// STUB, to be built by the icons feature: resolves icon references to image URLs and searches the catalogues.
import type { IconRef } from '../pages/page.ts';
import { isWebUrl } from '../pages/page-input.ts';

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
}

/**
 * Builds the icon service.
 *
 * @returns The service. The stub resolves only image URLs and finds nothing.
 */
export function createIconService(): IconService {
  return {
    urlFor: (icon) => (icon !== null && isWebUrl(icon) ? icon : null),
    search: async () => [],
  };
}
