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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** The one row `site_settings` holds. */
export const SITE_SETTINGS_ID = 'site';

/** A page: its title and icon, and where it sits in the list. Home's place is ignored: it is always first. */
export const pages = pgTable('pages', {
  slug: text('slug').primaryKey(),
  title: text('title').notNull(),
  icon: text('icon'),
  /** The groups that may see the page. Empty means everyone who may see the homepage. */
  visibleTo: text('visible_to').array().notNull().default(sql`'{}'::text[]`),
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
    /** The groups that may see the section. Empty means everyone who may see its page. */
    visibleTo: text('visible_to').array().notNull().default(sql`'{}'::text[]`),
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
    /** How many grid columns the item spans: ONE to FOUR, or FULL. null (rows from before it) means the kind's default. */
    columnSpan: text('column_span'),
    checkEnabled: boolean('check_enabled').notNull().default(true),
    checkUrl: text('check_url'),
    /**
     * A widget's type and settings, in the same mapping its YAML form uses (`widgetToDisk`), so it is read back
     * through the same checks. Secret references are kept as written. null for the other kinds.
     */
    widget: jsonb('widget').$type<Record<string, unknown>>(),
    /** The groups that may see the item. Empty means everyone who may see its section. */
    visibleTo: text('visible_to').array().notNull().default(sql`'{}'::text[]`),
    /** The discovered app it was added from, kept so the Discovered apps page can say where it is. */
    discoveredId: text('discovered_id').references(() => discoveredApps.id, { onDelete: 'set null' }),
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
    check(
      'ck_items_column_span',
      sql`${table.columnSpan} is null or ${table.columnSpan} in ('ONE', 'TWO', 'THREE', 'FOUR', 'FULL')`,
    ),
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

/**
 * An app the server found on the network: one row per thing a source reported, kept after it stops
 * being seen so its last sighting can be shown. Nothing here is on a page until someone adds it.
 */
export const discoveredApps = pgTable(
  'discovered_apps',
  {
    id: text('id').primaryKey(),
    /** Which source found it: MDNS, DOCKHAND or DOCKER. */
    source: text('source').notNull(),
    /** What the source calls it, stable across sightings: the mDNS instance, or the host and container name. */
    sourceKey: text('source_key').notNull().unique('uq_discovered_apps_source_key'),
    name: text('name').notNull(),
    url: text('url').notNull(),
    description: text('description'),
    /** An icon reference, as items take: an image URL, a catalogue icon, or `favicon`. */
    icon: text('icon'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    dismissed: boolean('dismissed').notNull().default(false),
    /** What the source and the description said, for working out why an app looks the way it does. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  },
  (table) => [check('ck_discovered_apps_source', sql`${table.source} in ('MDNS', 'DOCKHAND', 'DOCKER')`)],
);

/** A discovered app row as read. */
export type DiscoveredAppRow = typeof discoveredApps.$inferSelect;
/** A page row as read. */
export type PageRow = typeof pages.$inferSelect;
/** A section row as read. */
export type SectionRow = typeof sections.$inferSelect;
/** An item row as read. */
export type ItemRow = typeof items.$inferSelect;

// Sign-in. better-auth owns users, sessions, accounts and verifications through its Drizzle adapter
// (auth/better-auth.ts maps them); `is_admin` and `groups` are this app's own columns on users.

/** Someone who signs in: through the paired OIDC provider, or a proxy's forward auth. */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name'),
    /** better-auth's: whether a provider vouched for the address. */
    emailVerified: boolean('email_verified').notNull().default(false),
    /** better-auth's column for a picture. The homepage shows none. */
    image: text('image'),
    /** Whether this account runs the instance: may edit, and pair sign-in. The first account is. */
    isAdmin: boolean('is_admin').notNull().default(false),
    /** The groups the account was last seen in: the OIDC groups claim at sign-in, or Remote-Groups. */
    groups: text('groups').array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex('uq_users_email').on(table.email)],
);

/** A signed-in browser, sent as `Authorization: Bearer <token>`. Deleting the row signs it out. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique('uq_sessions_token'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('idx_sessions_user_id').on(table.userId)],
);

/** One way a user signs in: the OIDC provider (`oidc`), or a proxy's forward auth (`forward-auth`). */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The user's id at the provider: the `sub` claim, or the Remote-User name. */
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_accounts_user_id').on(table.userId),
    // One account per identity at a provider, so two first requests at once can't both make one.
    uniqueIndex('uq_accounts_provider_account').on(table.providerId, table.accountId),
  ],
);

/** Pending proofs better-auth keeps: one-time tokens, OIDC state. */
export const verifications = pgTable(
  'verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('idx_verifications_identifier').on(table.identifier)],
);

/**
 * The OIDC provider this instance was paired with (sso/pairing.ts): one row or none. OIDC_ISSUER in the
 * environment wins over it. The client secret and the registration access token are credentials, and no
 * resolver reads them back out.
 */
export const oidcSettings = pgTable(
  'oidc_settings',
  {
    id: text('id').primaryKey().default('oidc'),
    issuer: text('issuer').notNull(),
    clientId: text('client_id').notNull(),
    clientSecret: text('client_secret'),
    clientAuth: text('client_auth').notNull().default('client_secret_basic'),
    name: text('name').notNull(),
    registrationAccessToken: text('registration_access_token'),
    registrationClientUri: text('registration_client_uri'),
    // The address people opened the homepage at when it was paired: where sign-ins come back to while
    // APP_URL is unset. Null for a pairing made before it was recorded, or from this machine.
    appUrl: text('app_url'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [check('ck_oidc_settings_singleton', sql`${table.id} = 'oidc'`)],
);

/** A user row as read. */
export type UserRow = typeof users.$inferSelect;
