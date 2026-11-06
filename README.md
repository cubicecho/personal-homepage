# personal-homepage

A self-hosted start page for your network. Every edit is made in the web app.

- **Pages** are listed in the sidebar. **Home** is always there and always first; add as many others as you like.
- **Sections** group a page's items under a heading. A section can start folded, and each browser remembers
  whether you opened it.
- **Items** come in two kinds:
  - **Links** are tiles. Each opens in a new tab, in this tab, or inside the homepage: framed across the page, with
    **Open in the browser** beside it.
  - **Frames** show a service inline on the page, at a height you set.
- **Status dots** on items show whether each service answers, checked by the server.
- **Search:** press Ctrl+K (or ⌘K), or `/`, or just start typing anywhere. It finds items and pages on every
  page, opens addresses, and sends anything else to a web search. Start with `!g` or another prefix to pick the
  search engine.

Pages are kept in a database: a built-in one (PGlite, which is Postgres running inside the server) in `DATA_DIR`,
or your own Postgres server. The web app reads and writes them through a GraphQL API.

## Quick start

```sh
npm install
npm run dev                    # web on http://localhost:3000, API on :8787 (GraphiQL at /graphql)
```

The first start makes `./data/pg`, the built-in database, with an empty Home page. To start from the sample
pages instead, stop the server and run `npm run db:import-yaml -- --data-dir examples/data --replace`.

```sh
npm run check && npm test      # lint, types, tests
npm run build && npm start     # one process on PORT (default 3000) serving dist/
docker compose up -d --build   # the same, in a container, with the database in a named volume
```

`.env.example` documents `DATA_DIR`, `DATABASE_URL`, `DB_CONNECT_TIMEOUT_MS`, `PORT` and `TRUST_PROXY`.

Released images are published to GHCR as `ghcr.io/cubicecho/personal-homepage`, tagged with the version and
`latest`. A `feat:` or `fix:` commit on `main` cuts a release once CI passes.

## Where pages are kept

| `DATABASE_URL`                          | Pages live in                        | Good for                               |
| --------------------------------------- | ------------------------------------ | -------------------------------------- |
| unset (the default)                     | `DATA_DIR/pg`, the built-in database | one server, nothing else to run        |
| `postgres://user:password@host:5432/db` | that Postgres server                 | a Postgres you already run and back up |

- **Migrations run on every start.** They are committed in `drizzle/` and apply themselves, on either database.
- **With Postgres, the server waits for it.** It retries for up to `DB_CONNECT_TIMEOUT_MS` (default 60 s), so it can
  start before Postgres has. A wrong password or a missing database fails at once.
- **The built-in database belongs to one server.** A second server pointed at the same `DATA_DIR` refuses to start
  (`DATA_DIR/pg/homepage.pid` says who holds it). A lock left by a server that was killed is taken over.
- `DATA_DIR` also holds the icon caches (`cache/`), which can be deleted at any time.

### Backups

- **Download as zip,** at the bottom of the sidebar (`GET /export.zip`), saves every page and the search settings
  as readable YAML: `site.yaml` and one `pages/<slug>.yaml` per page.
  - To restore one, unzip it and run `npm run db:import-yaml -- --data-dir <the unzipped folder> --replace`, with
    the server stopped when it uses the built-in database.
  - A zip is a copy of the pages as they are now; there is no versioning.
- **The built-in database:** copy `DATA_DIR/pg` while the server is stopped.
- **Postgres:** `pg_dump`, as for any database.

### Upgrading from 1.x

Releases before 2.0 kept pages as YAML files in `DATA_DIR`. On its first start, 2.0 moves them into the database
by itself:

1. It imports `DATA_DIR/pages/*.yaml` and the page order and search settings in `DATA_DIR/site.yaml`, in one go.
   This happens only when the database holds nothing but an empty Home page.
2. It renames `pages/` and `site.yaml` to `pages.imported-<time>/` and `site.imported-<time>.yaml`, so they are
   never imported twice.
3. It logs `[db] imported N pages from YAML`. A file it can't read is logged and left out; the rest still import.

To import YAML into a database that already has pages, use
`npm run db:import-yaml -- --data-dir <folder> --replace`. It deletes the pages that are there first.

Every 1.x format reads: `kind: app` items become links that open in the app, and a page with bare `items:` becomes
one untitled section.

## Items

- **Icons** can be:
  - a built-in glyph: `globe`, `server`, `house`, `film`, `music` and the rest
  - an icon from [dashboard-icons](https://github.com/homarr-labs/dashboard-icons) (`di:jellyfin`) or
    [selfh.st icons](https://selfh.st/icons/) (`sh:jellyfin`)
  - `favicon`, the item's own site's icon, fetched by the server, so it works for services on your LAN
  - an image address
- **Status checks** run on the server when a page is open: a HEAD request, falling back to GET.
  - A success, a redirect, or a 401 or 403 (a sign-in page) counts as up.
  - An untrusted HTTPS certificate counts as up too, and says so.
  - Results are kept for 30 seconds.
  - An item can turn its check off, or check another address, such as a health endpoint.
- **Only `http` and `https` URLs are accepted.** A `javascript:` or `data:` URL in a frame would run inside this
  site.

## Search engines

The launcher's web searches are DuckDuckGo (`!d`, the default), Google (`!g`) and Wikipedia (`!w`). There is no
settings page for them yet. To change them, call `setSearchEngines` from GraphiQL at `/graphql` (in development),
for example to put a SearXNG instance first:

```graphql
mutation {
  setSearchEngines(
    input: {
      defaultPrefix: "s"
      engines: [
        { prefix: "s", name: "SearXNG", url: "http://searx.local/search?q={query}" }
        { prefix: "g", name: "Google", url: "https://www.google.com/search?q={query}" }
      ]
    }
  ) {
    prefix
    isDefault
  }
}
```

`setSearchEngines(input: null)` goes back to the built-in engines. A `search:` key in an imported `site.yaml` sets
them too.

## Frames and apps

Apps and frames show the service in an `<iframe>`. The service talks to its own server and keeps its own sign-in;
nothing is proxied.

- **Some services refuse to be framed.** `X-Frame-Options` or a `frame-ancestors` policy makes the browser show a
  blank box, and the page itself can't tell. So the server asks the site (`Query.frameCheck`, reading only the
  headers) and the item dialog and the app view warn when it forbids framing, with a one-click switch to a link
  that opens a new tab. A `frame-ancestors` list of hosts counts as forbidding, since the server can't know which
  address you open the homepage at. A site that can't be reached gets no warning. Every frame still has
  **Open in the browser**.
- **Use addresses that work from every device you'll open the homepage on.** `http://localhost:8096` means a
  different machine on your phone.

## The API

GraphQL at `/graphql`. In development, GraphiQL is served there too. `schema.graphql` is printed by `npm run codegen`
(it is generated, not committed).

- **Queries:** `pages`, `page(slug)`, `pageLimits`, `itemStatuses(pageSlug)`, `frameCheck(url)`,
  `iconSearch(query)` and `searchEngines`.
- **Page mutations:** `createPage`, `updatePage`, `deletePage`, `movePage`.
- **Section mutations:** `addSection`, `updateSection`, `removeSection`, `moveSection`.
- **Item mutations:** `addItem`, `updateItem`, `removeItem`, `moveItem`. `moveItem` can move an item into another
  section.
- **Settings:** `setSearchEngines`.

Failures carry `extensions.code`: `BAD_USER_INPUT`, `NOT_FOUND` or `QUERY_TOO_COMPLEX`. `GET /healthz` answers
`{ ok, version }`, or 503 when the database doesn't answer.

## How storage is built

`server/pages/page.ts` defines the `Page` and `Item` model and the `PageStore` interface. Everything above it
(resolvers, the web app) uses only those, and input is validated by `server/pages/page-input.ts` before it reaches
the store.

- **The rules for changing a page** live in `server/pages/page-edits.ts` as pure functions:
  - unique ids
  - limits
  - the last section stays
  - moves clamp to the list
- **`server/pages/db-page-store.ts`** applies those rules inside one transaction per change, behind one shared lock.
  It writes a page's sections and items back whole, renumbered.
- **`server/db/`** opens PGlite or Postgres (`client.ts`), defines the tables (`schema.ts`), waits for Postgres
  (`wait.ts`) and imports YAML (`import-yaml.ts`).
- **`server/pages/yaml-format.ts`** reads and writes the 1.x YAML layout, for the import and the zip.

To change the tables, edit `server/db/schema.ts`, run `npm run db:generate`, and commit the new folder in
`drizzle/`.

## Security

There is no sign-in. Anyone who can reach the port can edit the pages. Keep it on a trusted network, or put it
behind a proxy that authenticates.
