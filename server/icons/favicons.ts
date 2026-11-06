// Finds and keeps a site's favicon. The server fetches it rather than the browser, because the server can
// reach LAN hosts that public favicon services can't, and because nobody else learns which sites are asked
// about.
//
// A site's favicon is the best `<link rel="icon">` (or `shortcut icon`, `apple-touch-icon`) on the page at
// its address, else `/favicon.ico`. An SVG wins, then the largest declared size. Only images are kept: the
// declared type must be an image, or the bytes must look like one.
//
// Answers are kept under `<dataDir>/cache/favicons/`, one pair of files per site address, for
// ICON_DEFAULTS.faviconCacheHours. A site with no favicon is remembered for
// ICON_DEFAULTS.failureRetryMinutes. When a refresh fails, the old image is kept.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ICON_DEFAULTS } from '../core/defaults.ts';
import { MS_PER_SECOND } from '../core/wire.ts';
import { isWebUrl } from '../pages/page-input.ts';
import { type Clock, type Fetch, ICON_USER_AGENT, MS_PER_HOUR, MS_PER_MINUTE, readCapped } from './fetching.ts';

/** A favicon, ready to serve. */
export interface Favicon {
  contentType: string;
  body: Uint8Array;
  /** A short hash of the body, for an ETag. */
  hash: string;
}

/** Finds sites' favicons and keeps them. */
export interface FaviconFetcher {
  /**
   * Gives a site's favicon, from cache when fresh.
   *
   * @param siteUrl - The site's address: an item's URL.
   * @returns The favicon, or null when the site has none that could be fetched.
   */
  get(siteUrl: string): Promise<Favicon | null>;
}

/** What the fetcher needs from its surroundings. */
export interface FaviconDeps {
  /** Where favicons are kept: `<dataDir>/cache/favicons`. */
  cacheDir: string;
  fetch: Fetch;
  now: Clock;
}

/** One `<link>` that names an icon. */
interface IconLink {
  href: string;
  /** How good it is: higher is better. */
  score: number;
}

const LINK_TAG = /<link\b[^>]*>/gi;
const ATTRIBUTE = /([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const ICON_RELS = new Set(['icon', 'shortcut icon', 'apple-touch-icon', 'apple-touch-icon-precomposed']);
const FALLBACK_PATH = '/favicon.ico';
const SVG_TYPE = 'image/svg+xml';
/** What an SVG link scores: it draws sharp at any size. */
const SVG_SCORE = 10_000;
/** The size an apple-touch-icon is when it doesn't say: Apple's own default. */
const APPLE_TOUCH_DEFAULT_PX = 180;
/** The size a plain icon link is when it doesn't say. */
const ICON_DEFAULT_PX = 16;
/** How much of the body is looked at to tell what kind of image it is. */
const SNIFF_BYTES = 512;
/** Characters of the hash kept for an ETag and a file name. */
const HASH_LENGTH = 16;
/** The first bytes of each binary image format a favicon comes in, in hex. */
const IMAGE_SIGNATURES: readonly { type: string; bytes: Uint8Array }[] = [
  { type: 'image/png', hex: '89504e47' },
  { type: 'image/x-icon', hex: '00000100' },
  { type: 'image/gif', hex: '47494638' },
  { type: 'image/jpeg', hex: 'ffd8ff' },
].map(({ type, hex }) => ({ type, bytes: new Uint8Array(Buffer.from(hex, 'hex')) }));
/** A WebP file starts `RIFF`, four bytes of length, then `WEBP`. */
const RIFF_TAG = 'RIFF';
const WEBP_TAG = 'WEBP';
const WEBP_TAG_START = 8;
/** An SVG document: an optional XML declaration, comments and doctype, then `<svg`. */
const SVG_START = /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype svg[^>]*>\s*)?<svg[\s>]/i;
/** Content types a server may send an image as without saying which: the bytes decide. */
const UNTYPED = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

const cachedMeta = z.union([
  z.object({ found: z.literal(true), contentType: z.string(), fetchedAt: z.number(), hash: z.string() }),
  z.object({ found: z.literal(false), fetchedAt: z.number() }),
]);
type CachedMeta = z.output<typeof cachedMeta>;

/**
 * Hashes bytes or text, shortened.
 *
 * @param data - What to hash.
 * @returns The first characters of its SHA-256, in hex.
 */
function shortHash(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex').slice(0, HASH_LENGTH);
}

/**
 * Reads the largest size in a `sizes` attribute.
 *
 * @param sizes - Such as `16x16 32x32`, or `any`.
 * @returns The largest width, or null when it names none.
 */
function largestSize(sizes: string): number | null {
  const widths = sizes
    .split(/\s+/)
    .map((size) => Number.parseInt(size.split(/x/i)[0] ?? '', 10))
    .filter((width) => Number.isFinite(width));
  return widths.length === 0 ? null : Math.max(...widths);
}

/**
 * Finds the icon links in a page, best first.
 *
 * @param html - The page.
 * @param baseUrl - The address the page was fetched from, which relative links are read against.
 * @returns The links' absolute addresses, best first; links that aren't http(s) are left out.
 */
export function iconLinks(html: string, baseUrl: string): string[] {
  const links: IconLink[] = [];
  for (const [tag] of html.matchAll(LINK_TAG)) {
    const attributes = new Map<string, string>();
    for (const match of tag.matchAll(ATTRIBUTE)) {
      const [, name = '', double, single, bare] = match;
      attributes.set(name.toLowerCase(), double ?? single ?? bare ?? '');
    }
    const rel = (attributes.get('rel') ?? '').toLowerCase().trim().replaceAll(/\s+/g, ' ');
    const href = attributes.get('href')?.trim() ?? '';
    if (ICON_RELS.has(rel) === false || href === '' || URL.canParse(href, baseUrl) === false) {
      continue;
    }
    const absolute = new URL(href, baseUrl).href;
    if (isWebUrl(absolute) === false) {
      continue;
    }
    const isSvg = attributes.get('type') === SVG_TYPE || new URL(absolute).pathname.endsWith('.svg');
    const isAppleTouch = rel.startsWith('apple-touch-icon');
    const declared = largestSize(attributes.get('sizes') ?? '');
    const size = declared ?? (isAppleTouch ? APPLE_TOUCH_DEFAULT_PX : ICON_DEFAULT_PX);
    links.push({ href: absolute, score: isSvg ? SVG_SCORE : size });
  }
  // A stable sort keeps the page's order between links that score the same.
  return links.sort((a, b) => b.score - a.score).map((link) => link.href);
}

/**
 * Tells what kind of image some bytes are.
 *
 * @param body - The bytes.
 * @returns The image's content type, or null when they don't look like an image.
 */
export function sniffImageType(body: Uint8Array): string | null {
  const signature = IMAGE_SIGNATURES.find(({ bytes }) => bytes.every((byte, index) => body[index] === byte));
  if (signature !== undefined) {
    return signature.type;
  }
  const head = new TextDecoder().decode(body.slice(0, SNIFF_BYTES));
  const isWebp = head.startsWith(RIFF_TAG) && head.slice(WEBP_TAG_START, WEBP_TAG_START + WEBP_TAG.length) === WEBP_TAG;
  if (isWebp) {
    return 'image/webp';
  }
  return SVG_START.test(head) ? SVG_TYPE : null;
}

/**
 * Decides what a fetched icon is, refusing anything that is not an image.
 *
 * @param declared - The response's content type, without parameters, lower case.
 * @param body - The bytes.
 * @returns The content type to serve it as, or null to refuse it.
 */
function imageTypeOf(declared: string, body: Uint8Array): string | null {
  const sniffed = sniffImageType(body);
  if (declared.startsWith('image/')) {
    // A declared SVG must really be one: it is served from this origin.
    const isFakeSvg = declared === SVG_TYPE && sniffed !== SVG_TYPE;
    return isFakeSvg ? null : declared;
  }
  return UNTYPED.has(declared) ? sniffed : null;
}

/**
 * Opens the favicon fetcher.
 *
 * @param deps - Where favicons are kept, and how to fetch and tell the time.
 * @returns The fetcher.
 */
export function createFaviconFetcher(deps: FaviconDeps): FaviconFetcher {
  const maxAgeMs = ICON_DEFAULTS.faviconCacheHours * MS_PER_HOUR;
  const retryMs = ICON_DEFAULTS.failureRetryMinutes * MS_PER_MINUTE;
  const timeoutMs = ICON_DEFAULTS.faviconTimeoutSeconds * MS_PER_SECOND;
  const inFlight = new Map<string, Promise<Favicon | null>>();

  const filesOf = (key: string) => ({
    meta: path.join(deps.cacheDir, `${key}.json`),
    body: path.join(deps.cacheDir, `${key}.bin`),
  });

  /**
   * Fetches one address with the icon fetcher's limits.
   *
   * @param url - The address.
   * @param accept - The Accept header.
   * @returns The response, or null when the site could not be reached or answered with an error.
   */
  const request = async (url: string, accept: string): Promise<Response | null> => {
    try {
      const response = await deps.fetch(url, {
        headers: { 'user-agent': ICON_USER_AGENT, accept },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) {
        return response;
      }
      await response.body?.cancel();
      return null;
    } catch {
      return null;
    }
  };

  /**
   * Fetches one candidate icon.
   *
   * @param url - Its address.
   * @returns It, or null when it isn't an image within the size limit.
   */
  const fetchImage = async (url: string): Promise<Favicon | null> => {
    const response = await request(url, 'image/*');
    if (response === null) {
      return null;
    }
    try {
      const body = await readCapped(response, ICON_DEFAULTS.maxFaviconBytes);
      if (body === null || body.byteLength === 0) {
        return null;
      }
      const declared = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
      const contentType = imageTypeOf(declared, body);
      return contentType === null ? null : { contentType, body, hash: shortHash(body) };
    } catch {
      return null;
    }
  };

  /**
   * Looks a site's favicon up on the network.
   *
   * @param siteUrl - The site's address.
   * @returns The favicon, or null when there is none.
   */
  const discover = async (siteUrl: string): Promise<Favicon | null> => {
    const candidates: string[] = [];
    const page = await request(siteUrl, 'text/html,application/xhtml+xml');
    let baseUrl = siteUrl;
    if (page !== null) {
      baseUrl = page.url === '' ? siteUrl : page.url;
      const isHtml = (page.headers.get('content-type') ?? '').includes('html');
      const body = isHtml ? await readCapped(page, ICON_DEFAULTS.maxFaviconPageBytes).catch(() => null) : null;
      if (isHtml === false) {
        await page.body?.cancel();
      }
      if (body !== null) {
        candidates.push(...iconLinks(new TextDecoder().decode(body), baseUrl));
      }
    }
    candidates.push(new URL(FALLBACK_PATH, baseUrl).href);
    const fallbackFromSite = new URL(FALLBACK_PATH, siteUrl).href;
    if (candidates.includes(fallbackFromSite) === false) {
      candidates.push(fallbackFromSite);
    }
    for (const candidate of candidates) {
      const favicon = await fetchImage(candidate);
      if (favicon !== null) {
        return favicon;
      }
    }
    return null;
  };

  /**
   * Reads what is kept for a site.
   *
   * @param key - The site's cache key.
   * @returns The kept answer and image, or null when nothing is kept.
   */
  const readKept = async (key: string): Promise<{ meta: CachedMeta; favicon: Favicon | null } | null> => {
    const files = filesOf(key);
    try {
      const meta = cachedMeta.parse(JSON.parse(await readFile(files.meta, 'utf-8')));
      if (meta.found === false) {
        return { meta, favicon: null };
      }
      const body = new Uint8Array(await readFile(files.body));
      return { meta, favicon: { contentType: meta.contentType, body, hash: meta.hash } };
    } catch {
      return null;
    }
  };

  /**
   * Keeps an answer for a site.
   *
   * @param key - The site's cache key.
   * @param favicon - The favicon, or null to remember there is none.
   * @param fetchedAt - When it counts as fetched: now, unless an old image is kept a while longer.
   */
  const keep = async (key: string, favicon: Favicon | null, fetchedAt: number): Promise<void> => {
    const files = filesOf(key);
    const meta: CachedMeta =
      favicon === null
        ? { found: false, fetchedAt }
        : { found: true, contentType: favicon.contentType, fetchedAt, hash: favicon.hash };
    await mkdir(deps.cacheDir, { recursive: true });
    if (favicon !== null) {
      const temp = `${files.body}.${process.pid}.tmp`;
      await writeFile(temp, favicon.body);
      await rename(temp, files.body);
    }
    const temp = `${files.meta}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(meta), 'utf-8');
    await rename(temp, files.meta);
  };

  /**
   * Gives a site's favicon, refreshing what is kept when it is stale.
   *
   * @param siteUrl - The site's address.
   * @returns The favicon, or null.
   */
  const resolve = async (siteUrl: string): Promise<Favicon | null> => {
    const key = shortHash(siteUrl);
    const kept = await readKept(key);
    const age = kept === null ? Number.POSITIVE_INFINITY : deps.now() - kept.meta.fetchedAt;
    const isFresh = kept !== null && age < (kept.meta.found ? maxAgeMs : retryMs);
    if (isFresh) {
      return kept.favicon;
    }
    const found = await discover(siteUrl);
    const old = kept?.favicon ?? null;
    const isKeepingOld = found === null && old !== null;
    // When the site is down or changed, the old icon is better than none. It is tried again after the
    // retry wait rather than the full cache time.
    const answer = isKeepingOld ? old : found;
    const fetchedAt = isKeepingOld ? deps.now() - maxAgeMs + retryMs : deps.now();
    await keep(key, answer, fetchedAt).catch((error: unknown) => {
      console.warn(`[icons] could not keep the favicon of ${siteUrl}:`, error);
    });
    return answer;
  };

  return {
    get: (siteUrl) => {
      const running = inFlight.get(siteUrl);
      if (running !== undefined) {
        return running;
      }
      const started = resolve(siteUrl).finally(() => inFlight.delete(siteUrl));
      inFlight.set(siteUrl, started);
      return started;
    },
  };
}
