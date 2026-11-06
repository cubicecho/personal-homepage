import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { FrameCheckDocument } from '@/__generated__/graphql';
import { request } from '@/core/gql';
import { checkUrl } from '@/pages/form-checks';

/** How long the server's answer is reused here; the server keeps its own copy for as long. */
const FRAME_CHECK_STALE_MS = 300_000;

/**
 * Follows a value, but only once it has stopped changing for a while.
 *
 * @typeParam T - The value's type.
 * @param value - The value as it is now.
 * @param delayMs - How long it must hold still, in milliseconds. 0 follows it at once.
 * @returns The value it last held still at.
 */
function useSettledValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (delayMs === 0) {
      setSettled(value);
      return;
    }
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return delayMs === 0 ? value : settled;
}

/**
 * Asks the server whether a site may be shown in a frame.
 *
 * @param url - The address, as typed. Nothing is asked until it is a full http(s) address.
 * @param [delayMs] - How long the address must stop changing before it is asked about, for a field
 * being typed in. Default 0: at once.
 * @returns The query; its data is null until there is an address to check.
 */
export function useFrameCheck(url: string, delayMs = 0) {
  const settledUrl = useSettledValue(url.trim(), delayMs);
  const isCheckable = settledUrl !== '' && checkUrl(settledUrl) === undefined;
  return useQuery({
    queryKey: ['frameCheck', settledUrl],
    queryFn: async () => (await request(FrameCheckDocument, { url: settledUrl })).frameCheck,
    enabled: isCheckable,
    staleTime: FRAME_CHECK_STALE_MS,
    retry: false,
  });
}
