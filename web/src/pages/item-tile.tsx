import { Link } from '@tanstack/react-router';
import { Globe } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { iconElement } from '@/core/page-icons';
import { ItemStatusDot } from '@/status/item-status-dot';
import { hostOf } from './form-checks';
import { OPENS_IN } from './item-kinds';
import type { AddressedItem, Page } from './use-pages';

interface ItemTileProps {
  page: Page;
  item: AddressedItem;
  /** The item's ⋯ menu, at the end of the title row, above the tile's link. */
  menuSlot: ReactNode;
}

// The title is the tile's one link, stretched over the whole card by its ::after, so a press anywhere
// opens the app. The status mark and the menu sit above that layer (`relative z-10`), so pressing them
// does their own thing, and Tab reaches the link, then the mark, then the menu.
const TITLE_LINK =
  "min-w-0 flex-1 truncate font-semibold text-base text-foreground outline-none after:absolute after:inset-0 after:rounded-lg after:content-['']";

/** A link item, drawn as a tile that opens it where it says: its name over its icon, address and description. */
export function ItemTile({ page, item, menuSlot }: ItemTileProps) {
  const opensIn = item.opensIn ?? 'NEW_TAB';
  const opens = OPENS_IN[opensIn];
  const fullText = [item.title, item.description, item.url].filter(Boolean).join('\n');
  // Named in one string: a visually hidden part of the text is a box of its own, and the name the
  // browser builds from the two gets a stray space before its comma.
  const name = `${item.title}, ${opens.opensLabel}`;

  return (
    <Card className="relative h-full min-w-0 gap-3 p-4 transition-colors hover:bg-hover has-[a:focus-visible]:bg-hover">
      <div className="flex min-w-0 flex-row items-center gap-2">
        {opensIn === 'APP' ? (
          <Link
            to="/pages/$slug/apps/$itemId"
            params={{ slug: page.slug, itemId: item.id }}
            title={fullText}
            aria-label={name}
            className={TITLE_LINK}
          >
            {item.title}
          </Link>
        ) : (
          <a
            href={item.url}
            target={opensIn === 'NEW_TAB' ? '_blank' : undefined}
            rel="noreferrer"
            title={fullText}
            aria-label={name}
            className={TITLE_LINK}
          >
            {item.title}
          </a>
        )}
        <div className="-my-1 -mr-1.5 relative z-10 flex shrink-0 flex-row items-center gap-0.5">
          <ItemStatusDot pageSlug={page.slug} item={item} />
          {menuSlot}
        </div>
      </div>
      <div className="flex min-w-0 flex-row items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-foreground/5 text-foreground/80 [&_img]:size-6 [&_svg]:size-5">
          {iconElement(item.icon, Globe, item.iconUrl)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 flex-row items-center gap-1 text-foreground/60 text-xs">
            <span className="truncate">{hostOf(item.url)}</span>
            <opens.Glyph className="size-3 shrink-0" aria-hidden />
          </span>
          {item.description === null ? null : (
            <p className="line-clamp-2 text-foreground/70 text-sm">{item.description}</p>
          )}
        </div>
      </div>
    </Card>
  );
}
