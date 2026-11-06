// The YAML layout releases 1.x kept pages in, and the zip export still uses:
//
//   site.yaml          pageOrder: [media, tools]   the order of every page but home; `search:` for the launcher
//   pages/<slug>.yaml  one page; the file name is its slug
//
// A page with one open, untitled section lists its items under the page; any other has `sections:`.
// Words (`kind`, `opensIn`, glyph names) are written in lower case with hyphens and read in any case, keys
// that hold their default are left out, and `kind: app` from 1.0 reads as a link that opens in the app.
// `columnSpan` is a number of columns, 1 to 4, or `full`.
//
// The database is where pages live now. This module only reads a directory of these files (the import from
// 1.x, and restoring an export) and writes pages back out as them (the export).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { PAGE_LIMIT_DEFAULTS } from '../core/defaults.ts';
import { errorMessage } from '../core/errors.ts';
import { diskWord, toDiskWord } from './disk-words.ts';
import {
  ColumnSpan,
  DEFAULT_COLUMN_SPAN,
  HOME_SLUG,
  type Item,
  ItemKind,
  OpensIn,
  type Page,
  type Section,
} from './page.ts';
import { describeIssues, isIconRef, isWebUrl, normalizeIconRef, SLUG_PATTERN } from './page-input.ts';
import { slugFrom, uniqueSlug } from './slug.ts';
import { diskWidgetSchema, widgetFromDisk, widgetToDisk } from './widget-disk.ts';

const { minFrameHeightPx, maxFrameHeightPx, defaultFrameHeightPx } = PAGE_LIMIT_DEFAULTS;

/** The file holding the page order and the launcher's searches. */
export const SITE_FILE = 'site.yaml';
/** The folder holding one file per page. */
export const PAGES_DIR = 'pages';
const PAGE_EXTENSION = '.yaml';
/** What an item made from a title of only symbols is called. */
const FALLBACK_ITEM_ID = 'item';
/** The id of a page's untitled first section, and of a section with no title. */
export const MAIN_SECTION_ID = 'main';
/** What a titled section made from a title of only symbols is called. */
const FALLBACK_SECTION_ID = 'section';
/** The kind 1.0 files used for a link that opens in the app. */
const LEGACY_APP_KIND = 'APP';
/** Keeps long URLs on one line instead of folding them. */
const YAML_WRITE_OPTIONS = { lineWidth: 0 } as const;
const MISSING_FILE = 'ENOENT';
/** The end of the first line of a YAML parse error, before its code frame. */
const CODE_FRAME_START = /:?\n[\s\S]*$/;

const ITEM_KINDS = [...Object.values(ItemKind), LEGACY_APP_KIND];
const OPENS_IN = Object.values(OpensIn);

/** An icon as written: any known reference, or nothing. An unknown one reads as no icon. */
const diskIcon = z
  .string()
  .nullish()
  .transform((value) => {
    const icon = normalizeIconRef(value ?? '');
    return isIconRef(icon, true) ? icon : null;
  });

/** Who may see a page, section or item, as written: a list of group names, or left out for everyone. */
const diskGroups = z
  .array(z.string())
  .nullish()
  .transform((groups) => [...new Set((groups ?? []).map((group) => group.trim()).filter((group) => group !== ''))]);

/** The most columns a span can name by number. */
const MAX_SPAN_COLUMNS = 4;

/** The column spans written as a number of columns; FULL is written as the word. */
const SPAN_BY_COLUMNS: Readonly<Record<number, ColumnSpan>> = Object.freeze({
  1: ColumnSpan.One,
  2: ColumnSpan.Two,
  3: ColumnSpan.Three,
  4: ColumnSpan.Four,
});
const COLUMNS_BY_SPAN: Readonly<Partial<Record<ColumnSpan, number>>> = Object.freeze({
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
});

/** A column span as written: 1 to 4, or `full`; the words (`two`, `FULL`) are read too. */
const diskColumnSpan = z
  .union([
    z
      .number()
      .int()
      .min(1)
      .max(MAX_SPAN_COLUMNS)
      .transform((columns) => SPAN_BY_COLUMNS[columns] ?? ColumnSpan.Full),
    diskWord(Object.values(ColumnSpan)),
  ])
  .nullish();

const diskItemSchema = z
  .object({
    id: z.string().trim().nullish(),
    kind: diskWord(ITEM_KINDS).nullish(),
    opensIn: diskWord(OPENS_IN).nullish(),
    title: z.string().trim().min(1, 'needs a title'),
    url: z.string().trim().refine(isWebUrl, 'must be an http:// or https:// address').nullish(),
    icon: diskIcon,
    description: z.string().trim().nullish(),
    frameHeightPx: z.number().int().positive().nullish(),
    columnSpan: diskColumnSpan,
    check: z
      .union([z.boolean(), z.string().trim().refine(isWebUrl, 'check must be true, false or an http(s) address')])
      .nullish(),
    widget: diskWidgetSchema.nullish(),
    visibleTo: diskGroups,
  })
  .superRefine((item, context) => {
    const isWidget = item.kind === ItemKind.Widget;
    const hasUrl = (item.url ?? null) !== null;
    if (isWidget === false && hasUrl === false) {
      context.addIssue({ code: 'custom', path: ['url'], message: 'is missing' });
    }
    const widget = item.widget ?? null;
    if (isWidget && widget === null) {
      context.addIssue({ code: 'custom', path: ['widget'], message: 'is missing' });
    }
    const problem = isWidget && widget !== null ? widgetFromDisk(widget) : null;
    if (typeof problem === 'string') {
      context.addIssue({ code: 'custom', path: ['widget'], message: problem });
    }
  });
type DiskItem = z.output<typeof diskItemSchema>;

const diskSectionSchema = z.object({
  id: z.string().trim().nullish(),
  title: z.string().trim().nullish(),
  collapsed: z.boolean().nullish(),
  visibleTo: diskGroups,
  items: z.array(diskItemSchema).nullish(),
});
type DiskSection = z.output<typeof diskSectionSchema>;

const diskPageSchema = z.object({
  title: z.string().trim().min(1, 'needs a title'),
  icon: diskIcon,
  visibleTo: diskGroups,
  items: z.array(diskItemSchema).nullish(),
  sections: z.array(diskSectionSchema).nullish(),
});

const siteSchema = z.looseObject({
  pageOrder: z.array(z.string()).nullish(),
  search: z.unknown().optional(),
});

/** A file that could not be read, and why. */
export interface SkippedFile {
  /** Its path inside the directory, such as `pages/tools.yaml`. */
  file: string;
  problem: string;
}

/** What a directory of YAML holds. */
export interface YamlData {
  /** Every readable page, in list order: home first, then site.yaml's order, then the rest by title. */
  pages: Page[];
  /** The `search:` key of site.yaml as written, or undefined when there is none. */
  search: unknown;
  /** Files left out because they could not be read. */
  skipped: SkippedFile[];
}

/**
 * Keeps a hand-edited frame height inside the limits.
 *
 * @param heightPx - The height in the file, if any.
 * @returns The height to use.
 */
function frameHeightFrom(heightPx: number | null | undefined): number {
  const height = heightPx ?? defaultFrameHeightPx;
  return Math.min(maxFrameHeightPx, Math.max(minFrameHeightPx, height));
}

/**
 * Gives an id that is a slug and not yet taken, keeping the written one when it is usable.
 *
 * @param written - The id in the file, if any.
 * @param title - The title to make one from otherwise.
 * @param fallback - The id for a title of only symbols.
 * @param taken - The ids already used; the result is added to it.
 * @returns The id.
 */
function claimId(written: string | null | undefined, title: string, fallback: string, taken: Set<string>): string {
  const wanted = written ?? '';
  const isUsable = SLUG_PATTERN.test(wanted) && taken.has(wanted) === false;
  const id = isUsable ? wanted : uniqueSlug(slugFrom(title, fallback), taken);
  taken.add(id);
  return id;
}

/**
 * Turns one item read from a file into the model.
 *
 * @param item - The item as read.
 * @param id - Its id, already made unique.
 * @returns The item.
 */
function itemFromDisk(item: DiskItem, id: string): Item {
  const isLegacyApp = item.kind === LEGACY_APP_KIND;
  const isWidget = item.kind === ItemKind.Widget;
  const isFrame = item.kind === ItemKind.Frame;
  let kind: ItemKind = ItemKind.Link;
  if (isWidget) {
    kind = ItemKind.Widget;
  } else if (isFrame) {
    kind = ItemKind.Frame;
  }
  const writtenOpensIn = item.opensIn ?? OpensIn.NewTab;
  const opensIn = isLegacyApp ? OpensIn.App : writtenOpensIn;
  const description = item.description ?? '';
  // A widget is only checked when asked: its link is often a page whose status nobody needs.
  const check = item.check ?? isWidget === false;
  const isCheckUrl = typeof check === 'string';
  const diskWidget = item.widget ?? null;
  const widget = isWidget && diskWidget !== null ? widgetFromDisk(diskWidget) : null;
  return {
    id,
    kind,
    title: item.title,
    url: item.url ?? null,
    opensIn: kind === ItemKind.Link ? opensIn : null,
    icon: item.icon,
    description: description === '' ? null : description,
    frameHeightPx: isFrame ? frameHeightFrom(item.frameHeightPx) : null,
    columnSpan: kind === ItemKind.Link ? ColumnSpan.One : (item.columnSpan ?? DEFAULT_COLUMN_SPAN[kind]),
    check: { enabled: check !== false, url: isCheckUrl ? check : null },
    // diskItemSchema has already refused a widget that would come back as a sentence.
    widget: typeof widget === 'string' ? null : widget,
    visibleTo: item.visibleTo,
    // YAML never carries a link to a discovered app: those ids belong to one database.
    discoveredId: null,
  };
}

/**
 * Makes the one untitled, open section a new page starts with.
 *
 * @returns The section, with no items.
 */
export function emptySection(): Section {
  return { id: MAIN_SECTION_ID, title: null, collapsed: false, visibleTo: [], items: [] };
}

/**
 * Turns the sections read from a file into the model, giving every section and item a unique id.
 *
 * @param sections - The sections as read. A page written with bare `items` is one untitled section.
 * @returns The sections; at least one.
 */
function sectionsFromDisk(sections: DiskSection[]): Section[] {
  const sectionIds = new Set<string>();
  const itemIds = new Set<string>();
  const read = sections.map((section) => {
    const title = section.title ?? '';
    const hasTitle = title !== '';
    const id = claimId(section.id, hasTitle ? title : MAIN_SECTION_ID, FALLBACK_SECTION_ID, sectionIds);
    const items = (section.items ?? []).map((item) =>
      itemFromDisk(item, claimId(item.id, item.title, FALLBACK_ITEM_ID, itemIds)),
    );
    return {
      id,
      title: hasTitle ? title : null,
      collapsed: section.collapsed ?? false,
      visibleTo: section.visibleTo,
      items,
    };
  });
  const isEmpty = read.length === 0;
  return isEmpty ? [emptySection()] : read;
}

/**
 * Builds what one item holds on disk, leaving out keys that hold their default.
 *
 * @param item - The item.
 * @returns The plain object to write as YAML.
 */
function itemToDisk(item: Item): Record<string, unknown> {
  const written: Record<string, unknown> = { id: item.id };
  if (item.kind !== ItemKind.Link) {
    written.kind = toDiskWord(item.kind);
  }
  const hasOpensIn = item.opensIn !== null && item.opensIn !== OpensIn.NewTab;
  if (hasOpensIn && item.opensIn !== null) {
    written.opensIn = toDiskWord(item.opensIn);
  }
  written.title = item.title;
  if (item.url !== null) {
    written.url = item.url;
  }
  if (item.icon !== null) {
    written.icon = item.icon;
  }
  if (item.description !== null) {
    written.description = item.description;
  }
  if (item.frameHeightPx !== null) {
    written.frameHeightPx = item.frameHeightPx;
  }
  if (item.columnSpan !== DEFAULT_COLUMN_SPAN[item.kind]) {
    written.columnSpan = COLUMNS_BY_SPAN[item.columnSpan] ?? toDiskWord(item.columnSpan);
  }
  const isCheckedByDefault = item.kind !== ItemKind.Widget;
  if (item.check.url !== null && item.check.enabled) {
    written.check = item.check.url;
  } else if (item.check.enabled !== isCheckedByDefault) {
    written.check = item.check.enabled;
  }
  if (item.widget !== null) {
    written.widget = widgetToDisk(item.widget);
  }
  if (item.visibleTo.length > 0) {
    written.visibleTo = item.visibleTo;
  }
  return written;
}

/**
 * Builds what a page file holds. A page that is one open, untitled section lists its items under the
 * page; any other is written as sections.
 *
 * @param page - The page.
 * @returns The plain object to write as YAML.
 */
export function pageToDisk(page: Page): Record<string, unknown> {
  const written: Record<string, unknown> = { title: page.title };
  if (page.icon !== null) {
    written.icon = page.icon;
  }
  if (page.visibleTo.length > 0) {
    written.visibleTo = page.visibleTo;
  }
  const [first] = page.sections;
  const isPlain =
    page.sections.length === 1 &&
    first !== undefined &&
    first.title === null &&
    first.collapsed === false &&
    first.visibleTo.length === 0;
  if (isPlain) {
    written.items = first.items.map(itemToDisk);
    return written;
  }
  written.sections = page.sections.map((section) => {
    const disk: Record<string, unknown> = { id: section.id };
    if (section.title !== null) {
      disk.title = section.title;
    }
    if (section.collapsed) {
      disk.collapsed = true;
    }
    if (section.visibleTo.length > 0) {
      disk.visibleTo = section.visibleTo;
    }
    disk.items = section.items.map(itemToDisk);
    return disk;
  });
  return written;
}

/**
 * Writes pages out as the files of a data directory.
 *
 * @param pages - Every page, in list order.
 * @param search - The launcher's `search` settings as stored, or null for the defaults.
 * @returns The YAML text of each file, by its path inside the directory.
 */
export function toYamlFiles(pages: readonly Page[], search: unknown): Record<string, string> {
  const site: Record<string, unknown> = {
    pageOrder: pages.map((page) => page.slug).filter((slug) => slug !== HOME_SLUG),
  };
  if (search !== null && search !== undefined) {
    site.search = search;
  }
  const files: Record<string, string> = { [SITE_FILE]: stringify(site, YAML_WRITE_OPTIONS) };
  for (const page of pages) {
    files[`${PAGES_DIR}/${page.slug}${PAGE_EXTENSION}`] = stringify(pageToDisk(page), YAML_WRITE_OPTIONS);
  }
  return files;
}

/**
 * Describes a YAML syntax error in one line.
 *
 * @param error - What the parser threw.
 * @returns Its first line, which names the problem and where it is, without the code frame under it.
 */
function yamlProblem(error: unknown): string {
  return `not valid YAML: ${errorMessage(error).replace(CODE_FRAME_START, '')}`;
}

/**
 * Checks whether a caught file-system error means the file is not there.
 *
 * @param error - Whatever was thrown.
 * @returns True for ENOENT.
 */
function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === MISSING_FILE;
}

/**
 * Reads a file, or nothing when it is not there.
 *
 * @param file - The file.
 * @returns Its text, or null.
 */
async function readIfThere(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf-8');
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Parses one page file.
 *
 * @param slug - The page's slug: its file name.
 * @param text - The file's text.
 * @returns The page, or what is wrong with the file.
 */
function parsePage(slug: string, text: string): { page: Page } | { problem: string } {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    return { problem: yamlProblem(error) };
  }
  const result = diskPageSchema.safeParse(raw);
  if (result.success === false) {
    return { problem: describeIssues(result.error) };
  }
  const { title, icon, visibleTo, items, sections } = result.data;
  const diskSections = sections ?? [{ items: items ?? [], visibleTo: [] }];
  return { page: { slug, title, icon, visibleTo, sections: sectionsFromDisk(diskSections) } };
}

/**
 * Puts pages in list order: home, then the order in `site.yaml`, then the rest by title.
 *
 * @param pages - The pages, in any order.
 * @param pageOrder - The slugs from `site.yaml`.
 * @returns A new array, in list order.
 */
export function orderPages(pages: readonly Page[], pageOrder: readonly string[]): Page[] {
  const rank = new Map(pageOrder.map((slug, index) => [slug, index]));
  const rankOf = (page: Page): number => {
    if (page.slug === HOME_SLUG) {
      return Number.NEGATIVE_INFINITY;
    }
    return rank.get(page.slug) ?? Number.POSITIVE_INFINITY;
  };
  return [...pages].sort((a, b) => {
    const byRank = rankOf(a) - rankOf(b);
    const isSameRank = byRank === 0 || Number.isNaN(byRank);
    return isSameRank ? a.title.localeCompare(b.title) : byRank;
  });
}

/**
 * Lists the page files in a directory.
 *
 * @param dataDir - The directory holding `pages/`.
 * @returns The slugs that have a `.yaml` file; empty when there is no `pages/`.
 */
export async function listYamlPages(dataDir: string): Promise<string[]> {
  const names = await readdir(path.join(dataDir, PAGES_DIR)).catch((error: unknown) => {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  });
  return names
    .filter((name) => name.endsWith(PAGE_EXTENSION))
    .map((name) => name.slice(0, -PAGE_EXTENSION.length))
    .filter((slug) => SLUG_PATTERN.test(slug))
    .sort();
}

/**
 * Reads every page and the site settings from a directory laid out as above.
 *
 * @param dataDir - The directory holding `site.yaml` and `pages/`.
 * @returns The pages in list order, the `search` settings, and the files that could not be read.
 */
export async function readYamlData(dataDir: string): Promise<YamlData> {
  const skipped: SkippedFile[] = [];
  const pages: Page[] = [];
  for (const slug of await listYamlPages(dataDir)) {
    const file = `${PAGES_DIR}/${slug}${PAGE_EXTENSION}`;
    const text = await readIfThere(path.join(dataDir, file));
    if (text === null) {
      continue;
    }
    const read = parsePage(slug, text);
    if ('problem' in read) {
      skipped.push({ file, problem: read.problem });
    } else {
      pages.push(read.page);
    }
  }

  let pageOrder: string[] = [];
  let search: unknown;
  const siteText = await readIfThere(path.join(dataDir, SITE_FILE));
  if (siteText !== null) {
    try {
      const site = siteSchema.safeParse(parse(siteText) ?? {});
      if (site.success) {
        pageOrder = site.data.pageOrder ?? [];
        search = site.data.search;
      } else {
        skipped.push({ file: SITE_FILE, problem: describeIssues(site.error) });
      }
    } catch (error) {
      skipped.push({ file: SITE_FILE, problem: yamlProblem(error) });
    }
  }
  return { pages: orderPages(pages, pageOrder), search, skipped };
}
