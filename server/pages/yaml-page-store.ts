// The first PageStore: one YAML file per page, under DATA_DIR, meant to be read and edited by hand.
//
//   <dataDir>/site.yaml          pageOrder: [media, tools]    the order of every page but home
//   <dataDir>/pages/<slug>.yaml  one page; the file name is its slug
//
// A page file with one untitled section lists its items straight under the page:
//
//   title: Media
//   icon: film
//   items:
//     - id: jellyfin
//       kind: link              # link (the default) or frame
//       opensIn: new-tab        # new-tab (the default), same-tab or app; links only
//       title: Jellyfin
//       url: http://nas.local:8096
//       icon: di:jellyfin       # a glyph name, di:<name>, sh:<name>, favicon, or an image URL
//       description: Films and shows
//       check: http://nas.local:8096/health   # false to not check; a URL to check instead; left out checks url
//     - id: grafana
//       kind: frame
//       title: Grafana
//       url: http://nas.local:3001/d/home
//       frameHeightPx: 480
//
// With more sections, or a titled one, the items sit under `sections`:
//
//   title: Media
//   sections:
//     - id: watch
//       title: Watch
//       collapsed: true         # starts folded; left out means open
//       items: [...]
//
// Older files are read too: `kind: app` is a link that opens in the app. Words (`kind`, `opensIn`, glyph
// names) are written in lower case with hyphens and read in any case. When writing, keys that hold their
// default are left out. An item or section without a usable `id` gets one made from its title when read;
// it is saved on the next write. An icon that is not a reference this app knows is read as no icon.
//
// Files are read on every call, so a hand edit shows up on the next request without a restart.
// Writes go through one queue, so two mutations never interleave, and each file is written to a
// temporary file beside it and renamed over it, so a reader never sees half a file. A write rewrites
// the whole file, which drops any comments written in it by hand. Keys of site.yaml other than
// pageOrder are kept.
//
// A file that does not parse, or does not match the shape above, is logged once (`[store]`) and left
// out of the list. Asking for it by slug, or changing it, is NOT_FOUND with a message naming the file
// and what is wrong, so the reason reaches the web app. It still holds its slug: a new page cannot
// take it, and deleting the page removes the broken file.
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { PAGE_LIMIT_DEFAULTS } from '../core/defaults.ts';
import { badInput, errorMessage, notFound } from '../core/errors.ts';
import { HOME_SLUG, type Item, ItemKind, itemsOf, OpensIn, type Page, type PageStore, type Section } from './page.ts';
import { describeIssues, isIconRef, isWebUrl, normalizeIconRef, SLUG_PATTERN } from './page-input.ts';
import { slugFrom, uniqueSlug } from './slug.ts';

const { maxPages, maxItemsPerPage, maxSectionsPerPage, minFrameHeightPx, maxFrameHeightPx, defaultFrameHeightPx } =
  PAGE_LIMIT_DEFAULTS;

const SITE_FILE = 'site.yaml';
const PAGES_DIR = 'pages';
const PAGE_EXTENSION = '.yaml';
const TEMP_EXTENSION = '.tmp';
/** What a page made from a title of only symbols is called. */
const FALLBACK_PAGE_SLUG = 'page';
/** What an item made from a title of only symbols is called. */
const FALLBACK_ITEM_ID = 'item';
/** The id of a page's untitled first section, and of a section with no title. */
const MAIN_SECTION_ID = 'main';
/** What a titled section made from a title of only symbols is called. */
const FALLBACK_SECTION_ID = 'section';
/** The kind older files used for a link that opens in the app. */
const LEGACY_APP_KIND = 'APP';
/** The icon of the page every data directory starts with. */
const HOME_ICON = 'house';
/** Keeps long URLs on one line instead of folding them. */
const YAML_WRITE_OPTIONS = { lineWidth: 0 } as const;
const MISSING_FILE = 'ENOENT';
/** The end of the first line of a YAML parse error, before its code frame. */
const CODE_FRAME_START = /:?\n[\s\S]*$/;

/** Where the store keeps its files. */
export interface YamlPageStoreSettings {
  /** The directory holding `site.yaml` and `pages/`. Made when missing. */
  dataDir: string;
}

/**
 * A vocabulary member as written on disk: any case, hyphens for underscores.
 *
 * @typeParam T - The vocabulary's values.
 * @param values - The vocabulary's values, in upper case.
 * @returns A schema reading `film` or `FILM` as `FILM`.
 */
function diskWord<T extends string>(values: readonly T[]) {
  const isMember = (value: string): value is T => values.some((member) => member === value);
  return z
    .string()
    .transform((value) => value.trim().toUpperCase().replaceAll('-', '_'))
    .refine(isMember, { message: `must be one of ${values.map(toDiskWord).join(', ')}` });
}

/**
 * Writes a vocabulary member the way a person would type it in the file.
 *
 * @param value - The member, in upper case.
 * @returns It in lower case, hyphens for underscores.
 */
function toDiskWord(value: string): string {
  return value.toLowerCase().replaceAll('_', '-');
}

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

const diskItemSchema = z.object({
  id: z.string().trim().nullish(),
  kind: diskWord(ITEM_KINDS).nullish(),
  opensIn: diskWord(OPENS_IN).nullish(),
  title: z.string().trim().min(1, 'needs a title'),
  url: z.string().trim().refine(isWebUrl, 'must be an http:// or https:// address'),
  icon: diskIcon,
  description: z.string().trim().nullish(),
  frameHeightPx: z.number().int().positive().nullish(),
  check: z
    .union([z.boolean(), z.string().trim().refine(isWebUrl, 'check must be true, false or an http(s) address')])
    .nullish(),
});
type DiskItem = z.output<typeof diskItemSchema>;

const diskSectionSchema = z.object({
  id: z.string().trim().nullish(),
  title: z.string().trim().nullish(),
  collapsed: z.boolean().nullish(),
  items: z.array(diskItemSchema).nullish(),
});
type DiskSection = z.output<typeof diskSectionSchema>;

const diskPageSchema = z.object({
  title: z.string().trim().min(1, 'needs a title'),
  icon: diskIcon,
  items: z.array(diskItemSchema).nullish(),
  sections: z.array(diskSectionSchema).nullish(),
});

const siteSchema = z.looseObject({
  pageOrder: z.array(z.string()).nullish(),
});
type Site = z.output<typeof siteSchema>;

/** What reading one page file found. */
type PageRead = { page: Page; problem: null } | { page: null; problem: string } | { page: null; problem: null };

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
  const kind = item.kind === ItemKind.Frame ? ItemKind.Frame : ItemKind.Link;
  const isFrame = kind === ItemKind.Frame;
  const writtenOpensIn = item.opensIn ?? OpensIn.NewTab;
  const opensIn = isLegacyApp ? OpensIn.App : writtenOpensIn;
  const description = item.description ?? '';
  const check = item.check ?? true;
  const isCheckUrl = typeof check === 'string';
  return {
    id,
    kind,
    title: item.title,
    url: item.url,
    opensIn: isFrame ? null : opensIn,
    icon: item.icon,
    description: description === '' ? null : description,
    frameHeightPx: isFrame ? frameHeightFrom(item.frameHeightPx) : null,
    check: { enabled: check !== false, url: isCheckUrl ? check : null },
  };
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
    return { id, title: hasTitle ? title : null, collapsed: section.collapsed ?? false, items };
  });
  const isEmpty = read.length === 0;
  return isEmpty ? [{ id: MAIN_SECTION_ID, title: null, collapsed: false, items: [] }] : read;
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
  written.url = item.url;
  if (item.icon !== null) {
    written.icon = item.icon;
  }
  if (item.description !== null) {
    written.description = item.description;
  }
  if (item.frameHeightPx !== null) {
    written.frameHeightPx = item.frameHeightPx;
  }
  if (item.check.enabled === false) {
    written.check = false;
  } else if (item.check.url !== null) {
    written.check = item.check.url;
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
function pageToDisk(page: Page): Record<string, unknown> {
  const written: Record<string, unknown> = { title: page.title };
  if (page.icon !== null) {
    written.icon = page.icon;
  }
  const [first] = page.sections;
  const isPlain =
    page.sections.length === 1 && first !== undefined && first.title === null && first.collapsed === false;
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
    disk.items = section.items.map(itemToDisk);
    return disk;
  });
  return written;
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
 * Clamps an index into a range.
 *
 * @param index - The index asked for.
 * @param min - The lowest allowed.
 * @param max - The highest allowed.
 * @returns The index, inside the range.
 */
function clampIndex(index: number, min: number, max: number): number {
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
function moveEntry<T>(entries: readonly T[], from: number, to: number): T[] {
  const moved = [...entries];
  const [entry] = moved.splice(from, 1);
  if (entry !== undefined) {
    moved.splice(to, 0, entry);
  }
  return moved;
}

/**
 * Opens the YAML store over a directory, making it and the home page when they are missing.
 *
 * @param settings - Where the files are.
 * @returns The store.
 */
export async function createYamlPageStore(settings: YamlPageStoreSettings): Promise<PageStore> {
  const pagesDir = path.join(settings.dataDir, PAGES_DIR);
  const siteFile = path.join(settings.dataDir, SITE_FILE);
  /** The last problem logged per file, so each is logged once until it changes. */
  const reported = new Map<string, string>();
  let queue: Promise<unknown> = Promise.resolve();
  let tempCounter = 0;

  const pageFile = (slug: string): string => path.join(pagesDir, `${slug}${PAGE_EXTENSION}`);
  const relative = (file: string): string => path.relative(settings.dataDir, file);

  /**
   * Logs a file's problem the first time it is seen, and forgets it once the file reads.
   *
   * @param file - The file.
   * @param problem - What is wrong, or null when it read.
   */
  const report = (file: string, problem: string | null): void => {
    if (problem === null) {
      reported.delete(file);
      return;
    }
    if (reported.get(file) === problem) {
      return;
    }
    reported.set(file, problem);
    console.warn(`[store] skipping ${relative(file)}: ${problem}`);
  };

  /**
   * Runs one write after every write before it.
   *
   * @typeParam T - What the write returns.
   * @param task - The write.
   * @returns What it returned.
   */
  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
  };

  /**
   * Writes a file whole: to a temporary file beside it, then renamed over it.
   *
   * @param file - The file.
   * @param data - What to write, as YAML.
   */
  const writeYaml = async (file: string, data: unknown): Promise<void> => {
    tempCounter += 1;
    const temp = `${file}.${process.pid}.${tempCounter}${TEMP_EXTENSION}`;
    await writeFile(temp, stringify(data, YAML_WRITE_OPTIONS), 'utf-8');
    await rename(temp, file);
  };

  /**
   * Reads one page file.
   *
   * @param slug - The page's slug.
   * @returns The page, the problem with its file, or neither when there is no file.
   */
  const readPage = async (slug: string): Promise<PageRead> => {
    const file = pageFile(slug);
    let text: string;
    try {
      text = await readFile(file, 'utf-8');
    } catch (error) {
      if (isMissingFile(error)) {
        return { page: null, problem: null };
      }
      throw error;
    }
    let raw: unknown;
    try {
      raw = parse(text);
    } catch (error) {
      const problem = yamlProblem(error);
      report(file, problem);
      return { page: null, problem };
    }
    const result = diskPageSchema.safeParse(raw);
    if (result.success === false) {
      const problem = describeIssues(result.error);
      report(file, problem);
      return { page: null, problem };
    }
    report(file, null);
    const { title, icon, items, sections } = result.data;
    const diskSections = sections ?? [{ items: items ?? [] }];
    return { page: { slug, title, icon, sections: sectionsFromDisk(diskSections) }, problem: null };
  };

  /**
   * Lists the slugs that have a page file, readable or not.
   *
   * @returns The slugs.
   */
  const listSlugs = async (): Promise<string[]> => {
    const names = await readdir(pagesDir);
    return names
      .filter((name) => name.endsWith(PAGE_EXTENSION))
      .map((name) => name.slice(0, -PAGE_EXTENSION.length))
      .filter((slug) => SLUG_PATTERN.test(slug));
  };

  /**
   * Reads `site.yaml`.
   *
   * @returns What it holds; empty when the file is missing or unreadable.
   */
  const readSite = async (): Promise<Site> => {
    let text: string;
    try {
      text = await readFile(siteFile, 'utf-8');
    } catch (error) {
      if (isMissingFile(error)) {
        return {};
      }
      throw error;
    }
    try {
      const result = siteSchema.safeParse(parse(text) ?? {});
      if (result.success === false) {
        report(siteFile, describeIssues(result.error));
        return {};
      }
      report(siteFile, null);
      return result.data;
    } catch (error) {
      report(siteFile, yamlProblem(error));
      return {};
    }
  };

  /**
   * Writes the order of every page but home, keeping the rest of `site.yaml`.
   *
   * @param pages - The pages, in list order.
   */
  const writeOrder = async (pages: readonly Page[]): Promise<void> => {
    const site = await readSite();
    const pageOrder = pages.map((page) => page.slug).filter((slug) => slug !== HOME_SLUG);
    await writeYaml(siteFile, { ...site, pageOrder });
  };

  /**
   * Reads every readable page, in list order.
   *
   * @returns The pages.
   */
  const readAll = async (): Promise<Page[]> => {
    const [slugs, site] = await Promise.all([listSlugs(), readSite()]);
    const reads = await Promise.all(slugs.map(readPage));
    const pages = reads.flatMap((read) => (read.page === null ? [] : [read.page]));
    return orderPages(pages, site.pageOrder ?? []);
  };

  /**
   * Loads a page that is about to be read or changed.
   *
   * @param slug - The page's slug.
   * @returns The page.
   * @throws NOT_FOUND when there is no file, or when it cannot be read, saying why.
   */
  const loadPage = async (slug: string): Promise<Page> => {
    const read = await readPage(slug);
    if (read.page !== null) {
      return read.page;
    }
    if (read.problem !== null) {
      throw notFound(
        `The page "${slug}" can't be read: ${relative(pageFile(slug))} ${read.problem}. Fix or delete the file.`,
      );
    }
    throw notFound(`No page has the slug "${slug}".`);
  };

  /**
   * Finds an item's place on its page.
   *
   * @param page - The page.
   * @param id - The item's id.
   * @returns The index of its section, and its index there.
   * @throws NOT_FOUND when the page has no such item.
   */
  const locateItem = (page: Page, id: string): { sectionIndex: number; itemIndex: number } => {
    for (const [sectionIndex, section] of page.sections.entries()) {
      const itemIndex = section.items.findIndex((item) => item.id === id);
      if (itemIndex !== -1) {
        return { sectionIndex, itemIndex };
      }
    }
    throw notFound(`The page "${page.slug}" has no item "${id}".`);
  };

  /**
   * Finds a section's place on its page.
   *
   * @param page - The page.
   * @param id - The section's id.
   * @returns Its index.
   * @throws NOT_FOUND when the page has no such section.
   */
  const locateSection = (page: Page, id: string): number => {
    const index = page.sections.findIndex((section) => section.id === id);
    if (index === -1) {
      throw notFound(`The page "${page.slug}" has no section "${id}".`);
    }
    return index;
  };

  /**
   * Replaces one section of a page.
   *
   * @param page - The page.
   * @param index - The section's index.
   * @param change - Builds the new section from the old.
   * @returns A new page.
   */
  const withSection = (page: Page, index: number, change: (section: Section) => Section): Page => ({
    ...page,
    sections: page.sections.map((section, at) => (at === index ? change(section) : section)),
  });

  /**
   * Writes a page and returns it.
   *
   * @param page - The page.
   * @returns The same page.
   */
  const savePage = async (page: Page): Promise<Page> => {
    await writeYaml(pageFile(page.slug), pageToDisk(page));
    return page;
  };

  /**
   * Refuses a change to the home page that only other pages may have.
   *
   * @param slug - The page's slug.
   * @param action - What was asked, as a verb phrase: "deleted", "moved".
   * @throws BAD_USER_INPUT when the slug is home's.
   */
  const refuseHome = (slug: string, action: string): void => {
    if (slug === HOME_SLUG) {
      throw badInput(`The home page can't be ${action}.`);
    }
  };

  await mkdir(pagesDir, { recursive: true });
  const hasHome = existsSync(pageFile(HOME_SLUG));
  if (hasHome === false) {
    await savePage({ slug: HOME_SLUG, title: 'Home', icon: HOME_ICON, sections: sectionsFromDisk([]) });
  }

  return {
    list: readAll,

    find: async (slug) => {
      const isSlug = SLUG_PATTERN.test(slug);
      if (isSlug === false) {
        return null;
      }
      const read = await readPage(slug);
      if (read.problem !== null) {
        return loadPage(slug);
      }
      return read.page;
    },

    createPage: (newPage) =>
      exclusive(async () => {
        const slugs = await listSlugs();
        if (slugs.length >= maxPages) {
          throw badInput(`There are already ${maxPages} pages, the most there can be. Delete one first.`);
        }
        const taken = new Set(slugs);
        const wanted = newPage.slug;
        if (wanted !== undefined && taken.has(wanted)) {
          throw badInput(
            `The slug "${wanted}" is taken. Pick another, or leave it out to have one made from the title.`,
          );
        }
        const slug = wanted ?? uniqueSlug(slugFrom(newPage.title, FALLBACK_PAGE_SLUG), taken);
        const page: Page = { slug, title: newPage.title, icon: newPage.icon, sections: sectionsFromDisk([]) };
        const pages = await readAll();
        await savePage(page);
        await writeOrder([...pages, page]);
        return page;
      }),

    updatePage: (slug, patch) =>
      exclusive(async () => {
        const page = await loadPage(slug);
        return savePage({ ...page, ...patch });
      }),

    deletePage: (slug) =>
      exclusive(async () => {
        refuseHome(slug, 'deleted');
        const read = await readPage(slug);
        const isAbsent = read.page === null && read.problem === null;
        if (isAbsent) {
          throw notFound(`No page has the slug "${slug}".`);
        }
        await rm(pageFile(slug));
        report(pageFile(slug), null);
        await writeOrder(await readAll());
      }),

    movePage: (slug, toIndex) =>
      exclusive(async () => {
        refuseHome(slug, 'moved');
        await loadPage(slug);
        const pages = await readAll();
        const from = pages.findIndex((page) => page.slug === slug);
        const to = clampIndex(toIndex, 1, pages.length - 1);
        const moved = moveEntry(pages, from, to);
        await writeOrder(moved);
        return moved;
      }),

    addSection: (slug, fields) =>
      exclusive(async () => {
        const page = await loadPage(slug);
        if (page.sections.length >= maxSectionsPerPage) {
          throw badInput(`"${page.title}" already has ${maxSectionsPerPage} sections, the most a page can hold.`);
        }
        const ids = new Set(page.sections.map((section) => section.id));
        const id = uniqueSlug(slugFrom(fields.title ?? '', FALLBACK_SECTION_ID), ids);
        return savePage({ ...page, sections: [...page.sections, { id, ...fields, items: [] }] });
      }),

    updateSection: (slug, id, fields) =>
      exclusive(async () => {
        const page = await loadPage(slug);
        const index = locateSection(page, id);
        return savePage(withSection(page, index, (section) => ({ ...section, ...fields })));
      }),

    removeSection: (slug, id) =>
      exclusive(async () => {
        const page = await loadPage(slug);
        const index = locateSection(page, id);
        if (page.sections.length === 1) {
          throw badInput("A page's last section can't be removed. Remove its items instead.");
        }
        return savePage({ ...page, sections: page.sections.filter((_section, at) => at !== index) });
      }),

    moveSection: (slug, id, toIndex) =>
      exclusive(async () => {
        const page = await loadPage(slug);
        const from = locateSection(page, id);
        const to = clampIndex(toIndex, 0, page.sections.length - 1);
        return savePage({ ...page, sections: moveEntry(page.sections, from, to) });
      }),

    addItem: (slug, sectionId, fields) =>
      exclusive(async () => {
        const page = await loadPage(slug);
        const items = itemsOf(page);
        if (items.length >= maxItemsPerPage) {
          throw badInput(`"${page.title}" already has ${maxItemsPerPage} items, the most a page can hold.`);
        }
        const index = sectionId === null ? 0 : locateSection(page, sectionId);
        const ids = new Set(items.map((item) => item.id));
        const id = uniqueSlug(slugFrom(fields.title, FALLBACK_ITEM_ID), ids);
        return savePage(
          withSection(page, index, (section) => ({ ...section, items: [...section.items, { id, ...fields }] })),
        );
      }),

    updateItem: (slug, id, fields) =>
      exclusive(async () => {
        const page = await loadPage(slug);
        const { sectionIndex, itemIndex } = locateItem(page, id);
        return savePage(
          withSection(page, sectionIndex, (section) => ({
            ...section,
            items: section.items.map((item, at) => (at === itemIndex ? { id, ...fields } : item)),
          })),
        );
      }),

    removeItem: (slug, id) =>
      exclusive(async () => {
        const page = await loadPage(slug);
        const { sectionIndex, itemIndex } = locateItem(page, id);
        return savePage(
          withSection(page, sectionIndex, (section) => ({
            ...section,
            items: section.items.filter((_item, at) => at !== itemIndex),
          })),
        );
      }),

    moveItem: (slug, id, toSectionId, toIndex) =>
      exclusive(async () => {
        const page = await loadPage(slug);
        const { sectionIndex, itemIndex } = locateItem(page, id);
        const targetIndex = toSectionId === null ? sectionIndex : locateSection(page, toSectionId);
        if (targetIndex === sectionIndex) {
          return savePage(
            withSection(page, sectionIndex, (section) => {
              const to = clampIndex(toIndex, 0, section.items.length - 1);
              return { ...section, items: moveEntry(section.items, itemIndex, to) };
            }),
          );
        }
        const moving = page.sections[sectionIndex]?.items[itemIndex];
        if (moving === undefined) {
          throw notFound(`The page "${page.slug}" has no item "${id}".`);
        }
        const without = withSection(page, sectionIndex, (section) => ({
          ...section,
          items: section.items.filter((_item, at) => at !== itemIndex),
        }));
        return savePage(
          withSection(without, targetIndex, (section) => {
            const to = clampIndex(toIndex, 0, section.items.length);
            const items = [...section.items];
            items.splice(to, 0, moving);
            return { ...section, items };
          }),
        );
      }),
  };
}
