import type { ItemKind, OpensIn } from '@/__generated__/graphql';
import { AppWindow, ArrowRight, ExternalLink, Gauge, PanelsTopLeft } from '@/core/app-icons';

/** How each kind of item is named and explained, and the glyph that marks it. */
export const ITEM_KINDS = {
  LINK: {
    Glyph: ExternalLink,
    label: 'Link',
    summary: 'A tile that opens the address: in a new tab, this tab, or inside this page.',
  },
  FRAME: {
    Glyph: PanelsTopLeft,
    label: 'Frame',
    summary: 'The address shown inline on the page, as wide as you choose.',
  },
  WIDGET: {
    Glyph: Gauge,
    label: 'Widget',
    summary: 'Data the server fetches for you: values from an API, a feed, or the weather.',
  },
} satisfies Record<ItemKind, { Glyph: unknown; label: string; summary: string }>;

/** Where a link opens: how each choice is named, explained, and marked on its tile. */
export const OPENS_IN = {
  NEW_TAB: {
    Glyph: ExternalLink,
    label: 'New tab',
    summary: 'Opens in a new browser tab.',
    opensLabel: 'opens in a new tab',
  },
  SAME_TAB: {
    Glyph: ArrowRight,
    label: 'This tab',
    summary: 'Opens in this tab, leaving the homepage.',
    opensLabel: 'opens in this tab',
  },
  APP: {
    Glyph: AppWindow,
    label: 'Inside this page',
    summary: 'Framed across the page, with a way out to the browser. Some sites refuse to be framed.',
    opensLabel: 'opens inside this page',
  },
} satisfies Record<OpensIn, { Glyph: unknown; label: string; summary: string; opensLabel: string }>;
