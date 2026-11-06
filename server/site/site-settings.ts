// STUB, to be built by the search feature: reads `search:` from site.yaml over SEARCH_DEFAULTS.
import { SEARCH_DEFAULTS } from '../core/defaults.ts';

/** A web search the launcher can send a query to. */
export interface SearchEngine {
  prefix: string;
  name: string;
  url: string;
  isDefault: boolean;
}

/** Site-wide settings that are not pages. */
export interface SiteSettings {
  /**
   * Lists the launcher's web searches.
   *
   * @returns The engines, in order; exactly one is the default.
   */
  searchEngines(): Promise<SearchEngine[]>;
}

/**
 * Builds the site settings reader.
 *
 * @returns The reader. The stub gives SEARCH_DEFAULTS.
 */
export function createSiteSettings(): SiteSettings {
  return {
    searchEngines: async () =>
      SEARCH_DEFAULTS.engines.map((engine) => ({
        ...engine,
        isDefault: engine.prefix === SEARCH_DEFAULTS.defaultPrefix,
      })),
  };
}
