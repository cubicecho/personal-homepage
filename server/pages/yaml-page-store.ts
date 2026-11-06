// The first PageStore: one YAML file per page, under DATA_DIR, meant to be read and edited by hand.
//
//   <dataDir>/site.yaml          pageOrder: [media, tools]    the order of every page but home
//   <dataDir>/pages/<slug>.yaml  one page; the file name is its slug
//
// A page file:
//
//   title: Media
//   icon: film
//   items:
//     - id: jellyfin
//       kind: link
//       title: Jellyfin
//       url: http://nas.local:8096
//       icon: film
//       description: Films and shows
//     - id: grafana
//       kind: frame
//       title: Grafana
//       url: http://nas.local:3001/d/home
//       frameHeightPx: 480
//
// `kind` and `icon` are written in lower case (`link`, `film`) and read in any case, so `LINK` works
// too. When writing, keys that are null are left out. An item written by hand without an `id`, or
// with one that is not a slug, gets one made from its title when read; it is saved on the next write.
//
// Files are read on every call, so a hand edit shows up on the next request without a restart.
// Writes go through one queue, so two mutations never interleave, and each file is written to a
// temporary file beside it and renamed over it, so a reader never sees half a file. A write rewrites
// the whole file, which drops any comments written in it by hand.
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
import { HOME_SLUG, Icon, type Item, ItemKind, type Page, type PageStore } from './page.ts';
import { describeIssues, isWebUrl, SLUG_PATTERN } from './page-input.ts';
import { slugFrom, uniqueSlug } from './slug.ts';

const { maxPages, maxItemsPerPage, minFrameHeightPx, maxFrameHeightPx, defaultFrameHeightPx } = PAGE_LIMIT_DEFAULTS;

const SITE_FILE = 'site.yaml';
const PAGES_DIR = 'pages';
const PAGE_EXTENSION = '.yaml';
const TEMP_EXTENSION = '.tmp';
/** What a page made from a title of only symbols is called. */
const FALLBACK_PAGE_SLUG = 'page';
/** What an item made from a title of only symbols is called. */
const FALLBACK_ITEM_ID = 'item';
/** The page every data directory starts with. */
const HOME_PAGE: Readonly<Page> = Object.freeze({ slug: HOME_SLUG, title: 'Home', icon: Icon.House, items: [] });
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

const ITEM_KINDS = Object.values(ItemKind);
const ICONS = Object.values(Icon);

const diskItemSchema = z.object({
  id: z.string().trim().nullish(),
  kind: diskWord(ITEM_KINDS),
  title: z.string().trim().min(1, 'needs a title'),
  url: z.string().trim().refine(isWebUrl, 'must be an http:// or https:// address'),
  icon: diskWord(ICONS).nullish(),
  description: z.string().trim().nullish(),
  frameHeightPx: z.number().int().positive().nullish(),
});
type DiskItem = z.output<typeof diskItemSchema>;

const diskPageSchema = z.object({
  title: z.string().trim().min(1, 'needs a title'),
  icon: diskWord(ICONS).nullish(),
  items: z.array(diskItemSchema).nullish(),
});

const siteSchema = z.object({
  pageOrder: z.array(z.string()).nullish(),
});

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
 * Turns the items read from a file into the model, giving each a unique id.
 *
 * @param items - The items as read.
 * @returns The items.
 */
function itemsFromDisk(items: DiskItem[]): Item[] {
  const ids = new Set<string>();
  return items.map((item) => {
    const written = item.id ?? '';
    const isUsableId = SLUG_PATTERN.test(written) && ids.has(written) === false;
    const id = isUsableId ? written : uniqueSlug(slugFrom(item.title, FALLBACK_ITEM_ID), ids);
    ids.add(id);
    const description = item.description ?? '';
    const isFrame = item.kind === ItemKind.Frame;
    return {
      id,
      kind: item.kind,
      title: item.title,
      url: item.url,
      icon: item.icon ?? null,
      description: description === '' ? null : description,
      frameHeightPx: isFrame ? frameHeightFrom(item.frameHeightPx) : null,
    };
  });
}

/**
 * Builds what a page file holds, leaving out keys that are null.
 *
 * @param page - The page.
 * @returns The plain object to write as YAML.
 */
function pageToDisk(page: Page): Record<string, unknown> {
  const items = page.items.map((item) => {
    const written: Record<string, unknown> = {
      id: item.id,
      kind: toDiskWord(item.kind),
      title: item.title,
      url: item.url,
    };
    if (item.icon !== null) {
      written.icon = toDiskWord(item.icon);
    }
    if (item.description !== null) {
      written.description = item.description;
    }
    if (item.frameHeightPx !== null) {
      written.frameHeightPx = item.frameHeightPx;
    }
    return written;
  });
  const written: Record<string, unknown> = { title: page.title };
  if (page.icon !== null) {
    written.icon = toDiskWord(page.icon);
  }
  written.items = items;
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
    const { title, icon, items } = result.data;
    return { page: { slug, title, icon: icon ?? null, items: itemsFromDisk(items ?? []) }, problem: null };
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
   * Reads the page order from `site.yaml`.
   *
   * @returns The slugs in order; empty when the file is missing or unreadable.
   */
  const readOrder = async (): Promise<string[]> => {
    let text: string;
    try {
      text = await readFile(siteFile, 'utf-8');
    } catch (error) {
      if (isMissingFile(error)) {
        return [];
      }
      throw error;
    }
    try {
      const result = siteSchema.safeParse(parse(text));
      if (result.success === false) {
        report(siteFile, describeIssues(result.error));
        return [];
      }
      report(siteFile, null);
      return result.data.pageOrder ?? [];
    } catch (error) {
      report(siteFile, yamlProblem(error));
      return [];
    }
  };

  /**
   * Writes the order of every page but home.
   *
   * @param pages - The pages, in list order.
   */
  const writeOrder = (pages: readonly Page[]): Promise<void> =>
    writeYaml(siteFile, { pageOrder: pages.map((page) => page.slug).filter((slug) => slug !== HOME_SLUG) });

  /**
   * Reads every readable page, in list order.
   *
   * @returns The pages.
   */
  const readAll = async (): Promise<Page[]> => {
    const [slugs, order] = await Promise.all([listSlugs(), readOrder()]);
    const reads = await Promise.all(slugs.map(readPage));
    const pages = reads.flatMap((read) => (read.page === null ? [] : [read.page]));
    return orderPages(pages, order);
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
   * @returns The item's index.
   * @throws NOT_FOUND when the page has no such item.
   */
  const indexOfItem = (page: Page, id: string): number => {
    const index = page.items.findIndex((item) => item.id === id);
    if (index === -1) {
      throw notFound(`The page "${page.slug}" has no item "${id}".`);
    }
    return index;
  };

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
    await savePage({ ...HOME_PAGE, items: [] });
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
        const page: Page = { slug, title: newPage.title, icon: newPage.icon, items: [] };
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

    addItem: (slug, fields) =>
      exclusive(async () => {
        const page = await loadPage(slug);
        if (page.items.length >= maxItemsPerPage) {
          throw badInput(`"${page.title}" already has ${maxItemsPerPage} items, the most a page can hold.`);
        }
        const ids = new Set(page.items.map((item) => item.id));
        const id = uniqueSlug(slugFrom(fields.title, FALLBACK_ITEM_ID), ids);
        return savePage({ ...page, items: [...page.items, { id, ...fields }] });
      }),

    updateItem: (slug, id, fields) =>
      exclusive(async () => {
        const page = await loadPage(slug);
        const index = indexOfItem(page, id);
        const items = page.items.map((item, at) => (at === index ? { id, ...fields } : item));
        return savePage({ ...page, items });
      }),

    removeItem: (slug, id) =>
      exclusive(async () => {
        const page = await loadPage(slug);
        const index = indexOfItem(page, id);
        return savePage({ ...page, items: page.items.filter((_item, at) => at !== index) });
      }),

    moveItem: (slug, id, toIndex) =>
      exclusive(async () => {
        const page = await loadPage(slug);
        const from = indexOfItem(page, id);
        const to = clampIndex(toIndex, 0, page.items.length - 1);
        return savePage({ ...page, items: moveEntry(page.items, from, to) });
      }),
  };
}
