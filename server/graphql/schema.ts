import type { GraphQLSchema } from 'graphql';
import { createSchema } from 'graphql-yoga';
import type { Context } from '../core/context.ts';
import { ICON_DEFAULTS, PAGE_LIMIT_DEFAULTS, type PageLimitSettings } from '../core/defaults.ts';
import { badInput, notFound } from '../core/errors.ts';
import type { FrameCheckResult } from '../frames/frame-check.ts';
import type { IconOption } from '../icons/icon-service.ts';
import { HOME_SLUG, type Item, itemsOf, type Page, type Section } from '../pages/page.ts';
import { isWebUrl, parseItemFields, parseNewPage, parsePagePatch, parseSectionFields } from '../pages/page-input.ts';
import type { SearchEngine } from '../site/site-settings.ts';
import type { ItemStatus } from '../status/status-checker.ts';
import { TYPE_DEFS } from './type-defs.ts';

/** An item as resolvers pass it on: it knows its page, which its icon URL needs. */
interface PlacedItem extends Item {
  pageSlug: string;
}

/** A section whose items know their page. */
interface PlacedSection extends Omit<Section, 'items'> {
  items: PlacedItem[];
}

/** Arguments naming a page. */
interface SlugArgs {
  slug: string;
}

/** Arguments naming a section or an item on a page. */
interface OnPageArgs {
  pageSlug: string;
  id: string;
}

/** Arguments of a move. */
interface MoveArgs {
  toIndex: number;
}

/** Arguments carrying an unvalidated input object. */
interface InputArgs {
  input: unknown;
}

/**
 * Loads a page by slug.
 *
 * @param ctx - Request context.
 * @param slug - The page's slug.
 * @returns The page.
 * @throws NOT_FOUND when no page has that slug.
 */
async function loadPage(ctx: Context, slug: string): Promise<Page> {
  const page = await ctx.pages.find(slug);
  if (page === null) {
    throw notFound(`No page has the slug "${slug}".`);
  }
  return page;
}

/**
 * Tags a page's items with its slug.
 *
 * @param page - The page.
 * @returns Its sections, each item knowing its page.
 */
function placeSections(page: Page): PlacedSection[] {
  return page.sections.map((section) => ({
    ...section,
    items: section.items.map((item) => ({ ...item, pageSlug: page.slug })),
  }));
}

const resolvers = {
  Query: {
    /**
     * Resolves `Query.pages`.
     *
     * @param _parent - Unused.
     * @param _args - Unused.
     * @param ctx - Request context.
     * @returns Every page, home first.
     */
    pages: (_parent: unknown, _args: unknown, ctx: Context): Promise<Page[]> => ctx.pages.list(),
    /**
     * Resolves `Query.page`.
     *
     * @param _parent - Unused.
     * @param args - The page's slug.
     * @param ctx - Request context.
     * @returns The page.
     */
    page: (_parent: unknown, args: SlugArgs, ctx: Context): Promise<Page> => loadPage(ctx, args.slug),
    /**
     * Resolves `Query.pageLimits`.
     *
     * @returns The limits every write is checked against.
     */
    pageLimits: (): Readonly<PageLimitSettings> => PAGE_LIMIT_DEFAULTS,
    /**
     * Resolves `Query.itemStatuses`.
     *
     * @param _parent - Unused.
     * @param args - The page's slug.
     * @param ctx - Request context.
     * @returns The status of every checked item on the page.
     */
    itemStatuses: async (_parent: unknown, args: { pageSlug: string }, ctx: Context): Promise<ItemStatus[]> =>
      ctx.status.forPage(await loadPage(ctx, args.pageSlug)),
    /**
     * Resolves `Query.frameCheck`.
     *
     * @param _parent - Unused.
     * @param args - The URL to check.
     * @param ctx - Request context.
     * @returns Whether the site may be framed.
     * @throws BAD_USER_INPUT when the URL is not http(s).
     */
    frameCheck: (_parent: unknown, args: { url: string }, ctx: Context): Promise<FrameCheckResult> => {
      const url = args.url.trim();
      if (isWebUrl(url) === false) {
        throw badInput('Check a full http:// or https:// address.');
      }
      return ctx.frames.check(url);
    },
    /**
     * Resolves `Query.iconSearch`.
     *
     * @param _parent - Unused.
     * @param args - What was typed, and the most results wanted.
     * @param ctx - Request context.
     * @returns The matching icons.
     */
    iconSearch: (
      _parent: unknown,
      args: { query: string; limit?: number | null },
      ctx: Context,
    ): Promise<IconOption[]> => {
      const { maxSearchResults } = ICON_DEFAULTS;
      const limit = Math.min(maxSearchResults, Math.max(1, args.limit ?? maxSearchResults));
      return ctx.icons.search(args.query.trim(), limit);
    },
    /**
     * Resolves `Query.searchEngines`.
     *
     * @param _parent - Unused.
     * @param _args - Unused.
     * @param ctx - Request context.
     * @returns The launcher's web searches.
     */
    searchEngines: (_parent: unknown, _args: unknown, ctx: Context): Promise<SearchEngine[]> =>
      ctx.site.searchEngines(),
  },
  Page: {
    /**
     * Resolves `Page.isHome`.
     *
     * @param page - The page.
     * @returns Whether it is the home page.
     */
    isHome: (page: Page): boolean => page.slug === HOME_SLUG,
    /**
     * Resolves `Page.iconUrl`.
     *
     * @param page - The page.
     * @param _args - Unused.
     * @param ctx - Request context.
     * @returns Where its icon image is, or null.
     */
    iconUrl: (page: Page, _args: unknown, ctx: Context): string | null =>
      ctx.icons.urlFor(page.icon, { pageSlug: page.slug, itemId: null }),
    /**
     * Resolves `Page.sections`.
     *
     * @param page - The page.
     * @returns Its sections, each item knowing its page.
     */
    sections: (page: Page): PlacedSection[] => placeSections(page),
    /**
     * Resolves `Page.items`.
     *
     * @param page - The page.
     * @returns Every item, first section first.
     */
    items: (page: Page): PlacedItem[] => itemsOf(page).map((item) => ({ ...item, pageSlug: page.slug })),
  },
  Item: {
    /**
     * Resolves `Item.iconUrl`.
     *
     * @param item - The item.
     * @param _args - Unused.
     * @param ctx - Request context.
     * @returns Where its icon image is, or null.
     */
    iconUrl: (item: PlacedItem, _args: unknown, ctx: Context): string | null =>
      ctx.icons.urlFor(item.icon, { pageSlug: item.pageSlug, itemId: item.id }),
    /**
     * Resolves `Item.checkEnabled`.
     *
     * @param item - The item.
     * @returns Whether the server checks it.
     */
    checkEnabled: (item: Item): boolean => item.check.enabled,
    /**
     * Resolves `Item.checkUrl`.
     *
     * @param item - The item.
     * @returns The URL checked instead of its own, or null.
     */
    checkUrl: (item: Item): string | null => item.check.url,
  },
  Mutation: {
    /**
     * Resolves `Mutation.createPage`.
     *
     * @param _parent - Unused.
     * @param args - The new page's input.
     * @param ctx - Request context.
     * @returns The new page.
     */
    createPage: (_parent: unknown, args: InputArgs, ctx: Context): Promise<Page> =>
      ctx.pages.createPage(parseNewPage(args.input)),
    /**
     * Resolves `Mutation.updatePage`.
     *
     * @param _parent - Unused.
     * @param args - The page's slug and what to change.
     * @param ctx - Request context.
     * @returns The changed page.
     */
    updatePage: (_parent: unknown, args: SlugArgs & InputArgs, ctx: Context): Promise<Page> =>
      ctx.pages.updatePage(args.slug, parsePagePatch(args.input)),
    /**
     * Resolves `Mutation.deletePage`.
     *
     * @param _parent - Unused.
     * @param args - The page's slug.
     * @param ctx - Request context.
     * @returns The deleted page's slug.
     */
    deletePage: async (_parent: unknown, args: SlugArgs, ctx: Context): Promise<string> => {
      await ctx.pages.deletePage(args.slug);
      return args.slug;
    },
    /**
     * Resolves `Mutation.movePage`.
     *
     * @param _parent - Unused.
     * @param args - The page's slug and where it goes.
     * @param ctx - Request context.
     * @returns Every page, in the new order.
     */
    movePage: (_parent: unknown, args: SlugArgs & MoveArgs, ctx: Context): Promise<Page[]> =>
      ctx.pages.movePage(args.slug, args.toIndex),
    /**
     * Resolves `Mutation.addSection`.
     *
     * @param _parent - Unused.
     * @param args - The page's slug and the section's input.
     * @param ctx - Request context.
     * @returns The page, with the section.
     */
    addSection: (_parent: unknown, args: { pageSlug: string } & InputArgs, ctx: Context): Promise<Page> =>
      ctx.pages.addSection(args.pageSlug, parseSectionFields(args.input)),
    /**
     * Resolves `Mutation.updateSection`.
     *
     * @param _parent - Unused.
     * @param args - The section and its new input.
     * @param ctx - Request context.
     * @returns The page.
     */
    updateSection: (_parent: unknown, args: OnPageArgs & InputArgs, ctx: Context): Promise<Page> =>
      ctx.pages.updateSection(args.pageSlug, args.id, parseSectionFields(args.input)),
    /**
     * Resolves `Mutation.removeSection`.
     *
     * @param _parent - Unused.
     * @param args - The section.
     * @param ctx - Request context.
     * @returns The page, without the section.
     */
    removeSection: (_parent: unknown, args: OnPageArgs, ctx: Context): Promise<Page> =>
      ctx.pages.removeSection(args.pageSlug, args.id),
    /**
     * Resolves `Mutation.moveSection`.
     *
     * @param _parent - Unused.
     * @param args - The section and where it goes.
     * @param ctx - Request context.
     * @returns The page, in the new order.
     */
    moveSection: (_parent: unknown, args: OnPageArgs & MoveArgs, ctx: Context): Promise<Page> =>
      ctx.pages.moveSection(args.pageSlug, args.id, args.toIndex),
    /**
     * Resolves `Mutation.addItem`.
     *
     * @param _parent - Unused.
     * @param args - The page's slug, the section, and the item's input.
     * @param ctx - Request context.
     * @returns The page, with the item.
     */
    addItem: (
      _parent: unknown,
      args: { pageSlug: string; sectionId?: string | null } & InputArgs,
      ctx: Context,
    ): Promise<Page> => ctx.pages.addItem(args.pageSlug, args.sectionId ?? null, parseItemFields(args.input)),
    /**
     * Resolves `Mutation.updateItem`.
     *
     * @param _parent - Unused.
     * @param args - The item and its new input.
     * @param ctx - Request context.
     * @returns The page.
     */
    updateItem: (_parent: unknown, args: OnPageArgs & InputArgs, ctx: Context): Promise<Page> =>
      ctx.pages.updateItem(args.pageSlug, args.id, parseItemFields(args.input)),
    /**
     * Resolves `Mutation.removeItem`.
     *
     * @param _parent - Unused.
     * @param args - The item.
     * @param ctx - Request context.
     * @returns The page, without the item.
     */
    removeItem: (_parent: unknown, args: OnPageArgs, ctx: Context): Promise<Page> =>
      ctx.pages.removeItem(args.pageSlug, args.id),
    /**
     * Resolves `Mutation.moveItem`.
     *
     * @param _parent - Unused.
     * @param args - The item, the section it goes to, and where.
     * @param ctx - Request context.
     * @returns The page, in the new order.
     */
    moveItem: (
      _parent: unknown,
      args: OnPageArgs & MoveArgs & { toSectionId?: string | null },
      ctx: Context,
    ): Promise<Page> => ctx.pages.moveItem(args.pageSlug, args.id, args.toSectionId ?? null, args.toIndex),
  },
};

/** The schema this server serves. */
export const schema: GraphQLSchema = createSchema<Context>({ typeDefs: TYPE_DEFS, resolvers });
