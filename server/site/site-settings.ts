// Site-wide settings that are not pages, read from `<dataDir>/site.yaml` beside the page order:
//
//   search:
//     defaultPrefix: g
//     engines:
//       - prefix: g
//         name: Google
//         url: https://www.google.com/search?q={query}
//       - prefix: s
//         name: SearXNG
//         url: http://searx.local/search?q={query}
//
// Both keys are optional. Without `engines`, SEARCH_DEFAULTS' engines are used; without
// `defaultPrefix`, the default's prefix when it is one of the engines, otherwise the first engine.
// The file is read on every call, so a hand edit shows up without a restart. A `search` key that
// doesn't fit the shape is logged once (`[site]`) and ignored, and the defaults are used.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { SEARCH_DEFAULTS, type SearchEngineSettings } from '../core/defaults.ts';
import { errorMessage } from '../core/errors.ts';
import { describeIssues, isWebUrl } from '../pages/page-input.ts';

const SITE_FILE = 'site.yaml';
const MISSING_FILE = 'ENOENT';
/** Where the query goes in an engine's URL. */
export const QUERY_PLACEHOLDER = '{query}';
/** Lower-case letters and digits: what follows `!` in the launcher. */
const PREFIX_PATTERN = /^[a-z0-9]+$/;
/** Longest engine prefix, in characters. A bang is meant to be typed quickly. */
const MAX_PREFIX_LENGTH = 16;
/** Longest engine name, in characters. */
const MAX_NAME_LENGTH = 40;

/** A web search the launcher can send a query to. */
export interface SearchEngine {
  prefix: string;
  name: string;
  /** The search address, with `{query}` where the query goes. */
  url: string;
  /** Whether a query with no prefix goes here. Exactly one engine is the default. */
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

/** Where the settings are read from. */
export interface SiteSettingsOptions {
  /** The directory holding `site.yaml`. */
  dataDir: string;
}

const engineSchema = z.object({
  prefix: z
    .string()
    .trim()
    .toLowerCase()
    .max(MAX_PREFIX_LENGTH)
    .regex(PREFIX_PATTERN, 'prefix must be lower-case letters and digits'),
  name: z.string().trim().min(1, 'needs a name').max(MAX_NAME_LENGTH),
  url: z
    .string()
    .trim()
    .refine(isWebUrl, 'must be an http:// or https:// address')
    .refine((url) => url.includes(QUERY_PLACEHOLDER), `must hold ${QUERY_PLACEHOLDER} where the query goes`),
});

const searchSchema = z
  .object({
    engines: z
      .array(engineSchema)
      .min(1, 'needs at least one engine')
      .refine((engines) => new Set(engines.map((engine) => engine.prefix)).size === engines.length, {
        message: 'two engines have the same prefix',
      })
      .nullish(),
    defaultPrefix: z.string().trim().toLowerCase().nullish(),
  })
  .nullish();

const siteSchema = z.looseObject({ search: z.unknown().optional() });

/**
 * Picks the default engine and marks it.
 *
 * @param engines - The engines, in order.
 * @param wanted - The prefix asked for, if any.
 * @returns The engines, with exactly one the default; null when `wanted` names none of them.
 */
function markDefault(engines: readonly SearchEngineSettings[], wanted: string | null): SearchEngine[] | null {
  const prefixes = engines.map((engine) => engine.prefix);
  if (wanted !== null && prefixes.includes(wanted) === false) {
    return null;
  }
  const hasBuiltInDefault = prefixes.includes(SEARCH_DEFAULTS.defaultPrefix);
  const fallback = hasBuiltInDefault ? SEARCH_DEFAULTS.defaultPrefix : prefixes[0];
  const chosen = wanted ?? fallback;
  return engines.map((engine) => ({ ...engine, isDefault: engine.prefix === chosen }));
}

/** The engines when site.yaml says nothing usable. */
const DEFAULT_ENGINES = markDefault(SEARCH_DEFAULTS.engines, SEARCH_DEFAULTS.defaultPrefix) ?? [];

/**
 * Builds the site settings reader.
 *
 * @param options - Where `site.yaml` is.
 * @returns The reader.
 */
export function createSiteSettings(options: SiteSettingsOptions): SiteSettings {
  const siteFile = path.join(options.dataDir, SITE_FILE);
  /** The last problem logged, so each is logged once until it changes. */
  let reported: string | null = null;

  /**
   * Logs a problem the first time it is seen, and forgets it once the file reads.
   *
   * @param problem - What is wrong, or null when nothing is.
   */
  const report = (problem: string | null): void => {
    if (problem !== null && problem !== reported) {
      console.warn(`[site] ignoring search in ${SITE_FILE}, using the default engines: ${problem}`);
    }
    reported = problem;
  };

  /**
   * Reads the `search` key of site.yaml.
   *
   * @returns Its raw value, undefined when the file is missing; or what is wrong with the file.
   */
  const readSearch = async (): Promise<{ raw: unknown; problem: string | null }> => {
    let text: string;
    try {
      text = await readFile(siteFile, 'utf-8');
    } catch (error) {
      const isMissing = error instanceof Error && 'code' in error && error.code === MISSING_FILE;
      if (isMissing) {
        return { raw: undefined, problem: null };
      }
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = parse(text);
    } catch (error) {
      return { raw: undefined, problem: `not valid YAML: ${errorMessage(error).split('\n')[0]}` };
    }
    const site = siteSchema.safeParse(parsed ?? {});
    if (site.success === false) {
      return { raw: undefined, problem: 'the file is not a mapping of keys' };
    }
    return { raw: site.data.search, problem: null };
  };

  return {
    searchEngines: async () => {
      const { raw, problem } = await readSearch();
      if (problem !== null) {
        report(problem);
        return DEFAULT_ENGINES;
      }
      const result = searchSchema.safeParse(raw);
      if (result.success === false) {
        report(describeIssues(result.error));
        return DEFAULT_ENGINES;
      }
      const search = result.data ?? {};
      const engines = search.engines ?? SEARCH_DEFAULTS.engines;
      const marked = markDefault(engines, search.defaultPrefix ?? null);
      if (marked === null) {
        report(`defaultPrefix "${search.defaultPrefix}" is not one of the engines' prefixes`);
        return DEFAULT_ENGINES;
      }
      report(null);
      return marked;
    },
  };
}
