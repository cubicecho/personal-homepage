import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Mock } from 'vitest';
import type { OpenedDatabase } from '../../server/db/client.ts';
import { importedName, importYamlData, importYamlOnBoot } from '../../server/db/import-yaml.ts';
import { createDbPageStore } from '../../server/pages/db-page-store.ts';
import { HOME_SLUG, ItemKind, itemsOf, OpensIn, type PageStore } from '../../server/pages/page.ts';
import { readYamlData } from '../../server/pages/yaml-format.ts';
import { createSiteSettings } from '../../server/site/site-settings.ts';
import { openTestDatabase, resetTestDatabase } from '../db.ts';
import { linkFields, makeDataDir } from '../helpers.ts';

/** A fixed moment for the renamed files. */
const AT = new Date('2026-11-06T03:25:00.000Z');

/** The pages a 1.x DATA_DIR held, in the formats 1.0 and 1.1 wrote, with a hand edit or two. */
const OLD_FILES: Record<string, string> = {
  'site.yaml': ['pageOrder: [tools, media]', 'search:', '  defaultPrefix: g'].join('\n'),
  'pages/home.yaml': [
    'title: Start',
    'icon: HOUSE',
    'items:',
    '  - kind: link',
    '    title: Router',
    '    url: http://192.168.1.1',
    '  - id: Not A Slug',
    '    kind: frame',
    '    title: Router',
    '    url: https://router.local',
    '    frameHeightPx: 99999',
  ].join('\n'),
  'pages/media.yaml': [
    'title: Media',
    'icon: film',
    'items:',
    '  - id: jellyfin',
    '    kind: app',
    '    title: Jellyfin',
    '    url: http://nas.local:8096',
    '    icon: di:jellyfin',
    '    check: false',
  ].join('\n'),
  'pages/tools.yaml': [
    'title: Tools',
    'sections:',
    '  - title: Admin',
    '    collapsed: true',
    '    items:',
    '      - title: NAS',
    '        url: http://nas.local',
    '        opensIn: same-tab',
    '        check: http://nas.local/health',
  ].join('\n'),
  'pages/broken.yaml': 'title: [unclosed\n',
};

describe('importing YAML pages', () => {
  let database: OpenedDatabase;
  let store: PageStore;
  let dir: string;
  let remove: () => Promise<void>;
  let log: { log: Mock<(message: string) => void>; warn: Mock<(message: string) => void> };

  const writeFiles = async (files: Record<string, string>): Promise<void> => {
    await mkdir(path.join(dir, 'pages'), { recursive: true });
    for (const [name, text] of Object.entries(files)) {
      await writeFile(path.join(dir, name), text);
    }
  };

  beforeAll(async () => {
    database = await openTestDatabase();
  });

  afterAll(() => database.close());

  beforeEach(async () => {
    await resetTestDatabase(database.db);
    store = await createDbPageStore(database.db);
    ({ dir, remove } = await makeDataDir());
    log = { log: vi.fn<(message: string) => void>(), warn: vi.fn<(message: string) => void>() };
  });

  afterEach(() => remove());

  it('reads the 1.x formats: kind app, bare items, sections, check, hand edits', async () => {
    await writeFiles(OLD_FILES);
    const data = await readYamlData(dir);
    expect(data.pages.map((page) => page.slug)).toEqual([HOME_SLUG, 'tools', 'media']);
    expect(data.skipped.map((skip) => skip.file)).toEqual(['pages/broken.yaml']);
    expect(data.search).toEqual({ defaultPrefix: 'g' });

    const [home, tools, media] = data.pages;
    expect(home?.icon).toBe('house');
    expect(home === undefined ? [] : itemsOf(home)).toMatchObject([
      { id: 'router', kind: ItemKind.Link, opensIn: OpensIn.NewTab, check: { enabled: true, url: null } },
      { id: 'router-2', kind: ItemKind.Frame, opensIn: null, frameHeightPx: 2000 },
    ]);
    expect(media?.sections[0]?.items[0]).toMatchObject({
      kind: ItemKind.Link,
      opensIn: OpensIn.App,
      icon: 'di:jellyfin',
      check: { enabled: false, url: null },
    });
    expect(tools?.sections).toMatchObject([
      {
        id: 'admin',
        title: 'Admin',
        collapsed: true,
        items: [{ id: 'nas', opensIn: OpensIn.SameTab, check: { enabled: true, url: 'http://nas.local/health' } }],
      },
    ]);
  });

  it('imports on first boot, in one go, then renames the files so it never imports twice', async () => {
    await writeFiles(OLD_FILES);
    expect(await importYamlOnBoot(database.db, dir, log, () => AT)).toBe(3);

    expect((await store.list()).map((page) => [page.slug, page.title])).toEqual([
      [HOME_SLUG, 'Start'],
      ['tools', 'Tools'],
      ['media', 'Media'],
    ]);
    const engines = await createSiteSettings(database.db).searchEngines();
    expect(engines.find((engine) => engine.isDefault)?.prefix).toBe('g');
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('left out pages/broken.yaml'));
    expect(log.log).toHaveBeenCalledWith(expect.stringContaining('imported 3 pages'));

    expect((await readdir(dir)).sort()).toEqual([importedName('pages', AT), importedName('site.yaml', AT)].sort());
    expect(importedName('site.yaml', AT)).toBe('site.imported-2026-11-06T03-25-00-000Z.yaml');

    expect(await importYamlOnBoot(database.db, dir, log, () => AT)).toBe(0);
  });

  it('does nothing on boot when there is no YAML', async () => {
    expect(await importYamlOnBoot(database.db, dir, log)).toBe(0);
    expect(log.log).not.toHaveBeenCalled();
  });

  it('leaves the YAML alone on boot when the database already has pages', async () => {
    await store.addItem(HOME_SLUG, null, linkFields('Kept'));
    await writeFiles(OLD_FILES);
    expect(await importYamlOnBoot(database.db, dir, log)).toBe(0);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('--replace'));
    expect(itemsOf((await store.find(HOME_SLUG)) ?? { slug: '', title: '', icon: null, sections: [] })).toHaveLength(1);
    expect(await readdir(path.join(dir, 'pages'))).toContain('media.yaml');
  });

  it('refuses a manual import over pages unless told to replace them', async () => {
    await store.createPage({ title: 'Mine', icon: null });
    await writeFiles(OLD_FILES);
    const data = await readYamlData(dir);
    await expect(importYamlData(database.db, data, { replace: false })).rejects.toThrow(/--replace/);
    expect(await store.find('mine')).not.toBeNull();

    const result = await importYamlData(database.db, data, { replace: true });
    expect(result.imported).toBe(3);
    expect(await store.find('mine')).toBeNull();
    expect((await store.list()).map((page) => page.slug)).toEqual([HOME_SLUG, 'tools', 'media']);
  });

  it('adds a fresh home page when the YAML has none, and leaves out search settings that do not fit', async () => {
    await writeFiles({
      'site.yaml': 'search:\n  defaultPrefix: nope\n',
      'pages/media.yaml': 'title: Media\nitems: []\n',
    });
    const result = await importYamlData(database.db, await readYamlData(dir), { replace: false });
    expect(result.skipped).toEqual([{ file: 'site.yaml (search)', problem: expect.stringContaining('nope') }]);
    expect((await store.list()).map((page) => page.slug)).toEqual([HOME_SLUG, 'media']);
    expect(await createSiteSettings(database.db).storedSearch()).toBeNull();
  });
});
