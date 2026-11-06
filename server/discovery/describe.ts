// Describes an app from its address: fetches the page, follows its `<link rel="manifest">` to the web
// manifest (w3.org/TR/appmanifest), and reads its name, description and icon from that. A page with no
// manifest falls back to its `<title>`, meta description and icon links, and then to `favicon`, which the
// server fetches itself.
//
// Used for apps the server found, and for the item dialog's "Fill in". A found app's address came from the
// network, so anyone on it can announce one: those are only fetched when the name resolves to a private
// address. Every request has a time and size limit, and a redirect is only followed on the same host.
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';
import { DISCOVERY_DEFAULTS, type DiscoverySettings, PAGE_LIMIT_DEFAULTS } from '../core/defaults.ts';
import { errorMessage } from '../core/errors.ts';
import { MS_PER_SECOND, SECONDS_PER_MINUTE } from '../core/wire.ts';
import { iconLinks } from '../icons/favicons.ts';
import { type Clock, type Fetch, readCapped } from '../icons/fetching.ts';
import type { IconRef } from '../pages/page.ts';
import { FAVICON_ICON, isIconRef, isWebUrl } from '../pages/page-input.ts';

const { maxTitleLength, maxDescriptionLength, maxUrlLength } = PAGE_LIMIT_DEFAULTS;

/** What a page and its manifest say about an app. */
export interface Description {
  /** The address that was described. */
  url: string;
  /** The app's name, or null when the page names none. */
  title: string | null;
  description: string | null;
  /** An image address from the manifest or the page, `favicon` when the page links none, or null when it couldn't be read. */
  icon: IconRef | null;
  /** Why nothing could be read, in a sentence; null when the page was read. */
  problem: string | null;
}

/** How a description is asked for. */
export interface DescribeOptions {
  /**
   * Only fetch when the host resolves to private addresses: for addresses the network announced. The
   * item dialog's "Fill in" fetches what the person typed, so it doesn't.
   */
  requirePrivate: boolean;
}

/** Describes addresses, remembering the answers for a while. */
export interface Describer {
  /**
   * Describes the app at an address.
   *
   * @param url - An http(s) address.
   * @param options - Whether the address must be private.
   * @returns What its page says. Never throws: a page that can't be read gives a `problem`.
   */
  describe(url: string, options: DescribeOptions): Promise<Description>;
}

/** Resolves a host name to its addresses. */
export type Lookup = (hostname: string) => Promise<string[]>;

/** What the describer is given; tests pass their own. */
export interface DescriberDeps {
  fetch?: Fetch;
  lookup?: Lookup;
  now?: Clock;
}

/** Who the server says it is when it fetches a page. */
const USER_AGENT = 'Mozilla/5.0 (compatible; personal-homepage discovery)';
const HTML_TYPES = ['text/html', 'application/xhtml+xml'];
/** The statuses that send a browser on to the Location header. */
// biome-ignore lint/style/noMagicNumbers: HTTP's redirect statuses, which are known by these numbers.
const REDIRECT_STATUSES: readonly number[] = [301, 302, 303, 307, 308];
const LINK_TAG = /<link\b[^>]*>/gi;
const META_TAG = /<meta\b[^>]*>/gi;
const TITLE_TAG = /<title\b[^>]*>([\s\S]*?)<\/title>/i;
const ATTRIBUTE = /([a-z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
});
const ENTITY = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi;
const HEX_RADIX = 16;
const DECIMAL_RADIX = 10;
/** A manifest icon's purpose that only suits a mask or a single colour, not a tile. */
const UNSUITED_PURPOSES = new Set(['maskable', 'monochrome']);
/** What an icon declared as `sizes="any"` (an SVG) counts as: it draws sharp at any size. */
const ANY_SIZE_PX = 4096;
/** What `isIP` answers for each address family. */
const IPV4 = 4;
const IPV6 = 6;
/** IPv4 ranges only a local network uses, by first octet and a span of second octets. */
const PRIVATE_IPV4_RANGES: readonly { first: number; secondFrom: number; secondTo: number }[] = [
  { first: 10, secondFrom: 0, secondTo: 255 },
  { first: 127, secondFrom: 0, secondTo: 255 },
  { first: 172, secondFrom: 16, secondTo: 31 },
  { first: 192, secondFrom: 168, secondTo: 168 },
  { first: 169, secondFrom: 254, secondTo: 254 },
  // Carrier-grade NAT, which Tailscale uses.
  { first: 100, secondFrom: 64, secondTo: 127 },
];
/** IPv6 prefixes only a local network uses: unique-local and link-local. */
const PRIVATE_IPV6_PREFIXES = ['fc', 'fd', 'fe80'];
const IPV6_LOOPBACK = '::1';
/** How an IPv4 address written as IPv6 starts. */
const IPV4_MAPPED_PREFIX = '::ffff:';

const manifestSchema = z.object({
  name: z.string().nullish(),
  short_name: z.string().nullish(),
  description: z.string().nullish(),
  icons: z
    .array(
      z.object({
        src: z.string(),
        sizes: z.string().nullish(),
        type: z.string().nullish(),
        purpose: z.string().nullish(),
      }),
    )
    .nullish(),
});
type ManifestIcon = NonNullable<z.output<typeof manifestSchema>['icons']>[number];

/**
 * Checks whether an IP address is one only a local network uses.
 *
 * @param address - An IPv4 or IPv6 address.
 * @returns True for loopback, RFC 1918, link-local, carrier-grade NAT (Tailscale) and IPv6 unique-local addresses.
 */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === IPV4) {
    const [first = -1, second = -1] = address.split('.').map(Number);
    return PRIVATE_IPV4_RANGES.some(
      (range) => range.first === first && second >= range.secondFrom && second <= range.secondTo,
    );
  }
  if (version === IPV6) {
    const lower = address.toLowerCase();
    const mappedV4 = lower.startsWith(IPV4_MAPPED_PREFIX) ? lower.slice(IPV4_MAPPED_PREFIX.length) : null;
    if (mappedV4 !== null && isIP(mappedV4) === IPV4) {
      return isPrivateAddress(mappedV4);
    }
    return lower === IPV6_LOOPBACK || PRIVATE_IPV6_PREFIXES.some((prefix) => lower.startsWith(prefix));
  }
  return false;
}

/**
 * Resolves a name with the system resolver.
 *
 * @param hostname - The name.
 * @returns Its addresses.
 */
const systemLookup: Lookup = async (hostname) =>
  (await dnsLookup(hostname, { all: true })).map((entry) => entry.address);

/**
 * Turns HTML character references into the characters.
 *
 * @param text - Text from a page.
 * @returns It decoded, with runs of white space made one space.
 */
function decodeText(text: string): string {
  const decoded = text.replaceAll(ENTITY, (whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), HEX_RADIX));
    }
    if (name.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(name.slice(1), DECIMAL_RADIX));
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
  return decoded.replaceAll(/\s+/g, ' ').trim();
}

/**
 * Reads a tag's attributes.
 *
 * @param tag - The tag, such as `<meta name="description" content="…">`.
 * @returns Its attributes, names lower-cased.
 */
function attributesOf(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of tag.matchAll(ATTRIBUTE)) {
    const [, name = '', double, single, bare] = match;
    attributes.set(name.toLowerCase(), decodeText(double ?? single ?? bare ?? ''));
  }
  return attributes;
}

/** What a page's head says. */
interface PageHead {
  manifestHref: string | null;
  title: string | null;
  description: string | null;
  applicationName: string | null;
  siteName: string | null;
}

/**
 * Reads what a page's head says about the app.
 *
 * @param html - The page.
 * @returns Its manifest link, title, description and names.
 */
export function readHead(html: string): PageHead {
  const metas = new Map<string, string>();
  for (const [tag] of html.matchAll(META_TAG)) {
    const attributes = attributesOf(tag);
    const key = (attributes.get('name') ?? attributes.get('property') ?? '').toLowerCase();
    const content = attributes.get('content') ?? '';
    const isFirst = key !== '' && content !== '' && metas.has(key) === false;
    if (isFirst) {
      metas.set(key, content);
    }
  }
  let manifestHref: string | null = null;
  for (const [tag] of html.matchAll(LINK_TAG)) {
    const attributes = attributesOf(tag);
    const rels = (attributes.get('rel') ?? '').toLowerCase().split(/\s+/);
    const href = attributes.get('href') ?? '';
    if (rels.includes('manifest') && href !== '') {
      manifestHref = href;
      break;
    }
  }
  const title = decodeText(TITLE_TAG.exec(html)?.[1] ?? '');
  return {
    manifestHref,
    title: title === '' ? null : title,
    description: metas.get('description') ?? metas.get('og:description') ?? null,
    applicationName: metas.get('application-name') ?? null,
    siteName: metas.get('og:site_name') ?? null,
  };
}

/**
 * Reads the largest width in a `sizes` value.
 *
 * @param sizes - Such as `192x192 512x512`, or `any`.
 * @returns The width, ANY_SIZE_PX for `any`, or null when it names none.
 */
function iconWidth(sizes: string | null | undefined): number | null {
  const value = (sizes ?? '').trim().toLowerCase();
  if (value === 'any') {
    return ANY_SIZE_PX;
  }
  const widths = value
    .split(/\s+/)
    .map((size) => Number.parseInt(size.split('x')[0] ?? '', DECIMAL_RADIX))
    .filter((width) => Number.isFinite(width));
  return widths.length === 0 ? null : Math.max(...widths);
}

/**
 * Picks the manifest icon that suits a tile best.
 *
 * @param icons - The manifest's icons.
 * @param settings - The sizes to aim for.
 * @param settings.minIconSizePx - Smaller icons are passed over when a larger one exists.
 * @param settings.preferredIconSizePx - The size aimed for.
 * @returns The icon whose size is closest to the preferred one among those big enough, else the largest;
 * maskable-only and monochrome-only icons are left out. Null when none is left.
 */
export function pickManifestIcon(
  icons: readonly ManifestIcon[],
  settings: Pick<DiscoverySettings, 'minIconSizePx' | 'preferredIconSizePx'>,
): ManifestIcon | null {
  const suited = icons.filter((icon) => {
    const purposes = (icon.purpose ?? 'any').toLowerCase().split(/\s+/);
    return purposes.some((purpose) => UNSUITED_PURPOSES.has(purpose) === false);
  });
  const sized = suited.map((icon) => ({ icon, width: iconWidth(icon.sizes) ?? 0 }));
  const bigEnough = sized.filter((entry) => entry.width >= settings.minIconSizePx);
  if (bigEnough.length > 0) {
    const distance = (width: number): number => Math.abs(Math.min(width, ANY_SIZE_PX) - settings.preferredIconSizePx);
    return [...bigEnough].sort((a, b) => distance(a.width) - distance(b.width))[0]?.icon ?? null;
  }
  return [...sized].sort((a, b) => b.width - a.width)[0]?.icon ?? null;
}

/**
 * Cuts text to a length.
 *
 * @param text - The text, or nothing.
 * @param maxLength - The most characters kept.
 * @returns The text, trimmed and cut, or null when it is blank.
 */
function clip(text: string | null | undefined, maxLength: number): string | null {
  const trimmed = (text ?? '').replaceAll(/\s+/g, ' ').trim();
  if (trimmed === '') {
    return null;
  }
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1).trimEnd()}…` : trimmed;
}

/**
 * Keeps an icon address only when an item could store it.
 *
 * @param url - The address, or nothing.
 * @returns It, or null when it isn't an http(s) address short enough to keep.
 */
function usableIcon(url: string | null | undefined): IconRef | null {
  const isUsable = url !== null && url !== undefined && url.length <= maxUrlLength && isIconRef(url, true);
  return isUsable ? url : null;
}

/**
 * Builds the describer.
 *
 * @param [deps] - A fetch, a resolver and a clock, for tests.
 * @param [overrides] - Discovery settings to replace.
 * @returns The describer.
 */
export function createDescriber(deps: DescriberDeps = {}, overrides: Partial<DiscoverySettings> = {}): Describer {
  const settings = { ...DISCOVERY_DEFAULTS, ...overrides };
  const {
    describeTimeoutSeconds,
    maxPageBytes,
    maxManifestBytes,
    maxRedirects,
    describeCacheMinutes,
    failedDescribeCacheMinutes,
    maxCachedDescriptions,
  } = settings;
  const doFetch = deps.fetch ?? globalThis.fetch;
  const lookup = deps.lookup ?? systemLookup;
  const now = deps.now ?? Date.now;
  const cache = new Map<string, { at: number; description: Description }>();

  /**
   * Checks that a host only resolves to private addresses.
   *
   * @param url - The address.
   * @returns Why it may not be fetched, or null when it may.
   */
  const privateProblem = async (url: string): Promise<string | null> => {
    const hostname = new URL(url).hostname.replace(/^\[|\]$/g, '');
    try {
      const addresses = isIP(hostname) === 0 ? await lookup(hostname) : [hostname];
      const isPrivate = addresses.length > 0 && addresses.every(isPrivateAddress);
      return isPrivate ? null : `${hostname} is not an address on your network, so the server doesn't fetch it.`;
    } catch (error) {
      return `${hostname} could not be found from the server: ${errorMessage(error)}.`;
    }
  };

  /**
   * Fetches an address, following redirects only on its own host.
   *
   * @param url - The address.
   * @param accept - The Accept header.
   * @returns The final response and its address.
   * @throws When it can't be reached, or redirects to another host or too many times.
   */
  const fetchSameHost = async (url: string, accept: string): Promise<{ response: Response; url: string }> => {
    let current = url;
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const response = await doFetch(current, {
        redirect: 'manual',
        headers: { accept, 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(describeTimeoutSeconds * MS_PER_SECOND),
      });
      const location = response.headers.get('location');
      const isRedirect = REDIRECT_STATUSES.includes(response.status) && location !== null;
      if (isRedirect === false) {
        return { response, url: current };
      }
      await response.body?.cancel();
      const next = new URL(location, current);
      const isSameHost = next.hostname === new URL(current).hostname && isWebUrl(next.href);
      if (isSameHost === false) {
        throw new Error(`it redirects to ${next.hostname}, another host, which the server doesn't follow`);
      }
      current = next.href;
    }
    throw new Error('it redirects too many times');
  };

  /**
   * Reads a manifest.
   *
   * @param href - Its address, as the page wrote it.
   * @param pageUrl - The page's address, which it is read against.
   * @returns The manifest and its address, or null when it can't be read or is on another host.
   */
  const readManifest = async (href: string, pageUrl: string) => {
    if (URL.canParse(href, pageUrl) === false) {
      return null;
    }
    const manifestUrl = new URL(href, pageUrl).href;
    const isSameHost = new URL(manifestUrl).hostname === new URL(pageUrl).hostname && isWebUrl(manifestUrl);
    if (isSameHost === false) {
      return null;
    }
    try {
      const { response, url } = await fetchSameHost(manifestUrl, 'application/manifest+json, application/json');
      if (response.ok === false) {
        await response.body?.cancel();
        return null;
      }
      const body = await readCapped(response, maxManifestBytes);
      if (body === null) {
        return null;
      }
      const parsed = manifestSchema.safeParse(JSON.parse(Buffer.from(body).toString('utf-8')));
      return parsed.success ? { manifest: parsed.data, url } : null;
    } catch {
      return null;
    }
  };

  /**
   * Describes an address, without the cache.
   *
   * @param url - The address.
   * @param options - Whether it must be private.
   * @returns The description.
   */
  const describeNow = async (url: string, options: DescribeOptions): Promise<Description> => {
    const failed = (problem: string): Description => ({ url, title: null, description: null, icon: null, problem });
    if (isWebUrl(url) === false) {
      return failed('Only http:// and https:// addresses can be described.');
    }
    if (options.requirePrivate) {
      const problem = await privateProblem(url);
      if (problem !== null) {
        return failed(problem);
      }
    }
    let page: { response: Response; url: string };
    try {
      page = await fetchSameHost(url, HTML_TYPES.join(', '));
    } catch (error) {
      return failed(`The page could not be read: ${errorMessage(error)}.`);
    }
    const contentType = (page.response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    const isHtml = HTML_TYPES.includes(contentType);
    const isReadable = page.response.ok && isHtml;
    if (isReadable === false) {
      await page.response.body?.cancel();
      const why = page.response.ok ? 'it is not a web page' : `it answered ${page.response.status}`;
      return { ...failed(`The page could not be read: ${why}.`), icon: FAVICON_ICON };
    }
    // readCapped lets go of the body itself when it gives up.
    const body = await readCapped(page.response, maxPageBytes);
    if (body === null) {
      return { ...failed('The page could not be read: it is larger than the server reads.'), icon: FAVICON_ICON };
    }
    const html = Buffer.from(body).toString('utf-8');
    const head = readHead(html);
    const found = head.manifestHref === null ? null : await readManifest(head.manifestHref, page.url);
    const manifest = found?.manifest ?? null;
    const manifestIcon = found === null ? null : pickManifestIcon(manifest?.icons ?? [], settings);
    const manifestIconUrl =
      manifestIcon !== null && found !== null && URL.canParse(manifestIcon.src, found.url)
        ? new URL(manifestIcon.src, found.url).href
        : null;
    const pageIcon = iconLinks(html, page.url)[0] ?? null;
    return {
      url,
      title: clip(
        manifest?.name ?? manifest?.short_name ?? head.applicationName ?? head.siteName ?? head.title,
        maxTitleLength,
      ),
      description: clip(manifest?.description ?? head.description, maxDescriptionLength),
      icon: usableIcon(manifestIconUrl) ?? usableIcon(pageIcon) ?? FAVICON_ICON,
      problem: null,
    };
  };

  return {
    describe: async (url, options) => {
      const key = `${options.requirePrivate ? 'private' : 'any'} ${url}`;
      const cached = cache.get(key);
      const lifetimeMinutes = cached?.description.problem === null ? describeCacheMinutes : failedDescribeCacheMinutes;
      const isFresh = cached !== undefined && now() - cached.at < lifetimeMinutes * SECONDS_PER_MINUTE * MS_PER_SECOND;
      if (isFresh) {
        return cached.description;
      }
      const description = await describeNow(url, options);
      cache.delete(key);
      cache.set(key, { at: now(), description });
      // A Map keeps insertion order, so the first key is the oldest.
      while (cache.size > maxCachedDescriptions) {
        const [oldest] = cache.keys();
        if (oldest === undefined) {
          break;
        }
        cache.delete(oldest);
      }
      return description;
    },
  };
}
