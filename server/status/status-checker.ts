// STUB, to be built by the status feature: checks each item from the server and caches the answer.
import type { Page } from '../pages/page.ts';

/** How an item's last check went. */
export const StatusState = { Up: 'UP', Down: 'DOWN', Unknown: 'UNKNOWN' } as const;
export type StatusState = (typeof StatusState)[keyof typeof StatusState];

/** One item's status, from the last check of it. */
export interface ItemStatus {
  itemId: string;
  state: StatusState;
  httpStatus: number | null;
  latencyMs: number | null;
  /** ISO 8601. */
  checkedAt: string | null;
  message: string | null;
}

/** Checks items and remembers the answers for a while. */
export interface StatusChecker {
  /**
   * Gives the status of every checked item on a page, checking those whose answer is stale.
   *
   * @param page - The page.
   * @returns One status per item with checking on, in page order.
   */
  forPage(page: Page): Promise<ItemStatus[]>;
}

/**
 * Builds the status checker.
 *
 * @returns A checker. The stub answers UNKNOWN for every checked item.
 */
export function createStatusChecker(): StatusChecker {
  return {
    forPage: async (page) =>
      page.sections
        .flatMap((section) => section.items)
        .filter((item) => item.check.enabled)
        .map((item) => ({
          itemId: item.id,
          state: StatusState.Unknown,
          httpStatus: null,
          latencyMs: null,
          checkedAt: null,
          message: null,
        })),
  };
}
