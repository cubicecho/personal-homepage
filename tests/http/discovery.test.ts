import { sql } from 'drizzle-orm';
import { ErrorCode } from '../../server/core/errors.ts';
import type { OpenedDatabase } from '../../server/db/client.ts';
import { type Candidate, DiscoverySourceName } from '../../server/discovery/candidate.ts';
import { createDescriber } from '../../server/discovery/describe.ts';
import { createDiscoveryService, type DiscoveryService } from '../../server/discovery/service.ts';
import { createDiscoveryStore } from '../../server/discovery/store.ts';
import { asProxyUser, startApp, type TestApp } from '../auth/app.ts';
import { openTestDatabase, resetTestDatabase } from '../db.ts';
import { startSite, type TestSite } from '../icons/site.ts';

const APPS = `query ($all: Boolean) {
  discoveredApps(includeDismissed: $all) { id name url icon iconUrl dismissed addedTo { pageSlug itemId itemTitle } }
}`;
const ADD_ITEM = `mutation ($input: ItemInput!) {
  addItem(pageSlug: "home", input: $input) { items { id discoveredId } }
}`;
const UPDATE_ITEM = `mutation ($id: ID!, $input: ItemInput!) {
  updateItem(pageSlug: "home", id: $id, input: $input) { items { id discoveredId } }
}`;
const RESCAN = 'mutation { rescanDiscovery { found added sources { source isEnabled found error } } }';
const DISMISS =
  'mutation ($id: ID!, $dismissed: Boolean!) { dismissDiscoveredApp(id: $id, dismissed: $dismissed) { id dismissed } }';
const DESCRIBE = 'query ($url: String!) { describeUrl(url: $url) { title description icon iconUrl problem } }';

let database: OpenedDatabase;
let app: TestApp | null = null;
let site: TestSite;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await resetTestDatabase(database.db);
  site = await startSite();
});

afterEach(async () => {
  await app?.close();
  app = null;
  await site.close();
  vi.unstubAllEnvs();
});

/**
 * Builds discovery with one source that sees the test site's pages.
 *
 * @param candidates - What the source reports.
 * @returns The service.
 */
function discoveryOf(candidates: () => Candidate[]): DiscoveryService {
  return createDiscoveryService({
    store: createDiscoveryStore(database.db),
    describer: createDescriber(),
    sources: [{ name: DiscoverySourceName.Mdns, start: () => {}, stop: () => {}, scan: async () => candidates() }],
  });
}

/**
 * Makes a candidate on the test site.
 *
 * @param path - The page's path on the site.
 * @returns The candidate.
 */
function onSite(path: string): Candidate {
  return {
    source: DiscoverySourceName.Mdns,
    sourceKey: `mdns:${path}._http._tcp.local`,
    url: `${site.base}${path}`,
    probeUrl: null,
    fallbackName: path,
    nameHints: [],
    explicit: { name: null, description: null, icon: null },
    metadata: {},
  };
}

/**
 * Reads the first error code of an answer.
 *
 * @param answer - The answer.
 * @param answer.errors - Its errors.
 * @returns The code, or undefined.
 */
function codeOf(answer: { errors?: { extensions?: { code?: string } }[] }): string | undefined {
  return answer.errors?.[0]?.extensions?.code;
}

describe('discovered apps over GraphQL', () => {
  it('rescans, lists, links an added item to its app, and unlinks it on an edit without the link', async () => {
    site.routes.set('/jf', { type: 'text/html', body: '<title>Jellyfin</title><link rel="icon" href="/i.png">' });
    site.routes.set('/plain', { type: 'text/html', body: '<title>Plain</title>' });
    app = await startApp(database.db, { discovery: discoveryOf(() => [onSite('/jf'), onSite('/plain')]) });

    const rescanned = await app.gql(RESCAN);
    expect(rescanned.data.rescanDiscovery).toMatchObject({ found: 2, added: 2 });
    const listed = (await app.gql(APPS)).data.discoveredApps;
    const jellyfin = listed.find((found: { name: string }) => found.name === 'Jellyfin');
    expect(jellyfin).toMatchObject({ url: `${site.base}/jf`, icon: `${site.base}/i.png`, addedTo: [] });
    // A page with no icon link falls back to its favicon, served by this server for the discovered app.
    const plain = listed.find((found: { name: string }) => found.name === 'Plain');
    expect(plain.iconUrl).toMatch(/^\/icons\/discovered\//);

    const input = { kind: 'LINK', title: 'Jellyfin', url: jellyfin.url, discoveredId: jellyfin.id };
    const added = await app.gql(ADD_ITEM, { input });
    expect(added.data.addItem.items).toEqual([{ id: 'jellyfin', discoveredId: jellyfin.id }]);
    const [withPlacement] = (await app.gql(APPS)).data.discoveredApps.filter(
      (found: { id: string }) => found.id === jellyfin.id,
    );
    expect(withPlacement.addedTo).toEqual([{ pageSlug: 'home', itemId: 'jellyfin', itemTitle: 'Jellyfin' }]);

    const edited = await app.gql(UPDATE_ITEM, {
      id: 'jellyfin',
      input: { ...input, title: 'Films', discoveredId: null },
    });
    expect(edited.data.updateItem.items).toEqual([{ id: 'jellyfin', discoveredId: null }]);
  });

  it('refuses a link to an app that does not exist, and drops a link when its app is deleted', async () => {
    site.routes.set('/jf', { type: 'text/html', body: '<title>Jellyfin</title>' });
    app = await startApp(database.db, { discovery: discoveryOf(() => [onSite('/jf')]) });
    const unknown = await app.gql(ADD_ITEM, {
      input: { kind: 'LINK', title: 'X', url: site.base, discoveredId: 'nope' },
    });
    expect(codeOf(unknown)).toBe(ErrorCode.BadUserInput);

    await app.gql(RESCAN);
    const [found] = (await app.gql(APPS)).data.discoveredApps;
    await app.gql(ADD_ITEM, { input: { kind: 'LINK', title: 'Jellyfin', url: found.url, discoveredId: found.id } });
    await database.db.execute(sql`delete from discovered_apps`);
    const { data } = await app.gql('{ page(slug: "home") { items { id discoveredId } } }');
    expect(data.page.items).toEqual([{ id: 'jellyfin', discoveredId: null }]);
  });

  it('dismisses and restores an app', async () => {
    site.routes.set('/jf', { type: 'text/html', body: '<title>Jellyfin</title>' });
    app = await startApp(database.db, { discovery: discoveryOf(() => [onSite('/jf')]) });
    await app.gql(RESCAN);
    const [found] = (await app.gql(APPS)).data.discoveredApps;
    await app.gql(DISMISS, { id: found.id, dismissed: true });
    expect((await app.gql(APPS)).data.discoveredApps).toEqual([]);
    expect((await app.gql(APPS, { all: true })).data.discoveredApps).toMatchObject([{ id: found.id, dismissed: true }]);
    await app.gql(DISMISS, { id: found.id, dismissed: false });
    expect((await app.gql(APPS)).data.discoveredApps).toHaveLength(1);
  });

  it('fills in from an address someone typed', async () => {
    site.routes.set('/', { type: 'text/html', body: '<title>Typed</title><meta name="description" content="Here">' });
    app = await startApp(database.db);
    const { data } = await app.gql(DESCRIBE, { url: `${site.base}/` });
    expect(data.describeUrl).toEqual({
      title: 'Typed',
      description: 'Here',
      icon: 'favicon',
      iconUrl: null,
      problem: null,
    });
    expect(codeOf(await app.gql(DESCRIBE, { url: 'javascript:alert(1)' }))).toBe(ErrorCode.BadUserInput);
  });
});

describe('discovered apps once sign-in is set up', () => {
  it('are for editors only, and their server-served favicons are signed', async () => {
    vi.stubEnv('FORWARD_AUTH_TRUSTED_PROXIES', '127.0.0.1');
    site.routes.set('/plain', { type: 'text/html', body: '<title>Plain</title>' });
    app = await startApp(database.db, { discovery: discoveryOf(() => [onSite('/plain')]) });
    // The first account is the admin.
    const admin = asProxyUser('owner');
    const guest = asProxyUser('guest');
    expect((await app.gql('{ access { canEdit } }', {}, admin)).data.access.canEdit).toBe(true);

    for (const [query, variables] of [
      [APPS, {}],
      ['{ discoverySources { source } }', {}],
      [DESCRIBE, { url: `${site.base}/plain` }],
      [RESCAN, {}],
      [DISMISS, { id: 'x', dismissed: true }],
    ] as const) {
      expect(codeOf(await app.gql(query, variables, guest))).toBe(ErrorCode.Forbidden);
      expect(codeOf(await app.gql(query, variables))).toBe(ErrorCode.Unauthenticated);
    }

    await app.gql(RESCAN, {}, admin);
    const [found] = (await app.gql(APPS, {}, admin)).data.discoveredApps;
    expect(found.iconUrl).toMatch(/^\/icons\/discovered\/[^?]+\?exp=\d+&sig=/);
    // Without the signature the server says it has no icon.
    const unsigned = await fetch(`${app.base}${found.iconUrl.split('?')[0]}`);
    expect(unsigned.status).toBe(404);
  });
});
