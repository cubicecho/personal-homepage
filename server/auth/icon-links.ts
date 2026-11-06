import { createHmac, timingSafeEqual } from 'node:crypto';
import { AUTH_DEFAULTS } from '../core/defaults.ts';
import { MINUTES_PER_HOUR, MS_PER_SECOND, SECONDS_PER_MINUTE } from '../core/wire.ts';

// The server serves some icons itself (a site's favicon, which it fetched), at /icons/…. A browser loads
// them with an <img>, which sends no `Authorization` header, so once sign-in is set up the address the
// API hands a viewer carries its own proof: an expiry and an HMAC of the path and the expiry, under the
// auth secret. Only a viewer who may see the item is handed the address, so only they can load it.

/** Where the server's own icons are served. */
const ICON_PATH_PREFIX = '/icons/';
/** The query parameter holding when the link stops working, in seconds since the epoch. */
const EXPIRES_PARAM = 'exp';
/** The query parameter holding the signature. */
const SIGNATURE_PARAM = 'sig';

/** How the request's icon links are made. */
export interface IconLinks {
  /** Whether links must be signed: when sign-in is set up. */
  isRequired: boolean;
  /** The key they are signed with. */
  secret: string;
  /** The clock, in milliseconds since the epoch. */
  now: () => number;
}

/**
 * Signs a path and its expiry.
 *
 * @param secret - The key.
 * @param path - The icon's path.
 * @param expires - When it stops working, in seconds since the epoch.
 * @returns The signature, base64url.
 */
function signature(secret: string, path: string, expires: number): string {
  return createHmac('sha256', secret).update(`${path}\n${expires}`).digest('base64url');
}

/**
 * Adds proof to an icon address the server serves itself.
 *
 * @param url - The icon's address: one of the server's own, or anything else.
 * @param links - How links are made for this request.
 * @returns The address with an expiry and a signature, when it is the server's own and links must be signed;
 * otherwise as given.
 */
export function signIconPath(url: string, links: IconLinks): string {
  const isOwn = url.startsWith(ICON_PATH_PREFIX);
  if (isOwn === false || links.isRequired === false) {
    return url;
  }
  const { iconLinkTtlHours } = AUTH_DEFAULTS;
  const ttlSeconds = iconLinkTtlHours * MINUTES_PER_HOUR * SECONDS_PER_MINUTE;
  const expires = Math.floor(links.now() / MS_PER_SECOND) + ttlSeconds;
  return `${url}?${EXPIRES_PARAM}=${expires}&${SIGNATURE_PARAM}=${signature(links.secret, url, expires)}`;
}

/**
 * Checks the proof on a request for one of the server's own icons.
 *
 * @param path - The path asked for, without its query.
 * @param query - The query's parameters.
 * @param links - How links are made.
 * @returns True when links need no proof, or the signature matches and has not expired.
 */
export function isSignedIconPath(path: string, query: URLSearchParams, links: IconLinks): boolean {
  if (links.isRequired === false) {
    return true;
  }
  const expires = Number(query.get(EXPIRES_PARAM));
  const given = Buffer.from(query.get(SIGNATURE_PARAM) ?? '');
  const isCurrent = Number.isInteger(expires) && expires * MS_PER_SECOND > links.now();
  if (isCurrent === false) {
    return false;
  }
  const wanted = Buffer.from(signature(links.secret, path, expires));
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
