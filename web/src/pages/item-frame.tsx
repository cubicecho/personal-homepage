import type { ReactNode } from 'react';
import { CardLayout } from '@/components/card-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ExternalLink, PanelsTopLeft } from '@/core/app-icons';
import { iconElement } from '@/core/page-icons';
import { useIsEditing } from '@/shell/edit-mode';
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

/**
 * The framed page itself, as tall as the item says.
 *
 * @param props - The item.
 * @param props.item - The frame item.
 * @returns The iframe.
 */
function FramedPage({ item }: { item: AddressedItem }) {
  return (
    <iframe
      src={item.url}
      title={item.title}
      sandbox={FRAME_SANDBOX}
      referrerPolicy="no-referrer"
      className="w-full rounded-md border border-foreground/10 bg-background"
      style={{ height: item.frameHeightPx ?? undefined }}
    />
  );
}

/**
 * A frame item. In view mode it is the service's page alone: no title row, its name kept for screen readers,
 * a way out to the browser that shows on hover or focus, and its status only when it is down. In edit mode
 * it is a card with a title row: status, the way out, and its menu.
 *
 * @param props - The item, and its menu for edit mode.
 * @returns The frame card.
 */
export function ItemFrame({ item, menuSlot }: ItemFrameProps) {
  const pageSlug = useCurrentPageSlug();
  const isEditing = useIsEditing();
  if (isEditing === false) {
    return (
      <Card className="group relative h-full gap-0 px-1.5 pt-0 pb-1.5">
        <h3 className="sr-only">{item.title}</h3>
        {/*
          A slim strip over the frame for the corner controls, so they never cover the service's own page. They
          show while the pointer is on the card's padding or this strip, or focus is inside the card: a browser
          reports no hover from inside a cross-origin frame, so the framed page itself can't reveal them.
        */}
        <div className="flex h-7 flex-row items-center justify-end gap-0.5">
          <ItemStatusDot pageSlug={pageSlug} item={item} onlyWhenDown />
          <span className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-60">
            <OpenInBrowserButton url={item.url} />
          </span>
        </div>
        <FramedPage item={item} />
      </Card>
    );
  }
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
      contentSlot={<FramedPage item={item} />}
    />
  );
}
