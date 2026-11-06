// npm run db:import-yaml -- [--data-dir <dir>] [--replace]
//
// Imports a directory of YAML pages (a 1.x DATA_DIR, or an unzipped export) into the database the
// environment names (DATABASE_URL, or PGlite under DATA_DIR). Stop the server first when it uses PGlite:
// only one process may open that database.
import { parseArgs } from 'node:util';
import { databaseUrl, dataDir, dbConnectTimeoutMs } from '../core/config.ts';
import { errorMessage } from '../core/errors.ts';
import { ensureHome } from '../pages/db-page-store.ts';
import { readYamlData } from '../pages/yaml-format.ts';
import { openDatabase } from './client.ts';
import { importYamlData } from './import-yaml.ts';
import { waitForDatabase } from './wait.ts';

const { values } = parseArgs({
  options: { 'data-dir': { type: 'string' }, replace: { type: 'boolean', default: false } },
});
const source = values['data-dir'] ?? dataDir();

try {
  const opened = openDatabase({ databaseUrl: databaseUrl(), dataDir: dataDir() });
  try {
    if (opened.isPostgres) {
      await waitForDatabase(opened.db, { connectTimeoutMs: dbConnectTimeoutMs() });
    }
    await opened.migrate();
    await ensureHome(opened.db);
    const result = await importYamlData(opened.db, await readYamlData(source), { replace: values.replace });
    for (const { file, problem } of result.skipped) {
      console.warn(`[db] left out ${file}: ${problem}`);
    }
    console.log(`[db] imported ${result.imported} pages from ${source} into ${opened.location}`);
  } finally {
    await opened.close();
  }
} catch (error) {
  console.error(`[db] ${errorMessage(error)}`);
  process.exitCode = 1;
}
