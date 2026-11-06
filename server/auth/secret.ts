import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { configuredAuthSecret } from '../core/config.ts';

// What sessions and favicon links are signed with. BETTER_AUTH_SECRET wins when it is set; otherwise the
// server makes one the first time it starts and keeps it in the data directory, so an instance needs no
// configuration to sign people in, and sessions survive restarts and upgrades.

/** Where a made secret is kept, inside DATA_DIR. Never served, and not in the zip download. */
export const SECRET_FILE = 'auth-secret';
/** Random bytes in a made secret: hex doubles them, past the shortest secret preflight accepts. */
const SECRET_BYTES = 32;
/** Only the server's own user may read the file. */
const OWNER_ONLY = 0o600;
const MISSING_FILE = 'ENOENT';

/**
 * Finds the secret to sign with, making and keeping one when none is configured.
 *
 * @param dataDir - The data directory, which preflight has checked is writable.
 * @returns `BETTER_AUTH_SECRET`, or the one kept in `<dataDir>/auth-secret`.
 * @throws When the kept file exists but can't be read.
 */
export function resolveAuthSecret(dataDir: string): string {
  const configured = configuredAuthSecret() ?? '';
  if (configured !== '') {
    return configured;
  }
  const file = path.join(dataDir, SECRET_FILE);
  try {
    const kept = readFileSync(file, 'utf-8').trim();
    if (kept !== '') {
      return kept;
    }
  } catch (error) {
    const isMissing = error instanceof Error && 'code' in error && error.code === MISSING_FILE;
    if (isMissing === false) {
      throw error;
    }
  }
  const made = randomBytes(SECRET_BYTES).toString('hex');
  writeFileSync(file, `${made}\n`, { mode: OWNER_ONLY });
  console.log(`[auth] made a sign-in secret and kept it in ${file}; set BETTER_AUTH_SECRET to choose your own`);
  return made;
}
