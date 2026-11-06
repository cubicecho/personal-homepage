import { readdir } from 'node:fs/promises';
import type { Server } from 'node:http';
import path from 'node:path';
import express from 'express';
import { ICON_DEFAULTS } from '../../server/core/defaults.ts';
import { HttpStatus } from '../../server/core/wire.ts';
import { createFaviconFetcher, iconLinks, sniffImageType } from '../../server/icons/favicons.ts';
import { MS_PER_HOUR, MS_PER_MINUTE } from '../../server/icons/fetching.ts';
import { FAVICON_CACHE_DIR, faviconPath, mountIcons } from '../../server/icons/http.ts';
import { HOME_SLUG } from '../../server/pages/page.ts';
import { createYamlPageStore } from '../../server/pages/yaml-page-store.ts';
import { linkFields, makeDataDir, portOf } from '../helpers.ts';
import { ICO_BYTES, PNG_BYTES, SVG_TEXT, startSite, type TestSite } from './site.ts';

const HTML = 'text/html; charset=utf-8';

describe('iconLinks', () => {
  const base = 'http://nas.local:8096/web/index.html';

  it('puts an SVG first, then the largest size, keeping page order on a tie', () => {
    const html = `
      <link rel="shortcut icon" href="/favicon.ico">
      <link href="icons/32.png" rel="icon" sizes="32x32">
      <LINK REL="apple-touch-icon" HREF='/apple.png'>
      <link rel="icon" type="image/svg+xml" href="/logo.svg">
      <link rel="stylesheet" href="/style.css">
      <link rel="icon" href="javascript:alert(1)">`;
    expect(iconLinks(html, base)).toEqual([
      'http://nas.local:8096/logo.svg',
      'http://nas.local:8096/apple.png',
      'http://nas.local:8096/web/icons/32.png',
      'http://nas.local:8096/favicon.ico',
    ]);
  });

  it('finds nothing in a page with no icon links', () => {
    expect(iconLinks('<html><head><title>x</title></head></html>', base)).toEqual([]);
  });
});

describe('sniffImageType', () => {
  it.each([
    [PNG_BYTES, 'image/png'],
    [ICO_BYTES, 'image/x-icon'],
    [new TextEncoder().encode(`<?xml version="1.0"?>\n${SVG_TEXT}`), 'image/svg+xml'],
    [new TextEncoder().encode('<!doctype html><html></html>'), null],
  ])('reads %#', (bytes, expected) => {
    expect(sniffImageType(bytes)).toBe(expected);
  });
});

describe('favicon fetcher', () => {
  let site: TestSite;
  let dataDir: string;
  let remove: () => Promise<void>;
  let now: number;
  let warn: ReturnType<typeof vi.spyOn>;

  const open = () =>
    createFaviconFetcher({ cacheDir: path.join(dataDir, FAVICON_CACHE_DIR), fetch: globalThis.fetch, now: () => now });

  beforeEach(async () => {
    site = await startSite();
    ({ dir: dataDir, remove } = await makeDataDir());
    now = Date.UTC(2026, 10, 5);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    warn.mockRestore();
    await site.close();
    await remove();
  });

  it("takes the page's best icon link and keeps it", async () => {
    site.routes.set('/', { type: HTML, body: '<link rel="icon" href="/static/icon.png" sizes="32x32">' });
    site.routes.set('/static/icon.png', { type: 'image/png', body: PNG_BYTES });
    const fetcher = open();

    const favicon = await fetcher.get(`${site.base}/`);
    expect(favicon).toMatchObject({ contentType: 'image/png', body: PNG_BYTES });

    // Kept: a second fetcher over the same directory answers without asking the site.
    expect(await open().get(`${site.base}/`)).toMatchObject({ contentType: 'image/png' });
    expect(site.hits.get('/static/icon.png')).toBe(1);
    expect((await readdir(path.join(dataDir, FAVICON_CACHE_DIR))).some((file) => file.endsWith('.tmp'))).toBe(false);
  });

  it('falls back to /favicon.ico, telling an untyped icon by its bytes', async () => {
    site.routes.set('/app/', { type: HTML, body: '<title>No icons here</title>' });
    site.routes.set('/favicon.ico', { type: 'application/octet-stream', body: ICO_BYTES });
    expect(await open().get(`${site.base}/app/`)).toMatchObject({ contentType: 'image/x-icon' });
  });

  it('follows a redirect and reads links against where it landed', async () => {
    site.routes.set('/login/', { type: HTML, body: '<link rel="icon" href="logo.svg">' });
    site.routes.set('/login/logo.svg', { type: 'image/svg+xml', body: SVG_TEXT });
    // A second site that only redirects to the first, so the links must be read against the first.
    const server: Server = express()
      .get('/', (_req, res) => res.redirect(`${site.base}/login/`))
      .listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      const favicon = await open().get(`http://127.0.0.1:${portOf(server)}/`);
      expect(favicon).toMatchObject({ contentType: 'image/svg+xml' });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('refuses what is not an image: HTML, a fake SVG, or one too large', async () => {
    site.routes.set('/', {
      type: HTML,
      body: '<link rel="icon" href="/page.png"><link rel="icon" href="/fake.svg"><link rel="icon" href="/big.png">',
    });
    site.routes.set('/page.png', { type: HTML, body: '<html></html>' });
    site.routes.set('/fake.svg', { type: 'image/svg+xml', body: '<html><script>alert(1)</script></html>' });
    site.routes.set('/big.png', { type: 'image/png', body: new Uint8Array(ICON_DEFAULTS.maxFaviconBytes + 1) });
    expect(await open().get(`${site.base}/`)).toBeNull();
  });

  it('remembers a site with no icon for a while, then asks again', async () => {
    site.routes.set('/', { type: HTML, body: '' });
    const fetcher = open();
    expect(await fetcher.get(`${site.base}/`)).toBeNull();
    expect(await fetcher.get(`${site.base}/`)).toBeNull();
    expect(site.hits.get('/favicon.ico')).toBe(1);

    site.routes.set('/favicon.ico', { type: 'image/x-icon', body: ICO_BYTES });
    now += ICON_DEFAULTS.failureRetryMinutes * MS_PER_MINUTE + 1;
    expect(await fetcher.get(`${site.base}/`)).toMatchObject({ contentType: 'image/x-icon' });
  });

  it('refreshes a stale icon, and keeps the old one when the site is down', async () => {
    site.routes.set('/', { type: HTML, body: '' });
    site.routes.set('/favicon.ico', { type: 'image/x-icon', body: ICO_BYTES });
    const fetcher = open();
    await fetcher.get(`${site.base}/`);

    now += ICON_DEFAULTS.faviconCacheHours * MS_PER_HOUR + 1;
    site.routes.clear();
    expect(await fetcher.get(`${site.base}/`)).toMatchObject({ contentType: 'image/x-icon' });
    expect(site.hits.get('/favicon.ico')).toBe(2);

    // The old one is kept for the retry wait, not a whole cache period.
    await fetcher.get(`${site.base}/`);
    expect(site.hits.get('/favicon.ico')).toBe(2);
    now += ICON_DEFAULTS.failureRetryMinutes * MS_PER_MINUTE + 1;
    await fetcher.get(`${site.base}/`);
    expect(site.hits.get('/favicon.ico')).toBe(3);
  });

  it('asks the site once for many requests at the same time', async () => {
    site.routes.set('/', { type: HTML, body: '' });
    site.routes.set('/favicon.ico', { type: 'image/x-icon', body: ICO_BYTES });
    const fetcher = open();
    await Promise.all(Array.from({ length: 5 }, () => fetcher.get(`${site.base}/`)));
    expect(site.hits.get('/favicon.ico')).toBe(1);
  });

  it('gives up on a site that does not answer', async () => {
    const fetcher = createFaviconFetcher({
      cacheDir: path.join(dataDir, FAVICON_CACHE_DIR),
      fetch: () => Promise.reject(new Error('ECONNREFUSED')),
      now: () => now,
    });
    expect(await fetcher.get('http://nowhere.local/')).toBeNull();
  });
});

describe('GET /icons/favicon', () => {
  let site: TestSite;
  let server: Server;
  let base: string;
  let remove: () => Promise<void>;

  beforeAll(async () => {
    site = await startSite();
    site.routes.set('/', { type: HTML, body: '<link rel="icon" type="image/svg+xml" href="/logo.svg">' });
    site.routes.set('/logo.svg', { type: 'image/svg+xml', body: SVG_TEXT });
    const data = await makeDataDir();
    remove = data.remove;
    const pages = await createYamlPageStore({ dataDir: data.dir });
    await pages.addItem(HOME_SLUG, null, linkFields('NAS', { url: `${site.base}/`, icon: 'favicon' }));
    await pages.addItem(HOME_SLUG, null, linkFields('Gone', { url: 'http://127.0.0.1:9/' }));
    const app = express();
    mountIcons(app, pages, data.dir);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${portOf(server)}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await site.close();
    await remove();
  });

  it("serves a stored item's favicon, safely, with an ETag", async () => {
    const response = await fetch(`${base}${faviconPath(HOME_SLUG, 'nas')}`);
    expect(response.status).toBe(HttpStatus.Ok);
    expect(response.headers.get('content-type')).toMatch(/^image\/svg\+xml/);
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toBe(SVG_TEXT);

    const etag = response.headers.get('etag') ?? '';
    const again = await fetch(`${base}${faviconPath(HOME_SLUG, 'nas')}`, { headers: { 'if-none-match': etag } });
    expect(again.status).toBe(HttpStatus.NotModified);
  });

  it.each([
    ['an unknown page', faviconPath('nope', 'nas')],
    ['an unknown item', faviconPath(HOME_SLUG, 'nope')],
    ['a path that is not a slug', '/icons/favicon/home/..%2Fsite'],
    ['a site that is down', faviconPath(HOME_SLUG, 'gone')],
  ])('answers 404 for %s', async (_case, url) => {
    const response = await fetch(`${base}${url}`);
    expect(response.status).toBe(HttpStatus.NotFound);
  });
});
