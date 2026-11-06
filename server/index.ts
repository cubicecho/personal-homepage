// Boot only. Preflight is the first import: it exits with a sentence when the configuration is unusable.
import './core/preflight.ts';
import { sql } from 'drizzle-orm';
import { databaseUrl, dataDir, dbConnectTimeoutMs, port, version } from './core/config.ts';
import { errorMessage } from './core/errors.ts';
import { openDatabase } from './db/client.ts';
import { importYamlOnBoot } from './db/import-yaml.ts';
import { waitForDatabase } from './db/wait.ts';
import { createApp, WEB_DIST } from './http/app.ts';
import { stopOnSignals } from './http/shutdown.ts';
import { createDbPageStore } from './pages/db-page-store.ts';
import { createSiteSettings } from './site/site-settings.ts';

const LISTEN_HOST = '0.0.0.0';

/**
 * Opens and migrates the database, and moves in any YAML pages left by 1.x.
 *
 * @returns The opened database.
 */
async function prepareDatabase() {
  const opened = openDatabase({ databaseUrl: databaseUrl(), dataDir: dataDir() });
  try {
    if (opened.isPostgres) {
      await waitForDatabase(opened.db, { connectTimeoutMs: dbConnectTimeoutMs() });
    }
    await opened.migrate();
    return opened;
  } catch (error) {
    await opened.close().catch(() => {});
    throw error;
  }
}

let database: Awaited<ReturnType<typeof prepareDatabase>>;
try {
  database = await prepareDatabase();
} catch (error) {
  console.error(`[db] ${errorMessage(error)}`);
  process.exit(1);
}

const { db } = database;
const pages = await createDbPageStore(db);
await importYamlOnBoot(db, dataDir());
const site = createSiteSettings(db);

const server = createApp({
  pages,
  site,
  dataDir: dataDir(),
  dist: WEB_DIST,
  checkDatabase: () => db.execute(sql`select 1`),
}).listen(port(), LISTEN_HOST, () => {
  console.log(`[boot] personal-homepage ${version()} on http://localhost:${port()}, pages in ${database.location}`);
});
stopOnSignals(server, { after: () => database.close() });
