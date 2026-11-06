// Where found apps are kept: one `discovered_apps` row each, matched on the source's own key, so a
// sighting updates the row instead of adding another. Rows are never deleted by discovery: one that stops
// being seen keeps its last sighting, and dismissing it only hides it.
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { notFound } from '../core/errors.ts';
import type { Database } from '../db/client.ts';
import { type DiscoveredAppRow, discoveredApps } from '../db/schema.ts';
import type { IconRef } from '../pages/page.ts';
import { DiscoverySourceName } from './candidate.ts';

/** An app the server found. */
export interface DiscoveredApp {
  id: string;
  source: DiscoverySourceName;
  sourceKey: string;
  name: string;
  url: string;
  description: string | null;
  icon: IconRef | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  dismissed: boolean;
}

/** One sighting of an app, as the service describes it. */
export interface Sighting {
  source: DiscoverySourceName;
  sourceKey: string;
  name: string;
  url: string;
  description: string | null;
  icon: IconRef | null;
  metadata: Record<string, unknown>;
}

/** Keeps found apps. */
export interface DiscoveryStore {
  /**
   * Records a sighting: a new row, or the existing one updated.
   *
   * @param sighting - What was seen.
   * @param seenAt - When.
   * @returns The app, and whether it is new.
   */
  record(sighting: Sighting, seenAt: Date): Promise<{ app: DiscoveredApp; isNew: boolean }>;
  /**
   * Lists the found apps, by name.
   *
   * @param includeDismissed - Whether dismissed ones are listed too.
   * @returns The apps.
   */
  list(includeDismissed: boolean): Promise<DiscoveredApp[]>;
  /**
   * Finds one app.
   *
   * @param id - Its id.
   * @returns The app, or null when there is none.
   */
  find(id: string): Promise<DiscoveredApp | null>;
  /**
   * Dismisses an app, or brings it back.
   *
   * @param id - Its id.
   * @param dismissed - Whether it is dismissed.
   * @returns The app.
   * @throws NOT_FOUND when there is none.
   */
  setDismissed(id: string, dismissed: boolean): Promise<DiscoveredApp>;
}

const SOURCES = Object.values(DiscoverySourceName);

/**
 * Turns a row into the model.
 *
 * @param row - The row.
 * @returns The app.
 */
function appFromRow(row: DiscoveredAppRow): DiscoveredApp {
  const source = SOURCES.find((name) => name === row.source) ?? DiscoverySourceName.Mdns;
  return {
    id: row.id,
    source,
    sourceKey: row.sourceKey,
    name: row.name,
    url: row.url,
    description: row.description,
    icon: row.icon,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    dismissed: row.dismissed,
  };
}

/**
 * Opens the store over the database.
 *
 * @param db - The database, migrated.
 * @returns The store.
 */
export function createDiscoveryStore(db: Database): DiscoveryStore {
  return {
    record: async (sighting, seenAt) => {
      const seen = {
        source: sighting.source,
        name: sighting.name,
        url: sighting.url,
        description: sighting.description,
        icon: sighting.icon,
        metadata: sighting.metadata,
        lastSeenAt: seenAt,
      };
      const [row] = await db
        .insert(discoveredApps)
        .values({ id: randomUUID(), sourceKey: sighting.sourceKey, firstSeenAt: seenAt, ...seen })
        .onConflictDoUpdate({ target: discoveredApps.sourceKey, set: seen })
        .returning();
      if (row === undefined) {
        throw new Error(`Recording ${sighting.sourceKey} returned no row.`);
      }
      return { app: appFromRow(row), isNew: row.firstSeenAt.getTime() === seenAt.getTime() };
    },
    list: async (includeDismissed) => {
      const query = db.select().from(discoveredApps);
      const rows = await (includeDismissed ? query : query.where(eq(discoveredApps.dismissed, false))).orderBy(
        asc(discoveredApps.name),
      );
      return rows.map(appFromRow);
    },
    find: async (id) => {
      const [row] = await db.select().from(discoveredApps).where(eq(discoveredApps.id, id)).limit(1);
      return row === undefined ? null : appFromRow(row);
    },
    setDismissed: async (id, dismissed) => {
      const [row] = await db.update(discoveredApps).set({ dismissed }).where(eq(discoveredApps.id, id)).returning();
      if (row === undefined) {
        throw notFound(`No discovered app has the id "${id}".`);
      }
      return appFromRow(row);
    },
  };
}
