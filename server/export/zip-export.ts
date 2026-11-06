// GET /export.zip: every page and the site settings, written out in the YAML layout of 1.x
// (site.yaml and pages/<slug>.yaml, see pages/yaml-format.ts). It is a backup a person can read, and
// `npm run db:import-yaml -- --data-dir <unzipped> --replace` restores it.
import { promisify } from 'node:util';
import type { Express, Request, Response } from 'express';
import { type AsyncZippable, strToU8, zip } from 'fflate';
import type { PageStore } from '../pages/page.ts';
import { toYamlFiles } from '../pages/yaml-format.ts';
import type { SiteSettings } from '../site/site-settings.ts';

/** The path the zip is served at. */
export const EXPORT_PATH = '/export.zip';
/** Digits in a month or day of the zip's date. */
const DATE_PART_DIGITS = 2;

const zipAsync = promisify(zip);

/** What the export reads. */
export interface ExportSource {
  pages: PageStore;
  site: SiteSettings;
}

/**
 * Collects the files the zip holds.
 *
 * @param source - Where pages and settings are kept.
 * @returns The files, by path inside the zip.
 */
export async function exportFiles(source: ExportSource): Promise<Record<string, Uint8Array>> {
  const files = toYamlFiles(await source.pages.list(), await source.site.storedSearch());
  return Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)]));
}

/**
 * Names the zip after the day it was made.
 *
 * @param date - When it is made.
 * @returns `homepage-YYYY-MM-DD.zip`, in the server's time zone.
 */
export function exportFilename(date: Date): string {
  const pad = (value: number): string => String(value).padStart(DATE_PART_DIGITS, '0');
  return `homepage-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.zip`;
}

/**
 * Serves every page as a zip of YAML.
 *
 * @param app - The Express app.
 * @param source - Where pages and settings are kept.
 * @param [now] - The clock, for the file's name. Default: the real one.
 */
export function mountExport(app: Express, source: ExportSource, now: () => Date = () => new Date()): void {
  app.get(EXPORT_PATH, async (_req: Request, res: Response) => {
    const files: AsyncZippable = await exportFiles(source);
    const archive = await zipAsync(files);
    res
      .type('application/zip')
      .set('cache-control', 'no-store')
      .attachment(exportFilename(now()))
      .send(Buffer.from(archive));
  });
}
