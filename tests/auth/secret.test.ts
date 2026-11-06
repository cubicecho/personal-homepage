import { statSync } from 'node:fs';
import path from 'node:path';
import { resolveAuthSecret, SECRET_FILE } from '../../server/auth/secret.ts';
import { makeDataDir } from '../helpers.ts';

/** The file mode bits that say who may read and write it. */
const PERMISSION_BITS = 0o777;

describe('the sign-in secret', () => {
  let dir: string;
  let remove: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, remove } = await makeDataDir());
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await remove();
  });

  it('is made once, kept for the server alone, and the same at every start', () => {
    vi.stubEnv('BETTER_AUTH_SECRET', '');
    const made = resolveAuthSecret(dir);
    expect(made).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(path.join(dir, SECRET_FILE)).mode & PERMISSION_BITS).toBe(0o600);
    expect(resolveAuthSecret(dir)).toBe(made);
  });

  it('is BETTER_AUTH_SECRET when that is set, and then nothing is written', () => {
    vi.stubEnv('BETTER_AUTH_SECRET', 'set-by-the-operator-0123456789abcdef');
    expect(resolveAuthSecret(dir)).toBe('set-by-the-operator-0123456789abcdef');
    expect(() => statSync(path.join(dir, SECRET_FILE))).toThrow();
  });
});
