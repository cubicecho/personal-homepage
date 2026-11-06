import { RATE_LIMIT_DEFAULTS, type RateLimitSettings } from '../core/defaults.ts';
import { rateLimited } from '../core/errors.ts';
import { MS_PER_SECOND, SECONDS_PER_MINUTE } from '../core/wire.ts';

/**
 * Sliding-window counter, in process. Sign-in is reachable by anyone who can reach the port, and
 * better-auth's own limiter only runs on its REST routes, which are not mounted here.
 */
export interface RateLimiter {
  /**
   * Records one attempt against every key, or throws `TOO_MANY_REQUESTS` when any of them has used its
   * budget. A refused attempt is not recorded, so hammering a closed door does not keep it closed.
   */
  hit(...keys: string[]): void;
}

/**
 * Builds a limiter that holds its counts in this process.
 *
 * @param [overrides] - Settings that replace the defaults.
 * @param [now] - The clock, in milliseconds since the epoch. Tests pass their own.
 * @returns The limiter.
 */
export function createRateLimiter(
  overrides: Partial<RateLimitSettings> = {},
  now: () => number = Date.now,
): RateLimiter {
  const { maxAttempts, windowMinutes, sweepAtKeys } = { ...RATE_LIMIT_DEFAULTS, ...overrides };
  const windowMs = windowMinutes * SECONDS_PER_MINUTE * MS_PER_SECOND;
  /** When each key was last let through, oldest first. */
  const attempts = new Map<string, number[]>();

  const recent = (key: string, at: number): number[] =>
    (attempts.get(key) ?? []).filter((attempt) => attempt + windowMs > at);

  // The map would otherwise keep every key ever seen.
  const sweep = (at: number): void => {
    for (const key of attempts.keys()) {
      if (recent(key, at).length === 0) {
        attempts.delete(key);
      }
    }
  };

  return {
    hit(...keys: string[]): void {
      const at = now();
      const live = keys.map((key) => recent(key, at));
      const spent = live.filter((times) => times.length >= maxAttempts);
      if (spent.length > 0) {
        // The oldest attempt is the next to leave the window. Wait for the slowest key.
        const freeAt = Math.max(...spent.map((times) => (times[0] ?? at) + windowMs));
        const retryAfter = Math.ceil((freeAt - at) / MS_PER_SECOND);
        const minutes = Math.ceil(retryAfter / SECONDS_PER_MINUTE);
        throw rateLimited(
          `Too many sign-in attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`,
          retryAfter,
        );
      }
      keys.forEach((key, index) => {
        attempts.set(key, [...(live[index] ?? []), at]);
      });
      if (attempts.size > sweepAtKeys) {
        sweep(at);
      }
    },
  };
}
