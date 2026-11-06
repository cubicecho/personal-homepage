import { PAGE_LIMIT_DEFAULTS } from '../core/defaults.ts';

const { maxSlugLength } = PAGE_LIMIT_DEFAULTS;

/** Runs of anything but a lower-case letter or digit, which become one hyphen. */
const NON_SLUG_RUN = /[^a-z0-9]+/g;
/** Hyphens at either end. */
const EDGE_HYPHENS = /^-+|-+$/g;
/** Combining marks left behind when an accented letter is decomposed. */
const COMBINING_MARKS = /\p{M}/gu;
/** The first number tried when a slug is taken: `media-2`. */
const FIRST_SUFFIX = 2;

/**
 * Makes a slug from free text: lower-case letters and digits joined by single hyphens.
 *
 * @param text - A title, as typed.
 * @param fallback - Used when nothing in the text survives, such as a title of only symbols.
 * @returns The slug, at most `PAGE_LIMIT_DEFAULTS.maxSlugLength` long.
 */
export function slugFrom(text: string, fallback: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(NON_SLUG_RUN, '-')
    .replace(EDGE_HYPHENS, '')
    .slice(0, maxSlugLength)
    .replace(EDGE_HYPHENS, '');
  return slug === '' ? fallback : slug;
}

/**
 * Makes a slug unique among those taken, by adding `-2`, `-3` and so on.
 *
 * @param base - The slug wanted.
 * @param taken - The slugs already in use.
 * @returns `base` when it is free, otherwise the first free numbered form, still within the length limit.
 */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (taken.has(base) === false) {
    return base;
  }
  for (let number = FIRST_SUFFIX; ; number += 1) {
    const suffix = `-${number}`;
    const stem = base.slice(0, maxSlugLength - suffix.length).replace(EDGE_HYPHENS, '');
    const candidate = `${stem}${suffix}`;
    if (taken.has(candidate) === false) {
      return candidate;
    }
  }
}
