// The discovery part of the API: the apps the server found, how each source is doing, rescanning,
// dismissing, and "Fill in" (describing an address someone typed). All of it is for editors only: the
// list maps the network, and describing makes the server fetch an address.
import { requireEdit, visiblePages } from '../auth/access.ts';
import { signIconPath } from '../auth/icon-links.ts';
import type { Context } from '../core/context.ts';
import { badInput } from '../core/errors.ts';
import type { Description } from '../discovery/describe.ts';
import type { ScanReport, SourceStatus } from '../discovery/service.ts';
import type { DiscoveredApp } from '../discovery/store.ts';
import { discoveredFaviconPath } from '../icons/http.ts';
import { type IconRef, itemsOf } from '../pages/page.ts';
import { FAVICON_ICON, isWebUrl } from '../pages/page-input.ts';

/** The discovery types, and the link an item keeps to the app it came from. */
export const DISCOVERY_TYPE_DEFS = /* GraphQL */ `
  "Where an app was found."
  enum DiscoverySource {
    "Announced on the local network over mDNS."
    MDNS
    "A container Dockhand manages."
    DOCKHAND
    "A container on this host's Docker, read from its socket."
    DOCKER
  }

  "An item an app was added as."
  type DiscoveredPlacement {
    pageSlug: ID!
    pageTitle: String!
    itemId: ID!
    itemTitle: String!
  }

  "An app the server found on the network. It is a suggestion: nothing is on a page until someone adds it."
  type DiscoveredApp {
    id: ID!
    source: DiscoverySource!
    name: String!
    "The address people open it at."
    url: String!
    description: String
    "An icon reference, as an item takes."
    icon: String
    "Where the browser loads the icon image from. Null for no icon."
    iconUrl: String
    "When it was first seen, as an ISO 8601 time."
    firstSeenAt: String!
    "When it was last seen, as an ISO 8601 time."
    lastSeenAt: String!
    "Whether someone dismissed it. Dismissed apps are only listed when asked for."
    dismissed: Boolean!
    "The items it was added as, on pages the caller may see."
    addedTo: [DiscoveredPlacement!]!
  }

  "How one source is doing."
  type DiscoverySourceStatus {
    source: DiscoverySource!
    "Whether it is set up and asked."
    isEnabled: Boolean!
    "How to set it up, when it isn't."
    setupHint: String
    "When it was last asked, as an ISO 8601 time."
    lastScanAt: String
    "How many apps it reported last time."
    found: Int!
    "Why the last scan failed, in a sentence."
    error: String
  }

  "What a rescan did."
  type RescanResult {
    "Apps seen across the sources."
    found: Int!
    "Of those, how many had not been seen before."
    added: Int!
    sources: [DiscoverySourceStatus!]!
  }

  "What an address's page says about the app, for filling in the item dialog."
  type DescribedUrl {
    url: String!
    title: String
    description: String
    "An icon reference: an image address from the page or its manifest, or favicon."
    icon: String
    "Where the browser can load that icon now. Null for favicon, which the server fetches once the item exists."
    iconUrl: String
    "Why nothing could be read, in a sentence. Null when the page was read."
    problem: String
  }

  extend type Item {
    "The discovered app it was added from, or null. Only a link: the item is edited like any other."
    discoveredId: ID
  }

  extend input ItemInput {
    "The discovered app it comes from. Left out or null, the item is not linked to one."
    discoveredId: ID
  }

  extend type Query {
    "The apps the server found, by name. Editors only."
    discoveredApps(includeDismissed: Boolean = false): [DiscoveredApp!]!
    "How each discovery source is doing, set up or not. Editors only."
    discoverySources: [DiscoverySourceStatus!]!
    "What the page at an address says about the app: for the item dialog's Fill in. Editors only."
    describeUrl(url: String!): DescribedUrl!
  }

  extend type Mutation {
    "Asks every source again now. Editors only."
    rescanDiscovery: RescanResult!
    "Dismisses a discovered app, or brings it back. Editors only."
    dismissDiscoveredApp(id: ID!, dismissed: Boolean!): DiscoveredApp!
  }
`;

/** A discovered app with the items it was added as. */
interface PlacedApp extends DiscoveredApp {
  addedTo: Placement[];
}

/** One item an app was added as. */
interface Placement {
  pageSlug: string;
  pageTitle: string;
  itemId: string;
  itemTitle: string;
}

/**
 * Works out where an icon is loaded from for a discovered app.
 *
 * @param ctx - Request context.
 * @param id - The app's id.
 * @param icon - Its icon reference.
 * @returns The address, signed when it is one the server serves; null for no icon.
 */
function discoveredIconUrl(ctx: Context, id: string, icon: IconRef | null): string | null {
  if (icon === FAVICON_ICON) {
    return signIconPath(discoveredFaviconPath(id), ctx.iconLinks);
  }
  // A catalogue icon or an image address needs no page or item.
  const url = ctx.icons.urlFor(icon, { pageSlug: '', itemId: null });
  return url === null ? null : signIconPath(url, ctx.iconLinks);
}

/**
 * Finds the items each discovered app was added as, on the pages the caller may see.
 *
 * @param ctx - Request context.
 * @returns The placements, by discovered app id.
 */
async function placementsById(ctx: Context): Promise<Map<string, Placement[]>> {
  const placements = new Map<string, Placement[]>();
  for (const page of visiblePages(await ctx.pages.list(), ctx.access)) {
    for (const item of itemsOf(page)) {
      if (item.discoveredId === null) {
        continue;
      }
      const placement = { pageSlug: page.slug, pageTitle: page.title, itemId: item.id, itemTitle: item.title };
      placements.set(item.discoveredId, [...(placements.get(item.discoveredId) ?? []), placement]);
    }
  }
  return placements;
}

/**
 * Turns a source's status into its GraphQL shape.
 *
 * @param status - The status.
 * @returns It, with the time as ISO 8601.
 */
function statusOut(status: SourceStatus) {
  return { ...status, lastScanAt: status.lastScanAt?.toISOString() ?? null };
}

/**
 * Refuses an item link to a discovered app that doesn't exist.
 *
 * @param ctx - Request context.
 * @param discoveredId - The id the item would link to, or null.
 * @throws BAD_USER_INPUT when there is no such app.
 */
export async function checkDiscoveredLink(ctx: Context, discoveredId: string | null): Promise<void> {
  if (discoveredId === null) {
    return;
  }
  const app = await ctx.discovery.find(discoveredId);
  if (app === null) {
    throw badInput(`discoveredId: No discovered app has the id "${discoveredId}".`);
  }
}

export const discoveryResolvers = {
  DiscoveredApp: {
    /**
     * Resolves `DiscoveredApp.iconUrl`.
     *
     * @param app - The app.
     * @param _args - Unused.
     * @param ctx - Request context.
     * @returns Where its icon image is, or null.
     */
    iconUrl: (app: DiscoveredApp, _args: unknown, ctx: Context): string | null =>
      discoveredIconUrl(ctx, app.id, app.icon),
    /**
     * Resolves `DiscoveredApp.firstSeenAt`.
     *
     * @param app - The app.
     * @returns The time, as ISO 8601.
     */
    firstSeenAt: (app: DiscoveredApp): string => app.firstSeenAt.toISOString(),
    /**
     * Resolves `DiscoveredApp.lastSeenAt`.
     *
     * @param app - The app.
     * @returns The time, as ISO 8601.
     */
    lastSeenAt: (app: DiscoveredApp): string => app.lastSeenAt.toISOString(),
    /**
     * Resolves `DiscoveredApp.addedTo` for an app that came from a mutation, which has none worked out.
     *
     * @param app - The app, with or without its placements.
     * @param _args - Unused.
     * @param ctx - Request context.
     * @returns The items it was added as.
     */
    addedTo: async (app: DiscoveredApp & Partial<PlacedApp>, _args: unknown, ctx: Context): Promise<Placement[]> =>
      app.addedTo ?? (await placementsById(ctx)).get(app.id) ?? [],
  },
  Query: {
    /**
     * Resolves `Query.discoveredApps`.
     *
     * @param _parent - Unused.
     * @param args - Whether dismissed apps are listed.
     * @param ctx - Request context.
     * @returns The apps, each with where it was added.
     */
    discoveredApps: async (
      _parent: unknown,
      args: { includeDismissed?: boolean | null },
      ctx: Context,
    ): Promise<PlacedApp[]> => {
      requireEdit(ctx.access);
      const [apps, placements] = await Promise.all([
        ctx.discovery.list(args.includeDismissed ?? false),
        placementsById(ctx),
      ]);
      return apps.map((app) => ({ ...app, addedTo: placements.get(app.id) ?? [] }));
    },
    /**
     * Resolves `Query.discoverySources`.
     *
     * @param _parent - Unused.
     * @param _args - Unused.
     * @param ctx - Request context.
     * @returns How each source is doing.
     */
    discoverySources: (_parent: unknown, _args: unknown, ctx: Context) => {
      requireEdit(ctx.access);
      return ctx.discovery.statuses().map(statusOut);
    },
    /**
     * Resolves `Query.describeUrl`.
     *
     * @param _parent - Unused.
     * @param args - The address.
     * @param ctx - Request context.
     * @returns What its page says.
     * @throws BAD_USER_INPUT when it isn't an http(s) address.
     */
    describeUrl: async (_parent: unknown, args: { url: string }, ctx: Context) => {
      requireEdit(ctx.access);
      const url = args.url.trim();
      if (isWebUrl(url) === false) {
        throw badInput('url: Use a full address starting with http:// or https://.');
      }
      const described: Description = await ctx.discovery.describe(url);
      const isFavicon = described.icon === FAVICON_ICON;
      const iconUrl = isFavicon ? null : ctx.icons.urlFor(described.icon, { pageSlug: '', itemId: null });
      return { ...described, iconUrl };
    },
  },
  Mutation: {
    /**
     * Resolves `Mutation.rescanDiscovery`.
     *
     * @param _parent - Unused.
     * @param _args - Unused.
     * @param ctx - Request context.
     * @returns What the scan did.
     */
    rescanDiscovery: async (_parent: unknown, _args: unknown, ctx: Context) => {
      requireEdit(ctx.access);
      const report: ScanReport = await ctx.discovery.rescan();
      return { ...report, sources: report.sources.map(statusOut) };
    },
    /**
     * Resolves `Mutation.dismissDiscoveredApp`.
     *
     * @param _parent - Unused.
     * @param args - The app and whether it is dismissed.
     * @param ctx - Request context.
     * @returns The app.
     */
    dismissDiscoveredApp: (_parent: unknown, args: { id: string; dismissed: boolean }, ctx: Context) => {
      requireEdit(ctx.access);
      return ctx.discovery.setDismissed(args.id, args.dismissed);
    },
  },
};
