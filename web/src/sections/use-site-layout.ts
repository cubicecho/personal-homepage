import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SetLayoutColumnsDocument, SiteLayoutDocument, type SiteLayoutFieldsFragment } from '@/__generated__/graphql';
import { request } from '@/core/gql';

/** The cache key of the site's grid layout. */
const SITE_LAYOUT_KEY = ['siteLayout'] as const;
/** The Columns setting's default, used until the server has answered. Mirrors LAYOUT_DEFAULTS.columns. */
export const DEFAULT_LAYOUT_COLUMNS = 4;

/** How a section's grid is laid out. */
export type SiteLayout = SiteLayoutFieldsFragment;

/**
 * Reads how a section's grid is laid out.
 *
 * @returns The query.
 */
export function useSiteLayout() {
  return useQuery({
    queryKey: SITE_LAYOUT_KEY,
    queryFn: async () => (await request(SiteLayoutDocument)).siteLayout,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * Reads the Columns setting.
 *
 * @returns The columns a section's grid has at full width; the default until the server answers.
 */
export function useLayoutColumns(): number {
  return useSiteLayout().data?.columns ?? DEFAULT_LAYOUT_COLUMNS;
}

/**
 * Changes the Columns setting.
 *
 * @returns The mutation. Its result replaces the cached layout, so every page re-flows at once.
 */
export function useSetLayoutColumns() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (columns: number | null) =>
      (await request(SetLayoutColumnsDocument, { columns })).setLayoutColumns,
    onSuccess: (layout) => client.setQueryData(SITE_LAYOUT_KEY, layout),
  });
}
