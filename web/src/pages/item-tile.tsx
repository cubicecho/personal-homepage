import { Link } from '@tanstack/react-router';
import { Globe } from 'lucide-react';
import type { ReactNode } from 'react';
import { iconElement } from '@/core/page-icons';
import { ItemStatusDot } from '@/status/item-status-dot';
import { hostOf } from './form-checks';
import { OPENS_IN } from './item-kinds';
import type { Item, Page } from './use-pages';

interface ItemTileProps {
  page: Page;
  item: Item;
  /** The item's ⋯ menu, drawn beside the tile's link and outside it. */
  menuSlot: ReactNode;
}

const TILE_LINK =
  'flex min-w-0 flex-1 items-start gap-3 rounded-lg p-4 text-foreground outline-none hover:bg-hover focus-visible:bg-hover';

/** A link item, drawn as a tile that opens it where it says. */
export function ItemTile({ page, item, menuSlot }: ItemTileProps) {
  const opensIn = item.opensIn ?? 'NEW_TAB';
  const opens = OPENS_IN[opensIn];
  const body = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-foreground/10 [&_svg]:size-5">
        {iconElement(item.icon, Globe, item.iconUrl)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium text-sm">{item.title}</span>
          <opens.Glyph className="size-3.5 shrink-0 text-foreground/60" aria-hidden />
          <span className="sr-only">, {opens.opensLabel}</span>
        </span>
        {item.description === null ? null : (
          <span className="line-clamp-2 text-foreground/60 text-sm">{item.description}</span>
        )}
        <span className="truncate text-foreground/60 text-xs">{hostOf(item.url)}</span>
      </span>
    </>
  );

  const fullText = [item.title, item.description, item.url].filter(Boolean).join('\n');
  return (
    <li className="flex min-w-0 items-start rounded-lg border border-foreground/10 bg-secondary">
      {opensIn === 'APP' ? (
        <Link
          to="/pages/$slug/apps/$itemId"
          params={{ slug: page.slug, itemId: item.id }}
          title={fullText}
          className={TILE_LINK}
        >
          {body}
        </Link>
      ) : (
        <a
          href={item.url}
          target={opensIn === 'NEW_TAB' ? '_blank' : undefined}
          rel="noreferrer"
          title={fullText}
          className={TILE_LINK}
        >
          {body}
        </a>
      )}
      <div className="flex shrink-0 items-center gap-1 p-2">
        <ItemStatusDot pageSlug={page.slug} item={item} />
        {menuSlot}
      </div>
    </li>
  );
}
