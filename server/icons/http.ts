// GET /icons/favicon/<page>/<item>: the item's site's favicon, fetched and kept by the server.
//
// Only an item that is stored can be asked about, so this can't be used to make the server fetch an
// arbitrary address. The image is served from this origin, so it is sent with a policy that stops an
// SVG's scripts from running if someone opens it as a page.
import path from 'node:path';
import type { Express, Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { type IconLinks, isSignedIconPath } from '../auth/icon-links.ts';
import { ICON_DEFAULTS } from '../core/defaults.ts';
import { HttpStatus } from '../core/wire.ts';
import { itemsOf, type PageStore } from '../pages/page.ts';
import { SLUG_PATTERN } from '../pages/page-input.ts';
import { createFaviconFetcher, type FaviconFetcher } from './favicons.ts';
import type { Clock, Fetch } from './fetching.ts';

/** Where icon images are served under. */
export const ICONS_PATH_PREFIX = '/icons/';
const FAVICON_ROUTE = `${ICONS_PATH_PREFIX}favicon/:pageSlug/:itemId`;
const DISCOVERED_FAVICON_ROUTE = `${ICONS_PATH_PREFIX}discovered/:id`;
/** Where favicons are kept, under the data directory. */
export const FAVICON_CACHE_DIR = path.join('cache', 'favicons');
/** Served with every icon: no script runs and nothing loads if it is opened as a page. */
const ICON_SECURITY_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/**
 * Names the address an item's favicon is served at.
 *
 * @param pageSlug - The item's page.
 * @param itemId - The item.
 * @returns The path, under ICONS_PATH_PREFIX.
 */
export function faviconPath(pageSlug: string, itemId: string): string {
  return `${ICONS_PATH_PREFIX}favicon/${encodeURIComponent(pageSlug)}/${encodeURIComponent(itemId)}`;
}

/**
 * Names the address a discovered app's favicon is served at.
 *
 * @param id - The discovered app's id.
 * @returns The path, under ICONS_PATH_PREFIX.
 */
export function discoveredFaviconPath(id: string): string {
  return `${ICONS_PATH_PREFIX}discovered/${encodeURIComponent(id)}`;
}

/** What the icon routes can be given in tests. */
export interface IconRouteOptions {
  /**
   * Finds the address of a discovered app, so its favicon can be served before it is on a page. Left out,
   * discovered apps get no favicon.
   */
  discoveredUrl?: (id: string) => Promise<string | null>;
  /**
   * How icon links are signed now. Asked per request: pairing a provider turns signing on while the
   * server runs. Left out, links need no proof.
   */
  iconLinks?: () => IconLinks;
  fetch?: Fetch;
  now?: Clock;
}

/**
 * Finds the address of a stored item.
 *
 * @param pages - Where pages are kept.
 * @param pageSlug - The item's page.
 * @param itemId - The item.
 * @returns Its URL, or null when there is no such page or item, or the page can't be read.
 */
async function storedItemUrl(pages: PageStore, pageSlug: string, itemId: string): Promise<string | null> {
  const isWellFormed = SLUG_PATTERN.test(pageSlug) && SLUG_PATTERN.test(itemId);
  if (isWellFormed === false) {
    return null;
  }
  try {
    const page = await pages.find(pageSlug);
    const item = page === null ? undefined : itemsOf(page).find((candidate) => candidate.id === itemId);
    return item?.url ?? null;
  } catch {
    return null;
  }
}

/**
 * Serves icon images the server fetches itself, such as favicons.
 *
 * @param app - The Express app.
 * @param pages - Where pages are kept: a favicon is only fetched for an item that is stored.
 * @param dataDir - The data directory, where the cache is kept.
 * @param [options] - A fetch and clock, for tests.
 */
export function mountIcons(app: Express, pages: PageStore, dataDir: string, options: IconRouteOptions = {}): void {
  const favicons: FaviconFetcher = createFaviconFetcher({
    cacheDir: path.join(dataDir, FAVICON_CACHE_DIR),
    fetch: options.fetch ?? globalThis.fetch,
    now: options.now ?? Date.now,
  });

  /**
   * Answers a request for a favicon the server fetches itself.
   *
   * @param req - The request.
   * @param res - The response.
   * @param path - The path the link was signed for.
   * @param siteUrlOf - Finds the address of the site whose favicon it is.
   */
  const serveFavicon = async (
    req: ExpressRequest,
    res: ExpressResponse,
    path: string,
    siteUrlOf: () => Promise<string | null>,
  ): Promise<void> => {
    const links = options.iconLinks?.();
    const query = new URLSearchParams(req.originalUrl.split('?')[1] ?? '');
    const isAllowed = links === undefined || isSignedIconPath(path, query, links);
    if (isAllowed === false) {
      // The same answer as an item with no icon, so a missing proof says nothing about what exists.
      res.status(HttpStatus.NotFound).type('text/plain').send('No icon.');
      return;
    }
    const siteUrl = await siteUrlOf();
    const favicon = siteUrl === null ? null : await favicons.get(siteUrl);
    if (favicon === null) {
      res.status(HttpStatus.NotFound).type('text/plain').send('No icon.');
      return;
    }
    const etag = `"${favicon.hash}"`;
    res.set({
      // Private once links are signed: a shared cache would hand it to anyone who asks.
      'cache-control': `${links?.isRequired ? 'private' : 'public'}, max-age=${ICON_DEFAULTS.faviconBrowserCacheSeconds}`,
      'content-security-policy': ICON_SECURITY_POLICY,
      'x-content-type-options': 'nosniff',
      etag,
    });
    if (req.get('if-none-match') === etag) {
      res.status(HttpStatus.NotModified).end();
      return;
    }
    res.type(favicon.contentType).send(Buffer.from(favicon.body));
  };

  app.get(FAVICON_ROUTE, (req, res) => {
    const { pageSlug, itemId } = req.params;
    return serveFavicon(req, res, faviconPath(pageSlug, itemId), () => storedItemUrl(pages, pageSlug, itemId));
  });

  app.get(DISCOVERED_FAVICON_ROUTE, (req, res) => {
    const { id } = req.params;
    const discoveredUrl = options.discoveredUrl;
    // Only an app the server found can be asked about, as only a stored item can above.
    return serveFavicon(req, res, discoveredFaviconPath(id), async () =>
      discoveredUrl === undefined ? null : discoveredUrl(id),
    );
  });
}
