import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { PAGE_LIMIT_DEFAULTS } from '../../server/core/defaults.ts';
import { ErrorCode } from '../../server/core/errors.ts';
import { HOME_SLUG, Icon, ItemKind, type PageStore } from '../../server/pages/page.ts';
import { createYamlPageStore } from '../../server/pages/yaml-page-store.ts';
import { linkFields, makeDataDir } from '../helpers.ts';

/** How many items the concurrency test adds at once. */
const CONCURRENT_ADDS = 20;

describe('YAML page store', () => {
  let dir: string;
  let remove: () => Promise<void>;
  let store: PageStore;
  let warn: ReturnType<typeof vi.spyOn>;

  const pagesDir = () => path.join(dir, 'pages');
  const readYaml = async (file: string): Promise<unknown> => parse(await readFile(path.join(dir, file), 'utf-8'));
  const slugs = async () => (await store.list()).map((page) => page.slug);

  beforeEach(async () => {
    ({ dir, remove } = await makeDataDir());
    store = await createYamlPageStore({ dataDir: dir });
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    warn.mockRestore();
    await remove();
  });

  it('starts with a home page', async () => {
    expect(await store.list()).toEqual([{ slug: HOME_SLUG, title: 'Home', icon: Icon.House, items: [] }]);
    expect(await readYaml('pages/home.yaml')).toEqual({ title: 'Home', icon: 'house', items: [] });
  });

  it('keeps a home page that is already there', async () => {
    await store.updatePage(HOME_SLUG, { title: 'Start' });
    const reopened = await createYamlPageStore({ dataDir: dir });
    expect((await reopened.find(HOME_SLUG))?.title).toBe('Start');
  });

  it('creates pages with slugs made from their titles, de-duplicated', async () => {
    const media = await store.createPage({ title: 'Média Server!', icon: Icon.Film });
    const again = await store.createPage({ title: 'Media server', icon: null });
    const symbols = await store.createPage({ title: '!!!', icon: null });
    expect([media.slug, again.slug, symbols.slug]).toEqual(['media-server', 'media-server-2', 'page']);
    expect(await slugs()).toEqual([HOME_SLUG, 'media-server', 'media-server-2', 'page']);
    expect(await readYaml('site.yaml')).toEqual({ pageOrder: ['media-server', 'media-server-2', 'page'] });
  });

  it('keeps a made slug within the length limit', async () => {
    const page = await store.createPage({ title: 'a'.repeat(PAGE_LIMIT_DEFAULTS.maxSlugLength + 10), icon: null });
    const again = await store.createPage({ title: page.title, icon: null });
    expect(page.slug).toHaveLength(PAGE_LIMIT_DEFAULTS.maxSlugLength);
    expect(again.slug).toHaveLength(PAGE_LIMIT_DEFAULTS.maxSlugLength);
    expect(again.slug.endsWith('-2')).toBe(true);
  });

  it('refuses a slug that is taken', async () => {
    await store.createPage({ title: 'Tools', slug: 'tools', icon: null });
    await expect(store.createPage({ title: 'Other', slug: 'tools', icon: null })).rejects.toMatchObject({
      extensions: { code: ErrorCode.BadUserInput },
    });
    await expect(store.createPage({ title: 'Home again', slug: HOME_SLUG, icon: null })).rejects.toMatchObject({
      extensions: { code: ErrorCode.BadUserInput },
    });
  });

  it('refuses a page past the limit', async () => {
    const existing = await slugs();
    const room = PAGE_LIMIT_DEFAULTS.maxPages - existing.length;
    for (let index = 0; index < room; index += 1) {
      await writeFile(path.join(pagesDir(), `filler-${index}.yaml`), 'title: Filler\n');
    }
    await expect(store.createPage({ title: 'One too many', icon: null })).rejects.toMatchObject({
      extensions: { code: ErrorCode.BadUserInput },
    });
  });

  it('changes a page title and icon, keeping what was not sent', async () => {
    await store.createPage({ title: 'Tools', icon: Icon.Terminal });
    expect(await store.updatePage('tools', { title: 'Utilities' })).toMatchObject({
      slug: 'tools',
      title: 'Utilities',
      icon: Icon.Terminal,
    });
    expect((await store.updatePage('tools', { icon: null })).icon).toBeNull();
    expect(await readYaml('pages/tools.yaml')).toEqual({ title: 'Utilities', items: [] });
  });

  it('deletes a page and its place in the order', async () => {
    await store.createPage({ title: 'Tools', icon: null });
    await store.createPage({ title: 'Media', icon: null });
    await store.deletePage('tools');
    expect(await slugs()).toEqual([HOME_SLUG, 'media']);
    expect(await readYaml('site.yaml')).toEqual({ pageOrder: ['media'] });
    await expect(store.deletePage('tools')).rejects.toMatchObject({ extensions: { code: ErrorCode.NotFound } });
  });

  it('refuses to delete or move the home page', async () => {
    await expect(store.deletePage(HOME_SLUG)).rejects.toMatchObject({ extensions: { code: ErrorCode.BadUserInput } });
    await expect(store.movePage(HOME_SLUG, 1)).rejects.toMatchObject({ extensions: { code: ErrorCode.BadUserInput } });
  });

  it('moves a page, keeping home first', async () => {
    for (const title of ['A', 'B', 'C']) {
      await store.createPage({ title, icon: null });
    }
    expect((await store.movePage('c', 1)).map((page) => page.slug)).toEqual([HOME_SLUG, 'c', 'a', 'b']);
    expect((await store.movePage('c', 0)).map((page) => page.slug)).toEqual([HOME_SLUG, 'c', 'a', 'b']);
    expect((await store.movePage('c', 99)).map((page) => page.slug)).toEqual([HOME_SLUG, 'a', 'b', 'c']);
    expect(await slugs()).toEqual([HOME_SLUG, 'a', 'b', 'c']);
  });

  it('lists pages missing from the order after the rest, by title', async () => {
    await store.createPage({ title: 'Zed', icon: null });
    await writeFile(path.join(pagesDir(), 'beta.yaml'), 'title: Beta\n');
    await writeFile(path.join(pagesDir(), 'alpha.yaml'), 'title: Alpha\n');
    await writeFile(path.join(dir, 'site.yaml'), 'pageOrder: [gone, zed]\n');
    expect(await slugs()).toEqual([HOME_SLUG, 'zed', 'alpha', 'beta']);
  });

  it('adds, updates, moves and removes items', async () => {
    await store.addItem(HOME_SLUG, linkFields('Jellyfin', { icon: Icon.Film, description: 'Films' }));
    await store.addItem(HOME_SLUG, linkFields('Jellyfin'));
    const page = await store.addItem(
      HOME_SLUG,
      linkFields('Grafana', { kind: ItemKind.Frame, frameHeightPx: PAGE_LIMIT_DEFAULTS.defaultFrameHeightPx }),
    );
    expect(page.items.map((item) => item.id)).toEqual(['jellyfin', 'jellyfin-2', 'grafana']);

    const updated = await store.updateItem(HOME_SLUG, 'jellyfin-2', linkFields('Plex', { kind: ItemKind.App }));
    expect(updated.items[1]).toMatchObject({ id: 'jellyfin-2', title: 'Plex', kind: ItemKind.App });

    const moved = await store.moveItem(HOME_SLUG, 'grafana', 0);
    expect(moved.items.map((item) => item.id)).toEqual(['grafana', 'jellyfin', 'jellyfin-2']);

    const removed = await store.removeItem(HOME_SLUG, 'jellyfin');
    expect(removed.items.map((item) => item.id)).toEqual(['grafana', 'jellyfin-2']);
    expect(await store.find(HOME_SLUG)).toEqual(removed);

    expect(await readYaml('pages/home.yaml')).toEqual({
      title: 'Home',
      icon: 'house',
      items: [
        {
          id: 'grafana',
          kind: 'frame',
          title: 'Grafana',
          url: 'http://nas.local:8096',
          frameHeightPx: PAGE_LIMIT_DEFAULTS.defaultFrameHeightPx,
        },
        { id: 'jellyfin-2', kind: 'app', title: 'Plex', url: 'http://nas.local:8096' },
      ],
    });
  });

  it('refuses unknown pages and items', async () => {
    const notFound = { extensions: { code: ErrorCode.NotFound } };
    await expect(store.addItem('nope', linkFields('X'))).rejects.toMatchObject(notFound);
    await expect(store.updateItem(HOME_SLUG, 'nope', linkFields('X'))).rejects.toMatchObject(notFound);
    await expect(store.removeItem(HOME_SLUG, 'nope')).rejects.toMatchObject(notFound);
    await expect(store.moveItem(HOME_SLUG, 'nope', 0)).rejects.toMatchObject(notFound);
    await expect(store.updatePage('nope', { title: 'X' })).rejects.toMatchObject(notFound);
    expect(await store.find('nope')).toBeNull();
    expect(await store.find('../site')).toBeNull();
  });

  it('refuses an item past the limit', async () => {
    const items = Array.from({ length: PAGE_LIMIT_DEFAULTS.maxItemsPerPage }, (_unused, index) => ({
      id: `item-${index}`,
      kind: 'link',
      title: `Item ${index}`,
      url: 'http://nas.local',
    }));
    await writeFile(path.join(pagesDir(), 'full.yaml'), JSON.stringify({ title: 'Full', items }));
    await expect(store.addItem('full', linkFields('One more'))).rejects.toMatchObject({
      extensions: { code: ErrorCode.BadUserInput },
    });
  });

  it('shows a hand edit on the next read, in any case, making missing ids', async () => {
    await writeFile(
      path.join(pagesDir(), 'home.yaml'),
      [
        'title: Hand made',
        'icon: SERVER',
        'items:',
        '  - kind: Link',
        '    title: Router',
        '    url: http://192.168.1.1',
        '  - kind: frame',
        '    id: Not A Slug',
        '    title: Router',
        '    url: https://router.local',
        '    frameHeightPx: 99999',
        '    description: ""',
      ].join('\n'),
    );
    expect(await store.find(HOME_SLUG)).toEqual({
      slug: HOME_SLUG,
      title: 'Hand made',
      icon: Icon.Server,
      items: [
        {
          id: 'router',
          kind: ItemKind.Link,
          title: 'Router',
          url: 'http://192.168.1.1',
          icon: null,
          description: null,
          frameHeightPx: null,
        },
        {
          id: 'router-2',
          kind: ItemKind.Frame,
          title: 'Router',
          url: 'https://router.local',
          icon: null,
          description: null,
          frameHeightPx: PAGE_LIMIT_DEFAULTS.maxFrameHeightPx,
        },
      ],
    });
  });

  it('skips a broken file in the list, logs it once, and explains it when asked for', async () => {
    await store.createPage({ title: 'Tools', icon: null });
    await writeFile(path.join(pagesDir(), 'tools.yaml'), 'title: [unclosed\n');
    await writeFile(
      path.join(pagesDir(), 'bad-url.yaml'),
      'title: Bad\nitems:\n  - kind: link\n    title: X\n    url: javascript:alert(1)\n',
    );

    expect(await slugs()).toEqual([HOME_SLUG]);
    await store.list();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls.flat().join(' '))).toMatch(/\[store\] skipping pages\/(tools|bad-url)\.yaml/);

    await expect(store.find('tools')).rejects.toMatchObject({
      extensions: { code: ErrorCode.NotFound },
      message: expect.stringMatching(/pages\/tools\.yaml not valid YAML.*Fix or delete the file/),
    });
    await expect(store.addItem('bad-url', linkFields('X'))).rejects.toMatchObject({
      extensions: { code: ErrorCode.NotFound },
      message: expect.stringContaining('items.0.url'),
    });
    await expect(store.createPage({ title: 'Tools', slug: 'tools', icon: null })).rejects.toMatchObject({
      extensions: { code: ErrorCode.BadUserInput },
    });

    await store.deletePage('tools');
    expect(await readdir(pagesDir())).not.toContain('tools.yaml');
  });

  it('lands every one of many concurrent writes', async () => {
    const adds = Array.from({ length: CONCURRENT_ADDS }, (_unused, index) =>
      store.addItem(HOME_SLUG, linkFields(`Service ${index}`)),
    );
    await Promise.all(adds);
    const page = await store.find(HOME_SLUG);
    expect(page?.items).toHaveLength(CONCURRENT_ADDS);
    const files = await readdir(pagesDir());
    expect(files.filter((file) => file.endsWith('.tmp'))).toEqual([]);
  });

  it('keeps writing after a write that failed', async () => {
    await expect(store.addItem('nope', linkFields('X'))).rejects.toBeDefined();
    expect((await store.addItem(HOME_SLUG, linkFields('After'))).items).toHaveLength(1);
  });
});
