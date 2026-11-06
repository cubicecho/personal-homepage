// STUB, to be built by the export feature: GET /export.zip, the data directory's YAML as one zip.
import type { Express } from 'express';

/** The path the zip is served at. */
export const EXPORT_PATH = '/export.zip';

/**
 * Serves the data directory's YAML as a zip.
 *
 * @param _app - The Express app.
 * @param _dataDir - The data directory.
 */
export function mountExport(_app: Express, _dataDir: string): void {}
