import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import path from 'node:path';
import express from 'express';
import { strFromU8, unzipSync } from 'fflate';
import { EXPORT_PATH, exportFilename, mountExport } from '../../server/export/zip-export.ts';
import { createYamlPageStore } from '../../server/pages/yaml-page-store.ts';
import { linkFields, makeDataDir, portOf } from '../helpers.ts';

/** A fixed moment for the file's name: 5 November 2026, local time. */
const NOVEMBER = 10;
const FIXED_DATE = new Date(2026, NOVEMBER, 5, 12);

describe('zip export', () => {
  let server: Server;
  let dir: string;
  let remove: () => Promise<void>;

  beforeAll(async () => {
    ({ dir, remove } = await makeDataDir());
    const pages = await createYamlPageStore({ dataDir: dir });
    await pages.createPage({ title: 'Media', icon: 'film' });
    await pages.addItem('media', null, linkFields('Jellyfin'));
    // Things that are not pages, which the zip leaves out.
    await writeFile(path.join(dir, 'pages', 'media.yaml.123.1.tmp'), 'half a file');
    await writeFile(path.join(dir, 'pages', 'notes.txt'), 'not a page');
    await mkdir(path.join(dir, 'cache'));
    await writeFile(path.join(dir, 'cache', 'favicon.png'), 'not a page');

    const app = express();
    mountExport(app, dir, () => FIXED_DATE);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await remove();
  });

  it('zips site.yaml and every page file, as they are on disk, and nothing else', async () => {
    const response = await fetch(`http://127.0.0.1:${portOf(server)}${EXPORT_PATH}`);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="?homepage-2026-11-05\.zip"?$/);

    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(['pages/home.yaml', 'pages/media.yaml', 'site.yaml']);
    for (const name of Object.keys(files)) {
      const zipped = files[name];
      expect(zipped && strFromU8(zipped)).toBe(await readFile(path.join(dir, name), 'utf-8'));
    }
  });

  it('names the file after the day', () => {
    expect(exportFilename(new Date(2027, 0, 9))).toBe('homepage-2027-01-09.zip');
  });
});
