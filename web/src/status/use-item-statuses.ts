import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { ItemStatusesDocument, type ItemStatusesQuery } from '@/__generated__/graphql';
import { request } from '@/core/gql';
import { usePages } from '@/pages/use-pages';

/** One item's status, as the server last checked it. */
export type ItemStatus = ItemStatusesQuery['itemStatuses'][number];

/** How often a page's statuses are asked for again while it is open and the tab is showing. */
const REFRESH_MS = 30_000;
/** The slug the home route shows, which has no `$slug` param. */
const HOME_SLUG = 'home';

/**
 * Describes what a page checks, so the statuses are asked for again when an item or its check changes.
 *
 * @param pageSlug - The page.
 * @returns A string that changes whenever a checked item or the address it checks does.
 */
function useCheckSignature(pageSlug: string): string {
  const { data: pages } = usePages();
  const page = pages?.find((known) => known.slug === pageSlug);
  const checked = (page?.items ?? []).filter((item) => item.checkEnabled);
  return checked.map((item) => `${item.id}=${item.checkUrl ?? item.url}`).join(' ');
}

/**
 * The statuses of the checked items on a page, asked for every 30 seconds while the tab is showing,
 * and again when the tab comes back. The server checks; the browser never reaches the services.
 *
 * @param pageSlug - The page.
 * @returns The query: one status per checked item.
 */
export function useItemStatuses(pageSlug: string) {
  const signature = useCheckSignature(pageSlug);
  return useQuery({
    queryKey: ['itemStatuses', pageSlug, signature],
    queryFn: async () => (await request(ItemStatusesDocument, { pageSlug })).itemStatuses,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: REFRESH_MS,
    placeholderData: keepPreviousData,
  });
}

/**
 * One item's status.
 *
 * @param pageSlug - The page the item is on.
 * @param itemId - The item.
 * @returns Its status, or undefined until the first answer, or when it is not checked.
 */
export function useItemStatus(pageSlug: string, itemId: string): ItemStatus | undefined {
  return useItemStatuses(pageSlug).data?.find((status) => status.itemId === itemId);
}

/**
 * The slug of the page the current route shows.
 *
 * @returns `$slug`, or home's on `/`.
 */
export function useCurrentPageSlug(): string {
  const { slug } = useParams({ strict: false });
  return slug ?? HOME_SLUG;
}
