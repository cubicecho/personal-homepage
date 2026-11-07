## [3.5.1](https://github.com/cubicecho/personal-homepage/compare/v3.5.0...v3.5.1) (2026-11-07)


### Bug Fixes

* **web:** keep a widget card's menu on its title's line ([f5032af](https://github.com/cubicecho/personal-homepage/commit/f5032afe499017d2fe5eba6b2f4085d4f9791af7))

# [3.5.0](https://github.com/cubicecho/personal-homepage/compare/v3.4.0...v3.5.0) (2026-11-06)


### Features

* **web:** add edit mode, and keep every shortcut behind Ctrl or ⌘ ([f61c462](https://github.com/cubicecho/personal-homepage/commit/f61c46226fade65ac310349cf2618967885b7c3d))

# [3.4.0](https://github.com/cubicecho/personal-homepage/compare/v3.3.0...v3.4.0) (2026-11-06)


### Features

* **web:** put "Go to <page>" in the toast after moving an item ([c7ac629](https://github.com/cubicecho/personal-homepage/commit/c7ac629e10125888fe8ae714a2ba7963d17d533d)), closes [cubeui#403](https://github.com/cubeui/issues/403)

# [3.3.0](https://github.com/cubicecho/personal-homepage/compare/v3.2.0...v3.3.0) (2026-11-06)


### Features

* let the site set its column count, and size items in those columns ([696609c](https://github.com/cubicecho/personal-homepage/commit/696609c3fae88d37e195ee61b23e45876e07bf35))
* **web:** lay sections out in the site's columns, and tidy the cards ([9a179c1](https://github.com/cubicecho/personal-homepage/commit/9a179c1ba7aa247259a19ec65c27f78bb467cd4e))

# [3.2.0](https://github.com/cubicecho/personal-homepage/compare/v3.1.1...v3.2.0) (2026-11-06)


### Features

* add the page you're on to the homepage with a bookmarklet ([6236d47](https://github.com/cubicecho/personal-homepage/commit/6236d47b6aba8a4b56f0d6b7fbacc3b3052b288c))
* **web:** come back to the page you were opening after signing in ([4329dbd](https://github.com/cubicecho/personal-homepage/commit/4329dbdfafa33481ae6d2dfad1a5a647589e4a27))

## [3.1.1](https://github.com/cubicecho/personal-homepage/compare/v3.1.0...v3.1.1) (2026-11-06)


### Bug Fixes

* **discovery:** say what went wrong when Dockhand or the Docker socket can't be read ([bcbd626](https://github.com/cubicecho/personal-homepage/commit/bcbd626a9d36c079cb8f82dda099ab8cbba8481b))

# [3.1.0](https://github.com/cubicecho/personal-homepage/compare/v3.0.1...v3.1.0) (2026-11-06)


### Features

* let frames and widgets span columns of their section's grid ([bf93d72](https://github.com/cubicecho/personal-homepage/commit/bf93d72f8e6e87b01f79e238889f507de49ff325))
* **web:** give every card a title row with its status and a quiet menu ([44c34fd](https://github.com/cubicecho/personal-homepage/commit/44c34fd0674a8141b3f3b06e7494db23365396a5))
* **web:** lay a section out as one grid, and choose how wide a frame or widget is ([316975f](https://github.com/cubicecho/personal-homepage/commit/316975f9ff4d02e3d505559ad8b040eea8d88778))

## [3.0.1](https://github.com/cubicecho/personal-homepage/compare/v3.0.0...v3.0.1) (2026-11-06)


### Bug Fixes

* **web:** take cubeui's overlay fixes and drop the app's own frame guard ([a03c7a9](https://github.com/cubicecho/personal-homepage/commit/a03c7a999948b618646f25aac5a08241cb42b609)), closes [cubeui#402](https://github.com/cubeui/issues/402)

# [3.0.0](https://github.com/cubicecho/personal-homepage/compare/v2.2.2...v3.0.0) (2026-11-06)


* feat!: remove the zip download and every way of reading YAML pages ([21da835](https://github.com/cubicecho/personal-homepage/commit/21da83572ed4b7b1f81dbe20bee261f5626c084e))


### Features

* **discovery:** pick a catalogue icon when a found app's name matches one ([a3241b1](https://github.com/cubicecho/personal-homepage/commit/a3241b16d8966cbce1b8125346501d7a11a0545d))
* move an item to another page, with everything about it ([69692bd](https://github.com/cubicecho/personal-homepage/commit/69692bd46d58605406b5c9619b34e6100ab7416d))
* **web:** move an item to another page from its menu ([4c89906](https://github.com/cubicecho/personal-homepage/commit/4c8990671db7d5eec4eb23a1f04099471aff345c))


### BREAKING CHANGES

* GET /export.zip and npm run db:import-yaml are gone, and
the server no longer imports YAML pages on first start. Back up by
copying DATA_DIR/pg while the server is stopped, or with pg_dump on
Postgres. To keep pages from a 1.x install, upgrade to the last 2.x
release first and start it once so it imports them, then upgrade.

## [2.2.2](https://github.com/cubicecho/personal-homepage/compare/v2.2.1...v2.2.2) (2026-11-06)


### Bug Fixes

* **web:** keep menus open on a page that frames a focus-grabbing app ([5e5c2be](https://github.com/cubicecho/personal-homepage/commit/5e5c2beea2b8783e12e516354ac7cdbbf24f539b))

## [2.2.1](https://github.com/cubicecho/personal-homepage/compare/v2.2.0...v2.2.1) (2026-11-06)


### Bug Fixes

* **db:** keep the address a provider was paired from ([082de9d](https://github.com/cubicecho/personal-homepage/commit/082de9d705f0d3e5aaae15bb404aab02f60eefaf))
* **docker:** pass every variable in .env to the app ([3b5cda7](https://github.com/cubicecho/personal-homepage/commit/3b5cda73f726ceefb63873243fe54dccc5a0c7df))
* send OIDC sign-ins back to the address the homepage is open at, not localhost ([030af10](https://github.com/cubicecho/personal-homepage/commit/030af104d9c83523fd4a7ddb43e1c3fabb6ecbed))

# [2.2.0](https://github.com/cubicecho/personal-homepage/compare/v2.1.0...v2.2.0) (2026-11-06)


### Bug Fixes

* **discovery:** describe an mDNS app at the address it announced ([e7010c9](https://github.com/cubicecho/personal-homepage/commit/e7010c9ae30198d3d27da6cd40f133c1eb39f606))


### Features

* **db:** keep discovered apps, and link an item to the one it came from ([b230c9f](https://github.com/cubicecho/personal-homepage/commit/b230c9f3769081488820edefcd76e282fec69822))
* find apps on the network through mDNS, Dockhand and the Docker socket ([403f98b](https://github.com/cubicecho/personal-homepage/commit/403f98bd412e084035f43fdbfe88e51069032bd2))
* **web:** list discovered apps in Settings and add them from the item dialog ([465c9aa](https://github.com/cubicecho/personal-homepage/commit/465c9aaca9bf0e24737d997dee8fd1c01fbf1820))

# [2.1.0](https://github.com/cubicecho/personal-homepage/compare/v2.0.0...v2.1.0) (2026-11-06)


### Bug Fixes

* sign in provider users who have no email address ([f34142a](https://github.com/cubicecho/personal-homepage/commit/f34142a19461638a43b1f752b8a03eb92389dc1c))


### Features

* make and keep a sign-in secret when BETTER_AUTH_SECRET is unset ([0a5dfe0](https://github.com/cubicecho/personal-homepage/commit/0a5dfe010f118e6a3451360f75aa8db5ded07e79))
* sign in through heautou, by OIDC pairing or forward auth, and limit what each group sees ([a62a6e0](https://github.com/cubicecho/personal-homepage/commit/a62a6e0e42b3ed2311285f2d5cd5848f8ad2d4f1))
* **web:** sign in with heautou, set sign-in up from settings, and choose who can see each thing ([d6fe37e](https://github.com/cubicecho/personal-homepage/commit/d6fe37e4105635c27ecc404397843769cadf5d70))

# [2.0.0](https://github.com/cubicecho/personal-homepage/compare/v1.3.0...v2.0.0) (2026-11-06)


* feat!: store pages in the database instead of YAML files ([ba272e3](https://github.com/cubicecho/personal-homepage/commit/ba272e32138354ac7aa4bef513fc28f32c7bdc6d))


### Features

* **db:** open PGlite or Postgres, with committed migrations ([20c105a](https://github.com/cubicecho/personal-homepage/commit/20c105aa13831feca1d35709328e892449529b3c)), closes [#2](https://github.com/cubicecho/personal-homepage/issues/2)


### BREAKING CHANGES

* pages are no longer read from or written to
DATA_DIR/pages/*.yaml and site.yaml. Existing files are imported once on
first start and then renamed; editing them has no effect afterwards.
Search engines are set with setSearchEngines instead of site.yaml.

# [1.3.0](https://github.com/cubicecho/personal-homepage/compare/v1.2.0...v1.3.0) (2026-11-06)


### Features

* add widget items to the page model and the YAML store ([863bb84](https://github.com/cubicecho/personal-homepage/commit/863bb84371329784f7fc9c186844793779b926d0)), closes [#2](https://github.com/cubicecho/personal-homepage/issues/2)
* fetch widget data on the server, with secrets that never leave it ([84589e2](https://github.com/cubicecho/personal-homepage/commit/84589e29271edce2403f61d377ee0ba1e72ccd46)), closes [#2](https://github.com/cubicecho/personal-homepage/issues/2)
* **web:** fold the sidebar to a rail of icons ([5da9362](https://github.com/cubicecho/personal-homepage/commit/5da936251ef8f8fd08dfc1de5ce147060f96d741))
* **web:** show widgets on pages and edit them in the item dialog ([d55a95b](https://github.com/cubicecho/personal-homepage/commit/d55a95b4e791b3a128a44da3154719574fba0925)), closes [#2](https://github.com/cubicecho/personal-homepage/issues/2)

# [1.2.0](https://github.com/cubicecho/personal-homepage/compare/v1.1.0...v1.2.0) (2026-11-06)


### Features

* **web:** give a framed app the whole view under a slim bar ([e2ffa4b](https://github.com/cubicecho/personal-homepage/commit/e2ffa4b19e025505b3b5dec92852f9a360e24bdb))

# [1.1.0](https://github.com/cubicecho/personal-homepage/compare/v1.0.0...v1.1.0) (2026-11-06)


### Features

* add a search launcher for items, pages, addresses and the web ([e6df0dd](https://github.com/cubicecho/personal-homepage/commit/e6df0ddbd7ad00347859e23792465a1752f3f4ab))
* add sections, merge apps into links, and open the model for icons and status ([261580c](https://github.com/cubicecho/personal-homepage/commit/261580ccf60e11cb461d3cd6f9555176b65c47c2))
* download every page as one zip ([84dd7e4](https://github.com/cubicecho/personal-homepage/commit/84dd7e40c2a48a93ff00259ac0e4b6e66e95809d))
* **icons:** resolve dashboard-icons, selfh.st and favicon icons ([04c8414](https://github.com/cubicecho/personal-homepage/commit/04c841452cf4a1006e1bbfba4936f2f82a063ba5))
* show each item's status, checked by the server ([aac8f8f](https://github.com/cubicecho/personal-homepage/commit/aac8f8f1ef5aabb2a78d8d83c86899c5a20d34cf))
* warn when a site refuses to be framed, and offer a new tab instead ([89be382](https://github.com/cubicecho/personal-homepage/commit/89be38213fb015e6140f5ee376eda9420005ec86))
* **web:** group a page's items into sections that fold ([f8b8132](https://github.com/cubicecho/personal-homepage/commit/f8b8132ea295f768d48a80b4b72c647540a0487b))
* **web:** pick icons by searching, or use the site's own icon ([44a5ea4](https://github.com/cubicecho/personal-homepage/commit/44a5ea43fc1618a6326d869bd893fce2532c8ced))

# 1.0.0 (2026-11-06)

### Features

- add the homepage: pages of links, apps and frames kept in YAML ([ef13e5b](https://github.com/cubicecho/personal-homepage/commit/ef13e5b503304f0a78607e67d10141cfa9db0fd8))
