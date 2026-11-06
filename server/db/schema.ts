// The tables pages are kept in. One row per page, section and item, each with its place as an integer
// that the store renumbers on every write. A page's sections and items go with it when it is deleted.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/** The one row `site_settings` holds. */
export const SITE_SETTINGS_ID = 'site';

/** A page: its title and icon, and where it sits in the list. Home's place is ignored: it is always first. */
export const pages = pgTable('pages', {
  slug: text('slug').primaryKey(),
  title: text('title').notNull(),
  icon: text('icon'),
  position: integer('position').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** A group of items on a page. */
export const sections = pgTable(
  'sections',
  {
    pageSlug: text('page_slug')
      .notNull()
      .references(() => pages.slug, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    /** null draws the items with no heading. */
    title: text('title'),
    collapsed: boolean('collapsed').notNull().default(false),
    position: integer('position').notNull(),
  },
  (table) => [primaryKey({ name: 'pk_sections', columns: [table.pageSlug, table.id] })],
);

/** One thing on a page. Ids are unique within the page, across its sections. */
export const items = pgTable(
  'items',
  {
    pageSlug: text('page_slug')
      .notNull()
      .references(() => pages.slug, { onDelete: 'cascade' }),
    sectionId: text('section_id').notNull(),
    id: text('id').notNull(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    /** null only for a widget, whose link is optional. */
    url: text('url'),
    /** null for a frame or a widget. */
    opensIn: text('opens_in'),
    icon: text('icon'),
    description: text('description'),
    /** Set for a frame only. */
    frameHeightPx: integer('frame_height_px'),
    checkEnabled: boolean('check_enabled').notNull().default(true),
    checkUrl: text('check_url'),
    /**
     * A widget's type and settings, in the same mapping its YAML form uses (`widgetToDisk`), so it is read back
     * through the same checks. Secret references are kept as written. null for the other kinds.
     */
    widget: jsonb('widget').$type<Record<string, unknown>>(),
    position: integer('position').notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_items', columns: [table.pageSlug, table.id] }),
    foreignKey({
      name: 'fk_items_section',
      columns: [table.pageSlug, table.sectionId],
      foreignColumns: [sections.pageSlug, sections.id],
    }).onDelete('cascade'),
    index('idx_items_page_slug_section_id').on(table.pageSlug, table.sectionId),
    check('ck_items_kind', sql`${table.kind} in ('LINK', 'FRAME', 'WIDGET')`),
    check('ck_items_url', sql`${table.url} is not null or ${table.kind} = 'WIDGET'`),
    check('ck_items_widget', sql`(${table.widget} is not null) = (${table.kind} = 'WIDGET')`),
    check('ck_items_opens_in', sql`${table.opensIn} is null or ${table.opensIn} in ('NEW_TAB', 'SAME_TAB', 'APP')`),
  ],
);

/** Site-wide settings that are not pages: one row. */
export const siteSettings = pgTable(
  'site_settings',
  {
    id: text('id').primaryKey().default(SITE_SETTINGS_ID),
    /** The launcher's web searches: `{ engines, defaultPrefix }`, or null for the defaults. */
    search: jsonb('search').$type<unknown>(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [check('ck_site_settings_singleton', sql`${table.id} = 'site'`)],
);

/** A page row as read. */
export type PageRow = typeof pages.$inferSelect;
/** A section row as read. */
export type SectionRow = typeof sections.$inferSelect;
/** An item row as read. */
export type ItemRow = typeof items.$inferSelect;
