import { mkdir, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import path from 'node:path';
import express from 'express';
import { strFromU8, unzipSync } from 'fflate';
import { parse } from 'yaml';
import type { OpenedDatabase } from '../../server/db/client.ts';
import { importYamlData } from '../../server/db/import-yaml.ts';
import { EXPORT_PATH, exportFilename, mountExport } from '../../server/export/zip-export.ts';
import { createDbPageStore } from '../../server/pages/db-page-store.ts';
import { HOME_SLUG, ItemKind, type PageStore } from '../../server/pages/page.ts';
import { parseWidget } from '../../server/pages/page-input.ts';
import { WidgetType } from '../../server/pages/widget.ts';
import { readYamlData } from '../../server/pages/yaml-format.ts';
import { createSiteSettings, type SiteSettings } from '../../server/site/site-settings.ts';
import { openTestDatabase, resetTestDatabase } from '../db.ts';
import { linkFields, makeDataDir, portOf } from '../helpers.ts';

/** A fixed moment for the file's name: 5 November 2026, local time. */
const NOVEMBER = 10;
const FIXED_DATE = new Date(2026, NOVEMBER, 5, 12);
const SEARX = { prefix: 's', name: 'SearXNG', url: 'http://searx.local/search?q={query}' };

describe('zip export', () => {
  let database: OpenedDatabase;
  let pages: PageStore;
  let site: SiteSettings;
  let server: Server;

  const download = async (): Promise<Record<string, string>> => {
    const response = await fetch(`http://127.0.0.1:${portOf(server)}${EXPORT_PATH}`);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="?homepage-2026-11-05\.zip"?$/);
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    return Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, strFromU8(bytes)]));
  };

  beforeAll(async () => {
    database = await openTestDatabase();
    await resetTestDatabase(database.db);
    pages = await createDbPageStore(database.db);
    site = createSiteSettings(database.db);
    await pages.createPage({ title: 'Media', icon: 'film' });
    await pages.addItem('media', null, linkFields('Jellyfin'));
    await pages.addSection('media', { title: 'Watch', collapsed: true });
    await pages.addItem(
      'media',
      'watch',
      linkFields('Grafana', { kind: ItemKind.Frame, opensIn: null, frameHeightPx: 480 }),
    );
    await site.setSearch({ engines: [SEARX] });
    const feed = parseWidget({ type: WidgetType.Rss, rss: { url: 'https://example.com/feed', limit: 5 } });
    await pages.addItem(
      HOME_SLUG,
      null,
      linkFields('News', {
        kind: ItemKind.Widget,
        url: null,
        opensIn: null,
        check: { enabled: false, url: null },
        widget: feed,
      }),
    );

    const app = express();
    mountExport(app, { pages, site }, () => FIXED_DATE);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await database.close();
  });

  it('writes site.yaml and one file per page, in the 1.x layout', async () => {
    const files = await download();
    expect(Object.keys(files).sort()).toEqual(['pages/home.yaml', 'pages/media.yaml', 'site.yaml']);
    expect(parse(files['site.yaml'] ?? '')).toEqual({ pageOrder: ['media'], search: { engines: [SEARX] } });
    expect(parse(files['pages/home.yaml'] ?? '')).toEqual({
      title: 'Home',
      icon: 'house',
      items: [
        {
          id: 'news',
          kind: 'widget',
          title: 'News',
          widget: { type: 'rss', url: 'https://example.com/feed', limit: 5 },
        },
      ],
    });
    expect(parse(files['pages/media.yaml'] ?? '')).toEqual({
      title: 'Media',
      icon: 'film',
      sections: [
        { id: 'main', items: [{ id: 'jellyfin', title: 'Jellyfin', url: 'http://nas.local:8096' }] },
        {
          id: 'watch',
          title: 'Watch',
          collapsed: true,
          items: [{ id: 'grafana', kind: 'frame', title: 'Grafana', url: 'http://nas.local:8096', frameHeightPx: 480 }],
        },
      ],
    });
  });

  it('restores into an empty database exactly as it was', async () => {
    const files = await download();
    const { dir, remove } = await makeDataDir();
    try {
      await mkdir(path.join(dir, 'pages'));
      for (const [name, text] of Object.entries(files)) {
        await writeFile(path.join(dir, name), text);
      }
      const before = await pages.list();
      const restored = await openTestDatabase();
      try {
        await importYamlData(restored.db, await readYamlData(dir), { replace: true });
        expect(await (await createDbPageStore(restored.db)).list()).toEqual(before);
        expect(await createSiteSettings(restored.db).storedSearch()).toEqual({ engines: [SEARX] });
      } finally {
        await restored.close();
      }
    } finally {
      await remove();
    }
  });

  it('names the file after the day', () => {
    expect(exportFilename(new Date(2027, 0, 9))).toBe('homepage-2027-01-09.zip');
  });
});
