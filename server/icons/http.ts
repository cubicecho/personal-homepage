// STUB, to be built by the icons feature: GET /icons/... serves fetched favicons from the server's cache.
import type { Express } from 'express';
import type { PageStore } from '../pages/page.ts';

/** Where icon images are served under. */
export const ICONS_PATH_PREFIX = '/icons/';

/**
 * Serves icon images the server fetches itself, such as favicons.
 *
 * @param _app - The Express app.
 * @param _pages - Where pages are kept: a favicon is only fetched for an item that asks for one.
 * @param _dataDir - The data directory, where the cache is kept.
 */
export function mountIcons(_app: Express, _pages: PageStore, _dataDir: string): void {}
