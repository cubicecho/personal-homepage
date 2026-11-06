// Opens the database pages are kept in: Postgres when DATABASE_URL names a server, otherwise PGlite (the
// same Postgres, run inside this process) in a folder under DATA_DIR. Each driver is opened by its own
// function, which returns the client with that driver's own migrator and close.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzleNode } from 'drizzle-orm/node-postgres';
import { migrate as migrateNode } from 'drizzle-orm/node-postgres/migrator';
import type { PgAsyncDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import { POSTGRES_URL } from '../core/config.ts';
import { DATABASE_DEFAULTS } from '../core/defaults.ts';
import { claimDataDir } from './lock.ts';

/** Where the generated migrations are, committed beside the server. */
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));
/** The PGlite store that lives only in memory, for tests. */
export const IN_MEMORY = 'memory://';

/** A Drizzle client on either driver: what the stores and settings take. */
export type Database = PgAsyncDatabase<PgQueryResultHKT>;

/** An open database, with what its driver needs to set it up and let it go. */
export interface OpenedDatabase {
  db: Database;
  /** Whether this is a Postgres server, which may not be up yet (`waitForDatabase`). */
  isPostgres: boolean;
  /** Where it is, for the boot log: the PGlite folder, or the Postgres host. */
  location: string;
  /** Applies the committed migrations with the driver's own migrator. */
  migrate(): Promise<void>;
  /** Closes it at shutdown, after the server has drained. */
  close(): Promise<void>;
}

/** Where the database is. */
export interface DatabaseOptions {
  /** `DATABASE_URL`: a postgres:// URL, or empty for PGlite. */
  databaseUrl: string;
  /** `DATA_DIR`: where PGlite keeps its folder. */
  dataDir: string;
}

/**
 * Opens node-postgres against a server. Nothing connects until the first query.
 *
 * @param connectionString - A postgres:// URL.
 * @returns The opened database.
 */
function openPostgres(connectionString: string): OpenedDatabase {
  const pool = new pg.Pool({ connectionString });
  const db = drizzleNode({ client: pool });
  return {
    db,
    isPostgres: true,
    location: new URL(connectionString).host,
    migrate: async () => {
      await migrateNode(db, { migrationsFolder: MIGRATIONS_FOLDER });
    },
    close: () => pool.end(),
  };
}

/**
 * Opens PGlite in this process, claiming its folder so a second server can't open it too.
 *
 * @param store - A folder, or `memory://` for tests.
 * @returns The opened database.
 * @throws When another running server holds the folder.
 */
export function openPglite(store: string): OpenedDatabase {
  const isFolder = store !== IN_MEMORY;
  const release = isFolder ? claimFolder(store) : () => {};
  const client = new PGlite(store);
  const db = drizzlePglite({ client });
  return {
    db,
    isPostgres: false,
    location: store,
    migrate: async () => {
      await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });
    },
    close: async () => {
      // Flushes the folder; the lock goes only once it is closed.
      await client.close();
      release();
    },
  };
}

/**
 * Makes a PGlite folder and claims it.
 *
 * @param folder - The folder.
 * @returns What releases it.
 */
function claimFolder(folder: string): () => void {
  mkdirSync(folder, { recursive: true });
  return claimDataDir(folder);
}

/**
 * Opens the database the configuration names.
 *
 * @param options - `DATABASE_URL` and `DATA_DIR`.
 * @returns Postgres for a postgres:// URL, otherwise PGlite in `<dataDir>/pg`.
 */
export function openDatabase(options: DatabaseOptions): OpenedDatabase {
  const usesPostgres = POSTGRES_URL.test(options.databaseUrl);
  if (usesPostgres) {
    return openPostgres(options.databaseUrl);
  }
  return openPglite(path.join(options.dataDir, DATABASE_DEFAULTS.pgliteDirName));
}
