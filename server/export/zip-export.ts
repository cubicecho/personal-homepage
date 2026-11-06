// GET /export.zip: the data directory's YAML as one zip, laid out as the directory is, so unzipping it
// into an empty DATA_DIR restores every page. Only site.yaml and pages/*.yaml go in: no temporary
// files, caches, or anything else that happens to be there.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Express, Request, Response } from 'express';
import { type AsyncZippable, zip } from 'fflate';

/** The path the zip is served at. */
export const EXPORT_PATH = '/export.zip';

const SITE_FILE = 'site.yaml';
const PAGES_DIR = 'pages';
const PAGE_EXTENSION = '.yaml';
const MISSING_FILE = 'ENOENT';
/** Digits in a month or day of the zip's date. */
const DATE_PART_DIGITS = 2;

const zipAsync = promisify(zip);

/**
 * Reads a file, or nothing when it is not there.
 *
 * @param file - The file.
 * @returns Its bytes, or null.
 */
async function readIfThere(file: string): Promise<Uint8Array | null> {
  try {
    return await readFile(file);
  } catch (error) {
    const isMissing = error instanceof Error && 'code' in error && error.code === MISSING_FILE;
    if (isMissing) {
      return null;
    }
    throw error;
  }
}

/**
 * Collects the files the zip holds, under the paths they have in the data directory.
 *
 * @param dataDir - The data directory.
 * @returns The files, by path inside the zip.
 */
export async function exportFiles(dataDir: string): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};
  const site = await readIfThere(path.join(dataDir, SITE_FILE));
  if (site !== null) {
    files[SITE_FILE] = site;
  }
  const entries = await readdir(path.join(dataDir, PAGES_DIR), { withFileTypes: true }).catch(() => []);
  const pageNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(PAGE_EXTENSION))
    .map((entry) => entry.name)
    .sort();
  for (const name of pageNames) {
    const page = await readIfThere(path.join(dataDir, PAGES_DIR, name));
    if (page !== null) {
      files[`${PAGES_DIR}/${name}`] = page;
    }
  }
  return files;
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
 * Serves the data directory's YAML as a zip.
 *
 * @param app - The Express app.
 * @param dataDir - The data directory.
 * @param [now] - The clock, for the file's name. Default: the real one.
 */
export function mountExport(app: Express, dataDir: string, now: () => Date = () => new Date()): void {
  app.get(EXPORT_PATH, async (_req: Request, res: Response) => {
    const files: AsyncZippable = await exportFiles(dataDir);
    const archive = await zipAsync(files);
    res
      .type('application/zip')
      .set('cache-control', 'no-store')
      .attachment(exportFilename(now()))
      .send(Buffer.from(archive));
  });
}
