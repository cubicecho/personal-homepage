import type { RequestHandler } from 'express';
import { version } from '../core/config.ts';
import { HttpStatus } from '../core/wire.ts';

/**
 * Builds the `/healthz` handler.
 *
 * @param checkDatabase - Runs a trivial query; rejects when the database doesn't answer.
 * @returns The handler: 200 with `{ ok, version }`, or 503 with `ok: false` when the database doesn't answer.
 */
export function healthHandler(checkDatabase: () => Promise<unknown>): RequestHandler {
  return async (_req, res) => {
    try {
      await checkDatabase();
      res.json({ ok: true, version: version() });
    } catch {
      res.status(HttpStatus.ServiceUnavailable).json({ ok: false, version: version(), error: 'database unreachable' });
    }
  };
}
