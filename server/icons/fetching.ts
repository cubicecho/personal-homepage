// What the icon code needs from `fetch`: a function it can be given in tests, a body read with a size
// cap, and the clock and timing helpers they share.
import { MINUTES_PER_HOUR, MS_PER_SECOND, SECONDS_PER_MINUTE } from '../core/wire.ts';

/** The `fetch` the icon code calls. Tests pass their own, so nothing reaches the network. */
export type Fetch = typeof fetch;
/** The clock the icon code reads, in milliseconds since the epoch. Tests pass their own. */
export type Clock = () => number;

/** Milliseconds in a minute. */
export const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;
/** Milliseconds in an hour. */
export const MS_PER_HOUR = MINUTES_PER_HOUR * MS_PER_MINUTE;

/** Who the server says it is when it fetches icons. Some sites refuse a request with no user agent. */
export const ICON_USER_AGENT = 'Mozilla/5.0 (compatible; personal-homepage icon fetcher)';

/**
 * Reads a response's body, giving up once it passes a size.
 *
 * @param response - The response.
 * @param maxBytes - The most bytes to read.
 * @returns The body, or null when it is larger than `maxBytes` or has none.
 */
export async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  const isDeclaredTooBig = Number.isFinite(declared) && declared > maxBytes;
  if (isDeclaredTooBig || response.body === null) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
