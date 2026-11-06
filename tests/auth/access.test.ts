import { strFromU8, unzipSync } from 'fflate';
import { ErrorCode } from '../../server/core/errors.ts';
import type { OpenedDatabase } from '../../server/db/client.ts';
import { openTestDatabase, resetTestDatabase } from '../db.ts';
import { asProxyUser, startApp, type TestApp } from './app.ts';

// Who may see and change what. Identities come from forward auth here, because a trusted proxy's headers
// are the shortest way to be someone: the test client connects from 127.0.0.1, which the app trusts.

const ADD_PAGE = 'mutation ($input: CreatePageInput!) { createPage(input: $input) { slug visibleTo } }';
const ADD_ITEM =
  'mutation ($page: ID!, $input: ItemInput!) { addItem(pageSlug: $page, input: $input) { items { id visibleTo } } }';
const PAGES = '{ pages { slug items { id } } }';
const ACCESS = '{ access { mode canView canEdit viewer { email isAdmin groups via } } }';

let database: OpenedDatabase;
let app: TestApp | null = null;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await resetTestDatabase(database.db);
});

afterEach(async () => {
  await app?.close();
  app = null;
  vi.unstubAllEnvs();
});

/**
 * Starts the app with forward auth trusting this machine.
 *
 * @param [env] - More environment, such as ADMIN_GROUPS or PUBLIC_VIEW.
 * @returns The app.
 */
async function startSignedIn(env: Record<string, string> = {}): Promise<TestApp> {
  vi.stubEnv('FORWARD_AUTH_TRUSTED_PROXIES', '127.0.0.1');
  for (const [name, value] of Object.entries(env)) {
    vi.stubEnv(name, value);
  }
  app = await startApp(database.db);
  return app;
}

/**
 * Reads the first error code of an answer.
 *
 * @param answer - The answer.
 * @param answer.errors - Its errors.
 * @returns The code, or undefined when it has none.
 */
function codeOf(answer: { errors?: { extensions?: { code?: string } }[] }): string | undefined {
  return answer.errors?.[0]?.extensions?.code;
}

describe('an instance with no sign-in set up', () => {
  it('lets anyone see and change everything, as before sign-in existed', async () => {
    app = await startApp(database.db);
    const { data } = await app.gql(ACCESS);
    expect(data.access).toEqual({ mode: 'OPEN', canView: true, canEdit: true, viewer: null });
    const added = await app.gql(ADD_PAGE, { input: { title: 'Media', visibleTo: ['family'] } });
    expect(added.errors).toBeUndefined();
    expect((await app.gql(PAGES)).data.pages.map((page: { slug: string }) => page.slug)).toEqual(['home', 'media']);
  });
});

describe('an instance with sign-in set up', () => {
  it('asks a caller who is not signed in to sign in, for reading and for changing', async () => {
    const signedIn = await startSignedIn();
    expect(codeOf(await signedIn.gql(PAGES))).toBe(ErrorCode.Unauthenticated);
    expect(codeOf(await signedIn.gql(ADD_PAGE, { input: { title: 'X' } }))).toBe(ErrorCode.Unauthenticated);
    expect((await signedIn.gql(ACCESS)).data.access).toMatchObject({ mode: 'SIGN_IN', canView: false, viewer: null });
  });

  it('shows the pages to anyone with PUBLIC_VIEW, but still lets only editors change them', async () => {
    const signedIn = await startSignedIn({ PUBLIC_VIEW: 'true' });
    expect((await signedIn.gql(PAGES)).errors).toBeUndefined();
    expect(codeOf(await signedIn.gql(ADD_PAGE, { input: { title: 'X' } }))).toBe(ErrorCode.Unauthenticated);
  });

  it('makes the first account the admin, and refuses edits from the next unless it is in ADMIN_GROUPS', async () => {
    const signedIn = await startSignedIn({ ADMIN_GROUPS: 'homepage-admins' });
    const ada = asProxyUser('ada');
    const bob = asProxyUser('bob', ['family']);
    const cy = asProxyUser('cy', ['homepage-admins']);

    expect((await signedIn.gql(ACCESS, {}, ada)).data.access).toMatchObject({
      canEdit: true,
      viewer: { isAdmin: true, via: 'FORWARD_AUTH' },
    });
    expect((await signedIn.gql(ADD_PAGE, { input: { title: 'Ada' } }, ada)).errors).toBeUndefined();

    expect((await signedIn.gql(ACCESS, {}, bob)).data.access).toMatchObject({ canView: true, canEdit: false });
    expect(codeOf(await signedIn.gql(ADD_PAGE, { input: { title: 'Bob' } }, bob))).toBe(ErrorCode.Forbidden);
    expect(codeOf(await signedIn.gql('mutation { deletePage(slug: "ada") }', {}, bob))).toBe(ErrorCode.Forbidden);

    expect((await signedIn.gql(ADD_PAGE, { input: { title: 'Cy' } }, cy)).errors).toBeUndefined();
  });

  it('hides pages, sections and items from people outside their groups, everywhere they could show', async () => {
    const signedIn = await startSignedIn();
    const admin = asProxyUser('admin');
    const family = asProxyUser('mum', ['family']);
    const guest = asProxyUser('guest', ['friends']);
    await signedIn.gql(ACCESS, {}, admin);

    await signedIn.gql(ADD_PAGE, { input: { title: 'Kids', visibleTo: ['family'] } }, admin);
    const link = { kind: 'LINK', title: 'Router', url: 'http://192.168.1.1', visibleTo: ['family'] };
    await signedIn.gql(ADD_ITEM, { page: 'home', input: link }, admin);
    await signedIn.gql(
      ADD_ITEM,
      { page: 'home', input: { kind: 'LINK', title: 'News', url: 'http://news.lan' } },
      admin,
    );

    const asFamily = (await signedIn.gql(PAGES, {}, family)).data.pages;
    expect(asFamily).toEqual([
      { slug: 'home', items: [{ id: 'router' }, { id: 'news' }] },
      { slug: 'kids', items: [] },
    ]);

    const asGuest = (await signedIn.gql(PAGES, {}, guest)).data.pages;
    expect(asGuest).toEqual([{ slug: 'home', items: [{ id: 'news' }] }]);
    expect(codeOf(await signedIn.gql('{ page(slug: "kids") { title } }', {}, guest))).toBe(ErrorCode.NotFound);
    const statuses = await signedIn.gql('{ itemStatuses(pageSlug: "home") { itemId } }', {}, guest);
    expect(statuses.data.itemStatuses.map((status: { itemId: string }) => status.itemId)).not.toContain('router');

    // The editor sees everything, to be able to manage it.
    expect((await signedIn.gql(PAGES, {}, admin)).data.pages).toHaveLength(2);
  });

  it('hides a section and its items', async () => {
    const signedIn = await startSignedIn();
    const admin = asProxyUser('admin');
    await signedIn.gql(ACCESS, {}, admin);
    await signedIn.gql(
      'mutation { addSection(pageSlug: "home", input: { title: "Private", visibleTo: ["family"] }) { slug } }',
      {},
      admin,
    );
    await signedIn.gql(
      'mutation ($input: ItemInput!) { addItem(pageSlug: "home", sectionId: "private", input: $input) { slug } }',
      { input: { kind: 'LINK', title: 'Cameras', url: 'http://cams.lan' } },
      admin,
    );
    const asGuest = await signedIn.gql('{ page(slug: "home") { sections { id items { id } } } }', {}, asProxyUser('x'));
    expect(asGuest.data.page.sections).toEqual([{ id: 'main', items: [] }]);
  });

  it('leaves hidden pages and items out of the zip a viewer downloads', async () => {
    const signedIn = await startSignedIn();
    const admin = asProxyUser('admin');
    await signedIn.gql(ACCESS, {}, admin);
    await signedIn.gql(ADD_PAGE, { input: { title: 'Kids', visibleTo: ['family'] } }, admin);

    const download = async (headers: Record<string, string>): Promise<string[]> => {
      const response = await fetch(`${signedIn.base}/export.zip`, { headers });
      const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
      return Object.keys(files).sort();
    };
    expect(await download(asProxyUser('guest'))).toEqual(['pages/home.yaml', 'site.yaml']);
    expect(await download(admin)).toEqual(['pages/home.yaml', 'pages/kids.yaml', 'site.yaml']);
    const zipped = unzipSync(
      new Uint8Array(await (await fetch(`${signedIn.base}/export.zip`, { headers: admin })).arrayBuffer()),
    );
    expect(strFromU8(zipped['pages/kids.yaml'] ?? new Uint8Array())).toContain('family');

    const anonymous = await fetch(`${signedIn.base}/export.zip`);
    expect(anonymous.status).toBe(401);
  });

  it('signs favicon links, and refuses the icon route without one', async () => {
    const signedIn = await startSignedIn();
    const admin = asProxyUser('admin');
    await signedIn.gql(ACCESS, {}, admin);
    const input = { kind: 'LINK', title: 'NAS', url: 'http://127.0.0.1:9', icon: 'favicon' };
    await signedIn.gql(ADD_ITEM, { page: 'home', input }, admin);

    const { data } = await signedIn.gql('{ page(slug: "home") { items { iconUrl } } }', {}, admin);
    const signed: string = data.page.items[0].iconUrl;
    expect(signed).toMatch(/^\/icons\/favicon\/home\/nas\?exp=\d+&sig=[\w-]+$/);

    const bare = await fetch(`${signedIn.base}/icons/favicon/home/nas`);
    expect(bare.status).toBe(404);
    const forged = await fetch(`${signedIn.base}${signed.replace(/sig=[\w-]+/, 'sig=forged')}`);
    expect(forged.status).toBe(404);
  });
});
