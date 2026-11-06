// The page model and the store contract. Everything above the store (GraphQL, the web app) reads
// these types only, so the YAML store can be swapped for a database without touching them.
import type { Widget } from './widget.ts';

/** The slug of the page that is always there, first in the list, and cannot be deleted. */
export const HOME_SLUG = 'home';

/** What an item on a page is. */
export const ItemKind = {
  /** A tile that opens the URL; `opensIn` says where. */
  Link: 'LINK',
  /** The URL framed inline on the page, at a set height. */
  Frame: 'FRAME',
  /** Data the server fetches and the page shows: values from an API, a feed, the weather. */
  Widget: 'WIDGET',
} as const;
export type ItemKind = (typeof ItemKind)[keyof typeof ItemKind];

/** Where a link opens. */
export const OpensIn = {
  /** A new browser tab. */
  NewTab: 'NEW_TAB',
  /** This tab, leaving the homepage. */
  SameTab: 'SAME_TAB',
  /** Framed across the homepage's content area, with "Open in the browser" beside it. */
  App: 'APP',
} as const;
export type OpensIn = (typeof OpensIn)[keyof typeof OpensIn];

/**
 * The glyphs drawn by the web app itself. An icon reference that is one of these names is a glyph;
 * see `IconRef` for the other forms.
 */
export const BUILT_IN_ICONS = [
  'globe',
  'server',
  'house',
  'film',
  'music',
  'image',
  'book',
  'database',
  'chart',
  'cloud',
  'shield',
  'terminal',
  'code',
  'calendar',
  'mail',
  'download',
  'gamepad',
  'kanban',
  'camera',
  'router',
  'printer',
  'settings',
] as const;

/**
 * An icon reference, as stored and as sent over the API. One of:
 *
 * - a built-in glyph name: `film` (see `BUILT_IN_ICONS`)
 * - `di:<name>`: an icon from homarr-labs/dashboard-icons, such as `di:jellyfin`
 * - `sh:<name>`: an icon from selfh.st/icons, such as `sh:jellyfin`
 * - `favicon`: the item's own site's favicon, fetched by the server (items only)
 * - an absolute http(s) URL of an image
 */
export type IconRef = string;

/** How an item's status is checked. */
export interface StatusCheck {
  /** Whether the server checks it at all. */
  enabled: boolean;
  /** The URL to check instead of the item's own, such as an internal health endpoint. Null checks the item's URL. */
  url: string | null;
}

/** One thing on a page: a link tile, an inline frame, or a widget. */
export interface Item {
  /** Unique within its page, across its sections; made from the title when the item is added. */
  id: string;
  kind: ItemKind;
  title: string;
  /**
   * An absolute http or https URL. A widget's is optional: where its title links to, such as the service
   * whose numbers it shows. Null only for a widget.
   */
  url: string | null;
  /** Where a LINK opens. Null for the other kinds. */
  opensIn: OpensIn | null;
  icon: IconRef | null;
  description: string | null;
  /** Height of the inline frame, in CSS pixels. Set for FRAME items only, null for the others. */
  frameHeightPx: number | null;
  check: StatusCheck;
  /** What a WIDGET shows. Null for the other kinds. */
  widget: Widget | null;
  /** The groups that may see it. Empty means everyone who may see the homepage. */
  visibleTo: string[];
}

/** A group of items on a page, with an optional heading. */
export interface Section {
  /** Unique within its page. */
  id: string;
  /** The heading. Null draws the items with no heading, as a page's first section usually is. */
  title: string | null;
  /** Whether it starts folded. A browser remembers its own choice after that. */
  collapsed: boolean;
  /** The groups that may see it. Empty means everyone who may see the homepage. */
  visibleTo: string[];
  items: Item[];
}

/** A page: a title and its sections, in order. Every page has at least one section. */
export interface Page {
  /** Unique; the page's URL segment and, in the YAML store, its file name. */
  slug: string;
  title: string;
  icon: IconRef | null;
  /** The groups that may see it. Empty means everyone who may see the homepage. */
  visibleTo: string[];
  sections: Section[];
}

/** What a new page is made from. Already validated. */
export interface NewPage {
  title: string;
  /** Made from the title when left out. */
  slug?: string;
  icon: IconRef | null;
  /** The groups that may see it. Empty means everyone who may see the homepage. */
  visibleTo: string[];
}

/** The parts of a page that can change. Already validated. A key left out is kept. */
export interface PagePatch {
  title?: string;
  icon?: IconRef | null;
  visibleTo?: string[];
}

/** What a section is made from, or replaced with. Already validated. */
export interface SectionFields {
  title: string | null;
  collapsed: boolean;
  /** The groups that may see it. Empty means everyone who may see the homepage. */
  visibleTo: string[];
}

/**
 * What an item is made from, or replaced with. Already validated: `frameHeightPx` is null unless the
 * kind is FRAME, `opensIn` is null unless it is LINK, `widget` is null unless it is WIDGET, and `url` is
 * only null for a WIDGET.
 */
export interface ItemFields {
  kind: ItemKind;
  title: string;
  url: string | null;
  opensIn: OpensIn | null;
  icon: IconRef | null;
  description: string | null;
  frameHeightPx: number | null;
  check: StatusCheck;
  widget: Widget | null;
  /** The groups that may see it. Empty means everyone who may see the homepage. */
  visibleTo: string[];
}

/**
 * Gives the URL an item's status check asks.
 *
 * @param item - The item.
 * @returns The check URL when one is set, else the item's own; null when it has neither.
 */
export function checkUrlOf(item: Pick<Item, 'url' | 'check'>): string | null {
  return item.check.url ?? item.url;
}

/**
 * Lists a page's items in order, across its sections.
 *
 * @param page - The page.
 * @returns Every item, first section first.
 */
export function itemsOf(page: Page): Item[] {
  return page.sections.flatMap((section) => section.items);
}

/**
 * Where pages are kept. The YAML store is the first; a database store implements the same contract.
 *
 * Every method takes validated input (see `page-input.ts`) and throws a coded `GraphQLError`
 * (`errors.ts`): NOT_FOUND for an unknown slug, section or item id, BAD_USER_INPUT for a rule only the
 * store can check (a slug that is taken, a full page, the home page deleted or moved, the last section
 * removed).
 */
export interface PageStore {
  /**
   * Lists every page, home first, then in the order they were put in.
   *
   * @returns The pages.
   */
  list(): Promise<Page[]>;
  /**
   * Finds one page.
   *
   * @param slug - The page's slug.
   * @returns The page, or null when there is none.
   */
  find(slug: string): Promise<Page | null>;
  /**
   * Adds a page at the end of the list, with one untitled section.
   *
   * @param page - Its title, icon and optional slug.
   * @returns The new page.
   */
  createPage(page: NewPage): Promise<Page>;
  /**
   * Changes a page's title or icon. The slug never changes.
   *
   * @param slug - The page's slug.
   * @param patch - What to change.
   * @returns The changed page.
   */
  updatePage(slug: string, patch: PagePatch): Promise<Page>;
  /**
   * Deletes a page and everything on it. The home page cannot be deleted.
   *
   * @param slug - The page's slug.
   */
  deletePage(slug: string): Promise<void>;
  /**
   * Moves a page within the list. Home stays first: an index of 0 lands just after it.
   *
   * @param slug - The page's slug. Not the home page.
   * @param toIndex - Where it goes in the whole list, clamped to the list.
   * @returns Every page, in the new order.
   */
  movePage(slug: string, toIndex: number): Promise<Page[]>;
  /**
   * Adds a section at the end of a page.
   *
   * @param slug - The page's slug.
   * @param section - Its heading and whether it starts folded.
   * @returns The page, with the section.
   */
  addSection(slug: string, section: SectionFields): Promise<Page>;
  /**
   * Changes a section's heading or folding.
   *
   * @param slug - The page's slug.
   * @param id - The section's id.
   * @param section - The new fields.
   * @returns The page.
   */
  updateSection(slug: string, id: string, section: SectionFields): Promise<Page>;
  /**
   * Removes a section and its items. A page's last section cannot be removed.
   *
   * @param slug - The page's slug.
   * @param id - The section's id.
   * @returns The page, without the section.
   */
  removeSection(slug: string, id: string): Promise<Page>;
  /**
   * Moves a section within its page.
   *
   * @param slug - The page's slug.
   * @param id - The section's id.
   * @param toIndex - Where it goes, clamped to the page.
   * @returns The page, in the new order.
   */
  moveSection(slug: string, id: string, toIndex: number): Promise<Page>;
  /**
   * Adds an item at the end of a section.
   *
   * @param slug - The page's slug.
   * @param sectionId - The section, or null for the page's first.
   * @param item - The item's fields.
   * @returns The page, with the item.
   */
  addItem(slug: string, sectionId: string | null, item: ItemFields): Promise<Page>;
  /**
   * Replaces an item's fields. Its id and place stay.
   *
   * @param slug - The page's slug.
   * @param id - The item's id.
   * @param item - The new fields.
   * @returns The page.
   */
  updateItem(slug: string, id: string, item: ItemFields): Promise<Page>;
  /**
   * Removes an item from a page.
   *
   * @param slug - The page's slug.
   * @param id - The item's id.
   * @returns The page, without the item.
   */
  removeItem(slug: string, id: string): Promise<Page>;
  /**
   * Moves an item within its page, to the same section or another.
   *
   * @param slug - The page's slug.
   * @param id - The item's id.
   * @param toSectionId - The section it goes to, or null to stay in its own.
   * @param toIndex - Where it goes in that section, clamped to it.
   * @returns The page, in the new order.
   */
  moveItem(slug: string, id: string, toSectionId: string | null, toIndex: number): Promise<Page>;
}
