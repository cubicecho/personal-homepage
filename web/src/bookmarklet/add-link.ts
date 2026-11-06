// What the bookmarklet sends and builds. Plain functions over plain data, with no React and no app
// imports, so the tests can run them under Node.

/** The only schemes an address added from another page may use. A `javascript:` one would run here. */
const WEB_PROTOCOLS = ['http:', 'https:'];
/** A catalogue icon reference: `di:jellyfin`, `sh:home-assistant`. The server's own rule. */
const CATALOGUE_ICON = /^(di|sh):[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;
/** Hosts that only ever mean "this machine". */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'];

/** The longest each `/add` parameter is kept, in characters. Longer is cut, so a huge URL can't bloat the form. */
const MAX_PARAM_LENGTH = { url: 2048, title: 500, description: 1000, icon: 2048 } as const;

/** What `/add?…` carries. Every member is a trimmed, non-empty string, or absent. */
export interface AddLinkSearch {
  url?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  icon?: string | undefined;
}

/** Where the app's address came from, as the API says. */
export type AppUrlSource = 'ENV' | 'PAIRED' | 'FALLBACK';

/** The address the bookmarklet opens, and why that one. */
export interface BookmarkletOrigin {
  origin: string;
  /** `configured` by APP_URL, recorded at `paired`, or this `browser`'s own address. */
  source: 'configured' | 'paired' | 'browser';
}

/**
 * Reads one search parameter: a string, trimmed and cut to a length.
 *
 * @param value - The raw parameter.
 * @param maxLength - The longest kept.
 * @returns The text, or undefined when it is missing, not a string, or blank.
 */
function textParam(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const text = value.trim().slice(0, maxLength);
  return text === '' ? undefined : text;
}

/**
 * Validates `/add`'s search parameters. Anything else in the query is dropped.
 *
 * @param search - The parsed query string.
 * @returns The known parameters.
 */
export function parseAddLinkSearch(search: Record<string, unknown>): AddLinkSearch {
  return {
    url: textParam(search.url, MAX_PARAM_LENGTH.url),
    title: textParam(search.title, MAX_PARAM_LENGTH.title),
    description: textParam(search.description, MAX_PARAM_LENGTH.description),
    icon: textParam(search.icon, MAX_PARAM_LENGTH.icon),
  };
}

/**
 * Checks that an address can be added as an item.
 *
 * @param url - The address.
 * @returns Whether it is an absolute http or https URL.
 */
export function isWebAddress(url: string | undefined): url is string {
  if (url === undefined || URL.canParse(url) === false) {
    return false;
  }
  return WEB_PROTOCOLS.includes(new URL(url).protocol);
}

/**
 * Keeps an `icon` parameter only when it is a reference the app knows how to draw from elsewhere.
 *
 * @param icon - The parameter.
 * @returns A catalogue reference or an image URL, or null for anything else.
 */
export function iconFromParam(icon: string | undefined): string | null {
  if (icon === undefined) {
    return null;
  }
  const lowered = icon.toLowerCase();
  if (CATALOGUE_ICON.test(lowered)) {
    return lowered;
  }
  return isWebAddress(icon) ? icon : null;
}

/**
 * Cuts a title to what the server accepts.
 *
 * @param title - The page's title.
 * @param [maxLength] - The server's limit, once it is known.
 * @returns The title, cut with an ellipsis when it is too long.
 */
export function capTitle(title: string, maxLength?: number): string {
  if (maxLength === undefined || title.length <= maxLength) {
    return title;
  }
  return `${title.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * Picks the address the bookmarklet opens: the one the server knows people use, unless it only has its
 * localhost fallback, when the address this browser has the homepage open at is better.
 *
 * @param setup - What the server says about its address, once it has.
 * @param setup.appUrl - The address.
 * @param setup.appUrlSource - Where it came from.
 * @param browserOrigin - `window.location.origin`.
 * @returns The origin, without a trailing slash, and where it came from.
 */
export function bookmarkletOrigin(
  setup: { appUrl: string; appUrlSource: AppUrlSource } | undefined,
  browserOrigin: string,
): BookmarkletOrigin {
  if (setup?.appUrlSource === 'ENV') {
    return { origin: setup.appUrl.replace(/\/+$/, ''), source: 'configured' };
  }
  if (setup?.appUrlSource === 'PAIRED') {
    return { origin: setup.appUrl.replace(/\/+$/, ''), source: 'paired' };
  }
  return { origin: browserOrigin.replace(/\/+$/, ''), source: 'browser' };
}

/**
 * Checks whether an origin only works on the machine it names.
 *
 * @param origin - An http(s) origin.
 * @returns True for localhost and the loopback addresses.
 */
export function isLocalOrigin(origin: string): boolean {
  if (URL.canParse(origin) === false) {
    return false;
  }
  return LOCAL_HOSTS.includes(new URL(origin).hostname);
}

/**
 * Builds the bookmarklet: a `javascript:` URL that opens this homepage's `/add` with the page it is
 * clicked on, its title and its meta description.
 *
 * @param origin - Where the homepage is, without a trailing slash.
 * @returns The bookmark's address.
 */
export function bookmarkletCode(origin: string): string {
  const target = JSON.stringify(`${origin}/add?url=`);
  return (
    'javascript:(()=>{const d=document.querySelector(\'meta[name="description"]\');' +
    `window.open(${target}+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title)` +
    "+(d&&d.content?'&description='+encodeURIComponent(d.content):''),'_blank','noopener')})()"
  );
}
