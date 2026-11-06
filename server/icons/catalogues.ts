// The two icon catalogues an icon reference can name, and where their images are.
//
// Both are served from GitHub through jsDelivr, checked 2026-11-05:
//
// - dashboard-icons (`di:`): https://github.com/homarr-labs/dashboard-icons
//   Listing: https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/tree.json
//     { "png": ["jellyfin.png", ...], "svg": ["jellyfin.svg", ...], "webp": [...] }
//   Images:  https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/<format>/<name>.<format>
//   Not every icon has every format: about 3,800 have an SVG and 4,800 a PNG.
//   Other names: https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/metadata.json
//     { "uptime-kuma": { "base": "svg", "aliases": ["status-page", ...], "categories": [...], ... }, ... }
//   Only matching an app's name to an icon reads it (icon-match.ts).
//
// - selfh.st icons (`sh:`): https://github.com/selfhst/icons
//   Listing: https://cdn.jsdelivr.net/gh/selfhst/icons/index.json
//     [{ "Name": "2FAuth", "Reference": "2fauth", "SVG": "Yes", "PNG": "Yes", "WebP": "Yes", ... }, ...]
//   Images:  https://cdn.jsdelivr.net/gh/selfhst/icons/<format>/<reference>.<format>
//
// A listing is downloaded the first time it is needed and kept under `<dataDir>/cache/icons/` for
// ICON_DEFAULTS.catalogueCacheHours. When it can't be downloaded, an older copy is used if there is one;
// otherwise the catalogue is empty until ICON_DEFAULTS.failureRetryMinutes have passed.
import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ICON_DEFAULTS } from '../core/defaults.ts';
import { MS_PER_SECOND } from '../core/wire.ts';
import { type Clock, type Fetch, ICON_USER_AGENT, MS_PER_HOUR, MS_PER_MINUTE, readCapped } from './fetching.ts';

/** The image formats a catalogue icon can come in, best first. */
export const ICON_FORMATS = ['svg', 'png', 'webp'] as const;
export type IconFormat = (typeof ICON_FORMATS)[number];

/** One icon in a catalogue. */
export interface CatalogueIcon {
  /** What goes after the prefix in a reference: `jellyfin` in `di:jellyfin`. */
  name: string;
  /** What a person calls it. */
  label: string;
  /** The formats it is published in, best first. Empty in a listing that only gives other names. */
  formats: IconFormat[];
  /** Other names the catalogue knows it by, lower case. Only dashboard-icons' metadata lists them. */
  aliases?: string[] | undefined;
}

/** A catalogue's description: where its listing is, how to read it, and where its images are. */
export interface CatalogueSource {
  /** The reference prefix, without the colon: the catalogue the listing belongs to. */
  prefix: 'di' | 'sh';
  /** The file the listing is kept in under the cache directory. */
  cacheFile: string;
  /** Where the listing is downloaded from. */
  listingUrl: string;
  /** Where an image is. */
  imageUrl: (name: string, format: IconFormat) => string;
  /** Reads the downloaded listing. */
  parse: (listing: unknown) => CatalogueIcon[];
}

const CDN = 'https://cdn.jsdelivr.net/gh';
const DASHBOARD_ICONS_REPO = `${CDN}/homarr-labs/dashboard-icons`;
const SELFHST_REPO = `${CDN}/selfhst/icons`;
/** How the selfh.st listing says a format exists. */
const SELFHST_YES = 'Yes';
/** How the selfh.st listing names each format. */
const SELFHST_FORMAT_KEYS = { svg: 'SVG', png: 'PNG', webp: 'WebP' } as const satisfies Record<IconFormat, string>;

const dashboardIconsListing = z.record(z.string(), z.array(z.string()));
const dashboardIconsMetadata = z.record(
  z.string(),
  z.looseObject({ base: z.string().nullish(), aliases: z.array(z.string()).nullish() }),
);
const selfhstListing = z.array(z.looseObject({ Name: z.string(), Reference: z.string() }));

/**
 * Turns a file-name-like icon name into a label: `home-assistant` → `Home assistant`.
 *
 * @param name - The name.
 * @returns The label.
 */
export function labelFromName(name: string): string {
  const words = name.replaceAll(/[-_.]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Reads dashboard-icons' `tree.json`: a list of file names per format.
 *
 * @param listing - The parsed JSON.
 * @returns The icons, by name.
 */
function parseDashboardIcons(listing: unknown): CatalogueIcon[] {
  const tree = dashboardIconsListing.parse(listing);
  const formatsByName = new Map<string, IconFormat[]>();
  for (const format of ICON_FORMATS) {
    const suffix = `.${format}`;
    for (const file of tree[format] ?? []) {
      if (file.endsWith(suffix)) {
        const name = file.slice(0, -suffix.length).toLowerCase();
        formatsByName.set(name, [...(formatsByName.get(name) ?? []), format]);
      }
    }
  }
  return [...formatsByName].map(([name, formats]) => ({ name, label: labelFromName(name), formats }));
}

/**
 * Reads selfh.st's `index.json`: one entry per icon, with Yes or No per format.
 *
 * @param listing - The parsed JSON.
 * @returns The icons.
 */
function parseSelfhst(listing: unknown): CatalogueIcon[] {
  return selfhstListing.parse(listing).flatMap((entry) => {
    const formats = ICON_FORMATS.filter((format) => entry[SELFHST_FORMAT_KEYS[format]] === SELFHST_YES);
    const name = entry.Reference.trim().toLowerCase();
    const isUsable = name !== '' && formats.length > 0;
    return isUsable ? [{ name, label: entry.Name.trim() || labelFromName(name), formats }] : [];
  });
}

/**
 * Reads dashboard-icons' `metadata.json`: per icon, its base format and its other names.
 *
 * @param listing - The parsed JSON.
 * @returns The icons, each with its aliases; formats only as far as the base one says.
 */
function parseDashboardIconsMetadata(listing: unknown): CatalogueIcon[] {
  return Object.entries(dashboardIconsMetadata.parse(listing)).map(([name, entry]) => {
    const base = ICON_FORMATS.find((format) => format === entry.base);
    const aliases = (entry.aliases ?? []).map((alias) => alias.trim().toLowerCase()).filter((alias) => alias !== '');
    return { name: name.toLowerCase(), label: labelFromName(name), formats: base === undefined ? [] : [base], aliases };
  });
}

/** homarr-labs/dashboard-icons, as `di:`. */
export const DASHBOARD_ICONS: CatalogueSource = {
  prefix: 'di',
  cacheFile: 'dashboard-icons.json',
  listingUrl: `${DASHBOARD_ICONS_REPO}/tree.json`,
  imageUrl: (name, format) => `${DASHBOARD_ICONS_REPO}/${format}/${name}.${format}`,
  parse: parseDashboardIcons,
};

/** The other names dashboard-icons knows its icons by. Its images are `di:` ones. */
export const DASHBOARD_ICONS_METADATA: CatalogueSource = {
  prefix: 'di',
  cacheFile: 'dashboard-icons-metadata.json',
  listingUrl: `${DASHBOARD_ICONS_REPO}/metadata.json`,
  imageUrl: (name, format) => `${DASHBOARD_ICONS_REPO}/${format}/${name}.${format}`,
  parse: parseDashboardIconsMetadata,
};

/** selfh.st/icons, as `sh:`. */
export const SELFHST: CatalogueSource = {
  prefix: 'sh',
  cacheFile: 'selfhst.json',
  listingUrl: `${SELFHST_REPO}/index.json`,
  imageUrl: (name, format) => `${SELFHST_REPO}/${format}/${name}.${format}`,
  parse: parseSelfhst,
};

/** What is kept on disk for one catalogue. */
const cachedCatalogue = z.object({
  fetchedAt: z.number(),
  icons: z.array(
    z.object({
      name: z.string(),
      label: z.string(),
      formats: z.array(z.enum(ICON_FORMATS)),
      aliases: z.array(z.string()).optional(),
    }),
  ),
});
type CachedCatalogue = z.output<typeof cachedCatalogue>;

/** One catalogue, loaded on demand and kept fresh. */
export interface Catalogue {
  readonly source: CatalogueSource;
  /**
   * The icons known now, without waiting. Empty until the listing was read once.
   *
   * @returns The icons, by name.
   */
  current(): ReadonlyMap<string, CatalogueIcon>;
  /**
   * Makes sure the listing is loaded and fresh, downloading it when it is not.
   *
   * @returns The icons, by name. Never throws: a failed download leaves the last ones known.
   */
  load(): Promise<ReadonlyMap<string, CatalogueIcon>>;
}

/** What a catalogue needs from its surroundings. */
export interface CatalogueDeps {
  /** Where listings are kept: `<dataDir>/cache/icons`. */
  cacheDir: string;
  fetch: Fetch;
  now: Clock;
}

/**
 * Reads a catalogue kept on disk, if there is one and it reads.
 *
 * @param file - The cache file.
 * @returns What it holds, or null.
 */
function readCached(file: string): CachedCatalogue | null {
  try {
    const result = cachedCatalogue.safeParse(JSON.parse(readFileSync(file, 'utf-8')));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Opens a catalogue. Any copy already on disk is read straight away, so references resolve to the
 * right format before anything is downloaded.
 *
 * @param source - Which catalogue.
 * @param deps - Where it is kept, and how to fetch and tell the time.
 * @returns The catalogue.
 */
export function openCatalogue(source: CatalogueSource, deps: CatalogueDeps): Catalogue {
  const file = path.join(deps.cacheDir, source.cacheFile);
  const maxAgeMs = ICON_DEFAULTS.catalogueCacheHours * MS_PER_HOUR;
  const retryMs = ICON_DEFAULTS.failureRetryMinutes * MS_PER_MINUTE;
  let icons = new Map<string, CatalogueIcon>();
  let fetchedAt = Number.NEGATIVE_INFINITY;
  let failedAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | null = null;

  const adopt = (cached: CachedCatalogue): void => {
    icons = new Map(cached.icons.map((icon) => [icon.name, icon]));
    fetchedAt = cached.fetchedAt;
  };

  const onDisk = readCached(file);
  if (onDisk !== null) {
    adopt(onDisk);
  }

  /** Downloads the listing and keeps it, or notes the failure. */
  const refresh = async (): Promise<void> => {
    try {
      const response = await deps.fetch(source.listingUrl, {
        headers: { 'user-agent': ICON_USER_AGENT, accept: 'application/json' },
        signal: AbortSignal.timeout(ICON_DEFAULTS.catalogueTimeoutSeconds * MS_PER_SECOND),
      });
      if (response.ok === false) {
        throw new Error(`HTTP ${response.status}`);
      }
      const body = await readCapped(response, ICON_DEFAULTS.maxCatalogueBytes);
      if (body === null) {
        throw new Error('the listing is too large');
      }
      const cached: CachedCatalogue = {
        fetchedAt: deps.now(),
        icons: source.parse(JSON.parse(new TextDecoder().decode(body))),
      };
      adopt(cached);
      await mkdir(deps.cacheDir, { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify(cached), 'utf-8');
      await rename(temp, file);
    } catch (error) {
      failedAt = deps.now();
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[icons] could not download the ${source.prefix}: icon list (${reason}); using what is cached`);
    }
  };

  return {
    source,
    current: () => icons,
    load: async () => {
      const now = deps.now();
      const isFresh = now - fetchedAt < maxAgeMs;
      const isRetryTooSoon = now - failedAt < retryMs;
      if (isFresh || isRetryTooSoon) {
        return icons;
      }
      inFlight ??= refresh().finally(() => {
        inFlight = null;
      });
      await inFlight;
      return icons;
    },
  };
}
