// Matches an app's names to a catalogue icon: "Jellyfin", a container called `jellyfin`, or the image
// `lscr.io/linuxserver/jellyfin:latest` all give `di:jellyfin`.
//
// Only exact matches count, after both sides are written the same way: lower case, accents dropped, and
// spaces, underscores and dots as hyphens. Hyphens are then ignored too, so "Actual Budget",
// `actual-budget` and `actualbudget` are one name. A name that matches nothing is tried again without a
// trailing `-server`, `-web`, `-app` or `-docker`. Nothing closer than that is guessed: a wrong icon is
// worse than the app's own.
import type { IconRef } from '../pages/page.ts';
import type { CatalogueIcon } from './catalogues.ts';

/** Words an image or container name often ends in that aren't part of the app's name. */
const NAME_SUFFIXES = ['-server', '-web', '-app', '-docker'];
/** Combining marks, left once accented letters are split into letter and mark. */
const COMBINING_MARKS = /[̀-ͯ]/g;
/** What separates words in a name, all written as one hyphen. */
const SEPARATORS = /[\s_.]+/g;
/** Anything left that can't be in an icon name. */
const NOT_NAME = /[^a-z0-9-]+/g;
/** Repeated or edge hyphens. */
const EXTRA_HYPHENS = /-{2,}/g;
const EDGE_HYPHENS = /^-|-$/g;
/** An image's tag or digest, after its last path segment. */
const IMAGE_TAG = /[:@].*$/;
/** A registry host at the start of an image: it has a dot or a port, or is `localhost`. */
const REGISTRY_HOST = /^([^/]*[.:][^/]*|localhost)\//;

/**
 * Writes a name the way icon names are written.
 *
 * @param name - What something is called: "Home Assistant", `paperless_ngx`, "Média".
 * @returns The slug: `home-assistant`, `paperless-ngx`, `media`. Empty when nothing usable is left.
 */
export function slugOfName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(SEPARATORS, '-')
    .replace(NOT_NAME, '')
    .replace(EXTRA_HYPHENS, '-')
    .replace(EDGE_HYPHENS, '');
}

/**
 * Turns a slug into the key two names are compared by: hyphens don't count.
 *
 * @param slug - A slug.
 * @returns The key.
 */
function keyOf(slug: string): string {
  return slug.replaceAll('-', '');
}

/**
 * Gives the slugs to try for a name, best first.
 *
 * @param name - What the app is called.
 * @returns The name's slug, then the slug without a trailing word such as `-server`; no empty ones.
 */
export function nameSlugs(name: string): string[] {
  const slug = slugOfName(name);
  if (slug === '') {
    return [];
  }
  const slugs = [slug];
  for (const suffix of NAME_SUFFIXES) {
    const isTrimmable = slug.endsWith(suffix) && slug.length > suffix.length;
    if (isTrimmable) {
      slugs.push(slug.slice(0, -suffix.length));
    }
  }
  return slugs;
}

/**
 * Reads the names an image goes by.
 *
 * @param image - A Docker image: `lscr.io/linuxserver/jellyfin:latest`, `ghcr.io/actualbudget/actual-server`.
 * @returns Its repository name, then the namespace it is published under when there is one other than a
 * registry's: `['jellyfin', 'linuxserver']`, `['actual-server', 'actualbudget']`. Empty for an empty image.
 */
export function imageNames(image: string): string[] {
  // The registry first: its port has a colon, which isn't a tag's.
  const path = image.trim().replace(REGISTRY_HOST, '').replace(IMAGE_TAG, '');
  const segments = path.split('/').filter((segment) => segment !== '');
  const repository = segments.at(-1);
  if (repository === undefined) {
    return [];
  }
  const namespace = segments.length > 1 ? segments.at(-2) : undefined;
  // `library/` is Docker Hub's namespace for official images, not a name.
  const hasNamespace = namespace !== undefined && namespace !== 'library';
  return hasNamespace ? [repository, namespace] : [repository];
}

/** One catalogue's icons, by the key their names and aliases compare by. */
export type IconIndex = ReadonlyMap<string, string>;

/**
 * Indexes a catalogue's icons for matching.
 *
 * @param icons - The icons, from the catalogue's listing.
 * @param [aliases] - Icons from a listing that gives other names for the same catalogue's icons.
 * @returns Each icon's key, and each alias's, to the icon's name. A name wins over another icon's alias.
 */
export function indexIcons(icons: Iterable<CatalogueIcon>, aliases: Iterable<CatalogueIcon> = []): IconIndex {
  const index = new Map<string, string>();
  const known = new Set<string>();
  for (const icon of icons) {
    known.add(icon.name);
    index.set(keyOf(slugOfName(icon.name)), icon.name);
  }
  for (const icon of aliases) {
    // An alias only counts for an icon the image listing has, so the reference resolves to an image.
    const isPublished = known.has(icon.name);
    if (isPublished === false) {
      continue;
    }
    for (const alias of icon.aliases ?? []) {
      const key = keyOf(slugOfName(alias));
      const isTaken = index.has(key);
      if (key !== '' && isTaken === false) {
        index.set(key, icon.name);
      }
    }
  }
  return index;
}

/** The catalogues to match against, in the order they are preferred. */
export interface MatchIndexes {
  di: IconIndex;
  sh: IconIndex;
}

/**
 * Finds the catalogue icon for an app, from the names it goes by.
 *
 * @param names - The app's names, most telling first: its own name, then a container's, then an image's.
 * @param indexes - The catalogues.
 * @returns `di:<name>` or `sh:<name>` for the first name that matches exactly, dashboard-icons before
 * selfh.st for the same name; null when none does.
 */
export function matchIcon(names: readonly string[], indexes: MatchIndexes): IconRef | null {
  for (const name of names) {
    for (const slug of nameSlugs(name)) {
      const key = keyOf(slug);
      const fromDashboardIcons = indexes.di.get(key);
      if (fromDashboardIcons !== undefined) {
        return `di:${fromDashboardIcons}`;
      }
      const fromSelfhst = indexes.sh.get(key);
      if (fromSelfhst !== undefined) {
        return `sh:${fromSelfhst}`;
      }
    }
  }
  return null;
}
