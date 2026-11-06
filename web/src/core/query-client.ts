import { QueryClient } from '@tanstack/react-query';

/**
 * Builds the app's query client.
 *
 * @returns A client that does not retry a failed request and does not refetch when the window regains focus.
 *
 * @remarks
 * Every mutation hands back what it changed and writes it into the cache, so a refetch on focus
 * would only repeat what is already there.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
}
