import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DescribeUrlDocument,
  type DescribeUrlQuery,
  DiscoveredAppsDocument,
  type DiscoveredAppsQuery,
  DiscoverySourcesDocument,
  type DiscoverySourcesQuery,
  DismissDiscoveredAppDocument,
  RescanDiscoveryDocument,
} from '@/__generated__/graphql';
import { useCanEdit } from '@/auth/use-access';
import { request } from '@/core/gql';
import { DISCOVERED_KEY, DISCOVERY_SOURCES_KEY } from './keys';

/** An app the server found. */
export type DiscoveredApp = DiscoveredAppsQuery['discoveredApps'][number];
/** How one discovery source is doing. */
export type DiscoverySource = DiscoverySourcesQuery['discoverySources'][number];
/** What an address's page says about the app. */
export type DescribedUrl = DescribeUrlQuery['describeUrl'];

/**
 * The apps the server found. Only asked for by an editor: the list is theirs alone.
 *
 * @param includeDismissed - Whether dismissed apps are listed too.
 * @returns The query.
 */
export function useDiscoveredApps(includeDismissed: boolean) {
  const canEdit = useCanEdit();
  return useQuery({
    queryKey: [...DISCOVERED_KEY, includeDismissed],
    queryFn: async () => (await request(DiscoveredAppsDocument, { includeDismissed })).discoveredApps,
    enabled: canEdit,
    // Found apps change on their own, as the server scans.
    staleTime: 0,
  });
}

/**
 * How each discovery source is doing.
 *
 * @returns The query.
 */
export function useDiscoverySources() {
  const canEdit = useCanEdit();
  return useQuery({
    queryKey: DISCOVERY_SOURCES_KEY,
    queryFn: async () => (await request(DiscoverySourcesDocument)).discoverySources,
    enabled: canEdit,
    staleTime: 0,
  });
}

/**
 * Asks every source again now.
 *
 * @returns The mutation; its result says how many apps were found and how many are new.
 */
export function useRescanDiscovery() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => (await request(RescanDiscoveryDocument)).rescanDiscovery,
    onSuccess: (result) => {
      client.setQueryData(DISCOVERY_SOURCES_KEY, result.sources);
      return client.invalidateQueries({ queryKey: DISCOVERED_KEY });
    },
  });
}

/**
 * Dismisses a discovered app, or brings it back.
 *
 * @returns The mutation, taking the app's id and whether it is dismissed.
 */
export function useDismissDiscoveredApp() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (variables: { id: string; dismissed: boolean }) =>
      (await request(DismissDiscoveredAppDocument, variables)).dismissDiscoveredApp,
    onSuccess: () => client.invalidateQueries({ queryKey: DISCOVERED_KEY }),
  });
}

/**
 * Asks the server what the page at an address says, for "Fill in".
 *
 * @returns The mutation, taking the address. A mutation in the app's terms: it runs when pressed.
 */
export function useDescribeUrl() {
  return useMutation({
    mutationFn: async (url: string) => (await request(DescribeUrlDocument, { url })).describeUrl,
  });
}
