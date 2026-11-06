import type { Server } from 'node:http';
import { PAGE_LIMIT_DEFAULTS } from '../../server/core/defaults.ts';
import { ErrorCode } from '../../server/core/errors.ts';
import { HttpStatus } from '../../server/core/wire.ts';
import type { OpenedDatabase } from '../../server/db/client.ts';
import { createApp } from '../../server/http/app.ts';
import { databaseDeps, openTestDatabase } from '../db.ts';
import { makeDataDir, portOf } from '../helpers.ts';

/** Past `HTTP_DEFAULTS.bodyLimit`, which is 1 MB. */
const OVERSIZED_PADDING_BYTES = 1_100_000;
const SEARX = { prefix: 's', name: 'SearXNG', url: 'http://searx.local/search?q={query}' };

/**
 * Starts a server and waits until it listens.
 *
 * @param server - The server, just told to listen.
 * @returns Its base URL.
 */
async function listening(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${portOf(server)}`;
}

/**
 * Stops a server.
 *
 * @param server - The server.
 */
async function stop(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('app', () => {
  let database: OpenedDatabase;
  let server: Server;
  let base: string;
  let remove: () => Promise<void>;

  beforeAll(async () => {
    const data = await makeDataDir();
    remove = data.remove;
    database = await openTestDatabase();
    server = createApp({ ...(await databaseDeps(database.db)), dataDir: data.dir }).listen(0);
    base = await listening(server);
  });

  afterAll(async () => {
    await stop(server);
    await database.close();
    await remove();
  });

  const post = async (query: string, variables: Record<string, unknown> = {}) => {
    const response = await fetch(`${base}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    return response.json();
  };

  it('reports healthy', async () => {
    const response = await fetch(`${base}/healthz`);
    expect(response.status).toBe(HttpStatus.Ok);
    expect(await response.json()).toMatchObject({ ok: true });
  });

  it('tells anyone where the homepage is, which the bookmarklet opens', async () => {
    const { data } = await post('{ ssoSetup { appUrl appUrlSource } }');
    expect(data.ssoSetup.appUrlSource).toBe('FALLBACK');
    expect(data.ssoSetup.appUrl).toMatch(/^http:\/\/localhost:\d+$/);
  });

  it('serves the home page and the limits', async () => {
    const { data } = await post('{ pages { slug title isHome icon items { id } } pageLimits { maxPages } }');
    expect(data).toEqual({
      pages: [{ slug: 'home', title: 'Home', isHome: true, icon: 'house', items: [] }],
      pageLimits: { maxPages: PAGE_LIMIT_DEFAULTS.maxPages },
    });
  });

  it('creates a page and adds an item to it', async () => {
    const created = await post('mutation ($input: CreatePageInput!) { createPage(input: $input) { slug isHome } }', {
      input: { title: 'Media', icon: 'film' },
    });
    expect(created.data.createPage).toEqual({ slug: 'media', isHome: false });

    const added = await post(
      'mutation ($input: ItemInput!) { addItem(pageSlug: "media", input: $input) { items { id kind frameHeightPx } } }',
      { input: { kind: 'FRAME', title: 'Grafana', url: 'http://nas.local:3001' } },
    );
    expect(added.data.addItem.items).toEqual([
      { id: 'grafana', kind: 'FRAME', frameHeightPx: PAGE_LIMIT_DEFAULTS.defaultFrameHeightPx },
    ]);

    const { data } = await post('{ page(slug: "media") { title items { title url } } }');
    expect(data.page).toEqual({ title: 'Media', items: [{ title: 'Grafana', url: 'http://nas.local:3001' }] });
  });

  it('adds a section and moves an item into it', async () => {
    await post('mutation { addSection(pageSlug: "media", input: { title: "Watch" }) { slug } }');
    const { data } = await post(
      'mutation { moveItem(pageSlug: "media", id: "grafana", toSectionId: "watch", toIndex: 0) { sections { id title items { id checkEnabled } } } }',
    );
    expect(data.moveItem.sections).toEqual([
      { id: 'main', title: null, items: [] },
      { id: 'watch', title: 'Watch', items: [{ id: 'grafana', checkEnabled: true }] },
    ]);
  });

  it('serves the default search engines, and replaces them', async () => {
    const { data } = await post('{ searchEngines { prefix isDefault } }');
    expect(data.searchEngines.filter((engine: { isDefault: boolean }) => engine.isDefault)).toHaveLength(1);

    const set = await post(
      'mutation ($input: SearchSettingsInput) { setSearchEngines(input: $input) { prefix isDefault } }',
      { input: { engines: [SEARX] } },
    );
    expect(set.data.setSearchEngines).toEqual([{ prefix: 's', isDefault: true }]);
    const refused = await post('mutation { setSearchEngines(input: { defaultPrefix: "nope" }) { prefix } }');
    expect(refused.errors[0].extensions.code).toBe(ErrorCode.BadUserInput);
    const reset = await post('mutation { setSearchEngines(input: null) { prefix } }');
    expect(reset.data.setSearchEngines.length).toBeGreaterThan(1);
  });

  it('serves the grid layout, and changes its columns', async () => {
    const { data } = await post('{ siteLayout { columns minColumns maxColumns } }');
    expect(data.siteLayout).toEqual({ columns: 4, minColumns: 1, maxColumns: 8 });
    const set = await post('mutation { setLayoutColumns(columns: 6) { columns } }');
    expect(set.data.setLayoutColumns.columns).toBe(6);
    const refused = await post('mutation { setLayoutColumns(columns: 9) { columns } }');
    expect(refused.errors[0].extensions.code).toBe(ErrorCode.BadUserInput);
    await post('mutation { setLayoutColumns(columns: null) { columns } }');
  });

  it('refuses a script URL with BAD_USER_INPUT', async () => {
    const { errors } = await post(
      'mutation ($input: ItemInput!) { addItem(pageSlug: "home", input: $input) { slug } }',
      { input: { kind: 'LINK', title: 'Evil', url: 'javascript:alert(1)' } },
    );
    expect(errors[0].extensions.code).toBe(ErrorCode.BadUserInput);
    expect(errors[0].message).toMatch(/^url: /);
  });

  it('refuses deleting home with BAD_USER_INPUT', async () => {
    const { errors } = await post('mutation { deletePage(slug: "home") }');
    expect(errors[0].extensions.code).toBe(ErrorCode.BadUserInput);
  });

  it('answers an unknown page with NOT_FOUND', async () => {
    const { errors } = await post('{ page(slug: "nope") { title } }');
    expect(errors[0].extensions.code).toBe(ErrorCode.NotFound);
  });

  it('refuses an operation that is too deep', async () => {
    const { errors } = await post(
      '{ pages { items { id } } a: pages { slug } b: pages { slug } c: pages { slug } d: pages { slug } e: pages { slug } f: pages { slug } g: pages { slug } h: pages { slug } i: pages { slug } j: pages { slug } k: pages { slug } l: pages { slug } m: pages { slug } n: pages { slug } o: pages { slug } p: pages { slug } }',
    );
    expect(errors[0].extensions.code).toBe(ErrorCode.QueryTooComplex);
  });

  it('refuses a body over the limit', async () => {
    const response = await fetch(`${base}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ pages { slug } }', padding: 'x'.repeat(OVERSIZED_PADDING_BYTES) }),
    });
    expect(response.status).toBe(HttpStatus.PayloadTooLarge);
  });
});

describe('app with a database that does not answer', () => {
  it('reports 503 from /healthz', async () => {
    const data = await makeDataDir();
    const database = await openTestDatabase();
    const deps = await databaseDeps(database.db);
    const failing = () => Promise.reject(new Error('connection refused'));
    const server = createApp({ ...deps, checkDatabase: failing, dataDir: data.dir }).listen(0);
    try {
      const response = await fetch(`${await listening(server)}/healthz`);
      expect(response.status).toBe(HttpStatus.ServiceUnavailable);
      expect(await response.json()).toMatchObject({ ok: false, error: 'database unreachable' });
    } finally {
      await stop(server);
      await database.close();
      await data.remove();
    }
  });
});
