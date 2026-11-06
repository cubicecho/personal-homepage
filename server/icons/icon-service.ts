// Turns icon references into the image URLs the browser loads, and searches every icon by name.
//
// A reference (see `IconRef`) is a built-in glyph name, `di:<name>`, `sh:<name>`, `favicon`, or an image
// URL. Glyphs are drawn by the web app, so they have no URL. Catalogue icons load straight from jsDelivr
// (catalogues.ts); the server only downloads the catalogues' listings, for search and to pick a format.
// A favicon is fetched and served by this server (favicons.ts, http.ts).
import path from 'node:path';
import { BUILT_IN_ICONS, type IconRef } from '../pages/page.ts';
import { CATALOGUE_ICON_PATTERN, FAVICON_ICON, isIconRef, isWebUrl } from '../pages/page-input.ts';
import {
  type Catalogue,
  type CatalogueIcon,
  DASHBOARD_ICONS,
  DASHBOARD_ICONS_METADATA,
  type IconFormat,
  labelFromName,
  openCatalogue,
  SELFHST,
} from './catalogues.ts';
import type { Clock, Fetch } from './fetching.ts';
import { faviconPath } from './http.ts';
import { indexIcons, type MatchIndexes, matchIcon } from './icon-match.ts';

/** Where an icon in a search result comes from. */
export const IconSource = { Glyph: 'GLYPH', DashboardIcons: 'DASHBOARD_ICONS', Selfhst: 'SELFHST' } as const;
export type IconSource = (typeof IconSource)[keyof typeof IconSource];

/** One icon a search found. */
export interface IconOption {
  ref: IconRef;
  label: string;
  source: IconSource;
  url: string | null;
}

/** What an icon belongs to, which `favicon` needs to know whose site to ask. */
export interface IconOwner {
  pageSlug: string;
  /** Null for a page's own icon. */
  itemId: string | null;
}

/** Turns icon references into image URLs, and searches the catalogues. */
export interface IconService {
  /**
   * Gives the URL the browser loads an icon from.
   *
   * @param icon - The reference, or null.
   * @param owner - The page or item it belongs to.
   * @returns The image URL, or null for a built-in glyph or no icon.
   */
  urlFor(icon: IconRef | null, owner: IconOwner): string | null;
  /**
   * Finds icons by name.
   *
   * @param query - What was typed.
   * @param limit - The most results to give.
   * @returns The matches, glyphs first.
   */
  search(query: string, limit: number): Promise<IconOption[]>;
  /**
   * Finds the catalogue icon an app's names point to (icon-match.ts).
   *
   * @param names - The app's names, most telling first.
   * @returns `di:<name>` or `sh:<name>` for an exact match, or null for none, or when the catalogues
   * can't be read. Never throws.
   */
  matchName(names: readonly string[]): Promise<IconRef | null>;
}

/** What the icon service is built from. */
export interface IconServiceOptions {
  /** The data directory; catalogue listings are kept under `cache/icons` in it. */
  dataDir: string;
  /** Left out, the real `fetch`. */
  fetch?: Fetch;
  /** Left out, `Date.now`. */
  now?: Clock;
}

/** The format used for a catalogue icon whose formats aren't known yet: the one nearly all of them have. */
const UNKNOWN_FORMAT: IconFormat = 'png';
/** Where catalogue listings are kept, under the data directory. */
export const ICON_CACHE_DIR = path.join('cache', 'icons');

/** How well a name matches a query: lower is better. */
const MatchRank = { Exact: 0, Prefix: 1, WordPrefix: 2, Contains: 3 } as const;
type MatchRank = (typeof MatchRank)[keyof typeof MatchRank];

/** A search candidate, ranked. */
interface Ranked {
  option: IconOption;
  rank: MatchRank;
}

/**
 * Rates how well a name or label matches a query.
 *
 * @param query - The query, lower case, with no prefix.
 * @param texts - The candidate's name and label.
 * @returns The best rank, or null when neither matches.
 */
export function matchRank(query: string, texts: readonly string[]): MatchRank | null {
  let best: MatchRank | null = null;
  for (const raw of texts) {
    const text = raw.toLowerCase();
    let rank: MatchRank | null = null;
    if (text === query) {
      rank = MatchRank.Exact;
    } else if (text.startsWith(query)) {
      rank = MatchRank.Prefix;
    } else if (text.split(/[^a-z0-9]+/).some((word) => word.startsWith(query))) {
      rank = MatchRank.WordPrefix;
    } else if (text.includes(query)) {
      rank = MatchRank.Contains;
    }
    if (rank !== null && (best === null || rank < best)) {
      best = rank;
    }
  }
  return best;
}

/**
 * Sorts ranked candidates: best match first, then shorter names, then by name.
 *
 * @param candidates - The candidates.
 * @returns A new array, sorted.
 */
function byRank(candidates: readonly Ranked[]): Ranked[] {
  return [...candidates].sort(
    (a, b) => a.rank - b.rank || a.option.ref.length - b.option.ref.length || a.option.ref.localeCompare(b.option.ref),
  );
}

/**
 * Splits a query into an optional catalogue prefix and the text to match.
 *
 * @param query - What was typed: `jelly`, `di:jelly`, `sh:`.
 * @returns The prefix, if any, and the text, lower case.
 */
function readQuery(query: string): { prefix: string | null; text: string } {
  const lowered = query.trim().toLowerCase();
  const match = /^(di|sh):(.*)$/.exec(lowered);
  return match === null ? { prefix: null, text: lowered } : { prefix: match[1] ?? null, text: (match[2] ?? '').trim() };
}

/**
 * Builds the icon service.
 *
 * @param options - The data directory, and a fetch and clock for tests.
 * @returns The service.
 */
export function createIconService(options: IconServiceOptions): IconService {
  const deps = {
    cacheDir: path.join(options.dataDir, ICON_CACHE_DIR),
    fetch: options.fetch ?? globalThis.fetch,
    now: options.now ?? Date.now,
  };
  const catalogues: Record<'di' | 'sh', Catalogue> = {
    di: openCatalogue(DASHBOARD_ICONS, deps),
    sh: openCatalogue(SELFHST, deps),
  };
  // Only matching reads it: dashboard-icons' other names for its icons.
  const dashboardIconAliases = openCatalogue(DASHBOARD_ICONS_METADATA, deps);
  /** The match indexes, rebuilt only when a listing they came from changes. */
  let indexed: { from: readonly ReadonlyMap<string, CatalogueIcon>[]; indexes: MatchIndexes } | null = null;

  /**
   * Gives the match indexes for the listings as they are now.
   *
   * @param di - dashboard-icons' icons.
   * @param aliases - dashboard-icons' other names.
   * @param sh - selfh.st's icons.
   * @returns The indexes.
   */
  const indexesFor = (
    di: ReadonlyMap<string, CatalogueIcon>,
    aliases: ReadonlyMap<string, CatalogueIcon>,
    sh: ReadonlyMap<string, CatalogueIcon>,
  ): MatchIndexes => {
    const from = [di, aliases, sh];
    const isCurrent = indexed?.from.every((listing, at) => listing === from[at]) === true;
    if (isCurrent && indexed !== null) {
      return indexed.indexes;
    }
    const indexes: MatchIndexes = {
      di: indexIcons(di.values(), aliases.values()),
      sh: indexIcons(sh.values()),
    };
    indexed = { from, indexes };
    return indexes;
  };
  const sources: Record<'di' | 'sh', IconSource> = { di: IconSource.DashboardIcons, sh: IconSource.Selfhst };

  /**
   * Gives a catalogue icon's image URL, in the best format it is known to have.
   *
   * @param catalogue - Its catalogue.
   * @param name - Its name.
   * @param [icon] - What the listing says about it, when known.
   * @returns The URL.
   */
  const catalogueUrl = (catalogue: Catalogue, name: string, icon?: CatalogueIcon): string => {
    const known = icon ?? catalogue.current().get(name);
    if (known === undefined && catalogue.current().size === 0) {
      // The listing has never been read: fetch it in the background, so the next answer is exact.
      void catalogue.load();
    }
    return catalogue.source.imageUrl(name, known?.formats[0] ?? UNKNOWN_FORMAT);
  };

  /**
   * Finds matching glyphs.
   *
   * @param text - The query text.
   * @returns The glyphs, ranked; every glyph when the text is empty.
   */
  const searchGlyphs = (text: string): Ranked[] =>
    BUILT_IN_ICONS.flatMap((name) => {
      const label = labelFromName(name);
      const rank = text === '' ? MatchRank.Prefix : matchRank(text, [name, label]);
      return rank === null ? [] : [{ rank, option: { ref: name, label, source: IconSource.Glyph, url: null } }];
    });

  /**
   * Finds matching icons in one catalogue.
   *
   * @param prefix - The catalogue.
   * @param text - The query text. Empty matches nothing: a catalogue has thousands.
   * @returns The icons, ranked.
   */
  const searchCatalogue = async (prefix: 'di' | 'sh', text: string): Promise<Ranked[]> => {
    if (text === '') {
      return [];
    }
    const catalogue = catalogues[prefix];
    const icons = await catalogue.load();
    const found: Ranked[] = [];
    for (const icon of icons.values()) {
      const rank = matchRank(text, [icon.name, icon.label]);
      if (rank !== null) {
        const option: IconOption = {
          ref: `${prefix}:${icon.name}`,
          label: icon.label,
          source: sources[prefix],
          url: catalogueUrl(catalogue, icon.name, icon),
        };
        found.push({ rank, option });
      }
    }
    return byRank(found);
  };

  return {
    urlFor: (icon, owner) => {
      if (icon === null) {
        return null;
      }
      if (icon === FAVICON_ICON) {
        return owner.itemId === null ? null : faviconPath(owner.pageSlug, owner.itemId);
      }
      if (CATALOGUE_ICON_PATTERN.test(icon)) {
        const [prefix, name = ''] = icon.split(':') as ['di' | 'sh', string];
        return catalogueUrl(catalogues[prefix], name);
      }
      return isWebUrl(icon) ? icon : null;
    },

    search: async (query, limit) => {
      const { prefix, text } = readQuery(query);
      const glyphs = prefix === null ? byRank(searchGlyphs(text)) : [];
      const wanted: ('di' | 'sh')[] = prefix === null ? ['di', 'sh'] : [prefix as 'di' | 'sh'];
      const fromCatalogues = await Promise.all(wanted.map((which) => searchCatalogue(which, text)));
      // Both catalogues' best matches before either's weaker ones. At a tie, `di:` sorts before `sh:`.
      const merged = byRank(fromCatalogues.flat());
      return [...glyphs, ...merged].slice(0, limit).map((ranked) => ranked.option);
    },

    matchName: async (names) => {
      // Each load never throws: a listing that can't be fetched is the last one known, or empty.
      const [di, aliases, sh] = await Promise.all([
        catalogues.di.load(),
        dashboardIconAliases.load(),
        catalogues.sh.load(),
      ]);
      const icon = matchIcon(names, indexesFor(di, aliases, sh));
      return icon !== null && isIconRef(icon, false) ? icon : null;
    },
  };
}
