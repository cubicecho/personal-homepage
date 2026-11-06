import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeDataDir } from '../helpers.ts';

// Preflight runs on import and exits, so it is run as its own process, the way index.ts runs it.

const PREFLIGHT = fileURLToPath(new URL('../../server/core/preflight.ts', import.meta.url));

/**
 * Runs preflight with an environment.
 *
 * @param env - The variables, on top of a minimal environment.
 * @returns Its exit status and what it printed to stderr.
 */
function preflight(env: Record<string, string>): { status: number | null; stderr: string } {
  const result = spawnSync(process.execPath, [PREFLIGHT], {
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf-8',
  });
  return { status: result.status, stderr: result.stderr };
}

describe('preflight', () => {
  let dataDir: string;
  let remove: () => Promise<void>;

  beforeEach(async () => {
    ({ dir: dataDir, remove } = await makeDataDir());
  });

  afterEach(async () => {
    await remove();
  });

  const production = () => ({
    NODE_ENV: 'production',
    DATA_DIR: dataDir,
    OIDC_ISSUER: 'https://id.example.com/oidc',
    OIDC_CLIENT_ID: 'homepage',
  });

  it('refuses a provider from the environment in production without APP_URL', () => {
    const { status, stderr } = preflight(production());
    expect(status).toBe(1);
    expect(stderr).toMatch(/APP_URL/);
  });

  it('starts with APP_URL set', () => {
    expect(preflight({ ...production(), APP_URL: 'https://home.example.com' }).status).toBe(0);
  });

  it('starts without APP_URL when the provider will be paired from the app', () => {
    expect(preflight({ NODE_ENV: 'production', DATA_DIR: dataDir }).status).toBe(0);
  });
});
