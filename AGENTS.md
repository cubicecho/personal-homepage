# personal-homepage

A self-hosted start page. Pages hold sections of items: links (tiles that open in a new tab, this tab, or framed
across the content area), frames (a service shown inline at a set height) and widgets (data the server fetches: API
values, a feed, the weather). Home is always first and can't be deleted. Pages are kept in a database: PGlite under
`DATA_DIR/pg` by default, or Postgres when `DATABASE_URL` is a postgres:// URL. They are served over GraphQL to a
React app built from the cubeui registry.

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

- `server/core/`: config getters (`DATA_DIR`, `DATABASE_URL`, `DB_CONNECT_TIMEOUT_MS`, `PORT`, `TRUST_PROXY`, the sign-in
  variables,
  `WEATHER_API_URL`), the `defaults.ts` groups (`PAGE_LIMIT_DEFAULTS` is also served as `Query.pageLimits`), coded
  errors and preflight.
- `server/auth/`: sign-in and who may do what.
  - `better-auth.ts` (`createAuth`), `auth-host.ts` (rebuilt when a provider is paired), `endpoints.ts`
    (better-auth's endpoints as GraphQL), `resolvers.ts` (`access`, `authConfig`).
  - `access.ts`: the viewer, `requireView`/`requireEdit`, and `visiblePages` for `visibleTo`.
  - `forward-auth.ts`: trusted proxies and their `Remote-*` identities. `groups.ts`: the OIDC groups claim.
  - `icon-links.ts`: signed favicon addresses. `rate-limit.ts`, `throttle.ts`, `admin.ts`.
- `server/sso/`: pairing with a provider by setup URL (`pairing.ts`, RFC 7591/7592), where the provider comes from
  (`settings.ts`), and `ssoSetup`/`pairSso`/`updateSsoAppUrl`/`unpairSso` (`resolvers.ts`). `reset-cli.ts` is
  `npm run sso:reset`. `server/http/sso.ts` is the two OIDC legs.
- `server/db/`:
  - `client.ts`: opens PGlite or Postgres, each with its own migrator and close.
  - `schema.ts`: the tables, pages and sign-in both. Migrations are generated into `drizzle/` and committed.
  - `lock.ts`: one server per PGlite folder.
  - `wait.ts`: retries the first Postgres connection.
  - `import-yaml.ts`: moves 1.x YAML pages in on first boot. `import-yaml-cli.ts` is `npm run db:import-yaml`.
- `server/pages/`:
  - `page.ts`: the model and the `PageStore` interface.
  - `page-input.ts`: zod validation of API input, run before the store.
  - `page-edits.ts`: the rules for changing a page, as pure functions.
  - `db-page-store.ts`: the store.
  - `yaml-format.ts`: the 1.x YAML layout, for the import and the zip export.
  - `widget.ts`, `widget-input.ts`, `widget-disk.ts`: the widget model, its API validation, and its YAML form. The
    YAML form is also what `items.widget` holds.
  - `slug.ts`: slugs and ids.
- `server/site/site-settings.ts`: the launcher's search engines, in `site_settings`.
- `server/widgets/`: fetching widget data.
  - `widget-service.ts`: the cache (per page, item and settings hash), shared in-flight fetches and stale-on-error.
  - `api.ts`, `rss.ts`, `weather.ts`: the fetchers.
  - `secrets.ts`: fills in `${env:HOMEPAGE_*}` / `${file:…}` and scrubs them back out of everything a fetch returns.
- `server/discovery/`: finding apps on the network to suggest.
  - `candidate.ts`: what a source reports, and the `DiscoverySource` contract.
  - `mdns.ts`, `dockhand.ts`, `docker-socket.ts`: the sources; `container-apps.ts` maps a container (and its
    Homepage labels) to an app for both container sources.
  - `describe.ts`: an address's page and web manifest → name, description, icon. Also "Fill in".
  - `store.ts`: the `discovered_apps` rows. `service.ts`: scans, describes and records, one scan at a time.
  - `setup.ts`: which sources the environment sets up.
- `server/graphql/`: the SDL (`type-defs.ts`), resolvers (`schema.ts`), the discovery part (`discovery.ts`),
  operation limits and the logger. `write-schema.ts` prints `schema.graphql`.
- `server/http/`: `createApp(deps)`, health and shutdown. `server/index.ts` only boots.
- `web/src/components/`: vendored cubeui and shadcn code. Don't edit it; reinstall with
  `npx shadcn@latest add @cubeui/<item>`.
- The app's features:
  - `web/src/pages/`
  - `web/src/sections/`
  - `web/src/search/`
  - `web/src/status/`
  - `web/src/frames/`
  - `web/src/export/`
  - `web/src/widgets/`: the card, its per-type views, `useWidgetData` and the editor.
  - `web/src/auth/`: the stored session, `useAccess`/`useCanEdit`, the sign-in settings and account cards,
    the open-instance notice, and the groups the Who can see it field suggests.
  - `web/src/discovery/`: Settings' Discovered apps section, the add-to-page dialog, and the item dialog's
    Discovered app / Enter manually choice, Fill in button and linked-app note.
- `tests/`: mirrors `server/`. `tests/db.ts` opens one in-memory PGlite per file with the real migrations.
- `examples/data/`: sample pages in the 1.x YAML layout, for `db:import-yaml`.

## Rules specific to this repo

- **Nothing above the store touches the database.** Resolvers and the web app use only `page.ts` types.
- **Every write is one transaction behind one advisory lock** (`exclusive` in `db-page-store.ts`), and rewrites the
  page's sections and items whole. Page-changing rules belong in `page-edits.ts`, not in the store.
- **Item URLs are http(s) only,** checked in `page-input.ts` and again when YAML is read. Frames load in this
  origin's page. Only a WIDGET may have no URL (`Item.url` is nullable for that); links and frames always have one.
- **A widget's secrets never leave the fetch.**
  - References are stored and served as written.
  - Values are resolved in `server/widgets/secrets.ts` at fetch time, and every string a fetch returns (values, raw
    JSON, errors) passes through its `redact`.
  - A new fetcher must take its strings through the same resolver.
  - `tests/widgets` and `tests/http/widgets.test.ts` hold this.
- **Widgets fetch on view, never in the background.** Discovery is the one thing that runs on a timer
  (`DISCOVERY_DEFAULTS.pollMinutes`), started after listen and stopped first on shutdown.
- **Discovered apps are suggestions.** Nothing found is ever put on a page by the server. An address that came
  from the network is only fetched when it resolves to a private address (`describe.ts`). Every discovery field
  is editors-only (`requireEdit`), since the list maps the network. A discovered app's server-fetched favicon
  is served at `/icons/discovered/<id>` behind the same signed links as an item's.
- **`Item.discoveredId` is replaced like every other field**: an `ItemInput` without it unlinks the item.
- **Who may do what is decided once per request, in `server/auth/access.ts`.** Every mutation in
  `graphql/schema.ts` goes through `editorsOnly`; every read of a page goes through `loadPage` or
  `visiblePages`, which drop what the viewer's groups may not see. A new resolver, route or export that
  reads pages must do the same: hidden things are absent, never FORBIDDEN, so their existence doesn't leak.
- **An instance with no sign-in set up stays open** (`AuthMode.OPEN`): anyone may do anything. Never lock
  an upgraded instance; say so in the UI instead.
- **`Remote-*` headers are believed only from `FORWARD_AUTH_TRUSTED_PROXIES`**, checked against the socket's
  address, never X-Forwarded-For (`auth/forward-auth.ts`).
- **Sign-in follows the cubicecho_backend `sso.md` pattern:** better-auth on the database, its endpoints as
  GraphQL, the two OIDC legs in `http/sso.ts`, the pairing in `sso/`, `AuthHost` rebuilt on (un)pairing.
- **Every sign-in address comes from `authHost.urls()`** (`siteUrls` in `core/config.ts`: `APP_URL`, else the
  address pairing recorded from the browser, else localhost). Don't build one from the environment directly: a
  pairing made without `APP_URL` would register or redirect to localhost.
- **No Storybook stories yet.** The UI was checked with scripted headless runs.
