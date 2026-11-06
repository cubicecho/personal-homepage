/** How the HTTP server listens and stops. */
export interface HttpSettings {
  /** Port to listen on. `PORT` overrides it. */
  port: number;
  /** Largest request body, in the form express parses. */
  bodyLimit: string;
  /** How long in-flight requests get to finish on shutdown, in seconds. */
  drainSeconds: number;
  /** When shutdown gives up and exits, in seconds. Below Docker's 10 s stop grace. */
  shutdownDeadlineSeconds: number;
  /** Express `trust proxy`. `TRUST_PROXY` overrides it. */
  trustProxy: boolean | number | string;
}

export const HTTP_DEFAULTS: Readonly<HttpSettings> = Object.freeze({
  port: 3000,
  bodyLimit: '1mb',
  drainSeconds: 5,
  shutdownDeadlineSeconds: 8,
  trustProxy: false,
});

/** Bounds on one GraphQL operation. */
export interface OperationLimitSettings {
  /** Deepest selection allowed. */
  maxDepth: number;
  /** Most aliases in one document. */
  maxAliases: number;
  /** Highest cost an operation may have. */
  maxCost: number;
  /** Cost of a field with no hint of its own. */
  defaultFieldCost: number;
}

export const OPERATION_LIMIT_DEFAULTS: Readonly<OperationLimitSettings> = Object.freeze({
  maxDepth: 8,
  maxAliases: 15,
  maxCost: 10_000,
  defaultFieldCost: 1,
});

/** Where the server keeps what it writes. */
export interface StoreSettings {
  /**
   * Directory holding the built-in database (`pg/`) and the icon caches. `DATA_DIR` overrides it. Relative paths
   * are from the working directory. Pages a 1.x release kept here as YAML are imported from it on first boot.
   */
  dataDir: string;
}

/** How the server reaches its database (server/db/). */
export interface DatabaseSettings {
  /** How long boot waits for Postgres before giving up, in milliseconds. `DB_CONNECT_TIMEOUT_MS` overrides it. */
  connectTimeoutMs: number;
  /** The wait before the first retry, in milliseconds. */
  firstRetryDelayMs: number;
  /** The longest wait between two retries, in milliseconds. */
  maxRetryDelayMs: number;
  /** How much the wait grows after each failed attempt. */
  retryBackoffFactor: number;
  /** The folder under DATA_DIR where the built-in database (PGlite) keeps its files. */
  pgliteDirName: string;
}

export const DATABASE_DEFAULTS: Readonly<DatabaseSettings> = Object.freeze({
  connectTimeoutMs: 60_000,
  firstRetryDelayMs: 500,
  maxRetryDelayMs: 5_000,
  retryBackoffFactor: 2,
  pgliteDirName: 'pg',
});

export const STORE_DEFAULTS: Readonly<StoreSettings> = Object.freeze({
  dataDir: 'data',
});

/** How wide a section's grid is: the Columns setting on Settings → General. */
export interface LayoutSettings {
  /** How many columns a section's grid has at full width, until the site setting says otherwise. */
  columns: number;
  /** The fewest columns the setting may name. */
  minColumns: number;
  /** The most columns the setting may name, and so the widest an item can be set to. */
  maxColumns: number;
}

export const LAYOUT_DEFAULTS: Readonly<LayoutSettings> = Object.freeze({
  columns: 4,
  minColumns: 1,
  maxColumns: 8,
});

/** How big pages and items may get. Served as `Query.pageLimits`, so the web forms check the same numbers. */
export interface PageLimitSettings {
  /** Most pages, the home page included. */
  maxPages: number;
  /** Most items on one page, across its sections. */
  maxItemsPerPage: number;
  /** Most sections on one page. */
  maxSectionsPerPage: number;
  /** Longest page or item title, in characters. */
  maxTitleLength: number;
  /** Longest item description, in characters. */
  maxDescriptionLength: number;
  /** Longest item URL or icon URL, in characters. */
  maxUrlLength: number;
  /** Longest page slug, in characters. */
  maxSlugLength: number;
  /** Shortest a frame item may be, in CSS pixels. */
  minFrameHeightPx: number;
  /** Tallest a frame item may be, in CSS pixels. */
  maxFrameHeightPx: number;
  /** A frame item's height when none is given, in CSS pixels. */
  defaultFrameHeightPx: number;
  /** Most value rows one API widget shows. */
  maxWidgetFields: number;
  /** Most headers one API widget sends. */
  maxWidgetHeaders: number;
  /** Most entries an RSS widget shows. */
  maxRssEntries: number;
  /** Shortest a widget's answer may be cached, in seconds. */
  minWidgetCacheSeconds: number;
  /** Longest a widget's answer may be cached, in seconds. */
  maxWidgetCacheSeconds: number;
  /** Shortest interval a browser may refresh a widget at, in seconds. */
  minWidgetRefreshSeconds: number;
  /** Longest API widget request body, in characters. */
  maxWidgetBodyLength: number;
  /** Most groups one page, section or item may be limited to. */
  maxVisibleToGroups: number;
  /** Longest group name, in characters. */
  maxGroupNameLength: number;
}

export const PAGE_LIMIT_DEFAULTS: Readonly<PageLimitSettings> = Object.freeze({
  maxPages: 100,
  maxItemsPerPage: 200,
  maxSectionsPerPage: 30,
  maxTitleLength: 80,
  maxDescriptionLength: 280,
  maxUrlLength: 2048,
  maxSlugLength: 48,
  minFrameHeightPx: 120,
  maxFrameHeightPx: 2000,
  defaultFrameHeightPx: 480,
  maxWidgetFields: 6,
  maxWidgetHeaders: 10,
  maxRssEntries: 20,
  minWidgetCacheSeconds: 10,
  maxWidgetCacheSeconds: 86_400,
  minWidgetRefreshSeconds: 15,
  maxWidgetBodyLength: 4096,
  maxVisibleToGroups: 20,
  maxGroupNameLength: 64,
});

/** How item statuses are checked (server/status/). */
export interface StatusSettings {
  /** How long a check's result is reused before the item is checked again, in seconds. */
  cacheSeconds: number;
  /** How long one check may take before the item counts as down, in seconds. */
  timeoutSeconds: number;
  /** Most checks running at once. */
  maxConcurrentChecks: number;
}

export const STATUS_DEFAULTS: Readonly<StatusSettings> = Object.freeze({
  cacheSeconds: 30,
  timeoutSeconds: 5,
  maxConcurrentChecks: 8,
});

/** How the server checks whether a site may be framed (server/frames/). */
export interface FrameCheckSettings {
  /** How long the check may take, in seconds. */
  timeoutSeconds: number;
  /** How long a URL's answer is reused, in seconds. */
  cacheSeconds: number;
}

export const FRAME_CHECK_DEFAULTS: Readonly<FrameCheckSettings> = Object.freeze({
  timeoutSeconds: 5,
  cacheSeconds: 300,
});

/** How icons are found and fetched (server/icons/). */
export interface IconSettings {
  /** How long a fetched favicon is kept before it is fetched again, in hours. */
  faviconCacheHours: number;
  /** How long fetching one favicon may take, in seconds. */
  faviconTimeoutSeconds: number;
  /** Largest favicon kept, in bytes. */
  maxFaviconBytes: number;
  /** How long the downloaded icon catalogues are kept before they are fetched again, in hours. */
  catalogueCacheHours: number;
  /** Most results one icon search returns. */
  maxSearchResults: number;
  /** How long a failed favicon or catalogue fetch is remembered before it is tried again, in minutes. */
  failureRetryMinutes: number;
  /** Largest page read while looking for a favicon's `<link>`, in bytes. */
  maxFaviconPageBytes: number;
  /** How long downloading one icon catalogue may take, in seconds. */
  catalogueTimeoutSeconds: number;
  /** Largest icon catalogue downloaded, in bytes. */
  maxCatalogueBytes: number;
  /** How long a browser may reuse a served favicon before asking again, in seconds. */
  faviconBrowserCacheSeconds: number;
}

export const ICON_DEFAULTS: Readonly<IconSettings> = Object.freeze({
  faviconCacheHours: 24,
  faviconTimeoutSeconds: 5,
  maxFaviconBytes: 262_144,
  catalogueCacheHours: 24,
  maxSearchResults: 60,
  failureRetryMinutes: 10,
  maxFaviconPageBytes: 524_288,
  catalogueTimeoutSeconds: 15,
  maxCatalogueBytes: 8_388_608,
  faviconBrowserCacheSeconds: 300,
});

/** A web search the launcher can send a query to. */
export interface SearchEngineSettings {
  /** What a query starts with to pick it, after a `!`: `g` for `!g`. */
  prefix: string;
  name: string;
  /** The search address, with `{query}` where the query goes. */
  url: string;
}

/** The launcher's web searches (server/site/). `search:` in site.yaml replaces them. */
export interface SearchSettings {
  /** The engines offered, in order. */
  engines: readonly SearchEngineSettings[];
  /** The prefix of the engine a query with no prefix goes to. */
  defaultPrefix: string;
}

export const SEARCH_DEFAULTS: Readonly<SearchSettings> = Object.freeze({
  engines: Object.freeze([
    Object.freeze({ prefix: 'd', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={query}' }),
    Object.freeze({ prefix: 'g', name: 'Google', url: 'https://www.google.com/search?q={query}' }),
    Object.freeze({ prefix: 'w', name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search={query}' }),
  ]),
  defaultPrefix: 'd',
});

/** How widgets fetch their data (server/widgets/). */
export interface WidgetSettings {
  /** How long one fetch may take, in seconds. */
  timeoutSeconds: number;
  /** Largest response a widget reads, in bytes. */
  maxResponseBytes: number;
  /** Largest raw JSON an API widget's test shows, in characters. */
  maxPreviewRawChars: number;
  /** An API widget's cache time when none is given, in seconds. */
  defaultApiCacheSeconds: number;
  /** An RSS widget's cache time when none is given, in seconds. */
  defaultRssCacheSeconds: number;
  /** A weather widget's cache time when none is given, in seconds. */
  defaultWeatherCacheSeconds: number;
  /** How many entries an RSS widget shows when none is given. */
  defaultRssEntries: number;
  /** Longest summary an RSS entry keeps, in characters. */
  maxRssSummaryChars: number;
  /** Longest value an API widget row shows, in characters. */
  maxApiValueChars: number;
  /** How many coming hours a weather widget shows. */
  weatherHours: number;
  /** The Open-Meteo forecast endpoint. `WEATHER_API_URL` overrides it, for a self-hosted Open-Meteo. */
  weatherApiUrl: string;
  /** What a `${env:NAME}` secret's name must start with, so a widget can only read variables meant for it. */
  secretEnvPrefix: string;
  /** Directories a `${file:/path}` secret may be read from, besides `<dataDir>/secrets`. */
  secretFileDirs: readonly string[];
  /** Largest secret file read, in bytes. */
  maxSecretFileBytes: number;
  /** Most widget answers kept in memory. */
  maxCachedAnswers: number;
}

export const WIDGET_DEFAULTS: Readonly<WidgetSettings> = Object.freeze({
  timeoutSeconds: 10,
  maxResponseBytes: 1_048_576,
  maxPreviewRawChars: 16_384,
  defaultApiCacheSeconds: 60,
  defaultRssCacheSeconds: 900,
  defaultWeatherCacheSeconds: 900,
  defaultRssEntries: 8,
  maxRssSummaryChars: 280,
  maxApiValueChars: 200,
  weatherHours: 6,
  weatherApiUrl: 'https://api.open-meteo.com/v1/forecast',
  secretEnvPrefix: 'HOMEPAGE_',
  secretFileDirs: Object.freeze(['/run/secrets']),
  maxSecretFileBytes: 65_536,
  maxCachedAnswers: 500,
});

/** Signing in (server/auth/, server/sso/). */
export interface AuthSettings {
  /** How long a session lasts. Long: signing in again means a round trip through the provider. */
  sessionTtlDays: number;
  /** How long the token an OIDC callback hands the app works: the hop from the callback to `/auth/sso`. */
  oneTimeTokenTtlMinutes: number;
  /** The shortest `BETTER_AUTH_SECRET` production accepts. `openssl rand -hex 32` gives twice this. */
  minSecretLength: number;
  /** What the sign-in button calls the provider when nothing names it. `OIDC_NAME` overrides it. */
  oidcName: string;
  /** How a confidential OIDC client sends its secret. `OIDC_CLIENT_AUTH` overrides it. */
  oidcClientAuth: 'client_secret_basic' | 'client_secret_post';
  /** How long pairing waits on the provider before calling it unreachable, in milliseconds. */
  oidcPairingTimeoutMs: number;
  /** The ID token claim a user's groups are read from. `OIDC_GROUPS_CLAIM` overrides it. heautou's default. */
  oidcGroupsClaim: string;
  /** How long a forward-auth identity is trusted before its row is read again, in seconds. */
  forwardAuthCacheSeconds: number;
  /** How long a favicon address handed to a viewer works, in hours. */
  iconLinkTtlHours: number;
}

export const AUTH_DEFAULTS: Readonly<AuthSettings> = Object.freeze({
  sessionTtlDays: 30,
  oneTimeTokenTtlMinutes: 3,
  minSecretLength: 32,
  oidcName: 'SSO',
  // The default the OIDC spec names.
  oidcClientAuth: 'client_secret_basic',
  oidcPairingTimeoutMs: 10_000,
  oidcGroupsClaim: 'groups',
  forwardAuthCacheSeconds: 30,
  iconLinkTtlHours: 24,
});

/** The sign-in throttle: attempts per key in a sliding window, in this process. */
export interface RateLimitSettings {
  /** Attempts allowed per key inside one window. */
  maxAttempts: number;
  /** How long an attempt counts against its key, in minutes. */
  windowMinutes: number;
  /** How many keys may build up before stale ones are swept. */
  sweepAtKeys: number;
}

export const RATE_LIMIT_DEFAULTS: Readonly<RateLimitSettings> = Object.freeze({
  maxAttempts: 5,
  windowMinutes: 15,
  sweepAtKeys: 10_000,
});

/** How the server finds apps on the network (server/discovery/). */
export interface DiscoverySettings {
  /** Time between two polls of Dockhand and the Docker socket, in minutes. mDNS is watched all the time. */
  pollMinutes: number;
  /** How long one request to a source (Dockhand, the Docker socket) may take, in seconds. */
  sourceTimeoutSeconds: number;
  /** How long fetching a page or manifest to describe an app may take, in seconds. */
  describeTimeoutSeconds: number;
  /** Largest page read to describe an app, in bytes. Only its head is needed. */
  maxPageBytes: number;
  /** Largest web manifest read, in bytes. */
  maxManifestBytes: number;
  /** Most redirects followed on the same host when describing an app. */
  maxRedirects: number;
  /** How long a description of an address is reused, in minutes. A failed one is asked again sooner. */
  describeCacheMinutes: number;
  /** How long a failed description is remembered before the address is asked again, in minutes. */
  failedDescribeCacheMinutes: number;
  /** Most descriptions kept in memory. */
  maxCachedDescriptions: number;
  /** Most addresses described at once during a scan. */
  describeConcurrency: number;
  /** Icons smaller than this are passed over when a larger one exists, in pixels. */
  minIconSizePx: number;
  /** The icon size picked when there is a choice: the one closest to it, in pixels. */
  preferredIconSizePx: number;
  /** How long a scan waits for mDNS answers after asking again, in seconds. */
  mdnsSettleSeconds: number;
  /** The mDNS service types browsed, without the leading underscore and `._tcp`. */
  mdnsTypes: readonly string[];
  /** Container ports taken to be a web interface first, in order, when a container publishes several. */
  webPorts: readonly number[];
  /** Container ports served over https. */
  httpsPorts: readonly number[];
}

export const DISCOVERY_DEFAULTS: Readonly<DiscoverySettings> = Object.freeze({
  pollMinutes: 5,
  sourceTimeoutSeconds: 10,
  describeTimeoutSeconds: 5,
  maxPageBytes: 524_288,
  maxManifestBytes: 131_072,
  maxRedirects: 3,
  describeCacheMinutes: 60,
  failedDescribeCacheMinutes: 5,
  maxCachedDescriptions: 500,
  describeConcurrency: 6,
  minIconSizePx: 48,
  preferredIconSizePx: 192,
  mdnsSettleSeconds: 2,
  mdnsTypes: Object.freeze(['http', 'https', 'home-assistant', 'octoprint', 'ipp', 'ipps']),
  // biome-ignore lint/style/noMagicNumbers: a list of port numbers is the data this setting holds.
  webPorts: [80, 443, 8080, 8443, 3000, 8000, 8096, 9000, 5000, 8081, 8888],
  // biome-ignore lint/style/noMagicNumbers: a list of port numbers is the data this setting holds.
  httpsPorts: [443, 8443, 9443],
});
