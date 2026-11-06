// The one way a widget fetches: with a time limit and a size cap, and every failure turned into a
// sentence that names the address as written, so a secret filled into the real address never shows.
import { errorMessage } from '../core/errors.ts';
import { MS_PER_SECOND } from '../core/wire.ts';
import { readCapped } from '../icons/fetching.ts';
import { SECRET_REFERENCE } from '../pages/widget.ts';
import { WidgetError } from './widget-result.ts';

/** Bytes in a kibibyte, to say a size limit in words. */
const BYTES_PER_KIB = 1024;
/** Who the server says it is when it fetches for a widget. */
const USER_AGENT = 'Mozilla/5.0 (compatible; personal-homepage widgets)';
/** Network error codes, in words. */
const NETWORK_ERRORS: Readonly<Record<string, string>> = Object.freeze({
  ENOTFOUND: "its name doesn't resolve",
  EAI_AGAIN: "its name doesn't resolve",
  ECONNREFUSED: 'nothing is listening there',
  ECONNRESET: 'the connection was cut',
  EHOSTUNREACH: "the host can't be reached",
  ENETUNREACH: "the network can't be reached",
  ETIMEDOUT: 'the connection timed out',
  DEPTH_ZERO_SELF_SIGNED_CERT: "its certificate isn't trusted",
  SELF_SIGNED_CERT_IN_CHAIN: "its certificate isn't trusted",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "its certificate isn't trusted",
  CERT_HAS_EXPIRED: 'its certificate has expired',
  ERR_TLS_CERT_ALTNAME_INVALID: 'its certificate is for another name',
});

/** What a fetch needs besides the request. */
export interface FetchLimits {
  fetch: typeof fetch;
  timeoutSeconds: number;
  maxBytes: number;
}

/** A request, with its secrets already filled in, and the address as written for messages. */
export interface WidgetRequest {
  /** The address to fetch, secrets filled in. */
  url: string;
  /** The address as written, with secret references and not their values. */
  writtenUrl: string;
  init?: RequestInit;
}

/**
 * Names an address in a message without anything a secret could be in.
 *
 * @param writtenUrl - The address as written.
 * @returns Its host, or "the address" when it doesn't parse.
 */
export function hostOf(writtenUrl: string): string {
  const filled = writtenUrl.replace(SECRET_REFERENCE, 'secret');
  return URL.canParse(filled) ? new URL(filled).host : 'the address';
}

/**
 * Finds the code of a network failure, which fetch keeps in its cause.
 *
 * @param error - What fetch threw.
 * @returns The code, or null.
 */
function networkCode(error: unknown): string | null {
  const cause = error instanceof Error ? error.cause : null;
  const hasCode = cause instanceof Error && 'code' in cause && typeof cause.code === 'string';
  return hasCode ? String(cause.code) : null;
}

/**
 * Fetches a widget's source and reads its body as text.
 *
 * @param request - What to fetch.
 * @param limits - The fetch to use, and the time and size it may take.
 * @returns The body.
 * @throws WidgetError for a timeout, a network failure, an answer that isn't a success, or one too large.
 */
export async function fetchBody(request: WidgetRequest, limits: FetchLimits): Promise<string> {
  const host = hostOf(request.writtenUrl);
  let response: Response;
  try {
    response = await limits.fetch(request.url, {
      ...request.init,
      headers: { 'user-agent': USER_AGENT, ...request.init?.headers },
      redirect: 'follow',
      signal: AbortSignal.timeout(limits.timeoutSeconds * MS_PER_SECOND),
    });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'TimeoutError';
    if (isTimeout) {
      throw new WidgetError(`${host} didn't answer within ${limits.timeoutSeconds} seconds.`);
    }
    const code = networkCode(error);
    const reason = code === null ? errorMessage(error) : (NETWORK_ERRORS[code] ?? code);
    throw new WidgetError(`Couldn't reach ${host}: ${reason}.`);
  }
  if (response.ok === false) {
    await response.body?.cancel();
    const statusText = response.statusText === '' ? '' : ` ${response.statusText}`;
    throw new WidgetError(`${host} answered ${response.status}${statusText}.`);
  }
  const body = await readCapped(response, limits.maxBytes);
  if (body === null) {
    const isUnderKib = limits.maxBytes < BYTES_PER_KIB;
    const limit = isUnderKib ? `${limits.maxBytes} bytes` : `${Math.round(limits.maxBytes / BYTES_PER_KIB)} KiB`;
    throw new WidgetError(`${host} answered with more than ${limit}, which is more than a widget reads.`);
  }
  return new TextDecoder().decode(body);
}
