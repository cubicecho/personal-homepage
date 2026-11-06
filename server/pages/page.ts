// The page model and the store contract. Everything above the store (GraphQL, the web app) reads
// these types only, so the YAML store can be swapped for a database without touching them.

/** The slug of the page that is always there, first in the list, and cannot be deleted. */
export const HOME_SLUG = 'home';

/** What an item on a page is, and so how it opens. */
export const ItemKind = {
  /** A tile that opens the URL in a new browser tab. */
  Link: 'LINK',
  /** The URL framed inline on the page, at a set height. */
  Frame: 'FRAME',
  /** A tile that opens the URL framed across the whole content area, with "Open in the browser" beside it. */
  App: 'APP',
} as const;
export type ItemKind = (typeof ItemKind)[keyof typeof ItemKind];

/** The glyphs a page or item may wear. The web app maps each to an icon. */
export const Icon = {
  Globe: 'GLOBE',
  Server: 'SERVER',
  House: 'HOUSE',
  Film: 'FILM',
  Music: 'MUSIC',
  Image: 'IMAGE',
  Book: 'BOOK',
  Database: 'DATABASE',
  Chart: 'CHART',
  Cloud: 'CLOUD',
  Shield: 'SHIELD',
  Terminal: 'TERMINAL',
  Code: 'CODE',
  Calendar: 'CALENDAR',
  Mail: 'MAIL',
  Download: 'DOWNLOAD',
  Gamepad: 'GAMEPAD',
  Kanban: 'KANBAN',
  Camera: 'CAMERA',
  Router: 'ROUTER',
  Printer: 'PRINTER',
  Settings: 'SETTINGS',
} as const;
export type Icon = (typeof Icon)[keyof typeof Icon];

/** One thing on a page: a link tile, an inline frame, or an app tile. */
export interface Item {
  /** Unique within its page; made from the title when the item is added. */
  id: string;
  kind: ItemKind;
  title: string;
  /** An absolute http or https URL. */
  url: string;
  icon: Icon | null;
  description: string | null;
  /** Height of the inline frame, in CSS pixels. Set for FRAME items only, null for the others. */
  frameHeightPx: number | null;
}

/** A page: a title and its items, in order. */
export interface Page {
  /** Unique; the page's URL segment and, in the YAML store, its file name. */
  slug: string;
  title: string;
  icon: Icon | null;
  items: Item[];
}

/** What a new page is made from. Already validated. */
export interface NewPage {
  title: string;
  /** Made from the title when left out. */
  slug?: string;
  icon: Icon | null;
}

/** The parts of a page that can change. Already validated. A key left out is kept. */
export interface PagePatch {
  title?: string;
  icon?: Icon | null;
}

/** What an item is made from, or replaced with. Already validated: `frameHeightPx` is null unless the kind is FRAME. */
export interface ItemFields {
  kind: ItemKind;
  title: string;
  url: string;
  icon: Icon | null;
  description: string | null;
  frameHeightPx: number | null;
}

/**
 * Where pages are kept. The YAML store is the first; a database store implements the same contract.
 *
 * Every method takes validated input (see `page-input.ts`) and throws a coded `GraphQLError`
 * (`errors.ts`): NOT_FOUND for an unknown slug or item id, BAD_USER_INPUT for a rule only the store
 * can check (a slug that is taken, a full page, the home page deleted or moved).
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
   * Adds a page at the end of the list.
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
   * Deletes a page and its items. The home page cannot be deleted.
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
   * Adds an item at the end of a page.
   *
   * @param slug - The page's slug.
   * @param item - The item's fields.
   * @returns The page, with the item.
   */
  addItem(slug: string, item: ItemFields): Promise<Page>;
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
   * Moves an item within its page.
   *
   * @param slug - The page's slug.
   * @param id - The item's id.
   * @param toIndex - Where it goes, clamped to the page.
   * @returns The page, in the new order.
   */
  moveItem(slug: string, id: string, toIndex: number): Promise<Page>;
}
