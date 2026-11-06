# personal-homepage

A self-hosted start page for your network. Every edit is made in the web app.

- **Pages** are listed in the sidebar. **Home** is always there and always first; add as many others as you like.
- **Sections** group a page's items under a heading. A section can start folded, and each browser remembers
  whether you opened it.
- **Items** come in three kinds:
  - **Links** are tiles. Each opens in a new tab, in this tab, or inside the homepage: framed across the page, with
    **Open in the browser** beside it.
  - **Frames** show a service inline on the page, at a height you set.
  - **Widgets** show data the server fetches: values picked out of a JSON API, a feed's latest entries, or the
    weather. See [Widgets](#widgets).
- **Status dots** on items show whether each service answers, checked by the server.
- **Search:** press Ctrl+K (or ⌘K), or `/`, or just start typing anywhere. It finds items and pages on every
  page, opens addresses, and sends anything else to a web search. Start with `!g` or another prefix to pick the
  search engine.

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

A page with one untitled section lists its items directly:

```yaml
title: Media
icon: film
items:
  - id: jellyfin
    title: Jellyfin
    url: http://nas.local:8096
    icon: di:jellyfin
    description: Films and shows
  - id: kanban
    opensIn: app # new-tab (the default) | same-tab | app
    title: Kanban
    url: http://tools.local:3000
    check: http://tools.local:3000/health # false to not check, or another address to check
  - id: grafana
    kind: frame # link (the default) | frame
    title: Grafana
    url: http://nas.local:3001/d/home?kiosk
    frameHeightPx: 480 # frames only
```

With more sections, the items sit under each one:

```yaml
title: Media
sections:
  - id: watch
    title: Watch
    collapsed: true # starts folded
    items: [...]
  - id: listen
    title: Listen
    items: [...]
```

- **You can edit files by hand.** They are read on every request, so changes show without a restart.
  - Words such as `kind`, `opensIn` and glyph names are accepted in any case.
  - An item or section with no `id` gets one made from its title.
  - Files from 0.x with `kind: app` still read, as links that open in the app.
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
- **A save from the web app rewrites the whole page file.** Comments you typed into it are lost.
- **A broken file does not take the site down.** A file that isn't valid YAML or doesn't fit the shape is logged
  (`[store] skipping pages/x.yaml: …`) and left out of the list. Opening that page shows the error in a sentence.
- **Only `http` and `https` URLs are accepted.** A `javascript:` or `data:` URL in a frame would run inside this
  site.

## Search engines

The launcher's web searches are DuckDuckGo (`!d`, the default), Google (`!g`) and Wikipedia (`!w`). To change them,
add a `search` key to `site.yaml`, for example to put a SearXNG instance first:

```yaml
search:
  defaultPrefix: s
  engines:
    - { prefix: s, name: SearXNG, url: "http://searx.local/search?q={query}" }
    - { prefix: g, name: Google, url: "https://www.google.com/search?q={query}" }
```

## Widgets

A widget is an item the server fills in. Pick **Widget** as the kind in the item dialog, then one of three types.
**Test** runs it before you save; for an API widget it also shows the raw JSON, to write paths against.

- **API values:** one to six values picked out of a JSON API's answer, each with a label, a JSONPath
  (`$.totalRecords`, `$.records[0].title`, `$.records.length`), a format (number, size in bytes, percentage,
  duration, date or text) and optional warning thresholds. One value is drawn as a large figure.
- **Feed:** the latest entries of an RSS or Atom feed, each linking to the entry, optionally with a line of its summary.
- **Weather:** the weather now, today's high and low and the coming hours, from [Open-Meteo](https://open-meteo.com/).
  It needs no key. `WEATHER_API_URL` points it at a self-hosted Open-Meteo instead.

How they fetch:

- **Only when a page is viewed.** Nothing polls in the background. The server keeps each answer for the widget's
  cache time (60 seconds for an API, 15 minutes for a feed or the weather, unless you set one), and a page can ask
  again every so often while it is open and its tab is showing.
- **From the server, not the browser.** Sources on your LAN work, there are no cross-origin problems, and API keys
  never reach the page.
- **A source that is down doesn't blank the widget.** The last good answer stays, marked out of date, with the error
  under it.

### Secrets

An API widget's address, headers and body may hold secret references, which the server fills in only when it
fetches. The page file and the API keep the reference, never the value:

```yaml
- id: sonarr-queue
  kind: widget
  title: Sonarr queue
  url: http://sonarr.lan:8989 # optional: where the title links to
  widget:
    type: api
    url: http://sonarr.lan:8989/api/v3/queue
    headers: { X-Api-Key: "${env:HOMEPAGE_SONARR_KEY}" }
    fields:
      - { label: Downloading, path: $.totalRecords, format: number, warnAbove: 10 }
```

- `${env:NAME}` reads an environment variable. **Its name must start with `HOMEPAGE_`**, so a widget can't read any
  other variable the server has.
- `${file:/path}` reads a file, trimmed, such as a Docker secret. **It must be in `/run/secrets` or
  `<DATA_DIR>/secrets`.**
- These limits matter because there is no sign-in yet: anyone who can edit a widget chooses where its requests go.
- Anything a fetch sends back is scrubbed of the secrets it used: the widget's values, the raw JSON of a test, and
  every error message.

With Docker Compose, pass the variables in `environment:` or an `env_file:`.

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

## Export

**Download as zip**, at the bottom of the sidebar, saves `site.yaml` and every `pages/*.yaml` as one zip
(`GET /export.zip`, named `homepage-YYYY-MM-DD.zip`). The files keep their paths, so unzipping it into an empty data
directory restores every page. Nothing else in the data directory is included. There is no versioning: a zip is a
copy of the files as they are now.

## The API

GraphQL at `/graphql`. In development, GraphiQL is served there too. `schema.graphql` is printed by `npm run codegen`
(it is generated, not committed).

- **Queries:** `pages`, `page(slug)`, `pageLimits`, `itemStatuses(pageSlug)`, `frameCheck(url)`,
  `iconSearch(query)`, `searchEngines`, `widgetData(pageSlug, itemId)` and `widgetPreview(input)`.
- **Page mutations:** `createPage`, `updatePage`, `deletePage`, `movePage`.
- **Section mutations:** `addSection`, `updateSection`, `removeSection`, `moveSection`.
- **Item mutations:** `addItem`, `updateItem`, `removeItem`, `moveItem`. `moveItem` can move an item into another
  section.

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
