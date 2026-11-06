// Checks each item from the server and caches the answer, so the browser never needs to reach the
// services itself (no CORS, and it works for addresses only the server can reach).
//
// A check asks for the headers only: HEAD first, and GET when a server refuses HEAD. Redirects are
// not followed; answering one means the service is up. So does 401 or 403: a sign-in page in front
// of a service is the service answering. A certificate the server does not trust (self-signed, as
// many LAN services are) also counts as up, with a note: something answered over TLS at that
// address, which is what the dot is for. Nothing is logged per check.
import { STATUS_DEFAULTS, type StatusSettings } from '../core/defaults.ts';
import { errorMessage } from '../core/errors.ts';
import { HttpStatus, MS_PER_SECOND } from '../core/wire.ts';
import { itemsOf, type Page } from '../pages/page.ts';

/** How an item's last check went. */
export const StatusState = { Up: 'UP', Down: 'DOWN', Unknown: 'UNKNOWN' } as const;
export type StatusState = (typeof StatusState)[keyof typeof StatusState];

/** One item's status, from the last check of it. */
export interface ItemStatus {
  itemId: string;
  state: StatusState;
  httpStatus: number | null;
  latencyMs: number | null;
  /** ISO 8601. */
  checkedAt: string | null;
  message: string | null;
}

/** Checks items and remembers the answers for a while. */
export interface StatusChecker {
  /**
   * Gives the status of every checked item on a page, checking those whose answer is stale.
   *
   * @param page - The page.
   * @returns One status per item with checking on, in page order.
   */
  forPage(page: Page): Promise<ItemStatus[]>;
}

/** What the checker needs from outside, replaceable in tests. */
export interface StatusCheckerDeps {
  /** Makes the requests. */
  fetch: typeof fetch;
  /** The time, in milliseconds since the epoch. */
  now: () => number;
}

/** One URL's answer, shared by every item that checks that URL. */
type UrlStatus = Omit<ItemStatus, 'itemId'>;

/** The statuses a check reads, beyond `HttpStatus`. */
const CheckStatus = {
  /** The first status that is neither a success nor a redirect. */
  FirstError: 400,
  Unauthorized: 401,
  Forbidden: 403,
  MethodNotAllowed: 405,
  NotImplemented: 501,
} as const;
/** Statuses that mean the server would not answer HEAD, so GET is tried. */
const HEAD_REFUSED = new Set<number>([CheckStatus.MethodNotAllowed, CheckStatus.NotImplemented]);
/** Statuses that mean a sign-in stands in front of the service: it is up. */
const AUTH_WALL = new Set<number>([CheckStatus.Unauthorized, CheckStatus.Forbidden]);

/** Node's codes for a certificate it could not verify, though the server answered. */
const UNTRUSTED_CERTIFICATE_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/**
 * Lists a failed fetch's error and the errors behind it: Node puts the socket's error in `cause`.
 *
 * @param error - What fetch threw.
 * @returns The chain, outermost first.
 */
function causeChain(error: unknown): Error[] {
  const chain: Error[] = [];
  let current: unknown = error;
  while (current instanceof Error && chain.includes(current) === false) {
    chain.push(current);
    current = current.cause;
  }
  return chain;
}

/**
 * Finds the error code behind a failed fetch.
 *
 * @param error - What fetch threw.
 * @returns The first code in the chain, such as ECONNREFUSED, or null when there is none.
 */
function errorCode(error: unknown): string | null {
  for (const link of causeChain(error)) {
    const code: unknown = Reflect.get(link, 'code');
    if (typeof code === 'string') {
      return code;
    }
  }
  return null;
}

/**
 * Checks whether a fetch failed because its time ran out.
 *
 * @param error - What fetch threw.
 * @returns True for an abort or a timeout.
 */
function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

/**
 * Says in a sentence why a URL could not be reached.
 *
 * @param error - What fetch threw.
 * @param url - The URL checked.
 * @param timeoutSeconds - How long the check was given.
 * @returns The sentence.
 */
function describeFailure(error: unknown, url: string, timeoutSeconds: number): string {
  const { host, hostname } = new URL(url);
  if (isTimeout(error)) {
    return `No answer within ${timeoutSeconds} seconds.`;
  }
  switch (errorCode(error)) {
    case 'ECONNREFUSED':
      return `Nothing is listening at ${host}.`;
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `The name ${hostname} doesn't resolve.`;
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return `${hostname} can't be reached on the network.`;
    case 'ECONNRESET':
    case 'UND_ERR_SOCKET':
      return 'The connection was dropped before it answered.';
    default:
      return `It couldn't be reached: ${errorMessage(causeChain(error).at(-1) ?? error)}.`;
  }
}

/**
 * Builds the status checker.
 *
 * @param [overrides] - Settings to use instead of STATUS_DEFAULTS.
 * @param [deps] - The fetch and clock to use instead of the real ones.
 * @returns A checker.
 */
export function createStatusChecker(
  overrides: Partial<StatusSettings> = {},
  deps: Partial<StatusCheckerDeps> = {},
): StatusChecker {
  const settings: StatusSettings = { ...STATUS_DEFAULTS, ...overrides };
  const fetchUrl = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const cache = new Map<string, { status: UrlStatus; expiresAt: number }>();
  const inFlight = new Map<string, Promise<UrlStatus>>();
  const waiting: Array<() => void> = [];
  let running = 0;

  /**
   * Waits for a free slot, so at most `maxConcurrentChecks` run at once.
   *
   * @returns Once a slot is free; the caller must call `release`.
   */
  const acquire = async (): Promise<void> => {
    if (running < settings.maxConcurrentChecks) {
      running += 1;
      return;
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
  };

  /** Hands the slot to the next waiting check, or frees it. */
  const release = (): void => {
    const next = waiting.shift();
    if (next === undefined) {
      running -= 1;
      return;
    }
    next();
  };

  /**
   * Asks a URL for its headers, HEAD first and GET when HEAD is refused.
   *
   * @param url - The URL.
   * @param signal - Aborts both requests when the time is up.
   * @returns The response, its body unread and cancelled.
   */
  const request = async (url: string, signal: AbortSignal): Promise<Response> => {
    const head = await fetchUrl(url, { method: 'HEAD', redirect: 'manual', signal });
    await head.body?.cancel();
    if (HEAD_REFUSED.has(head.status) === false) {
      return head;
    }
    const get = await fetchUrl(url, { method: 'GET', redirect: 'manual', signal });
    await get.body?.cancel();
    return get;
  };

  /**
   * Checks one URL now.
   *
   * @param url - The URL.
   * @returns Its status.
   */
  const check = async (url: string): Promise<UrlStatus> => {
    await acquire();
    const started = now();
    try {
      const response = await request(url, AbortSignal.timeout(settings.timeoutSeconds * MS_PER_SECOND));
      const status = response.status;
      const isAnswer = status >= HttpStatus.Ok && status < CheckStatus.FirstError;
      const isAuthWall = AUTH_WALL.has(status);
      const isUp = isAnswer || isAuthWall;
      let message: string | null = null;
      if (isAuthWall) {
        message = `It asks for a sign-in (HTTP ${status}).`;
      } else if (isUp === false) {
        message = `It answered HTTP ${status}.`;
      }
      return {
        state: isUp ? StatusState.Up : StatusState.Down,
        httpStatus: status,
        latencyMs: now() - started,
        checkedAt: new Date(now()).toISOString(),
        message,
      };
    } catch (error) {
      const code = errorCode(error);
      const isUntrusted = code !== null && UNTRUSTED_CERTIFICATE_CODES.has(code);
      return {
        state: isUntrusted ? StatusState.Up : StatusState.Down,
        httpStatus: null,
        latencyMs: isUntrusted ? now() - started : null,
        checkedAt: new Date(now()).toISOString(),
        message: isUntrusted
          ? "It answered, but its certificate isn't trusted (self-signed or expired)."
          : describeFailure(error, url, settings.timeoutSeconds),
      };
    } finally {
      release();
    }
  };

  /**
   * Gives a URL's status from cache when fresh, joining a check already running for it.
   *
   * @param url - The URL.
   * @returns Its status.
   */
  const statusOf = (url: string): Promise<UrlStatus> => {
    const cached = cache.get(url);
    const isFresh = cached !== undefined && cached.expiresAt > now();
    if (isFresh) {
      return Promise.resolve(cached.status);
    }
    const running = inFlight.get(url);
    if (running !== undefined) {
      return running;
    }
    const checking = check(url).then((status) => {
      cache.set(url, { status, expiresAt: now() + settings.cacheSeconds * MS_PER_SECOND });
      inFlight.delete(url);
      return status;
    });
    inFlight.set(url, checking);
    return checking;
  };

  /** Forgets answers that have gone stale, so the cache holds only URLs still being asked about. */
  const prune = (): void => {
    const time = now();
    for (const [url, entry] of cache) {
      if (entry.expiresAt <= time) {
        cache.delete(url);
      }
    }
  };

  return {
    forPage: async (page) => {
      prune();
      const checked = itemsOf(page).filter((item) => item.check.enabled);
      return Promise.all(
        checked.map(async (item) => ({ itemId: item.id, ...(await statusOf(item.check.url ?? item.url)) })),
      );
    },
  };
}
