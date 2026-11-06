// The PageStore over the database: a page is one `pages` row, its `sections` and its `items`, each
// ordered by an integer position. Every write runs in one transaction that first takes a lock every
// write shares, so two changes never interleave, then reads the page, applies the rule from
// page-edits.ts, and writes the page's sections and items back whole, renumbered. That is a few dozen
// rows at most, and it keeps one code path for every change.
import { asc, eq, inArray, max, ne, sql } from 'drizzle-orm';
import type { PgAsyncTransaction, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { PAGE_LIMIT_DEFAULTS } from '../core/defaults.ts';
import { badInput, notFound } from '../core/errors.ts';
import type { Database } from '../db/client.ts';
import { discoveredApps, type ItemRow, items, type PageRow, pages, type SectionRow, sections } from '../db/schema.ts';
import { HOME_SLUG, type Item, ItemKind, itemsOf, OpensIn, type Page, type PageStore, type Section } from './page.ts';
import * as edits from './page-edits.ts';
import { describeIssues, SLUG_PATTERN } from './page-input.ts';
import { slugFrom, uniqueSlug } from './slug.ts';
import type { Widget } from './widget.ts';
import { storedWidgetSchema, widgetFromStored, widgetToStored } from './widget-storage.ts';

const { maxPages } = PAGE_LIMIT_DEFAULTS;

/** What a page made from a title of only symbols is called. */
const FALLBACK_PAGE_SLUG = 'page';
/** The icon of the page every database starts with. */
const HOME_ICON = 'house';
/** The id of a page's untitled first section. */
const MAIN_SECTION_ID = 'main';
/** The advisory lock every write takes, so writes run one at a time. Any fixed number would do. */
const WRITE_LOCK_KEY = 4_206_001;

/**
 * Builds the untitled section a new page starts with.
 *
 * @returns The section, with no items.
 */
function emptySection(): Section {
  return { id: MAIN_SECTION_ID, title: null, collapsed: false, visibleTo: [], items: [] };
}

/** A transaction on either driver. */
type Transaction = PgAsyncTransaction<PgQueryResultHKT>;
/** Anything that can run queries: the database, or a transaction in it. */
type Queries = Database | Transaction;

/**
 * Reads a stored word as a member of its vocabulary.
 *
 * @typeParam T - The vocabulary's values.
 * @param values - The vocabulary's values.
 * @param value - The stored word.
 * @returns The member.
 * @throws When the word is not one; the table's check constraint should make that impossible.
 */
function memberOf<T extends string>(values: readonly T[], value: string): T {
  const member = values.find((candidate) => candidate === value);
  if (member === undefined) {
    throw new Error(`"${value}" is not one of ${values.join(', ')}.`);
  }
  return member;
}

/**
 * Reads a widget column back into the model, through the same checks its YAML form gets.
 *
 * @param row - The item row.
 * @returns The widget, or null when the row holds none.
 * @throws When a stored widget no longer reads; only a hand-edited row could hold one.
 */
function widgetFromRow(row: ItemRow): Widget | null {
  if (row.widget === null) {
    return null;
  }
  const parsed = storedWidgetSchema.safeParse(row.widget);
  const widget = parsed.success ? widgetFromStored(parsed.data) : describeIssues(parsed.error);
  if (typeof widget === 'string') {
    throw new Error(`The widget of item "${row.id}" on page "${row.pageSlug}" can't be read: ${widget}`);
  }
  return widget;
}

/**
 * Turns an item row into the model.
 *
 * @param row - The row.
 * @returns The item.
 */
function itemFromRow(row: ItemRow): Item {
  return {
    id: row.id,
    kind: memberOf(Object.values(ItemKind), row.kind),
    title: row.title,
    url: row.url,
    opensIn: row.opensIn === null ? null : memberOf(Object.values(OpensIn), row.opensIn),
    icon: row.icon,
    description: row.description,
    frameHeightPx: row.frameHeightPx,
    check: { enabled: row.checkEnabled, url: row.checkUrl },
    widget: widgetFromRow(row),
    visibleTo: row.visibleTo,
    discoveredId: row.discoveredId,
  };
}

/**
 * Puts rows back together as pages.
 *
 * @param pageRows - The pages, in list order.
 * @param sectionRows - Their sections, in position order.
 * @param itemRows - Their items, in position order.
 * @returns The pages.
 */
function assemble(pageRows: PageRow[], sectionRows: SectionRow[], itemRows: ItemRow[]): Page[] {
  const itemsBySection = new Map<string, Item[]>();
  for (const row of itemRows) {
    const key = `${row.pageSlug}/${row.sectionId}`;
    itemsBySection.set(key, [...(itemsBySection.get(key) ?? []), itemFromRow(row)]);
  }
  return pageRows.map((page) => {
    const pageSections = sectionRows
      .filter((section) => section.pageSlug === page.slug)
      .map((section) => ({
        id: section.id,
        title: section.title,
        collapsed: section.collapsed,
        visibleTo: section.visibleTo,
        items: itemsBySection.get(`${page.slug}/${section.id}`) ?? [],
      }));
    const hasSections = pageSections.length > 0;
    return {
      slug: page.slug,
      title: page.title,
      icon: page.icon,
      visibleTo: page.visibleTo,
      sections: hasSections ? pageSections : [emptySection()],
    };
  });
}

/**
 * Orders page rows for the list: home first, then by position, then by title.
 *
 * @param rows - The rows.
 * @returns A new array, in list order.
 */
function listOrder(rows: PageRow[]): PageRow[] {
  return [...rows].sort((a, b) => {
    const isHomeA = a.slug === HOME_SLUG;
    const isHomeB = b.slug === HOME_SLUG;
    if (isHomeA !== isHomeB) {
      return isHomeA ? -1 : 1;
    }
    return a.position - b.position || a.title.localeCompare(b.title);
  });
}

/**
 * Reads every page.
 *
 * @param db - Where to read.
 * @returns The pages, in list order.
 */
async function readAll(db: Queries): Promise<Page[]> {
  const pageRows = await db.select().from(pages);
  const sectionRows = await db.select().from(sections).orderBy(asc(sections.position));
  const itemRows = await db.select().from(items).orderBy(asc(items.position));
  return assemble(listOrder(pageRows), sectionRows, itemRows);
}

/**
 * Reads one page.
 *
 * @param db - Where to read.
 * @param slug - The page's slug.
 * @returns The page, or null when there is none.
 */
async function readPage(db: Queries, slug: string): Promise<Page | null> {
  const pageRows = await db.select().from(pages).where(eq(pages.slug, slug));
  if (pageRows.length === 0) {
    return null;
  }
  const sectionRows = await db
    .select()
    .from(sections)
    .where(eq(sections.pageSlug, slug))
    .orderBy(asc(sections.position));
  const itemRows = await db.select().from(items).where(eq(items.pageSlug, slug)).orderBy(asc(items.position));
  const [page] = assemble(pageRows, sectionRows, itemRows);
  return page ?? null;
}

/**
 * Reads a page that is about to change.
 *
 * @param tx - The transaction.
 * @param slug - The page's slug.
 * @returns The page.
 * @throws NOT_FOUND when there is none.
 */
async function loadPage(tx: Transaction, slug: string): Promise<Page> {
  const page = await readPage(tx, slug);
  if (page === null) {
    throw notFound(`No page has the slug "${slug}".`);
  }
  return page;
}

/**
 * Finds which of the discovered apps some items link to still exist.
 *
 * @param tx - The transaction.
 * @param pageItems - The items about to be written.
 * @returns The ids that exist.
 */
async function existingDiscoveredIds(tx: Transaction, pageItems: Item[]): Promise<Set<string>> {
  const linked = [...new Set(pageItems.flatMap((item) => (item.discoveredId === null ? [] : [item.discoveredId])))];
  if (linked.length === 0) {
    return new Set();
  }
  const rows = await tx
    .select({ id: discoveredApps.id })
    .from(discoveredApps)
    .where(inArray(discoveredApps.id, linked));
  return new Set(rows.map((row) => row.id));
}

/**
 * Writes a page's title, icon, sections and items, replacing what was there.
 *
 * @param tx - The transaction.
 * @param page - The page as it should be.
 * @returns The same page.
 */
export async function writePage(tx: Transaction, page: Page): Promise<Page> {
  await tx
    .update(pages)
    .set({ title: page.title, icon: page.icon, visibleTo: page.visibleTo })
    .where(eq(pages.slug, page.slug));
  // Items go with their sections (fk_items_section cascades).
  await tx.delete(sections).where(eq(sections.pageSlug, page.slug));
  const sectionRows = page.sections.map((section, position) => ({
    pageSlug: page.slug,
    id: section.id,
    title: section.title,
    collapsed: section.collapsed,
    visibleTo: section.visibleTo,
    position,
  }));
  await tx.insert(sections).values(sectionRows);
  const linkable = await existingDiscoveredIds(tx, itemsOf(page));
  const itemRows = page.sections.flatMap((section) =>
    section.items.map((item) => ({
      pageSlug: page.slug,
      sectionId: section.id,
      id: item.id,
      kind: item.kind,
      title: item.title,
      url: item.url,
      opensIn: item.opensIn,
      icon: item.icon,
      description: item.description,
      frameHeightPx: item.frameHeightPx,
      checkEnabled: item.check.enabled,
      checkUrl: item.check.url,
      // The YAML mapping, secret references as written: never a resolved value.
      widget: item.widget === null ? null : widgetToStored(item.widget),
      visibleTo: item.visibleTo,
      // A link to a discovered app deleted since is dropped, as the foreign key does on delete.
      discoveredId: item.discoveredId !== null && linkable.has(item.discoveredId) ? item.discoveredId : null,
    })),
  );
  if (itemRows.length > 0) {
    await tx.insert(items).values(itemRows.map((row, position) => ({ ...row, position })));
  }
  return page;
}

/**
 * Inserts a new page row and writes its contents.
 *
 * @param tx - The transaction.
 * @param page - The page.
 * @param position - Its place in the list.
 * @returns The same page.
 */
export async function insertPage(tx: Transaction, page: Page, position: number): Promise<Page> {
  await tx
    .insert(pages)
    .values({ slug: page.slug, title: page.title, icon: page.icon, visibleTo: page.visibleTo, position });
  return writePage(tx, page);
}

/**
 * Runs a write after every other write, in one transaction.
 *
 * @typeParam T - What the write returns.
 * @param db - The database.
 * @param write - The write.
 * @returns What it returned.
 */
export function exclusive<T>(db: Database, write: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${WRITE_LOCK_KEY})`);
    return write(tx);
  });
}

/**
 * Refuses a change to the home page that only other pages may have.
 *
 * @param slug - The page's slug.
 * @param action - What was asked, as a verb phrase: "deleted", "moved".
 * @throws BAD_USER_INPUT when the slug is home's.
 */
function refuseHome(slug: string, action: string): void {
  if (slug === HOME_SLUG) {
    throw badInput(`The home page can't be ${action}.`);
  }
}

/**
 * Makes the home page if the database has none.
 *
 * @param db - The database, migrated.
 */
export async function ensureHome(db: Database): Promise<void> {
  await exclusive(db, async (tx) => {
    const existing = await tx.select({ slug: pages.slug }).from(pages).where(eq(pages.slug, HOME_SLUG));
    if (existing.length === 0) {
      await insertPage(
        tx,
        { slug: HOME_SLUG, title: 'Home', icon: HOME_ICON, visibleTo: [], sections: [emptySection()] },
        0,
      );
    }
  });
}

/**
 * Opens the database store, making the home page when there is none.
 *
 * @param db - The database, migrated.
 * @returns The store.
 */
export async function createDbPageStore(db: Database): Promise<PageStore> {
  await ensureHome(db);

  /**
   * Changes one page under the write lock.
   *
   * @param slug - The page's slug.
   * @param change - The rule to apply.
   * @returns The changed page.
   */
  const edit = (slug: string, change: (page: Page) => Page): Promise<Page> =>
    exclusive(db, async (tx) => writePage(tx, change(await loadPage(tx, slug))));

  return {
    list: () => readAll(db),

    find: (slug) => {
      const isSlug = SLUG_PATTERN.test(slug);
      return isSlug ? readPage(db, slug) : Promise.resolve(null);
    },

    createPage: (newPage) =>
      exclusive(db, async (tx) => {
        const slugs = (await tx.select({ slug: pages.slug }).from(pages)).map((row) => row.slug);
        if (slugs.length >= maxPages) {
          throw badInput(`There are already ${maxPages} pages, the most there can be. Delete one first.`);
        }
        const taken = new Set(slugs);
        const wanted = newPage.slug;
        if (wanted !== undefined && taken.has(wanted)) {
          throw badInput(
            `The slug "${wanted}" is taken. Pick another, or leave it out to have one made from the title.`,
          );
        }
        const slug = wanted ?? uniqueSlug(slugFrom(newPage.title, FALLBACK_PAGE_SLUG), taken);
        const [last] = await tx.select({ position: max(pages.position) }).from(pages);
        const position = (last?.position ?? 0) + 1;
        const page: Page = {
          slug,
          title: newPage.title,
          icon: newPage.icon,
          visibleTo: newPage.visibleTo,
          sections: [emptySection()],
        };
        return insertPage(tx, page, position);
      }),

    updatePage: (slug, patch) => edit(slug, (page) => ({ ...page, ...patch })),

    deletePage: (slug) =>
      exclusive(db, async (tx) => {
        refuseHome(slug, 'deleted');
        const deleted = await tx.delete(pages).where(eq(pages.slug, slug)).returning({ slug: pages.slug });
        if (deleted.length === 0) {
          throw notFound(`No page has the slug "${slug}".`);
        }
      }),

    movePage: (slug, toIndex) =>
      exclusive(db, async (tx) => {
        refuseHome(slug, 'moved');
        await loadPage(tx, slug);
        const others = listOrder(await tx.select().from(pages).where(ne(pages.slug, HOME_SLUG)));
        const from = others.findIndex((page) => page.slug === slug);
        // The index counts home, which stays first, so the first place another page can take is 1.
        const to = edits.clampIndex(toIndex - 1, 0, others.length - 1);
        const moved = edits.moveEntry(others, from, to);
        for (const [position, page] of moved.entries()) {
          await tx.update(pages).set({ position }).where(eq(pages.slug, page.slug));
        }
        return readAll(tx);
      }),

    addSection: (slug, fields) => edit(slug, (page) => edits.addSection(page, fields)),
    updateSection: (slug, id, fields) => edit(slug, (page) => edits.updateSection(page, id, fields)),
    removeSection: (slug, id) => edit(slug, (page) => edits.removeSection(page, id)),
    moveSection: (slug, id, toIndex) => edit(slug, (page) => edits.moveSection(page, id, toIndex)),
    addItem: (slug, sectionId, fields) => edit(slug, (page) => edits.addItem(page, sectionId, fields)),
    updateItem: (slug, id, fields) => edit(slug, (page) => edits.updateItem(page, id, fields)),
    removeItem: (slug, id) => edit(slug, (page) => edits.removeItem(page, id)),
    moveItem: (slug, id, toSectionId, toIndex) => edit(slug, (page) => edits.moveItem(page, id, toSectionId, toIndex)),

    moveItemToPage: (slug, id, toSlug, toSectionId, toIndex) =>
      exclusive(db, async (tx) => {
        const from = await loadPage(tx, slug);
        if (toSlug === slug) {
          // An index past the end is clamped to it, so no index means the end of the section.
          const page = edits.moveItem(from, id, toSectionId, toIndex ?? Number.POSITIVE_INFINITY);
          await writePage(tx, page);
          return { from: page, to: page, itemId: id };
        }
        const moved = edits.transferItem(from, id, await loadPage(tx, toSlug), toSectionId, toIndex);
        await writePage(tx, moved.from);
        await writePage(tx, moved.to);
        return moved;
      }),
  };
}

export { readAll as readAllPages };
