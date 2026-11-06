// npm run sso:reset
//
// Forgets the paired OIDC provider, for when nobody can sign in to fix it from the app (a pairing that
// registered the wrong callback, a provider that is gone). It asks the provider to delete the client
// (RFC 7592) and forgets the pairing whatever the provider answers.
//
// Stop the server first when it uses the built-in database (PGlite): only one process may open it. With
// Postgres it can run beside the server, but restart the server afterwards so it stops offering the
// provider. A provider set in the environment (OIDC_ISSUER) is not a pairing: unset it there instead.

import { hasUsers } from '../auth/admin.ts';
import { databaseUrl, dataDir, dbConnectTimeoutMs, oidcConfig } from '../core/config.ts';
import { errorMessage } from '../core/errors.ts';
import { openDatabase } from '../db/client.ts';
import { waitForDatabase } from '../db/wait.ts';
import { unpair } from './pairing.ts';
import { readPairedOidc } from './settings.ts';

try {
  const opened = openDatabase({ databaseUrl: databaseUrl(), dataDir: dataDir() });
  try {
    if (opened.isPostgres) {
      await waitForDatabase(opened.db, { connectTimeoutMs: dbConnectTimeoutMs() });
    }
    await opened.migrate();
    const paired = await readPairedOidc(opened.db);
    if (paired === null) {
      console.log(`[sso] no provider is paired in ${opened.location}; nothing to reset.`);
    } else {
      const removed = await unpair(opened.db);
      const atProvider = removed
        ? 'and the provider deleted its client'
        : `but the provider did not confirm deleting its client: remove client ${paired.clientId} in ${paired.issuer} by hand`;
      console.log(`[sso] forgot the pairing with ${paired.name} (${paired.issuer}), ${atProvider}.`);
      const accounts = (await hasUsers(opened.db))
        ? ' Existing accounts are kept, and sign in again once a provider is paired.'
        : '';
      console.log(
        `[sso] With no way to sign in set up, the homepage is open again: start it and pair a provider from Settings.${accounts}`,
      );
    }
    if (oidcConfig() !== null) {
      console.log('[sso] OIDC_ISSUER is set in the environment, so that provider stays in use until you unset it.');
    }
  } finally {
    await opened.close();
  }
} catch (error) {
  console.error(`[sso] ${errorMessage(error)}`);
  process.exitCode = 1;
}
