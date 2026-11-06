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

/** Where the YAML store keeps its files. */
export interface StoreSettings {
  /** Directory holding `site.yaml` and `pages/`. `DATA_DIR` overrides it. Relative paths are from the working directory. */
  dataDir: string;
}

export const STORE_DEFAULTS: Readonly<StoreSettings> = Object.freeze({
  dataDir: 'data',
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
}

export const ICON_DEFAULTS: Readonly<IconSettings> = Object.freeze({
  faviconCacheHours: 24,
  faviconTimeoutSeconds: 5,
  maxFaviconBytes: 262_144,
  catalogueCacheHours: 24,
  maxSearchResults: 60,
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
