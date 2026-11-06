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
  /** Most items on one page. */
  maxItemsPerPage: number;
  /** Longest page or item title, in characters. */
  maxTitleLength: number;
  /** Longest item description, in characters. */
  maxDescriptionLength: number;
  /** Longest item URL, in characters. */
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
  maxTitleLength: 80,
  maxDescriptionLength: 280,
  maxUrlLength: 2048,
  maxSlugLength: 48,
  minFrameHeightPx: 120,
  maxFrameHeightPx: 2000,
  defaultFrameHeightPx: 480,
});
