import { defineConfig } from 'drizzle-kit';

/** Migrations are generated from server/db/schema.ts into drizzle/, and committed. */
export default defineConfig({
  out: './drizzle',
  schema: './server/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
