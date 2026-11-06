# personal-homepage

A self-hosted start page for your network. Each page holds a list of items, and every edit is made in the web app:

- **Links:** tiles that open a service in a new tab.
- **Apps:** tiles that open a service framed across the whole page, with **Open in the browser** beside it.
- **Frames:** a service shown inline on the page, at a height you set.

**Home** is always there and always first. Add as many other pages as you like.

There is no database. Pages are YAML files in a data directory, and the web app reads and writes them through a
GraphQL API. The API is the only thing that touches the files, so a database can replace them later without the
web app changing (see [Storage](#storage)).

## Quick start

```sh
npm install
cp -r examples/data ./data     # optional: start from the sample pages
npm run dev                    # web on http://localhost:3000, API on :8787 (GraphiQL at /graphql)
```

With no `./data`, the server makes one and creates an empty Home page.

```sh
npm run check && npm test      # lint, types, tests
npm run build && npm start     # one process on PORT (default 3000) serving dist/
docker compose up -d --build   # the same, in a container, with the pages in a named volume
```

`.env.example` documents `DATA_DIR`, `PORT` and `TRUST_PROXY`.

Released images are published to GHCR as `ghcr.io/cubicecho/personal-homepage`, tagged with the version and
`latest`. A `feat:` or `fix:` commit on `main` cuts a release once CI passes.

## The data directory

```
data/
  site.yaml           # pageOrder: [media, tools]  (page order after Home)
  pages/
    home.yaml
    media.yaml        # the file name is the page's slug: /pages/media
```

One page file:

```yaml
title: Media
icon: film
items:
  - id: jellyfin
    kind: link # link | app | frame
    title: Jellyfin
    url: http://nas.local:8096
    icon: film
    description: Films and shows
  - id: grafana
    kind: frame
    title: Grafana
    url: http://nas.local:3001/d/home?kiosk
    frameHeightPx: 480 # frames only
```

- **You can edit files by hand.** They are read on every request, so changes show without a restart.
  - `kind` and `icon` are accepted in any case.
  - An item with no `id` gets one made from its title.
  - The icons are the `Icon` enum in the schema, written in lower case: `globe`, `server`, `house`, `film`,
    `music` and the rest.
- **A save from the web app rewrites the whole page file.** Comments you typed into it are lost.
- **A broken file does not take the site down.** A file that isn't valid YAML or doesn't fit the shape is logged
  (`[store] skipping pages/x.yaml: …`) and left out of the list. Opening that page shows the error in a sentence.
- **Only `http` and `https` URLs are accepted.** A `javascript:` or `data:` URL in a frame would run inside this
  site.

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

- **Queries:** `pages`, `page(slug)`, `pageLimits`.
- **Page mutations:** `createPage`, `updatePage`, `deletePage`, `movePage`.
- **Item mutations:** `addItem`, `updateItem`, `removeItem`, `moveItem`.

Failures carry `extensions.code`: `BAD_USER_INPUT`, `NOT_FOUND` or `QUERY_TOO_COMPLEX`. `GET /healthz` answers
`{ ok, version }`.

## Storage

`server/pages/page.ts` defines the `Page` and `Item` model and the `PageStore` interface. Everything above it
(resolvers, the web app) uses only those. Input is validated by `server/pages/page-input.ts` before it reaches a
store, so every store gets checked input.

`server/pages/yaml-page-store.ts` is the only store so far. To move to a database, write another `PageStore` and
pass it to `createApp` in `server/index.ts`. The store's own rules are written in the `PageStore` doc comments and
covered by `tests/pages/yaml-page-store.test.ts`:

- unique slugs and ids
- page and item limits
- Home stays first and can't be deleted

## Security

There is no sign-in. Anyone who can reach the port can edit the pages. Keep it on a trusted network, or put it
behind a proxy that authenticates.
