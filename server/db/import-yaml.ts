// Moves pages kept as YAML (releases 1.x, or an unzipped export) into the database, in one transaction.
// On boot it happens by itself: when the database holds only a fresh home page and DATA_DIR has page
// files, they are imported and the files renamed out of the way, so they are never imported twice.
import { rename } from 'node:fs/promises';
import path from 'node:path';
import { exclusive, insertPage, readAllPages } from '../pages/db-page-store.ts';
import { HOME_SLUG, itemsOf, type Page } from '../pages/page.ts';
import {
  emptySection,
  listYamlPages,
  PAGES_DIR,
  readYamlData,
  SITE_FILE,
  type SkippedFile,
  type YamlData,
} from '../pages/yaml-format.ts';
import { resolveSearch } from '../site/site-settings.ts';
import type { Database } from './client.ts';
import { pages, SITE_SETTINGS_ID, siteSettings } from './schema.ts';

/** What an import did. */
export interface ImportResult {
  /** Pages written, home included. */
  imported: number;
  /** Files, or settings, left out, and why. */
  skipped: SkippedFile[];
}

/** How an import treats pages already in the database. */
export interface ImportOptions {
  /** Delete every page first. Without it, an import into a database that holds pages is refused. */
  replace: boolean;
}

/**
 * Checks whether the database holds nothing worth keeping: only a home page with no items on it.
 *
 * @param db - The database.
 * @returns True when an import would lose nothing.
 */
export async function isFreshDatabase(db: Database): Promise<boolean> {
  const all = await readAllPages(db);
  const [home] = all;
  const isOnlyHome = all.length === 1 && home !== undefined && home.slug === HOME_SLUG;
  return isOnlyHome && itemsOf(home).length === 0;
}

/**
 * Writes pages and search settings read from YAML into the database, replacing every page.
 *
 * @param db - The database, migrated.
 * @param data - What was read, in list order.
 * @param options - Whether pages already there may be replaced.
 * @returns How many pages were written, and what was left out.
 * @throws When the database holds pages and `replace` is off.
 */
export async function importYamlData(db: Database, data: YamlData, options: ImportOptions): Promise<ImportResult> {
  const skipped = [...data.skipped];
  const isFresh = await isFreshDatabase(db);
  if (isFresh === false && options.replace === false) {
    throw new Error('The database already holds pages. Pass --replace to delete them and import these instead.');
  }
  const hasHome = data.pages.some((page) => page.slug === HOME_SLUG);
  const freshHome: Page = { slug: HOME_SLUG, title: 'Home', icon: 'house', sections: [emptySection()] };
  const toWrite = hasHome ? data.pages : [freshHome, ...data.pages];

  const hasSearch = data.search !== undefined && data.search !== null;
  const resolved = hasSearch ? resolveSearch(data.search) : null;
  const isSearchUsable = resolved !== null && 'engines' in resolved;
  if (resolved !== null && 'problem' in resolved) {
    skipped.push({ file: `${SITE_FILE} (search)`, problem: resolved.problem });
  }

  await exclusive(db, async (tx) => {
    await tx.delete(pages);
    for (const [position, page] of toWrite.entries()) {
      await insertPage(tx, page, position);
    }
    if (isSearchUsable) {
      await tx
        .insert(siteSettings)
        .values({ id: SITE_SETTINGS_ID, search: data.search })
        .onConflictDoUpdate({ target: siteSettings.id, set: { search: data.search } });
    }
  });
  return { imported: toWrite.length, skipped };
}

/**
 * Names a folder or file after the moment it was set aside.
 *
 * @param name - The name.
 * @param at - When.
 * @returns `pages.imported-2026-11-06T03-25-00-000Z`, or `site.imported-….yaml` for a file.
 */
export function importedName(name: string, at: Date): string {
  const stamp = at.toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const { name: base, ext } = path.parse(name);
  return `${base}.imported-${stamp}${ext}`;
}

/**
 * Imports the YAML in DATA_DIR on first boot, then renames it so it is never imported again.
 *
 * @param db - The database, migrated, with its home page.
 * @param dataDir - The data directory.
 * @param [log] - Where lines go. Default: the console.
 * @param [now] - The clock, for the renamed names.
 * @returns How many pages were imported; 0 when there was nothing to do.
 */
export async function importYamlOnBoot(
  db: Database,
  dataDir: string,
  log: Pick<Console, 'log' | 'warn'> = console,
  now: () => Date = () => new Date(),
): Promise<number> {
  const slugs = await listYamlPages(dataDir);
  if (slugs.length === 0) {
    return 0;
  }
  const isFresh = await isFreshDatabase(db);
  if (isFresh === false) {
    log.warn(
      `[db] ${path.join(dataDir, PAGES_DIR)} holds YAML pages, but the database already has pages, so they were not imported. Run npm run db:import-yaml -- --replace to import them anyway.`,
    );
    return 0;
  }
  const result = await importYamlData(db, await readYamlData(dataDir), { replace: false });
  for (const { file, problem } of result.skipped) {
    log.warn(`[db] left out ${file}: ${problem}`);
  }
  const at = now();
  await rename(path.join(dataDir, PAGES_DIR), path.join(dataDir, importedName(PAGES_DIR, at)));
  await rename(path.join(dataDir, SITE_FILE), path.join(dataDir, importedName(SITE_FILE, at))).catch(() => {});
  log.log(`[db] imported ${result.imported} pages from YAML; the files were renamed to *.imported-*`);
  return result.imported;
}
