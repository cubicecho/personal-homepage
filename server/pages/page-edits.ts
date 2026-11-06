// The rules for changing one page, as pure functions from a page to the next: what a store does between
// reading the page and writing it back. Kept apart from any store so the rules are written once.
import { PAGE_LIMIT_DEFAULTS } from '../core/defaults.ts';
import { badInput, notFound } from '../core/errors.ts';
import { type ItemFields, itemsOf, type Page, type Section, type SectionFields } from './page.ts';
import { slugFrom, uniqueSlug } from './slug.ts';

const { maxItemsPerPage, maxSectionsPerPage } = PAGE_LIMIT_DEFAULTS;

/** What an item made from a title of only symbols is called. */
const FALLBACK_ITEM_ID = 'item';
/** What a section made from a title of only symbols, or none, is called. */
const FALLBACK_SECTION_ID = 'section';

/**
 * Clamps an index into a range.
 *
 * @param index - The index asked for.
 * @param min - The lowest allowed.
 * @param max - The highest allowed.
 * @returns The index, inside the range.
 */
export function clampIndex(index: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, index));
}

/**
 * Moves one entry of an array.
 *
 * @typeParam T - The entries' type.
 * @param entries - The array.
 * @param from - Where the entry is.
 * @param to - Where it goes, already clamped.
 * @returns A new array.
 */
export function moveEntry<T>(entries: readonly T[], from: number, to: number): T[] {
  const moved = [...entries];
  const [entry] = moved.splice(from, 1);
  if (entry !== undefined) {
    moved.splice(to, 0, entry);
  }
  return moved;
}

/**
 * Finds an item's place on its page.
 *
 * @param page - The page.
 * @param id - The item's id.
 * @returns The index of its section, and its index there.
 * @throws NOT_FOUND when the page has no such item.
 */
function locateItem(page: Page, id: string): { sectionIndex: number; itemIndex: number } {
  for (const [sectionIndex, section] of page.sections.entries()) {
    const itemIndex = section.items.findIndex((item) => item.id === id);
    if (itemIndex !== -1) {
      return { sectionIndex, itemIndex };
    }
  }
  throw notFound(`The page "${page.slug}" has no item "${id}".`);
}

/**
 * Finds a section's place on its page.
 *
 * @param page - The page.
 * @param id - The section's id.
 * @returns Its index.
 * @throws NOT_FOUND when the page has no such section.
 */
function locateSection(page: Page, id: string): number {
  const index = page.sections.findIndex((section) => section.id === id);
  if (index === -1) {
    throw notFound(`The page "${page.slug}" has no section "${id}".`);
  }
  return index;
}

/**
 * Replaces one section of a page.
 *
 * @param page - The page.
 * @param index - The section's index.
 * @param change - Builds the new section from the old.
 * @returns A new page.
 */
function withSection(page: Page, index: number, change: (section: Section) => Section): Page {
  return { ...page, sections: page.sections.map((section, at) => (at === index ? change(section) : section)) };
}

/**
 * Adds a section at the end of a page.
 *
 * @param page - The page.
 * @param fields - The section's heading and folding.
 * @returns The new page.
 * @throws BAD_USER_INPUT when the page has as many sections as it may.
 */
export function addSection(page: Page, fields: SectionFields): Page {
  if (page.sections.length >= maxSectionsPerPage) {
    throw badInput(`"${page.title}" already has ${maxSectionsPerPage} sections, the most a page can hold.`);
  }
  const ids = new Set(page.sections.map((section) => section.id));
  const id = uniqueSlug(slugFrom(fields.title ?? '', FALLBACK_SECTION_ID), ids);
  return { ...page, sections: [...page.sections, { id, ...fields, items: [] }] };
}

/**
 * Changes a section's heading or folding.
 *
 * @param page - The page.
 * @param id - The section's id.
 * @param fields - The new fields.
 * @returns The new page.
 */
export function updateSection(page: Page, id: string, fields: SectionFields): Page {
  return withSection(page, locateSection(page, id), (section) => ({ ...section, ...fields }));
}

/**
 * Removes a section and its items.
 *
 * @param page - The page.
 * @param id - The section's id.
 * @returns The new page.
 * @throws BAD_USER_INPUT when it is the page's last section.
 */
export function removeSection(page: Page, id: string): Page {
  const index = locateSection(page, id);
  if (page.sections.length === 1) {
    throw badInput("A page's last section can't be removed. Remove its items instead.");
  }
  return { ...page, sections: page.sections.filter((_section, at) => at !== index) };
}

/**
 * Moves a section within its page.
 *
 * @param page - The page.
 * @param id - The section's id.
 * @param toIndex - Where it goes, clamped to the page.
 * @returns The new page.
 */
export function moveSection(page: Page, id: string, toIndex: number): Page {
  const from = locateSection(page, id);
  const to = clampIndex(toIndex, 0, page.sections.length - 1);
  return { ...page, sections: moveEntry(page.sections, from, to) };
}

/**
 * Adds an item at the end of a section, with an id made from its title.
 *
 * @param page - The page.
 * @param sectionId - The section, or null for the first.
 * @param fields - The item's fields.
 * @returns The new page.
 * @throws BAD_USER_INPUT when the page holds as many items as it may.
 */
export function addItem(page: Page, sectionId: string | null, fields: ItemFields): Page {
  const items = itemsOf(page);
  if (items.length >= maxItemsPerPage) {
    throw badInput(`"${page.title}" already has ${maxItemsPerPage} items, the most a page can hold.`);
  }
  const index = sectionId === null ? 0 : locateSection(page, sectionId);
  const id = uniqueSlug(slugFrom(fields.title, FALLBACK_ITEM_ID), new Set(items.map((item) => item.id)));
  return withSection(page, index, (section) => ({ ...section, items: [...section.items, { id, ...fields }] }));
}

/**
 * Replaces an item's fields, keeping its id and place.
 *
 * @param page - The page.
 * @param id - The item's id.
 * @param fields - The new fields.
 * @returns The new page.
 */
export function updateItem(page: Page, id: string, fields: ItemFields): Page {
  const { sectionIndex, itemIndex } = locateItem(page, id);
  return withSection(page, sectionIndex, (section) => ({
    ...section,
    items: section.items.map((item, at) => (at === itemIndex ? { id, ...fields } : item)),
  }));
}

/**
 * Removes an item.
 *
 * @param page - The page.
 * @param id - The item's id.
 * @returns The new page.
 */
export function removeItem(page: Page, id: string): Page {
  const { sectionIndex, itemIndex } = locateItem(page, id);
  return withSection(page, sectionIndex, (section) => ({
    ...section,
    items: section.items.filter((_item, at) => at !== itemIndex),
  }));
}

/**
 * Moves an item within its page, to the same section or another.
 *
 * @param page - The page.
 * @param id - The item's id.
 * @param toSectionId - The section it goes to, or null to stay in its own.
 * @param toIndex - Where it goes in that section, clamped to it.
 * @returns The new page.
 */
export function moveItem(page: Page, id: string, toSectionId: string | null, toIndex: number): Page {
  const { sectionIndex, itemIndex } = locateItem(page, id);
  const targetIndex = toSectionId === null ? sectionIndex : locateSection(page, toSectionId);
  if (targetIndex === sectionIndex) {
    return withSection(page, sectionIndex, (section) => {
      const to = clampIndex(toIndex, 0, section.items.length - 1);
      return { ...section, items: moveEntry(section.items, itemIndex, to) };
    });
  }
  const moving = page.sections[sectionIndex]?.items[itemIndex];
  if (moving === undefined) {
    throw notFound(`The page "${page.slug}" has no item "${id}".`);
  }
  const without = removeItem(page, id);
  return withSection(without, targetIndex, (section) => {
    const to = clampIndex(toIndex, 0, section.items.length);
    const items = [...section.items];
    items.splice(to, 0, moving);
    return { ...section, items };
  });
}

/** Two pages after an item moved from one to the other, and the id it has now. */
export interface ItemTransfer {
  /** The page it left. */
  from: Page;
  /** The page it went to. */
  to: Page;
  /** Its id on the page it went to: the same, unless that page already had an item with that id. */
  itemId: string;
}

/**
 * Moves an item to another page, keeping everything about it. It is the item itself that moves, spread
 * whole, so a field added to items later travels with it without this rule changing.
 *
 * @param from - The page it is on.
 * @param id - The item's id.
 * @param to - The page it goes to. Not the same page: that is `moveItem`.
 * @param toSectionId - The section it goes to, or null for that page's first.
 * @param toIndex - Where it goes in that section, clamped to it; null for the end.
 * @returns Both pages, and the item's id on the page it went to.
 * @throws NOT_FOUND when the item or the section is not there; BAD_USER_INPUT when the page it goes to
 * holds as many items as it may.
 */
export function transferItem(
  from: Page,
  id: string,
  to: Page,
  toSectionId: string | null,
  toIndex: number | null,
): ItemTransfer {
  const { sectionIndex, itemIndex } = locateItem(from, id);
  const moving = from.sections[sectionIndex]?.items[itemIndex];
  if (moving === undefined) {
    throw notFound(`The page "${from.slug}" has no item "${id}".`);
  }
  const targetItems = itemsOf(to);
  if (targetItems.length >= maxItemsPerPage) {
    throw badInput(`"${to.title}" already has ${maxItemsPerPage} items, the most a page can hold.`);
  }
  const targetIndex = toSectionId === null ? 0 : locateSection(to, toSectionId);
  const itemId = uniqueSlug(moving.id, new Set(targetItems.map((item) => item.id)));
  const arrived = withSection(to, targetIndex, (section) => {
    const at = clampIndex(toIndex ?? section.items.length, 0, section.items.length);
    const sectionItems = [...section.items];
    sectionItems.splice(at, 0, { ...moving, id: itemId });
    return { ...section, items: sectionItems };
  });
  return { from: removeItem(from, id), to: arrived, itemId };
}
