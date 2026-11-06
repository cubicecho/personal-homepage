// Prints the schema the server serves, for codegen. Run by `npm run codegen`.
//
// Building the schema describes better-auth's fields from an auth instance over a database, but never
// queries it, so this hands it a Postgres pool that is never connected.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { printSchema } from 'graphql';
import pg from 'pg';
import { buildSchema } from './schema.ts';

/** A connection string nothing connects to: the pool opens connections only when queried. */
const UNUSED_DATABASE = 'postgres://codegen@127.0.0.1:1/unused';

const pool = new pg.Pool({ connectionString: UNUSED_DATABASE });
const schema = buildSchema(drizzle({ client: pool }));
const target = fileURLToPath(new URL('../../schema.graphql', import.meta.url));
await writeFile(target, `${printSchema(schema)}\n`, 'utf-8');
await pool.end();
console.log(`[codegen] wrote ${target}`);
