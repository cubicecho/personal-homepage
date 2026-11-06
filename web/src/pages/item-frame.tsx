import type { ReactNode } from 'react';
import { CardLayout } from '@/components/card-layout';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ExternalLink, PanelsTopLeft } from '@/core/app-icons';
import { iconElement } from '@/core/page-icons';
import { ItemStatusDot } from '@/status/item-status-dot';
import { useCurrentPageSlug } from '@/status/use-item-statuses';
import type { AddressedItem } from './use-pages';

interface ItemFrameProps {
  item: AddressedItem;
  /** The item's ⋯ menu, at the end of the card's title row. */
  menuSlot: ReactNode;
}

/** The permissions a framed service gets: it runs, keeps its own session and opens its own tabs. */
export const FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox';

const OPEN_LABEL = 'Open in the browser';

/**
 * Opens an address in a new tab, as a quiet icon button named and tooltipped by what it does.
 *
 * @param props - The address.
 * @param props.url - Where it goes.
 * @returns The button.
 */
export function OpenInBrowserButton({ url }: { url: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={OPEN_LABEL}
          linkSlot={<a href={url} target="_blank" rel="noreferrer" />}
          iconSlot={<ExternalLink />}
        />
      </TooltipTrigger>
      <TooltipContent>{OPEN_LABEL}</TooltipContent>
    </Tooltip>
  );
}

/** A frame item: the service's own page, inline, under a title row with its status and a way out to the browser. */
export function ItemFrame({ item, menuSlot }: ItemFrameProps) {
  const pageSlug = useCurrentPageSlug();
  return (
    <CardLayout
      className="h-full"
      title={item.title}
      // As tall as the 28px controls beside it, so the title and they share a centre line.
      titleClassName="leading-7"
      iconSlot={iconElement(item.icon, PanelsTopLeft, item.iconUrl)}
      description={item.description ?? undefined}
      actionSlot={
        <>
          <ItemStatusDot pageSlug={pageSlug} item={item} showLabel />
          <OpenInBrowserButton url={item.url} />
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
