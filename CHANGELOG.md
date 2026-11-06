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
