// Boot only. Preflight is the first import: it exits with a sentence when the configuration is unusable.
import './core/preflight.ts';
import { sql } from 'drizzle-orm';
import { type AuthHost, createAuthHost } from './auth/auth-host.ts';
import { resolveAuthSecret } from './auth/secret.ts';
import {
  AppUrlSource,
  databaseUrl,
  dataDir,
  dbConnectTimeoutMs,
  forwardAuthTrustedProxies,
  isLoopbackHost,
  port,
  version,
} from './core/config.ts';
import { errorMessage } from './core/errors.ts';
import { openDatabase } from './db/client.ts';
import { waitForDatabase } from './db/wait.ts';
import { createConfiguredDiscovery } from './discovery/setup.ts';
import { createApp, WEB_DIST } from './http/app.ts';
import { stopOnSignals } from './http/shutdown.ts';
import { createIconService } from './icons/icon-service.ts';
import { createDbPageStore } from './pages/db-page-store.ts';
import { createSiteSettings } from './site/site-settings.ts';

const LISTEN_HOST = '0.0.0.0';

/**
 * Says at boot how people sign in, and warns when nobody has to.
 *
 * @param authHost - The auth host, built from the environment and the pairing.
 */
function logSignIn(authHost: AuthHost): void {
  const oidc = authHost.oidc();
  const urls = authHost.urls();
  const proxies = forwardAuthTrustedProxies();
  const from = { [AppUrlSource.Env]: 'APP_URL', [AppUrlSource.Paired]: 'pairing', [AppUrlSource.Fallback]: 'default' };
  console.log(`[auth] callback address ${urls.redirectUri} (from ${from[urls.source]})`);
  if (oidc !== null) {
    console.log(`[auth] sign-in with ${oidc.name} (${oidc.issuer})`);
    const isLocal = isLoopbackHost(new URL(urls.redirectUri).hostname);
    if (isLocal) {
      console.warn(
        '[auth] the callback is a localhost address, so only a browser on this machine can finish signing in. Set APP_URL to the address you open the homepage at, or use "Fix the callback address" on the sign-in page.',
      );
    }
  }
  if (proxies.length > 0) {
    console.log(`[auth] forward auth: Remote-* headers believed from ${proxies.join(', ')}`);
  }
  const isOpen = oidc === null && proxies.length === 0;
  if (isOpen) {
    console.warn(
      '[auth] no sign-in is set up: anyone who can reach this port can change the homepage. Pair a provider from the app, or set OIDC_ISSUER or FORWARD_AUTH_TRUSTED_PROXIES.',
    );
  }
}

/**
 * Opens and migrates the database.
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
const site = createSiteSettings(db);
// Built after migrate: it reads the OIDC pairing from the database.
const secret = resolveAuthSecret(dataDir());
const authHost = await createAuthHost(db, { secret });
// One icon service for the API and discovery, so the catalogue listings are downloaded once.
const icons = createIconService({ dataDir: dataDir() });
const discovery = createConfiguredDiscovery(db, icons);

const server = createApp({
  pages,
  site,
  db,
  authHost,
  discovery,
  icons,
  authSecret: secret,
  dataDir: dataDir(),
  dist: WEB_DIST,
  checkDatabase: () => db.execute(sql`select 1`),
}).listen(port(), LISTEN_HOST, () => {
  console.log(`[boot] personal-homepage ${version()} on http://localhost:${port()}, pages in ${database.location}`);
  logSignIn(authHost);
  // After listen: discovery fetches pages and writes to the database in the background.
  discovery.start();
});
stopOnSignals(server, { before: () => discovery.stop(), after: () => database.close() });
