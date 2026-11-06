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
- **Widths:** a section's items sit in one grid with as many columns as **Settings → General → Columns** says
  (1–8, default 4), fewer on a narrower screen and one on a phone. A tile takes one column. A frame (full width by
  default) or a widget (two columns by default) can take 1 column up to that setting, or the full width: **Width**
  in its dialog. An item set wider than the page has is drawn as wide as the page, and keeps its setting.
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

The first start makes `./data/pg`, the built-in database, with an empty Home page.

```sh
npm run check && npm test      # lint, types, tests
npm run build && npm start     # one process on PORT (default 3000) serving dist/
docker compose up -d --build   # the same, in a container, with the database in a named volume
```

`.env.example` documents every setting. Copy it to `.env` and fill in what you need, `APP_URL` first.

**With Docker Compose,** settings go in `.env` beside `docker-compose.yml` (or in the service's `environment`), and
every variable in `.env` reaches the app. After changing `.env`, run `docker compose up -d` so the container is
recreated: `docker compose restart` keeps the old values. Inside the container the app always listens on 3000 and
keeps its data in `/data`; `PORT` in `.env` chooses the port on the host.

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

Everything (pages, sign-in, discovered apps) is in the database, so a backup is a copy of it:

- **The built-in database:** stop the server, then copy `DATA_DIR/pg`. Restore by putting the copy back with the
  server stopped.
- **Postgres:** `pg_dump` and `pg_restore`, as for any database.

### Upgrading from 1.x

Releases before 2.0 kept pages as YAML files in `DATA_DIR`. 2.x imported them into the database on its first start;
3.0 no longer reads YAML at all. To keep pages from a 1.x install, upgrade to the last 2.x release first, start it
once so it imports them, then upgrade to 3.x.

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

`setSearchEngines(input: null)` goes back to the built-in engines.

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
fetches. The database and the API keep the reference, never the value: a header written as
`X-Api-Key: ${env:HOMEPAGE_SONARR_KEY}` is stored and shown exactly like that.

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

## Discovery

The server looks for apps on your network and lists them under **Settings → Discovered apps**. They are suggestions:
nothing appears on a page until you add it.

- **To add one,** use **Add to page…** in its menu, or choose **Discovered app** at the top of the Add item dialog.
  The dialog fills in the name, address, icon and description, and you can change any of them.
- **An added item is an ordinary item.** It remembers which app it came from, so the list can say "On Media"; editing
  it never changes the app. **Unlink** in the item's dialog forgets that.
- **Dismiss** hides an app from the list. **Show dismissed** brings it back.
- **Enter manually** has a **Fill in from this address** button, which reads the same details from any address
  you type.

Apps are found in three places:

| Source            | Finds                                                                                                                                                   | Set it up                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **mDNS**          | Anything that announces a web page on your network: `_http`/`_https` services (with their `path`), Home Assistant, OctoPrint, and printers' admin pages | On by default. Multicast doesn't cross Docker's default network, so run the container with `network_mode: host`. `DISCOVERY_MDNS=false` turns it off |
| **Dockhand**      | Running containers on every host [Dockhand](https://dockhand.pro) manages, at each host's public address and published port                             | `DOCKHAND_URL` and `DOCKHAND_TOKEN` (an API token, `dh_…`, from Dockhand)                                                                            |
| **Docker socket** | Running containers on this host                                                                                                                         | Mount `/var/run/docker.sock` read-only (or set `DOCKER_SOCKET`), and set `DISCOVERY_DOCKER_HOST` to the name other devices reach this host by        |

**How a found app gets its details:**

- Containers with [Homepage's labels](https://gethomepage.dev/configs/docker/) (`homepage.name`, `homepage.href`,
  `homepage.description`, `homepage.icon`) use them. `homepage.hide=true` keeps a container out.
- Everything else is described from its own page. The server reads the page's
  [web manifest](https://developer.mozilla.org/docs/Web/Manifest) for the name, description and icon, which most
  self-hosted apps ship so they can be installed on a phone.
- Without a manifest, it uses the page's title, description and icon links, and then its favicon.
- **Icons:** when the app's name matches an icon in dashboard-icons or selfh.st, that icon is chosen over the
  page's own. The name comes from its page, its container, or its image (`lscr.io/linuxserver/jellyfin` →
  `di:jellyfin`), and the match must be exact, ignoring case, spaces and hyphens. Order: a `homepage.icon` label, then
  a catalogue match, then the page's icon, then the favicon. **Fill in** matches the same way.
- **Rescan** on the page asks every source again. Otherwise Dockhand and the socket are asked every 5 minutes,
  and mDNS is watched all the time.

**Security:**

- Anyone on your network can announce a service, so found apps are only ever suggestions.
- The server fetches a found address only when it resolves to a private address. It follows redirects only on
  the same host, and every request has a time and size limit.
- Once sign-in is set up, the Discovered apps section, rescanning and Fill in are for editors only, since the
  list maps your network.

```yaml
services:
  personal-homepage:
    image: ghcr.io/cubicecho/personal-homepage:latest
    network_mode: host # for mDNS; drop `ports:`, the app listens on PORT on the host
    environment:
      DOCKHAND_URL: http://dockhand.lan:3000
      DOCKHAND_TOKEN: ${DOCKHAND_TOKEN}
      DISCOVERY_DOCKER_HOST: nas.lan
    volumes:
      - homepage_data:/data
      - /var/run/docker.sock:/var/run/docker.sock:ro
```

**When a name points at the container itself.** Some hosts list their own name against a loopback address in
`/etc/hosts` (`127.0.1.1 framework.lan`). Inside the container, that name then reaches the homepage instead of the
host. Dockhand's card says so when it happens ("…answered with this homepage's own page…"). The same wrong address
breaks status checks, favicons, frame checks, widgets and **Fill in** for anything on that host. Tell the container
where the name really is:

```yaml
extra_hosts:
  - "framework.lan:host-gateway" # or the host's LAN IP, e.g. "framework.lan:192.168.1.20"
```

Using the IP address in `DOCKHAND_URL` works too, but only fixes Dockhand.

## Bookmarklet

**Settings → Bookmarklet** has an **Add to homepage** button to drag to your browser's bookmarks bar. Click
that bookmark on any site, and the homepage opens at `/add` with the site's address, title and description
filled in. **Fill in** then adds its icon. Pick a page and section, and save.

- The bookmarklet opens `APP_URL`, or the address recorded when sign-in was paired, or else the address you
  had Settings open at. Settings warns when that is `localhost`, which only works on the same machine.
- On a phone, copy the code from the same page and paste it as a bookmark's address.
- Signing in on the way keeps the `/add?…` address, so you land on the filled-in dialog afterwards.
- `/add` accepts only `http` and `https` addresses. A few sites with strict security settings stop
  bookmarklets from running; use **Add item** there.

## The API

GraphQL at `/graphql`. In development, GraphiQL is served there too. `schema.graphql` is printed by `npm run codegen`
(it is generated, not committed).

- **Queries:** `pages`, `page(slug)`, `pageLimits`, `itemStatuses(pageSlug)`, `frameCheck(url)`,
  `iconSearch(query)`, `searchEngines`, `widgetData(pageSlug, itemId)` and `widgetPreview(input)`.
- **Page mutations:** `createPage`, `updatePage`, `deletePage`, `movePage`.
- **Section mutations:** `addSection`, `updateSection`, `removeSection`, `moveSection`.
- **Item mutations:** `addItem`, `updateItem`, `removeItem`, `moveItem`. `moveItem` can move an item into another
  section.
- **Settings:** `setSearchEngines`.
- **Discovery (editors only):** `discoveredApps(includeDismissed)`, `discoverySources` and `describeUrl(url)`; the
  mutations `rescanDiscovery` and `dismissDiscoveredApp`. `ItemInput.discoveredId` links an item to the app it
  came from.

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
  (`wait.ts`) and holds the built-in database's lock (`lock.ts`).
- **`server/pages/widget-storage.ts`** is how a widget's settings are stored in the `items.widget` column.

To change the tables, edit `server/db/schema.ts`, run `npm run db:generate`, and commit the new folder in
`drizzle/`.

## Sign-in

A new homepage has no sign-in: anyone who can reach it can see and change everything, exactly as before
sign-in existed, so an upgrade locks nobody out. It says so above every page until sign-in is set up.

Sign-in is set up in one of two ways, both made for [heautou](https://github.com/cubicecho/heautou). Any OpenID
Connect provider, or any proxy that sends Authelia-style `Remote-*` headers, works too.

**First, set `APP_URL` to the address you open the homepage at,** such as `APP_URL=http://homepage.lan:3000` or
`https://home.example.com`. After signing in, the provider sends the browser back to
`<APP_URL>/api/auth/callback/oidc`, the _callback address_, so it has to be an address your browser can reach.
Settings shows the callback address in use.

### Pairing with heautou (OpenID Connect)

1. In heautou, go to **Clients → Pair an app**. Choose the groups that may sign in, keep the groups claim as
   `groups`, and choose **Make setup URL**.
2. In the homepage, go to **Settings**, paste the setup URL, and choose **Pair**. The homepage registers itself
   with heautou. It needs no client ID, secret, or restart.
3. The homepage now asks for sign-in. Choose **Sign in with heautou**. The first person to sign in becomes the
   admin.

- **The callback address registered** is under `APP_URL`. If `APP_URL` isn't set, pairing records the address your
  browser has the homepage open at, and uses that. Pairing from another machine is refused when it would register
  a `localhost` callback, since a browser elsewhere could never come back to it.
- **Unpairing:** choose **Disconnect** on the same page. The client is deleted at heautou too.
- **Pinning the provider instead:** set `OIDC_ISSUER` and `OIDC_CLIENT_ID` (and `OIDC_CLIENT_SECRET`) in the
  environment. That wins over a pairing, and can't be changed from the app. `APP_URL` is then required, and you
  register the callback address that Settings shows with the provider yourself.

### When the callback address is wrong

The provider sends the browser to an address it can't open (often `localhost`), so nobody can finish signing in.
Ways to fix it, quickest first:

1. **Fix the callback address,** shown on the sign-in page and in Settings while the address is wrong. Open the
   homepage at the address people use and choose it. The homepage records that address and asks the provider to
   register the new callback (heautou supports this, RFC 7592). If the provider refuses, the message says which
   redirect URI to set in the provider by hand. In heautou that's **Clients →** the homepage's client **→ Redirect
   URIs**.
2. **Set `APP_URL`** and restart (with Compose: `docker compose up -d`), then change the client's redirect URI in
   the provider to the callback address the boot log prints (`[auth] callback address …`).
3. **Start over:** stop the homepage, run `npm run sso:reset`, start it again, and pair again. With Docker Compose:
   `docker compose run --rm personal-homepage node server/sso/reset-cli.ts`. This forgets the pairing and asks the
   provider to delete the client. With no way to sign in set up, the homepage is open again until it is re-paired.
   Accounts are kept, and the admin is still the admin once they sign in again. With Postgres it can run while the
   homepage does; restart the homepage afterwards.

- **Groups:** a person's groups come from the ID token's `groups` claim (`OIDC_GROUPS_CLAIM` to read another),
  copied at each sign-in.
- **No email address needed:** a heautou user without one signs in under a placeholder address that is never
  shown.
- **Sessions:** kept in the database for 30 days, and sent as bearer tokens. There are no passwords or sign-in
  links.

### Forward auth (heautou Protected sites, Authelia, Authentik)

When a reverse proxy already asks heautou about every request
([heautou's forward-auth guide](https://github.com/cubicecho/heautou/blob/main/docs/forward-auth.md)), the
homepage can trust what it says:

```sh
FORWARD_AUTH_TRUSTED_PROXIES=172.18.0.0/16   # the proxy's address or range; comma-separated
```

`Remote-User`, `Remote-Name`, `Remote-Email` and `Remote-Groups` are then believed, but only on connections from
those addresses. From anywhere else they are ignored, so nobody can claim to be someone by sending them. Each
person gets an account the first time the proxy names them, linked by address to an OIDC account when both
exist. The first becomes the admin.

### Who may see and change what

|                               | Open (no sign-in set up) | Sign-in set up                                                                 |
| ----------------------------- | ------------------------ | ------------------------------------------------------------------------------ |
| See the pages                 | Anyone                   | Anyone signed in, or anyone at all with `PUBLIC_VIEW=true`                     |
| Change anything               | Anyone                   | The admin (the first account), and members of `ADMIN_GROUPS` (comma-separated) |
| Pair or disconnect a provider | Anyone                   | The same editors; anyone while nobody has an account yet                       |

**Limiting by group:** a page, section or item can be limited to groups with **Who can see it** in its dialog
(`visibleTo`). People outside those groups don't see it anywhere:

- it is missing from the pages, search, status checks and widget data
- its address answers _not found_

Editors see everything, to be able to manage it.

### Settings

| Variable                                              | Meaning                                                                                            |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `APP_URL`                                             | The address you open the homepage at, such as `https://home.example.com`. Sign-ins come back here. |
| `SERVER_URL`                                          | Where the server is, when it is not under `APP_URL`. The callback address is under it.             |
| `BETTER_AUTH_SECRET`                                  | What sessions are signed with. Unset, one is made and kept in `DATA_DIR/auth-secret`.              |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | A provider set in the environment, instead of pairing.                                             |
| `OIDC_NAME`, `OIDC_CLIENT_AUTH`, `OIDC_GROUPS_CLAIM`  | Its button name, how the secret is sent, and the groups claim.                                     |
| `FORWARD_AUTH_TRUSTED_PROXIES`                        | Addresses and CIDR ranges whose `Remote-*` headers are believed.                                   |
| `ADMIN_GROUPS`                                        | Groups whose members may edit, besides the admin.                                                  |
| `PUBLIC_VIEW`                                         | `true` to let people who are not signed in see (not change) the pages.                             |

## Security

Until sign-in is set up, anyone who can reach the port can change the pages. With it set up:

- **Sign-in is throttled.** Spending sign-in tokens and pairing are limited per client address. `TRUST_PROXY`
  has to name the proxy in front, so that the address is the client's own.
- **Hidden things can't be found.** Favicon addresses carry a signature, since an image request sends no session.
  Anything hidden answers as though it did not exist.
- **Forward auth needs the proxy to protect it.** Only trust a proxy that strips `Remote-*` headers from the
  browser's own request; heautou's snippets do.
