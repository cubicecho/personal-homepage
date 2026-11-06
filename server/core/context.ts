import type { PageStore } from '../pages/page.ts';

/** What every resolver is given. */
export interface Context {
  /** Where pages are kept. */
  pages: PageStore;
}
