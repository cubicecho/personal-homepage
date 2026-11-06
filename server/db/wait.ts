// Postgres is often still starting when the server boots (after a reboot, in a compose stack), so boot
// waits for a real round-trip with capped backoff, and fails with a sentence only when the time runs out.
// PGlite needs none of this: it is up the moment it is opened.
import { sql } from 'drizzle-orm';
import { DATABASE_DEFAULTS, type DatabaseSettings } from '../core/defaults.ts';
import { MS_PER_SECOND } from '../core/wire.ts';

/** Error codes that mean "not up yet" rather than "misconfigured". `57P03` is Postgres starting up. */
const RETRYABLE = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', '57P03']);

/** Anything that can run a query: the Drizzle client on either driver. */
export interface Queryable {
  execute: (query: ReturnType<typeof sql>) => PromiseLike<unknown>;
}

/**
 * Reads the error code off a caught value.
 *
 * @param value - Anything that was thrown, or an error's `cause`.
 * @returns The code, or an empty string when there is none.
 */
function codeOf(value: unknown): string {
  if (typeof value !== 'object' || value === null) {
    return '';
  }
  if ('code' in value && typeof value.code === 'string') {
    return value.code;
  }
  return '';
}

/**
 * Whether a connection failure is worth retrying.
 *
 * @param error - The caught value. Drivers may put the socket error on `cause`.
 * @returns True when the error or its cause carries a retryable code.
 */
function isRetryable(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  return RETRYABLE.has(codeOf(error)) || RETRYABLE.has(codeOf(cause));
}

/**
 * Waits until `select 1` succeeds.
 *
 * @param db - The Drizzle client.
 * @param [overrides] - Settings that differ from `DATABASE_DEFAULTS`. Boot passes the connect timeout from the environment.
 * @param [log] - Called before each retry.
 * @returns Resolves once connected.
 * @throws A non-retryable error at once (a wrong password, a missing database), or the last error when time runs out.
 */
export async function waitForDatabase(
  db: Queryable,
  overrides: Partial<DatabaseSettings> = {},
  log: (message: string) => void = console.warn,
): Promise<void> {
  const settings = { ...DATABASE_DEFAULTS, ...overrides };
  const deadline = Date.now() + settings.connectTimeoutMs;
  const nextDelay = (delay: number): number => Math.min(delay * settings.retryBackoffFactor, settings.maxRetryDelayMs);
  for (let delay = settings.firstRetryDelayMs; ; delay = nextDelay(delay)) {
    try {
      await db.execute(sql`select 1`);
      return;
    } catch (error) {
      const isOutOfTime = Date.now() + delay > deadline;
      const shouldGiveUp = isRetryable(error) === false || isOutOfTime;
      if (shouldGiveUp) {
        throw error;
      }
      log(`[db] Postgres not reachable yet, retrying in ${delay / MS_PER_SECOND}s`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
