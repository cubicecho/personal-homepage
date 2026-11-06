import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../server/db/client.ts';
import { readPairedOidc, savePairedOidc } from '../../server/sso/settings.ts';
import { makeDataDir } from '../helpers.ts';

// `npm run sso:reset`, run as its own process against a built-in database on disk, as an operator would
// with the server stopped.

const RESET = fileURLToPath(new URL('../../server/sso/reset-cli.ts', import.meta.url));

/**
 * Runs the reset script against a data directory.
 *
 * @param dataDir - DATA_DIR.
 * @returns Its exit status and what it printed.
 */
function reset(dataDir: string): { status: number | null; stdout: string } {
  const result = spawnSync(process.execPath, [RESET], {
    env: { PATH: process.env.PATH ?? '', DATA_DIR: dataDir },
    encoding: 'utf-8',
  });
  return { status: result.status, stdout: result.stdout };
}

/**
 * Opens the data directory's database, migrated, runs something on it, and closes it.
 *
 * @typeParam T - What the work returns.
 * @param dataDir - DATA_DIR.
 * @param work - What to do.
 * @returns What it returned.
 */
async function withDatabase<T>(
  dataDir: string,
  work: (db: ReturnType<typeof openDatabase>['db']) => Promise<T>,
): Promise<T> {
  const opened = openDatabase({ databaseUrl: '', dataDir });
  try {
    await opened.migrate();
    return await work(opened.db);
  } finally {
    await opened.close();
  }
}

describe('sso:reset', () => {
  let dataDir: string;
  let remove: () => Promise<void>;

  beforeEach(async () => {
    ({ dir: dataDir, remove } = await makeDataDir());
  });

  afterEach(async () => {
    await remove();
  });

  it('forgets the pairing, so the homepage is open again', async () => {
    await withDatabase(dataDir, (db) =>
      savePairedOidc(db, {
        issuer: 'https://id.example.com/oidc',
        clientId: 'homepage-client',
        clientSecret: 'secret',
        clientAuth: 'client_secret_basic',
        name: 'heautou',
        registrationAccessToken: null,
        registrationClientUri: null,
        appUrl: null,
      }),
    );
    const { status, stdout } = reset(dataDir);
    expect(status).toBe(0);
    expect(stdout).toContain('forgot the pairing with heautou');
    expect(stdout).toContain('remove client homepage-client');
    expect(await withDatabase(dataDir, readPairedOidc)).toBeNull();
  });

  it('says there was nothing to reset', () => {
    const { status, stdout } = reset(dataDir);
    expect(status).toBe(0);
    expect(stdout).toContain('nothing to reset');
  });
});
