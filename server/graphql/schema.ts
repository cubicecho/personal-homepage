import type { GraphQLSchema } from 'graphql';
import { createSchema } from 'graphql-yoga';
import { requireEdit, requireView, visiblePage, visiblePages } from '../auth/access.ts';
import { applyBetterAuthExtension } from '../auth/endpoints.ts';
import { signIconPath } from '../auth/icon-links.ts';
import { applyAuthExtension } from '../auth/resolvers.ts';
import type { Context } from '../core/context.ts';
import { ICON_DEFAULTS, PAGE_LIMIT_DEFAULTS, type PageLimitSettings } from '../core/defaults.ts';
import { badInput, notFound } from '../core/errors.ts';
import type { Database } from '../db/client.ts';
import type { FrameCheckResult } from '../frames/frame-check.ts';
import type { IconOption } from '../icons/icon-service.ts';
import { HOME_SLUG, type Item, itemsOf, type Page, type Section } from '../pages/page.ts';
import {
  isWebUrl,
  parseItemFields,
  parseNewPage,
  parsePagePatch,
  parseSectionFields,
  parseWidget,
} from '../pages/page-input.ts';
import { WidgetType } from '../pages/widget.ts';
import type { SearchEngine } from '../site/site-settings.ts';
import { applySsoExtension } from '../sso/resolvers.ts';
import type { ItemStatus } from '../status/status-checker.ts';
import type { WidgetData, WidgetPreview, WidgetResult } from '../widgets/widget-result.ts';
import { checkDiscoveredLink, DISCOVERY_TYPE_DEFS, discoveryResolvers } from './discovery.ts';
import { TYPE_DEFS } from './type-defs.ts';

/** The GraphQL type of each widget type's result. */
const RESULT_TYPE_NAMES: Readonly<Record<WidgetType, string>> = Object.freeze({
  [WidgetType.Api]: 'ApiWidgetResult',
  [WidgetType.Rss]: 'RssWidgetResult',
  [WidgetType.Weather]: 'WeatherWidgetResult',
});

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
 * Loads a page by slug, as the caller may see it.
 *
 * @param ctx - Request context.
 * @param slug - The page's slug.
 * @returns The page, with only the sections and items the caller may see.
 * @throws UNAUTHENTICATED when the caller may not see the homepage; NOT_FOUND when no page has that slug,
 * or the caller may not see it.
 */
async function loadPage(ctx: Context, slug: string): Promise<Page> {
  requireView(ctx.access);
  const page = await ctx.pages.find(slug);
  const visible = page === null ? null : visiblePage(page, ctx.access);
  if (visible === null) {
    throw notFound(`No page has the slug "${slug}".`);
  }
  return visible;
}

/** A resolver that changes something: it is given the context third, as every resolver is. */
// biome-ignore lint/suspicious/noExplicitAny: the wrapped resolvers' parents and arguments differ.
type Resolver = (parent: any, args: any, ctx: Context) => unknown;

/**
 * Makes every resolver of a set refuse a caller who may not edit, before it runs.
 *
 * @typeParam T - The resolvers, by field name.
 * @param fields - The resolvers.
 * @returns The same resolvers, each checking `requireEdit` first.
 */
function editorsOnly<T extends Record<string, Resolver>>(fields: T): T {
  const guarded = Object.entries(fields).map(([name, resolve]) => [
    name,
    (parent: unknown, args: unknown, ctx: Context) => {
      requireEdit(ctx.access);
      return resolve(parent, args, ctx);
    },
  ]);
  return Object.fromEntries(guarded) as T;
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
    pages: async (_parent: unknown, _args: unknown, ctx: Context): Promise<Page[]> => {
      requireView(ctx.access);
      return visiblePages(await ctx.pages.list(), ctx.access);
    },
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
      requireView(ctx.access);
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
      requireEdit(ctx.access);
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
    searchEngines: (_parent: unknown, _args: unknown, ctx: Context): Promise<SearchEngine[]> => {
      requireView(ctx.access);
      return ctx.site.searchEngines();
    },
    /**
     * Resolves `Query.widgetData`.
     *
     * @param _parent - Unused.
     * @param args - The page and the widget item.
     * @param ctx - Request context.
     * @returns The widget's latest data.
     * @throws NOT_FOUND when the page has no such item, BAD_USER_INPUT when the item isn't a widget.
     */
    widgetData: async (
      _parent: unknown,
      args: { pageSlug: string; itemId: string },
      ctx: Context,
    ): Promise<WidgetData> => {
      const page = await loadPage(ctx, args.pageSlug);
      const item = itemsOf(page).find((candidate) => candidate.id === args.itemId);
      if (item === undefined) {
        throw notFound(`The page "${args.pageSlug}" has no item "${args.itemId}".`);
      }
      if (item.widget === null) {
        throw badInput(`"${item.title}" is not a widget.`);
      }
      return ctx.widgets.dataFor(page.slug, item);
    },
    /**
     * Resolves `Query.widgetPreview`.
     *
     * @param _parent - Unused.
     * @param args - The widget as it would be saved.
     * @param ctx - Request context.
     * @returns Its result or failure, and an API widget's raw answer.
     * @throws BAD_USER_INPUT when a setting is out of bounds.
     */
    widgetPreview: (_parent: unknown, args: InputArgs, ctx: Context): Promise<WidgetPreview> => {
      requireEdit(ctx.access);
      return ctx.widgets.preview(parseWidget(args.input));
    },
  },
  WidgetResult: {
    /**
     * Names the GraphQL type of a widget's result.
     *
     * @param result - The result.
     * @returns `ApiWidgetResult`, `RssWidgetResult` or `WeatherWidgetResult`.
     */
    __resolveType: (result: WidgetResult): string => RESULT_TYPE_NAMES[result.type],
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
    iconUrl: (item: PlacedItem, _args: unknown, ctx: Context): string | null => {
      const url = ctx.icons.urlFor(item.icon, { pageSlug: item.pageSlug, itemId: item.id });
      // An <img> sends no bearer token, so a favicon the server serves carries proof it was handed out.
      return url === null ? null : signIconPath(url, ctx.iconLinks);
    },
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
  Mutation: editorsOnly({
    /**
     * Resolves `Mutation.setSearchEngines`.
     *
     * @param _parent - Unused.
     * @param args - The new settings, or null for the defaults.
     * @param ctx - Request context.
     * @returns The engines now in use.
     */
    setSearchEngines: (_parent: unknown, args: { input?: unknown }, ctx: Context): Promise<SearchEngine[]> =>
      ctx.site.setSearch(args.input ?? null),
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
    addItem: async (
      _parent: unknown,
      args: { pageSlug: string; sectionId?: string | null } & InputArgs,
      ctx: Context,
    ): Promise<Page> => {
      const fields = parseItemFields(args.input);
      await checkDiscoveredLink(ctx, fields.discoveredId);
      return ctx.pages.addItem(args.pageSlug, args.sectionId ?? null, fields);
    },
    /**
     * Resolves `Mutation.updateItem`.
     *
     * @param _parent - Unused.
     * @param args - The item and its new input.
     * @param ctx - Request context.
     * @returns The page.
     */
    updateItem: async (_parent: unknown, args: OnPageArgs & InputArgs, ctx: Context): Promise<Page> => {
      const fields = parseItemFields(args.input);
      await checkDiscoveredLink(ctx, fields.discoveredId);
      return ctx.pages.updateItem(args.pageSlug, args.id, fields);
    },
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
    /**
     * Resolves `Mutation.moveItemToPage`.
     *
     * @param _parent - Unused.
     * @param args - The item, the page and section it goes to, and where.
     * @param ctx - Request context.
     * @returns Both pages, and the item's id where it landed.
     */
    moveItemToPage: (
      _parent: unknown,
      args: OnPageArgs & { toPageSlug: string; toSectionId?: string | null; toIndex?: number | null },
      ctx: Context,
    ): Promise<{ from: Page; to: Page; itemId: string }> =>
      ctx.pages.moveItemToPage(args.pageSlug, args.id, args.toPageSlug, args.toSectionId ?? null, args.toIndex ?? null),
  }),
};

/**
 * Builds the schema this server serves: pages, and signing in.
 *
 * @param db - The database. better-auth's fields are described from an instance built over it; nothing is
 * queried while building.
 * @returns The schema.
 */
export function buildSchema(db: Database): GraphQLSchema {
  const pagesSchema = createSchema<Context>({
    typeDefs: [TYPE_DEFS, DISCOVERY_TYPE_DEFS],
    resolvers: [resolvers, discoveryResolvers],
  });
  return applySsoExtension(applyAuthExtension(applyBetterAuthExtension(pagesSchema, db)));
}
