import { sql } from 'drizzle-orm';
import { PAGE_LIMIT_DEFAULTS } from '../../server/core/defaults.ts';
import { ErrorCode } from '../../server/core/errors.ts';
import type { OpenedDatabase } from '../../server/db/client.ts';
import { items, pages } from '../../server/db/schema.ts';
import { createDbPageStore } from '../../server/pages/db-page-store.ts';
import { ColumnSpan, HOME_SLUG, ItemKind, itemsOf, OpensIn, type PageStore } from '../../server/pages/page.ts';
import { parseWidget } from '../../server/pages/page-input.ts';
import { HttpMethod, ValueFormat, WeatherUnits, type Widget, WidgetType } from '../../server/pages/widget.ts';
import { openTestDatabase, resetTestDatabase } from '../db.ts';
import { linkFields } from '../helpers.ts';

/** How many items the concurrency test adds at once. */
const CONCURRENT_ADDS = 20;
const notFound = { extensions: { code: ErrorCode.NotFound } };
const badInput = { extensions: { code: ErrorCode.BadUserInput } };

describe('database page store', () => {
  let database: OpenedDatabase;
  let store: PageStore;

  const slugs = async () => (await store.list()).map((page) => page.slug);

  beforeAll(async () => {
    database = await openTestDatabase();
  });

  afterAll(() => database.close());

  beforeEach(async () => {
    await resetTestDatabase(database.db);
    store = await createDbPageStore(database.db);
  });

  it('starts with a home page', async () => {
    expect(await store.list()).toEqual([
      {
        slug: HOME_SLUG,
        title: 'Home',
        icon: 'house',
        visibleTo: [],
        sections: [{ id: 'main', title: null, collapsed: false, visibleTo: [], items: [] }],
      },
    ]);
  });

  it('keeps a home page that is already there', async () => {
    await store.updatePage(HOME_SLUG, { title: 'Start' });
    const reopened = await createDbPageStore(database.db);
    expect((await reopened.find(HOME_SLUG))?.title).toBe('Start');
  });

  it('creates pages with slugs made from their titles, de-duplicated, at the end of the list', async () => {
    const media = await store.createPage({ title: 'Média Server!', icon: 'film', visibleTo: [] });
    const again = await store.createPage({ title: 'Media server', icon: null, visibleTo: [] });
    const symbols = await store.createPage({ title: '!!!', icon: null, visibleTo: [] });
    expect([media.slug, again.slug, symbols.slug]).toEqual(['media-server', 'media-server-2', 'page']);
    expect(await slugs()).toEqual([HOME_SLUG, 'media-server', 'media-server-2', 'page']);
  });

  it('keeps a made slug within the length limit', async () => {
    const page = await store.createPage({
      title: 'a'.repeat(PAGE_LIMIT_DEFAULTS.maxSlugLength + 10),
      icon: null,
      visibleTo: [],
    });
    const again = await store.createPage({ title: page.title, icon: null, visibleTo: [] });
    expect(page.slug).toHaveLength(PAGE_LIMIT_DEFAULTS.maxSlugLength);
    expect(again.slug).toHaveLength(PAGE_LIMIT_DEFAULTS.maxSlugLength);
    expect(again.slug.endsWith('-2')).toBe(true);
  });

  it('refuses a slug that is taken', async () => {
    await store.createPage({ title: 'Tools', slug: 'tools', icon: null, visibleTo: [] });
    await expect(store.createPage({ title: 'Other', slug: 'tools', icon: null, visibleTo: [] })).rejects.toMatchObject(
      badInput,
    );
    await expect(
      store.createPage({ title: 'Home again', slug: HOME_SLUG, icon: null, visibleTo: [] }),
    ).rejects.toMatchObject(badInput);
  });

  it('refuses a page past the limit', async () => {
    const room = PAGE_LIMIT_DEFAULTS.maxPages - (await slugs()).length;
    const fillers = Array.from({ length: room }, (_unused, index) => ({
      slug: `filler-${index}`,
      title: 'Filler',
      position: index + 1,
    }));
    await database.db.insert(pages).values(fillers);
    await expect(store.createPage({ title: 'One too many', icon: null, visibleTo: [] })).rejects.toMatchObject(
      badInput,
    );
  });

  it('changes a page title and icon, keeping what was not sent', async () => {
    await store.createPage({ title: 'Tools', icon: 'terminal', visibleTo: [] });
    expect(await store.updatePage('tools', { title: 'Utilities' })).toMatchObject({
      slug: 'tools',
      title: 'Utilities',
      icon: 'terminal',
    });
    expect((await store.updatePage('tools', { icon: null })).icon).toBeNull();
    expect((await store.find('tools'))?.title).toBe('Utilities');
  });

  it('deletes a page, its sections and its items', async () => {
    await store.createPage({ title: 'Tools', icon: null, visibleTo: [] });
    await store.addItem('tools', null, linkFields('Router'));
    await store.createPage({ title: 'Media', icon: null, visibleTo: [] });
    await store.deletePage('tools');
    expect(await slugs()).toEqual([HOME_SLUG, 'media']);
    const left = await database.db.select().from(items);
    expect(left).toEqual([]);
    await expect(store.deletePage('tools')).rejects.toMatchObject(notFound);
  });

  it('refuses to delete or move the home page', async () => {
    await expect(store.deletePage(HOME_SLUG)).rejects.toMatchObject(badInput);
    await expect(store.movePage(HOME_SLUG, 1)).rejects.toMatchObject(badInput);
  });

  it('moves a page, keeping home first and clamping the place', async () => {
    for (const title of ['A', 'B', 'C']) {
      await store.createPage({ title, icon: null, visibleTo: [] });
    }
    expect((await store.movePage('c', 1)).map((page) => page.slug)).toEqual([HOME_SLUG, 'c', 'a', 'b']);
    expect((await store.movePage('c', 0)).map((page) => page.slug)).toEqual([HOME_SLUG, 'c', 'a', 'b']);
    expect((await store.movePage('c', 99)).map((page) => page.slug)).toEqual([HOME_SLUG, 'a', 'b', 'c']);
    expect(await slugs()).toEqual([HOME_SLUG, 'a', 'b', 'c']);
  });

  it('adds, updates, moves and removes items, keeping every field', async () => {
    await store.addItem(HOME_SLUG, null, linkFields('Jellyfin', { icon: 'di:jellyfin', description: 'Films' }));
    await store.addItem(HOME_SLUG, null, linkFields('Jellyfin', { check: { enabled: true, url: 'http://nas/up' } }));
    const page = await store.addItem(
      HOME_SLUG,
      null,
      linkFields('Grafana', {
        kind: ItemKind.Frame,
        opensIn: null,
        frameHeightPx: PAGE_LIMIT_DEFAULTS.defaultFrameHeightPx,
        check: { enabled: false, url: null },
      }),
    );
    expect(itemsOf(page).map((item) => item.id)).toEqual(['jellyfin', 'jellyfin-2', 'grafana']);

    const updated = await store.updateItem(HOME_SLUG, 'jellyfin-2', linkFields('Plex', { opensIn: OpensIn.App }));
    expect(itemsOf(updated)[1]).toMatchObject({ id: 'jellyfin-2', title: 'Plex', opensIn: OpensIn.App });

    const moved = await store.moveItem(HOME_SLUG, 'grafana', null, 0);
    expect(itemsOf(moved).map((item) => item.id)).toEqual(['grafana', 'jellyfin', 'jellyfin-2']);

    const removed = await store.removeItem(HOME_SLUG, 'jellyfin');
    expect(itemsOf(removed).map((item) => item.id)).toEqual(['grafana', 'jellyfin-2']);
    expect(await store.find(HOME_SLUG)).toEqual(removed);
    expect(itemsOf(removed)[0]).toEqual({
      id: 'grafana',
      kind: ItemKind.Frame,
      title: 'Grafana',
      url: 'http://nas.local:8096',
      opensIn: null,
      icon: null,
      description: null,
      frameHeightPx: PAGE_LIMIT_DEFAULTS.defaultFrameHeightPx,
      columnSpan: ColumnSpan.Full,
      check: { enabled: false, url: null },
      widget: null,
      visibleTo: [],
      discoveredId: null,
    });
  });

  describe('widgets', () => {
    const queue = parseWidget({
      type: WidgetType.Api,
      refreshSeconds: 60,
      api: {
        url: 'http://sonarr.lan:8989/api/v3/queue',
        method: HttpMethod.Post,
        headers: [{ name: 'X-Api-Key', value: '${env:HOMEPAGE_SONARR_KEY}' }],
        body: '{"page": 1}',
        fields: [
          { label: 'Downloading', path: '$.totalRecords', format: ValueFormat.Number, warnAbove: 10 },
          { label: 'First', path: '$.records[0].title' },
        ],
      },
    });
    const weather = parseWidget({
      type: WidgetType.Weather,
      cacheSeconds: 600,
      weather: { latitude: 52.37, longitude: 4.89, units: WeatherUnits.Imperial },
    });
    const widgetFields = (title: string, widget: Widget, url: string | null = null) =>
      linkFields(title, { kind: ItemKind.Widget, url, opensIn: null, check: { enabled: false, url: null }, widget });

    it('keeps every widget setting, with no URL, and reads it back the same', async () => {
      await store.addItem(HOME_SLUG, null, widgetFields('Sonarr queue', queue));
      const page = await store.addItem(HOME_SLUG, null, widgetFields('Weather', weather, 'https://open-meteo.com/'));
      expect(itemsOf(page).map((item) => item.widget)).toEqual([queue, weather]);
      expect(itemsOf(page)[0]?.url).toBeNull();
      const reopened = await createDbPageStore(database.db);
      expect(await reopened.find(HOME_SLUG)).toEqual(page);
    });

    it('stores secret references as written, in the YAML mapping, never a value', async () => {
      await store.addItem(HOME_SLUG, null, widgetFields('Sonarr queue', queue));
      const [row] = await database.db.select({ widget: items.widget }).from(items);
      expect(row?.widget).toMatchObject({
        type: 'api',
        method: 'post',
        headers: { 'X-Api-Key': '${env:HOMEPAGE_SONARR_KEY}' },
      });
    });

    it('refuses, at the table, a widget row without settings and a link without a URL', async () => {
      await expect(
        database.db.execute(
          sql`insert into items (page_slug, section_id, id, kind, title, position) values ('home', 'main', 'w', 'WIDGET', 'W', 0)`,
        ),
      ).rejects.toThrow();
      await expect(
        database.db.execute(
          sql`insert into items (page_slug, section_id, id, kind, title, position) values ('home', 'main', 'l', 'LINK', 'L', 0)`,
        ),
      ).rejects.toThrow();
    });
  });

  it('refuses unknown pages, sections and items', async () => {
    await expect(store.addItem('nope', null, linkFields('X'))).rejects.toMatchObject(notFound);
    await expect(store.addItem(HOME_SLUG, 'nope', linkFields('X'))).rejects.toMatchObject(notFound);
    await expect(store.updateItem(HOME_SLUG, 'nope', linkFields('X'))).rejects.toMatchObject(notFound);
    await expect(store.removeItem(HOME_SLUG, 'nope')).rejects.toMatchObject(notFound);
    await expect(store.moveItem(HOME_SLUG, 'nope', null, 0)).rejects.toMatchObject(notFound);
    await expect(
      store.updateSection(HOME_SLUG, 'nope', { title: 'X', collapsed: false, visibleTo: [] }),
    ).rejects.toMatchObject(notFound);
    await expect(store.updatePage('nope', { title: 'X' })).rejects.toMatchObject(notFound);
    await expect(store.movePage('nope', 1)).rejects.toMatchObject(notFound);
    expect(await store.find('nope')).toBeNull();
    expect(await store.find('../site')).toBeNull();
  });

  it('refuses an item past the limit', async () => {
    const full = Array.from({ length: PAGE_LIMIT_DEFAULTS.maxItemsPerPage }, (_unused, index) => ({
      pageSlug: HOME_SLUG,
      sectionId: 'main',
      id: `item-${index}`,
      kind: ItemKind.Link,
      title: `Item ${index}`,
      url: 'http://nas.local',
      opensIn: OpensIn.NewTab,
      position: index,
    }));
    await database.db.insert(items).values(full);
    await expect(store.addItem(HOME_SLUG, null, linkFields('One more'))).rejects.toMatchObject(badInput);
  });

  it('lands every one of many concurrent writes', async () => {
    const adds = Array.from({ length: CONCURRENT_ADDS }, (_unused, index) =>
      store.addItem(HOME_SLUG, null, linkFields(`Service ${index}`)),
    );
    await Promise.all(adds);
    const page = await store.find(HOME_SLUG);
    expect(page === null ? [] : itemsOf(page)).toHaveLength(CONCURRENT_ADDS);
  });

  it('keeps writing after a write that failed, which changed nothing', async () => {
    await expect(store.addItem('nope', null, linkFields('X'))).rejects.toBeDefined();
    await expect(store.removeSection(HOME_SLUG, 'main')).rejects.toMatchObject(badInput);
    expect(itemsOf(await store.addItem(HOME_SLUG, null, linkFields('After')))).toHaveLength(1);
    expect((await store.find(HOME_SLUG))?.sections).toHaveLength(1);
  });

  it('adds, renames, folds, moves and removes sections', async () => {
    await store.addItem(HOME_SLUG, null, linkFields('Jellyfin'));
    await store.addSection(HOME_SLUG, { title: 'Admin', collapsed: false, visibleTo: [] });
    await store.addSection(HOME_SLUG, { title: 'Admin', collapsed: true, visibleTo: [] });
    let page = await store.addItem(HOME_SLUG, 'admin', linkFields('Router'));
    expect(page.sections.map((section) => section.id)).toEqual(['main', 'admin', 'admin-2']);

    page = await store.moveItem(HOME_SLUG, 'jellyfin', 'admin-2', 0);
    expect(page.sections.map((section) => section.items.map((item) => item.id))).toEqual([
      [],
      ['router'],
      ['jellyfin'],
    ]);

    page = await store.updateSection(HOME_SLUG, 'admin-2', { title: 'Media', collapsed: false, visibleTo: [] });
    page = await store.moveSection(HOME_SLUG, 'admin-2', 0);
    expect(page.sections.map((section) => section.title)).toEqual(['Media', null, 'Admin']);
    expect(await store.find(HOME_SLUG)).toEqual(page);

    page = await store.removeSection(HOME_SLUG, 'main');
    page = await store.removeSection(HOME_SLUG, 'admin');
    expect(page.sections.map((section) => section.id)).toEqual(['admin-2']);
    await expect(store.removeSection(HOME_SLUG, 'admin-2')).rejects.toMatchObject(badInput);
  });

  it('refuses a section past the limit', async () => {
    for (let index = 1; index < PAGE_LIMIT_DEFAULTS.maxSectionsPerPage; index += 1) {
      await store.addSection(HOME_SLUG, { title: `S${index}`, collapsed: false, visibleTo: [] });
    }
    await expect(
      store.addSection(HOME_SLUG, { title: 'One more', collapsed: false, visibleTo: [] }),
    ).rejects.toMatchObject(badInput);
  });

  it('keeps the width of an item, and gives rows from before it the default of their kind', async () => {
    await store.addItem(
      HOME_SLUG,
      null,
      linkFields('Wide', { kind: ItemKind.Frame, opensIn: null, columnSpan: ColumnSpan.Two }),
    );
    await store.addItem(HOME_SLUG, null, linkFields('Old', { kind: ItemKind.Frame, opensIn: null }));
    await database.db.execute(sql`update items set column_span = null where id = 'old'`);
    const page = await store.find(HOME_SLUG);
    expect(page === null ? [] : itemsOf(page).map((item) => item.columnSpan)).toEqual([
      ColumnSpan.Two,
      ColumnSpan.Full,
    ]);
    await expect(database.db.execute(sql`update items set column_span = 'FIVE' where id = 'wide'`)).rejects.toThrow();
  });

  it('keeps a stored item kind the schema allows, and nothing else', async () => {
    await expect(
      database.db.execute(
        sql`insert into items (page_slug, section_id, id, kind, title, url, position) values ('home', 'main', 'x', 'APP', 'X', 'http://x', 0)`,
      ),
    ).rejects.toThrow();
  });
});
