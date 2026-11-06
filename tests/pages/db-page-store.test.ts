import { readFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import { PAGE_LIMIT_DEFAULTS } from '../../server/core/defaults.ts';
import { ErrorCode } from '../../server/core/errors.ts';
import type { OpenedDatabase } from '../../server/db/client.ts';
import { discoveredApps, items, pages } from '../../server/db/schema.ts';
import { createDbPageStore } from '../../server/pages/db-page-store.ts';
import { HOME_SLUG, ItemKind, itemsOf, OpensIn, type PageStore } from '../../server/pages/page.ts';
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
  const mustFind = async (slug: string) => {
    const page = await store.find(slug);
    if (page === null) {
      throw new Error(`no page ${slug}`);
    }
    return page;
  };

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
      columnSpan: 2,
      fullWidth: true,
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
      linkFields('Wide', { kind: ItemKind.Frame, opensIn: null, columnSpan: 7, fullWidth: false }),
    );
    await store.addItem(HOME_SLUG, null, linkFields('Old', { kind: ItemKind.Frame, opensIn: null }));
    await database.db.execute(sql`update items set column_span = null, full_width = null where id = 'old'`);
    const page = await store.find(HOME_SLUG);
    expect(page === null ? [] : itemsOf(page).map(({ columnSpan, fullWidth }) => ({ columnSpan, fullWidth }))).toEqual([
      { columnSpan: 7, fullWidth: false },
      { columnSpan: 2, fullWidth: true },
    ]);
    await expect(database.db.execute(sql`update items set column_span = 9 where id = 'wide'`)).rejects.toThrow();
  });

  it('turns the old ONE…FOUR and FULL spans into columns and a full-width flag', async () => {
    // Put the items table back in its old shape, write rows in it, then run the width migration's
    // statements for items. They leave the table as the other tests expect it.
    await database.db.execute(sql`alter table items drop constraint ck_items_column_span`);
    await database.db.execute(sql`alter table items drop column full_width`);
    await database.db.execute(sql`alter table items alter column column_span type text`);
    await database.db.execute(
      sql`alter table items add constraint ck_items_column_span check (column_span in ('ONE', 'TWO', 'THREE', 'FOUR', 'FULL'))`,
    );
    const rows = [
      ['one', 'ONE'],
      ['four', 'FOUR'],
      ['full', 'FULL'],
      ['unset', null],
    ] as const;
    for (const [position, [id, span]] of rows.entries()) {
      await database.db.execute(
        sql`insert into items (page_slug, section_id, id, kind, title, url, column_span, check_enabled, position)
            values ('home', 'main', ${id}, 'FRAME', ${id}, 'http://nas.local', ${span}, false, ${position})`,
      );
    }
    const migration = await readFile(
      new URL('../../drizzle/20261106072433_item_width_and_layout_columns/migration.sql', import.meta.url),
      'utf-8',
    );
    for (const statement of migration.split('--> statement-breakpoint')) {
      const isItemsStatement = statement.includes('"items"');
      if (isItemsStatement) {
        await database.db.execute(sql.raw(statement));
      }
    }
    const converted = await database.db
      .select({ id: items.id, columnSpan: items.columnSpan, fullWidth: items.fullWidth })
      .from(items)
      .orderBy(items.id);
    expect(converted).toEqual([
      { id: 'four', columnSpan: 4, fullWidth: false },
      { id: 'full', columnSpan: null, fullWidth: true },
      { id: 'one', columnSpan: 1, fullWidth: false },
      { id: 'unset', columnSpan: null, fullWidth: null },
    ]);
    expect(
      itemsOf(await mustFind(HOME_SLUG)).map(({ id, columnSpan, fullWidth }) => [id, columnSpan, fullWidth]),
    ).toEqual([
      ['one', 1, false],
      ['four', 4, false],
      ['full', 2, true],
      ['unset', 2, true],
    ]);
  });

  it('keeps a stored item kind the schema allows, and nothing else', async () => {
    await expect(
      database.db.execute(
        sql`insert into items (page_slug, section_id, id, kind, title, url, position) values ('home', 'main', 'x', 'APP', 'X', 'http://x', 0)`,
      ),
    ).rejects.toThrow();
  });

  describe('moving an item to another page', () => {
    const queue = parseWidget({
      type: WidgetType.Api,
      api: {
        url: 'http://sonarr.lan:8989/api/v3/queue',
        headers: [{ name: 'X-Api-Key', value: '${env:HOMEPAGE_SONARR_KEY}' }],
        fields: [{ label: 'Downloading', path: '$.totalRecords' }],
      },
    });

    beforeEach(async () => {
      await store.createPage({ title: 'Media', icon: null, visibleTo: [] });
      await store.addSection('media', { title: 'Watch', collapsed: false, visibleTo: [] });
      await store.addItem('media', null, linkFields('Plex'));
      await store.addItem('media', 'watch', linkFields('Emby'));
    });

    it('carries every field of the item, and the item alone', async () => {
      await database.db.insert(discoveredApps).values({
        id: 'found-1',
        source: 'DOCKHAND',
        sourceKey: 'nas/jellyfin',
        name: 'Jellyfin',
        url: 'http://nas:8096',
      });
      const original = linkFields('Jellyfin', {
        url: 'http://nas.local:8096',
        opensIn: OpensIn.App,
        icon: 'di:jellyfin',
        description: 'Films and shows',
        check: { enabled: false, url: 'http://nas.local:8096/health' },
        visibleTo: ['family'],
        discoveredId: 'found-1',
      });
      await store.addItem(HOME_SLUG, null, original);
      await store.addItem(HOME_SLUG, null, linkFields('Router'));
      const before = itemsOf(await mustFind(HOME_SLUG))[0];

      const moved = await store.moveItemToPage(HOME_SLUG, 'jellyfin', 'media', 'watch', 0);

      expect(moved.itemId).toBe('jellyfin');
      expect(itemsOf(moved.from).map((item) => item.id)).toEqual(['router']);
      const arrived = moved.to.sections.find((section) => section.id === 'watch')?.items[0];
      // Every field the item has, whatever is added to items later, reads back the same.
      expect(arrived).toEqual(before);
      expect(await store.find('media')).toEqual(moved.to);
      expect(await store.find(HOME_SLUG)).toEqual(moved.from);
    });

    it('carries a widget, secret references as written', async () => {
      const widget = linkFields('Sonarr', { kind: ItemKind.Widget, url: null, opensIn: null, widget: queue });
      await store.addItem(HOME_SLUG, null, widget);
      const moved = await store.moveItemToPage(HOME_SLUG, 'sonarr', 'media', null, null);
      expect(itemsOf(moved.to).find((item) => item.id === 'sonarr')).toMatchObject({
        kind: ItemKind.Widget,
        widget: queue,
      });
    });

    it('goes to the end of the first section by default, and gets a new id when its own is taken', async () => {
      await store.addItem(HOME_SLUG, null, linkFields('Plex', { url: 'http://home-plex.lan' }));
      const moved = await store.moveItemToPage(HOME_SLUG, 'plex', 'media', null, null);
      expect(moved.itemId).toBe('plex-2');
      expect(moved.to.sections.map((section) => section.items.map((item) => item.id))).toEqual([
        ['plex', 'plex-2'],
        ['emby'],
      ]);
      expect(itemsOf(moved.to).find((item) => item.id === 'plex-2')?.url).toBe('http://home-plex.lan');
    });

    it('clamps the place it goes to, and renumbers both pages', async () => {
      await store.addItem(HOME_SLUG, null, linkFields('A'));
      await store.addItem(HOME_SLUG, null, linkFields('B'));
      await store.addItem(HOME_SLUG, null, linkFields('C'));
      await store.moveItemToPage(HOME_SLUG, 'b', 'media', 'watch', 99);
      const positions = await database.db
        .select({ page: items.pageSlug, id: items.id, position: items.position })
        .from(items)
        .orderBy(items.pageSlug, items.position);
      expect(positions).toEqual([
        { page: 'home', id: 'a', position: 0 },
        { page: 'home', id: 'c', position: 1 },
        { page: 'media', id: 'plex', position: 0 },
        { page: 'media', id: 'emby', position: 1 },
        { page: 'media', id: 'b', position: 2 },
      ]);
    });

    it('moves within the page when the page it goes to is its own', async () => {
      const moved = await store.moveItemToPage('media', 'plex', 'media', 'watch', null);
      expect(moved.from).toBe(moved.to);
      expect(moved.itemId).toBe('plex');
      expect(moved.to.sections.map((section) => section.items.map((item) => item.id))).toEqual([[], ['emby', 'plex']]);
    });

    it('refuses an unknown page, section or item, and a full page, changing nothing', async () => {
      await store.addItem(HOME_SLUG, null, linkFields('Router'));
      await expect(store.moveItemToPage(HOME_SLUG, 'router', 'nope', null, null)).rejects.toMatchObject(notFound);
      await expect(store.moveItemToPage(HOME_SLUG, 'router', 'media', 'nope', null)).rejects.toMatchObject(notFound);
      await expect(store.moveItemToPage(HOME_SLUG, 'nope', 'media', null, null)).rejects.toMatchObject(notFound);

      const full = Array.from({ length: PAGE_LIMIT_DEFAULTS.maxItemsPerPage - 2 }, (_unused, index) =>
        linkFields(`Filler ${index}`),
      );
      for (const fields of full) {
        await store.addItem('media', null, fields);
      }
      await expect(store.moveItemToPage(HOME_SLUG, 'router', 'media', null, null)).rejects.toMatchObject(badInput);
      expect(itemsOf(await mustFind(HOME_SLUG)).map((item) => item.id)).toEqual(['router']);
    });
  });
});
