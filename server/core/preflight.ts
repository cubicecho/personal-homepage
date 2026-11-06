// Runs before anything listens, so a misconfigured instance fails with a sentence, not a stack trace.
import { accessSync, constants, mkdirSync } from 'node:fs';
import { dataDir } from './config.ts';
import { errorMessage } from './errors.ts';

try {
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  accessSync(dir, constants.R_OK | constants.W_OK);
} catch (error) {
  console.error(
    `[preflight] DATA_DIR "${dataDir()}" is not a directory this process can read and write: ${errorMessage(error)}`,
  );
  process.exit(1);
}
