// One in-memory database per test file: opened and migrated in beforeAll, emptied between tests,
// closed in afterAll. Opening one is the slow part, so a file never opens one per test.
import { sql } from 'drizzle-orm';
import { createAuthHost } from '../server/auth/auth-host.ts';
import { type Database, IN_MEMORY, type OpenedDatabase, openPglite } from '../server/db/client.ts';
import type { AppDeps } from '../server/http/app.ts';
import { createDbPageStore } from '../server/pages/db-page-store.ts';
import { createSiteSettings } from '../server/site/site-settings.ts';

/**
 * Opens PGlite in memory and applies the committed migrations, so the tests run the same schema boot does.
 *
 * @returns The opened database; pass it to `closeTestDatabase` when the file is done.
 */
export async function openTestDatabase(): Promise<OpenedDatabase> {
  const opened = openPglite(IN_MEMORY);
  await opened.migrate();
  return opened;
}

/** What signs test sessions: long enough for preflight's rule, and never a real secret. */
export const TEST_SECRET = 'test-secret-0123456789abcdef0123456789';

/** What `createApp` needs from the database, for tests that build the app. */
export type DatabaseDeps = Pick<AppDeps, 'pages' | 'site' | 'checkDatabase' | 'db' | 'authHost'>;

/**
 * Builds the stores and auth `createApp` takes over a test database.
 *
 * @param db - The test database, migrated.
 * @returns The page store (with its home page), the site settings, the health query, the database and an
 * auth host over it, with no provider unless the environment names one.
 */
export async function databaseDeps(db: Database): Promise<DatabaseDeps> {
  return {
    pages: await createDbPageStore(db),
    site: createSiteSettings(db),
    checkDatabase: () => db.execute(sql`select 1`),
    db,
    authHost: await createAuthHost(db, { secret: TEST_SECRET }),
  };
}

/**
 * Empties every table, so the next test starts from a migrated, empty database.
 *
 * @param db - The test database.
 */
export async function resetTestDatabase(db: Database): Promise<void> {
  await db.execute(
    sql`truncate table pages, sections, items, site_settings, users, sessions, accounts, verifications, oidc_settings, discovered_apps cascade`,
  );
}
