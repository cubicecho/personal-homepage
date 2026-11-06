import type { GraphQLSchema } from 'graphql';
import { createSchema } from 'graphql-yoga';
import type { Context } from '../core/context.ts';
import { PAGE_LIMIT_DEFAULTS, type PageLimitSettings } from '../core/defaults.ts';
import { notFound } from '../core/errors.ts';
import { HOME_SLUG, type Page } from '../pages/page.ts';
import { parseItemFields, parseNewPage, parsePagePatch } from '../pages/page-input.ts';
import { TYPE_DEFS } from './type-defs.ts';

/** Arguments naming a page. */
interface SlugArgs {
  slug: string;
}

/** Arguments naming an item on a page. */
interface ItemArgs {
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
  },
  Page: {
    /**
     * Resolves `Page.isHome`.
     *
     * @param page - The page.
     * @returns Whether it is the home page.
     */
    isHome: (page: Page): boolean => page.slug === HOME_SLUG,
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
     * Resolves `Mutation.addItem`.
     *
     * @param _parent - Unused.
     * @param args - The page's slug and the item's input.
     * @param ctx - Request context.
     * @returns The page, with the item.
     */
    addItem: (_parent: unknown, args: Pick<ItemArgs, 'pageSlug'> & InputArgs, ctx: Context): Promise<Page> =>
      ctx.pages.addItem(args.pageSlug, parseItemFields(args.input)),
    /**
     * Resolves `Mutation.updateItem`.
     *
     * @param _parent - Unused.
     * @param args - The item and its new input.
     * @param ctx - Request context.
     * @returns The page.
     */
    updateItem: (_parent: unknown, args: ItemArgs & InputArgs, ctx: Context): Promise<Page> =>
      ctx.pages.updateItem(args.pageSlug, args.id, parseItemFields(args.input)),
    /**
     * Resolves `Mutation.removeItem`.
     *
     * @param _parent - Unused.
     * @param args - The item.
     * @param ctx - Request context.
     * @returns The page, without the item.
     */
    removeItem: (_parent: unknown, args: ItemArgs, ctx: Context): Promise<Page> =>
      ctx.pages.removeItem(args.pageSlug, args.id),
    /**
     * Resolves `Mutation.moveItem`.
     *
     * @param _parent - Unused.
     * @param args - The item and where it goes.
     * @param ctx - Request context.
     * @returns The page, in the new order.
     */
    moveItem: (_parent: unknown, args: ItemArgs & MoveArgs, ctx: Context): Promise<Page> =>
      ctx.pages.moveItem(args.pageSlug, args.id, args.toIndex),
  },
};

/** The schema this server serves. */
export const schema: GraphQLSchema = createSchema<Context>({ typeDefs: TYPE_DEFS, resolvers });
