# personal-homepage

A self-hosted start page. Pages hold sections of items: links (tiles that open in a new tab, this tab, or framed
across the content area) and frames (a service shown inline at a set height). Home is always first and can't be
deleted. Pages are kept in a database: PGlite under `DATA_DIR/pg` by default, or Postgres when `DATABASE_URL` is a
postgres:// URL. They are served over GraphQL to a React app built from the cubeui registry.

## Run

```
npm install
npm run dev                    # web on http://localhost:3000, API on :8787
npm run check && npm test
npm run build && npm start     # one process on PORT (default 3000) serving dist/
docker compose up -d --build   # the database in the homepage_data volume at /data
npm run db:generate            # after changing server/db/schema.ts; commit drizzle/
npm run db:import-yaml -- --data-dir examples/data --replace   # sample pages (server stopped)
```

## Layout

- `server/core/`: config getters (`DATA_DIR`, `DATABASE_URL`, `DB_CONNECT_TIMEOUT_MS`, `PORT`, `TRUST_PROXY`), the
  `defaults.ts` groups (`PAGE_LIMIT_DEFAULTS` is also served as `Query.pageLimits`), coded errors and preflight.
- `server/db/`:
  - `client.ts`: opens PGlite or Postgres, each with its own migrator and close.
  - `schema.ts`: the tables. Migrations are generated into `drizzle/` and committed.
  - `lock.ts`: one server per PGlite folder.
  - `wait.ts`: retries the first Postgres connection.
  - `import-yaml.ts`: moves 1.x YAML pages in on first boot. `import-yaml-cli.ts` is `npm run db:import-yaml`.
- `server/pages/`:
  - `page.ts`: the model and the `PageStore` interface.
  - `page-input.ts`: zod validation of API input, run before the store.
  - `page-edits.ts`: the rules for changing a page, as pure functions.
  - `db-page-store.ts`: the store.
  - `yaml-format.ts`: the 1.x YAML layout, for the import and the zip export.
  - `slug.ts`: slugs and ids.
- `server/site/site-settings.ts`: the launcher's search engines, in `site_settings`.
- `server/graphql/`: the SDL (`type-defs.ts`), resolvers (`schema.ts`), operation limits and the logger.
  `write-schema.ts` prints `schema.graphql`.
- `server/http/`: `createApp(deps)`, health and shutdown. `server/index.ts` only boots.
- `web/src/components/`: vendored cubeui and shadcn code. Don't edit it; reinstall with
  `npx shadcn@latest add @cubeui/<item>`.
- `web/src/pages/`, `web/src/sections/`, `web/src/search/`, `web/src/status/`, `web/src/frames/`, `web/src/export/`:
  the app's features.
- `tests/`: mirrors `server/`. `tests/db.ts` opens one in-memory PGlite per file with the real migrations.
- `examples/data/`: sample pages in the 1.x YAML layout, for `db:import-yaml`.

## Rules specific to this repo

- **Nothing above the store touches the database.** Resolvers and the web app use only `page.ts` types.
- **Every write is one transaction behind one advisory lock** (`exclusive` in `db-page-store.ts`), and rewrites the
  page's sections and items whole. Page-changing rules belong in `page-edits.ts`, not in the store.
- **Item URLs are http(s) only,** checked in `page-input.ts` and again when YAML is read. Frames load in this
  origin's page.
- **`items.widget` is reserved** for widget items (issue #2).
- **No sign-in.** Keep it on a trusted network (issue #1).
- **No Storybook stories yet.** The UI was checked with scripted headless runs.
