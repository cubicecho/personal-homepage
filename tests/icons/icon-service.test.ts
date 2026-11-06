import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ICON_DEFAULTS } from '../../server/core/defaults.ts';
import { DASHBOARD_ICONS, SELFHST } from '../../server/icons/catalogues.ts';
import { MS_PER_HOUR, MS_PER_MINUTE } from '../../server/icons/fetching.ts';
import { createIconService, ICON_CACHE_DIR, IconSource, matchRank } from '../../server/icons/icon-service.ts';
import { BUILT_IN_ICONS } from '../../server/pages/page.ts';
import { makeDataDir } from '../helpers.ts';

/** dashboard-icons' tree.json, cut down. */
const TREE = {
  svg: ['jellyfin.svg', 'jellyseerr.svg', 'home-assistant.svg'],
  png: ['jellyfin.png', 'jellyseerr.png', 'home-assistant.png', 'plex.png'],
  webp: ['jellyfin.webp', 'plex.webp'],
};
/** selfh.st's index.json, cut down. */
const SELFHST_INDEX = [
  { Name: 'Jellyfin', Reference: 'jellyfin', SVG: 'Yes', PNG: 'Yes', WebP: 'Yes' },
  { Name: 'Navidrome', Reference: 'navidrome', SVG: 'No', PNG: 'Yes', WebP: 'Yes' },
  { Name: 'Smelly Jelly', Reference: 'smelly-jelly', SVG: 'No', PNG: 'No', WebP: 'No' },
];

describe('icon service', () => {
  let dataDir: string;
  let remove: () => Promise<void>;
  let now: number;
  let calls: string[];
  let isOffline: boolean;
  let warn: ReturnType<typeof vi.spyOn>;

  /** Answers the two listing URLs from the fixtures above, and nothing else. */
  const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    if (isOffline) {
      throw new Error('ENOTFOUND');
    }
    const listings = new Map<string, unknown>([
      [DASHBOARD_ICONS.listingUrl, TREE],
      [SELFHST.listingUrl, SELFHST_INDEX],
    ]);
    const listing = listings.get(url);
    return listing === undefined
      ? new Response('not found', { status: 404 })
      : new Response(JSON.stringify(listing), { headers: { 'content-type': 'application/json' } });
  };

  const open = () => createIconService({ dataDir, fetch: fakeFetch as typeof fetch, now: () => now });

  beforeEach(async () => {
    ({ dir: dataDir, remove } = await makeDataDir());
    now = Date.UTC(2026, 10, 5);
    calls = [];
    isOffline = false;
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    warn.mockRestore();
    await remove();
  });

  describe('urlFor', () => {
    const item = { pageSlug: 'home', itemId: 'jellyfin' };
    const page = { pageSlug: 'home', itemId: null };

    it('gives no URL for a glyph or no icon, and an image URL as it is', () => {
      const icons = open();
      expect(icons.urlFor(null, item)).toBeNull();
      expect(icons.urlFor('film', item)).toBeNull();
      expect(icons.urlFor('https://cdn.example.com/a.png', item)).toBe('https://cdn.example.com/a.png');
    });

    it("gives an item's favicon its route, and a page none", () => {
      const icons = open();
      expect(icons.urlFor('favicon', item)).toBe('/icons/favicon/home/jellyfin');
      expect(icons.urlFor('favicon', page)).toBeNull();
    });

    it('picks the best format the catalogue lists, PNG until it has been read', async () => {
      const icons = open();
      expect(icons.urlFor('di:jellyfin', item)).toBe(DASHBOARD_ICONS.imageUrl('jellyfin', 'png'));
      await icons.search('jelly', ICON_DEFAULTS.maxSearchResults);
      expect(icons.urlFor('di:jellyfin', item)).toBe(DASHBOARD_ICONS.imageUrl('jellyfin', 'svg'));
      expect(icons.urlFor('di:plex', item)).toBe(DASHBOARD_ICONS.imageUrl('plex', 'png'));
      expect(icons.urlFor('sh:navidrome', item)).toBe(SELFHST.imageUrl('navidrome', 'png'));
      expect(icons.urlFor('sh:jellyfin', item)).toBe('https://cdn.jsdelivr.net/gh/selfhst/icons/svg/jellyfin.svg');
    });

    it('reads the listings kept on disk straight away', async () => {
      await open().search('jelly', ICON_DEFAULTS.maxSearchResults);
      calls = [];
      expect(open().urlFor('di:jellyfin', item)).toBe(DASHBOARD_ICONS.imageUrl('jellyfin', 'svg'));
      expect(calls).toEqual([]);
    });
  });

  describe('search', () => {
    it('lists every glyph for an empty query, and asks no catalogue', async () => {
      const results = await open().search('', ICON_DEFAULTS.maxSearchResults);
      expect(results.map((result) => result.ref)).toEqual(
        [...BUILT_IN_ICONS].sort((a, b) => a.length - b.length || a.localeCompare(b)),
      );
      expect(calls).toEqual([]);
    });

    it('puts glyphs first, then catalogue icons by how well they match', async () => {
      const results = await open().search('Jelly', ICON_DEFAULTS.maxSearchResults);
      expect(results.map((result) => result.ref)).toEqual(['di:jellyfin', 'sh:jellyfin', 'di:jellyseerr']);
      expect(results[0]).toMatchObject({
        label: 'Jellyfin',
        source: IconSource.DashboardIcons,
        url: DASHBOARD_ICONS.imageUrl('jellyfin', 'svg'),
      });
      expect(results.find((result) => result.ref === 'sh:smelly-jelly')).toBeUndefined();
    });

    it('matches glyphs by name and label, and words inside names', async () => {
      const icons = open();
      expect((await icons.search('game', 10)).map((result) => result.ref)).toEqual(['gamepad']);
      expect((await icons.search('assist', 10)).map((result) => result.ref)).toEqual(['di:home-assistant']);
    });

    it('searches one catalogue when the query names it', async () => {
      const results = await open().search('sh:jelly', ICON_DEFAULTS.maxSearchResults);
      expect(results.map((result) => result.ref)).toEqual(['sh:jellyfin']);
    });

    it('keeps to the limit', async () => {
      expect(await open().search('', 3)).toHaveLength(3);
    });

    it('downloads each listing once, keeps it, and refreshes it when it is stale', async () => {
      const icons = open();
      await Promise.all([icons.search('jelly', 10), icons.search('plex', 10)]);
      expect(calls.sort()).toEqual([DASHBOARD_ICONS.listingUrl, SELFHST.listingUrl].sort());
      const kept = JSON.parse(await readFile(path.join(dataDir, ICON_CACHE_DIR, DASHBOARD_ICONS.cacheFile), 'utf-8'));
      expect(kept.icons).toContainEqual({ name: 'jellyfin', label: 'Jellyfin', formats: ['svg', 'png', 'webp'] });

      calls = [];
      await icons.search('jelly', 10);
      expect(calls).toEqual([]);
      now += ICON_DEFAULTS.catalogueCacheHours * MS_PER_HOUR + 1;
      await icons.search('jelly', 10);
      expect(calls).toHaveLength(2);
    });

    it('gives glyphs only when offline, and waits before trying again', async () => {
      isOffline = true;
      const icons = open();
      const results = await icons.search('film', 10);
      expect(results.map((result) => result.ref)).toEqual(['film']);
      expect(calls).toHaveLength(2);

      await icons.search('jelly', 10);
      expect(calls).toHaveLength(2);
      now += ICON_DEFAULTS.failureRetryMinutes * MS_PER_MINUTE + 1;
      isOffline = false;
      expect((await icons.search('jelly', 10)).length).toBeGreaterThan(0);
    });

    it('keeps an old listing when a refresh fails', async () => {
      await open().search('jelly', 10);
      isOffline = true;
      now += ICON_DEFAULTS.catalogueCacheHours * MS_PER_HOUR + 1;
      const results = await open().search('jelly', 10);
      expect(results.map((result) => result.ref)).toContain('di:jellyfin');
    });
  });
});

describe('matchRank', () => {
  it('ranks exact, prefix, word prefix, then anywhere', () => {
    expect(matchRank('plex', ['plex'])).toBe(0);
    expect(matchRank('ple', ['plex'])).toBe(1);
    expect(matchRank('assist', ['home-assistant'])).toBe(2);
    expect(matchRank('lex', ['plex'])).toBe(3);
    expect(matchRank('zzz', ['plex'])).toBeNull();
  });
});
