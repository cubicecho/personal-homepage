// Runs before anything listens, so a misconfigured instance fails with a sentence, not a stack trace.
// Whether Postgres answers is not checked here: it coming up after the app is normal (db/wait.ts).
import { accessSync, constants, mkdirSync } from 'node:fs';
import { databaseUrl, databaseUrlProblem, dataDir } from './config.ts';
import { errorMessage } from './errors.ts';

/**
 * Logs and exits 1.
 *
 * @param message - What's wrong and how to fix it.
 * @returns Never.
 */
function fatal(message: string): never {
  console.error(`[preflight] ${message}`);
  process.exit(1);
}

const urlProblem = databaseUrlProblem(databaseUrl());
if (urlProblem !== null) {
  fatal(urlProblem);
}

try {
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  accessSync(dir, constants.R_OK | constants.W_OK);
} catch (error) {
  fatal(`DATA_DIR "${dataDir()}" is not a directory this process can read and write: ${errorMessage(error)}`);
}
