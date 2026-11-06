import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { WidgetDataDocument, type WidgetDataQuery } from '@/__generated__/graphql';
import { request } from '@/core/gql';
import type { Item } from '@/pages/use-pages';

/** A widget's latest answer, as the server serves it. */
export type WidgetData = WidgetDataQuery['widgetData'];
/** What a widget shows. */
export type WidgetResult = NonNullable<WidgetData['result']>;

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

/**
 * A widget item's data. The server fetches it and keeps it for the widget's cache time; this asks again
 * every `refreshSeconds` while the tab is showing (TanStack Query pauses an interval in a hidden tab),
 * and only when the page loads when the widget has no refresh.
 *
 * @param pageSlug - The page the widget is on.
 * @param item - The widget item.
 * @returns The query.
 */
export function useWidgetData(pageSlug: string, item: Item) {
  const refreshSeconds = item.widget?.refreshSeconds ?? null;
  return useQuery({
    // The settings are in the key, so an edited widget is asked for again at once.
    queryKey: ['widgetData', pageSlug, item.id, JSON.stringify(item.widget)],
    queryFn: async () => (await request(WidgetDataDocument, { pageSlug, itemId: item.id })).widgetData,
    refetchInterval: refreshSeconds === null ? false : refreshSeconds * MS_PER_SECOND,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
  });
}

/**
 * The time now, moved on once a minute, so "Updated 3 minutes ago" stays true while the page sits open.
 *
 * @returns Milliseconds since 1970.
 */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MS_PER_MINUTE);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * Says how long ago something happened, in words.
 *
 * @param iso - When, as an ISO 8601 time.
 * @param now - The time now, in milliseconds since 1970.
 * @returns "just now", "5 minutes ago", "2 hours ago", "3 days ago".
 */
export function timeAgo(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / MS_PER_MINUTE));
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < MINUTES_PER_HOUR) {
    return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  }
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) {
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }
  const days = Math.floor(hours / HOURS_PER_DAY);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}
