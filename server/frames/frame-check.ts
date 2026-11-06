// Asks a site whether other sites may show it in a frame, the way a browser would decide.
//
// Only the final response's headers are read (redirects are followed, the body is never read):
//
// - A `Content-Security-Policy` with `frame-ancestors` decides on its own; browsers ignore
//   `X-Frame-Options` when one is there. It allows an arbitrary homepage only with `*` or a bare
//   `http:`/`https:` scheme. `'none'`, `'self'` or a list of hosts are reported as blocking, since
//   the server can't know which origin the homepage is opened at.
// - Otherwise `X-Frame-Options: DENY` or `SAMEORIGIN` blocks it. Other values (the obsolete
//   `ALLOW-FROM`) are ignored by browsers, and so here.
// - `Content-Security-Policy-Report-Only` blocks nothing and is ignored.
//
// Answers are cached per URL for `cacheSeconds`, except "couldn't reach it"; two checks of one URL at
// once share one request.
import { FRAME_CHECK_DEFAULTS, type FrameCheckSettings } from '../core/defaults.ts';
import { errorMessage } from '../core/errors.ts';
import { MS_PER_SECOND } from '../core/wire.ts';

/** Whether a site lets other sites show it in a frame. */
export interface FrameCheckResult {
  url: string;
  /** True when nothing forbids it, false when a header does, null when the site could not be reached. */
  framable: boolean | null;
  /** What decided it, in a sentence. */
  reason: string | null;
}

/** Checks sites for framing rules. */
export interface FrameChecker {
  /**
   * Checks one URL.
   *
   * @param url - An http(s) URL, already validated.
   * @returns What the site's headers say.
   */
  check(url: string): Promise<FrameCheckResult>;
}

/** What the checker uses from the outside world, replaced in tests. */
export interface FrameCheckDeps {
  /** The fetch to call. Default: the global one. */
  fetch?: typeof fetch;
  /** The time now, in milliseconds since the epoch. Default: `Date.now`. */
  now?: () => number;
}

/** The headers' verdict, before the URL is attached. */
type Verdict = Omit<FrameCheckResult, 'url'>;

const FRAME_ANCESTORS = 'frame-ancestors';
/** Sources that let any web page frame the site. */
const OPEN_SOURCES = new Set(['*', 'http:', 'https:']);
const SELF_SOURCE = "'self'";
const NONE_SOURCE = "'none'";
/** The first HTTP status that is an error. */
const FIRST_ERROR_STATUS = 400;
const FRAMABLE_REASON = 'Nothing on the site forbids showing it inside another page.';
const BROWSER_REFUSES = "so browsers won't show it inside another site";

/**
 * Reads the `frame-ancestors` sources of every policy in a CSP header.
 *
 * @param header - The header's value. Several headers arrive joined by commas, one policy each.
 * @returns One list of sources per policy that has the directive. Every policy is enforced, so each must allow framing.
 */
function frameAncestorLists(header: string): string[][] {
  return header.split(',').flatMap((policy) => {
    const directive = policy
      .split(';')
      .map((part) => part.trim().split(/\s+/))
      .find(([name]) => name?.toLowerCase() === FRAME_ANCESTORS);
    return directive === undefined ? [] : [directive.slice(1).map((source) => source.toLowerCase())];
  });
}

/**
 * Decides from one `frame-ancestors` source list.
 *
 * @param sources - The directive's sources, lower-cased.
 * @returns The verdict, or null when the list allows any page.
 */
function ancestorsVerdict(sources: string[]): Verdict | null {
  const isOpen = sources.some((source) => OPEN_SOURCES.has(source));
  if (isOpen) {
    return null;
  }
  const hosts = sources.filter((source) => source !== SELF_SOURCE && source !== NONE_SOURCE);
  const isEmpty = sources.length === 0 || sources.includes(NONE_SOURCE);
  if (isEmpty) {
    return {
      framable: false,
      reason: `The site's Content-Security-Policy says frame-ancestors 'none', ${BROWSER_REFUSES}.`,
    };
  }
  if (hosts.length === 0) {
    return {
      framable: false,
      reason: `The site's Content-Security-Policy says frame-ancestors 'self', so browsers only show it inside pages on its own site.`,
    };
  }
  return {
    framable: false,
    reason: `The site's Content-Security-Policy only lets ${hosts.join(', ')} show it in a frame. It works only if this homepage is opened at one of those.`,
  };
}

/**
 * Decides from a response's headers, the way a browser does.
 *
 * @param headers - The final response's headers.
 * @returns Whether the site may be framed, and why.
 */
export function framingVerdict(headers: Headers): Verdict {
  const policies = frameAncestorLists(headers.get('content-security-policy') ?? '');
  if (policies.length > 0) {
    const blocking = policies.map(ancestorsVerdict).find((verdict) => verdict !== null);
    return blocking ?? { framable: true, reason: FRAMABLE_REASON };
  }
  const options = (headers.get('x-frame-options') ?? '').split(',').map((value) => value.trim().toUpperCase());
  if (options.includes('DENY')) {
    return { framable: false, reason: `The site sends X-Frame-Options: DENY, ${BROWSER_REFUSES}.` };
  }
  if (options.includes('SAMEORIGIN')) {
    return {
      framable: false,
      reason: 'The site sends X-Frame-Options: SAMEORIGIN, so browsers only show it inside pages on its own site.',
    };
  }
  return { framable: true, reason: FRAMABLE_REASON };
}

/**
 * Builds the frame checker.
 *
 * @param [overrides] - Settings to replace in `FRAME_CHECK_DEFAULTS`.
 * @param [deps] - The fetch and clock to use.
 * @returns A checker.
 */
export function createFrameChecker(
  overrides: Partial<FrameCheckSettings> = {},
  deps: FrameCheckDeps = {},
): FrameChecker {
  const settings = { ...FRAME_CHECK_DEFAULTS, ...overrides };
  const fetchUrl = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const cache = new Map<string, { result: FrameCheckResult; expiresAt: number }>();
  const inFlight = new Map<string, Promise<FrameCheckResult>>();

  /**
   * Asks the site, without the cache.
   *
   * @param url - The URL.
   * @returns What its headers say, or why it could not be asked.
   */
  const ask = async (url: string): Promise<FrameCheckResult> => {
    try {
      const response = await fetchUrl(url, {
        redirect: 'follow',
        headers: { accept: 'text/html,*/*' },
        signal: AbortSignal.timeout(settings.timeoutSeconds * MS_PER_SECOND),
      });
      // The headers are all that matter; a big or endless body must not be waited for.
      await response.body?.cancel().catch(() => undefined);
      const verdict = framingVerdict(response.headers);
      const isError = response.status >= FIRST_ERROR_STATUS;
      const reason =
        verdict.framable && isError
          ? `Nothing forbids framing it, but the site answered HTTP ${response.status}.`
          : verdict.reason;
      return { url, framable: verdict.framable, reason };
    } catch (error) {
      const host = new URL(url).host;
      return { url, framable: null, reason: `Couldn't reach ${host} to check: ${errorMessage(error)}.` };
    }
  };

  /** Forgets every answer that has expired, so the cache can't grow without end. */
  const prune = (): void => {
    const at = now();
    for (const [url, entry] of cache) {
      if (entry.expiresAt <= at) {
        cache.delete(url);
      }
    }
  };

  return {
    check: (url) => {
      const cached = cache.get(url);
      if (cached !== undefined && cached.expiresAt > now()) {
        return Promise.resolve(cached.result);
      }
      const pending = inFlight.get(url);
      if (pending !== undefined) {
        return pending;
      }
      const run = ask(url)
        .then((result) => {
          prune();
          // A site that couldn't be reached is asked again next time: it may be starting up.
          const isAnswer = result.framable !== null;
          if (isAnswer) {
            cache.set(url, { result, expiresAt: now() + settings.cacheSeconds * MS_PER_SECOND });
          }
          return result;
        })
        .finally(() => inFlight.delete(url));
      inFlight.set(url, run);
      return run;
    },
  };
}
