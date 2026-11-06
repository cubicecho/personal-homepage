import type { ReactNode } from 'react';
import { CardLayout } from '@/components/card-layout';
import { QueryError } from '@/components/query-state';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { iconElement } from '@/core/page-icons';
import type { Item, Page } from '@/pages/use-pages';
import { timeAgo, useMinuteClock, useWidgetData } from './use-widget-data';
import { WidgetResultView } from './widget-result-view';
import { WIDGET_TYPES } from './widget-types';

interface WidgetCardProps {
  page: Page;
  /** The widget item. */
  item: Item;
  /** The item's ⋯ menu, at the end of the card's header. */
  menuSlot: ReactNode;
}

/**
 * A widget item: its data, fetched by the server, in a card as wide as its column span. Its title links to
 * the item's address when it has one. When the latest fetch failed, the last good data stays, marked
 * out of date, with what went wrong under it.
 */
export function WidgetCard({ page, item, menuSlot }: WidgetCardProps) {
  const query = useWidgetData(page.slug, item);
  const now = useMinuteClock();
  const type = WIDGET_TYPES[item.widget?.type ?? 'API'];
  const data = query.data;
  const title =
    item.url === null ? (
      item.title
    ) : (
      <a href={item.url} target="_blank" rel="noreferrer" className="hover:underline focus-visible:underline">
        {item.title}
      </a>
    );

  let content: ReactNode = null;
  if (query.isError) {
    content = <QueryError compact error={query.error} onRetry={query.refetch} what={`“${item.title}”`} />;
  } else if (data?.result != null) {
    content = <WidgetResultView result={data.result} now={now} />;
  } else if (data?.error != null) {
    content = <Alert variant="destructive" title="Couldn't load this widget" description={data.error} />;
  }

  const isStale = data?.stale === true;
  const fetchedAt = data?.fetchedAt ?? null;
  return (
    <CardLayout
      className="h-full"
      title={title}
      // As tall as the 28px controls beside it, so the title and they share a centre line.
      titleClassName="leading-7"
      iconSlot={iconElement(item.icon, type.Glyph, item.iconUrl)}
      description={item.description ?? undefined}
      actionSlot={
        <>
          {isStale ? <Badge variant="warning-soft">Out of date</Badge> : null}
          {menuSlot}
        </>
      }
      loading={query.isPending}
      contentSlot={content}
      footerSlot={
        <div className="flex min-w-0 flex-col gap-0.5 text-foreground/60 text-xs">
          {fetchedAt === null ? null : <span>Updated {timeAgo(fetchedAt, now)}</span>}
          {isStale && data?.error != null ? <span>{data.error}</span> : null}
        </div>
      }
    />
  );
}
