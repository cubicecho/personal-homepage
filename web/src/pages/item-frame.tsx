import type { ReactNode } from 'react';
import { CardLayout } from '@/components/card-layout';
import { Button } from '@/components/ui/button';
import { ExternalLink, PanelsTopLeft } from '@/core/app-icons';
import { iconElement } from '@/core/page-icons';
import { ItemStatusDot } from '@/status/item-status-dot';
import { useCurrentPageSlug } from '@/status/use-item-statuses';
import type { AddressedItem } from './use-pages';

interface ItemFrameProps {
  item: AddressedItem;
  /** The item's ⋯ menu, at the end of the card's header. */
  menuSlot: ReactNode;
}

/** The permissions a framed service gets: it runs, keeps its own session and opens its own tabs. */
export const FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox';

/** A frame item: the service's own page, inline, with a way out to the browser. */
export function ItemFrame({ item, menuSlot }: ItemFrameProps) {
  const pageSlug = useCurrentPageSlug();
  return (
    <CardLayout
      title={item.title}
      iconSlot={iconElement(item.icon, PanelsTopLeft, item.iconUrl)}
      description={item.description ?? undefined}
      actionSlot={
        <>
          <ItemStatusDot pageSlug={pageSlug} item={item} showLabel />
          <Button
            variant="outline"
            size="sm"
            linkSlot={<a href={item.url} target="_blank" rel="noreferrer" />}
            iconSlot={<ExternalLink />}
            content="Open in the browser"
          />
          {menuSlot}
        </>
      }
      contentSlot={
        <iframe
          src={item.url}
          title={item.title}
          sandbox={FRAME_SANDBOX}
          referrerPolicy="no-referrer"
          className="w-full rounded-md border border-foreground/10 bg-background"
          style={{ height: item.frameHeightPx ?? undefined }}
        />
      }
    />
  );
}
