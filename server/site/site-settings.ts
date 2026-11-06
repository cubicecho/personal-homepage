// Site-wide settings that are not pages, kept in the one row of `site_settings`: how many columns a
// section's grid has (null for LAYOUT_DEFAULTS.columns), and the launcher's web searches, stored as written:
//
//   { "defaultPrefix": "s", "engines": [{ "prefix": "s", "name": "SearXNG", "url": "http://searx.local/search?q={query}" }] }
//
// Both keys are optional. Without `engines`, SEARCH_DEFAULTS' engines are used; without `defaultPrefix`,
// the default's prefix when it is one of the engines, otherwise the first engine. A stored value that no
// longer fits (it came from an import, or a rule changed) is logged once (`[site]`) and the defaults used.
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { LAYOUT_DEFAULTS, type LayoutSettings, SEARCH_DEFAULTS, type SearchEngineSettings } from '../core/defaults.ts';
import { badInput } from '../core/errors.ts';
import type { Database } from '../db/client.ts';
import { SITE_SETTINGS_ID, siteSettings } from '../db/schema.ts';
import { describeIssues, isWebUrl } from '../pages/page-input.ts';

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
  /**
   * Gives the search settings as stored, for the export.
   *
   * @returns `{ engines, defaultPrefix }` as written, or null when the defaults are in use.
   */
  storedSearch(): Promise<unknown>;
  /**
   * Replaces the search settings.
   *
   * @param search - `{ engines, defaultPrefix }`, either optional; null to go back to the defaults.
   * @returns The engines now in use.
   * @throws BAD_USER_INPUT when the settings don't fit the rules above.
   */
  setSearch(search: unknown): Promise<SearchEngine[]>;
  /**
   * Gives how a section's grid is laid out.
   *
   * @returns The columns in use, and the bounds the setting may take.
   */
  layout(): Promise<LayoutSettings>;
  /**
   * Sets how many columns a section's grid has.
   *
   * @param columns - From `LAYOUT_DEFAULTS.minColumns` to `maxColumns`; null to go back to the default.
   * @returns The layout now in use.
   * @throws BAD_USER_INPUT when the number is outside the bounds or not whole.
   */
  setLayoutColumns(columns: number | null): Promise<LayoutSettings>;
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

/** The engines when nothing usable is stored. */
const DEFAULT_ENGINES = markDefault(SEARCH_DEFAULTS.engines, SEARCH_DEFAULTS.defaultPrefix) ?? [];

/**
 * Checks search settings and works out the engines they give.
 *
 * @param raw - The settings, as stored or as sent.
 * @returns The engines, or what is wrong with the settings.
 */
export function resolveSearch(raw: unknown): { engines: SearchEngine[] } | { problem: string } {
  const result = searchSchema.safeParse(raw);
  if (result.success === false) {
    return { problem: describeIssues(result.error) };
  }
  const search = result.data ?? {};
  const marked = markDefault(search.engines ?? SEARCH_DEFAULTS.engines, search.defaultPrefix ?? null);
  if (marked === null) {
    return { problem: `defaultPrefix "${search.defaultPrefix}" is not one of the engines' prefixes` };
  }
  return { engines: marked };
}

/**
 * Builds the settings over the database.
 *
 * @param db - The database, migrated.
 * @returns The settings.
 */
export function createSiteSettings(db: Database): SiteSettings {
  /** The last problem logged, so each is logged once until it changes. */
  let reported: string | null = null;

  /**
   * Reads the stored search settings.
   *
   * @returns What is stored, or null when nothing is.
   */
  const readSearch = async (): Promise<unknown> => {
    const [row] = await db
      .select({ search: siteSettings.search })
      .from(siteSettings)
      .where(eq(siteSettings.id, SITE_SETTINGS_ID));
    return row?.search ?? null;
  };

  return {
    searchEngines: async () => {
      const resolved = resolveSearch(await readSearch());
      if ('problem' in resolved) {
        if (resolved.problem !== reported) {
          console.warn(`[site] ignoring the stored search settings, using the default engines: ${resolved.problem}`);
        }
        reported = resolved.problem;
        return DEFAULT_ENGINES;
      }
      reported = null;
      return resolved.engines;
    },

    storedSearch: readSearch,

    setSearch: async (search) => {
      const resolved = resolveSearch(search);
      if ('problem' in resolved) {
        throw badInput(resolved.problem);
      }
      const stored = search ?? null;
      await db
        .insert(siteSettings)
        .values({ id: SITE_SETTINGS_ID, search: stored })
        .onConflictDoUpdate({ target: siteSettings.id, set: { search: stored } });
      return resolved.engines;
    },

    layout: async () => {
      const [row] = await db
        .select({ layoutColumns: siteSettings.layoutColumns })
        .from(siteSettings)
        .where(eq(siteSettings.id, SITE_SETTINGS_ID));
      return { ...LAYOUT_DEFAULTS, columns: row?.layoutColumns ?? LAYOUT_DEFAULTS.columns };
    },

    setLayoutColumns: async (columns) => {
      const { minColumns, maxColumns } = LAYOUT_DEFAULTS;
      const isWithinBounds =
        columns === null || (Number.isInteger(columns) && columns >= minColumns && columns <= maxColumns);
      if (isWithinBounds === false) {
        throw badInput(`columns: Use a whole number from ${minColumns} to ${maxColumns}.`);
      }
      await db
        .insert(siteSettings)
        .values({ id: SITE_SETTINGS_ID, layoutColumns: columns })
        .onConflictDoUpdate({ target: siteSettings.id, set: { layoutColumns: columns } });
      return { ...LAYOUT_DEFAULTS, columns: columns ?? LAYOUT_DEFAULTS.columns };
    },
  };
}
