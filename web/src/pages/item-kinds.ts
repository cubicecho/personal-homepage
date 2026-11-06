import type { ItemKind } from '@/__generated__/graphql';
import { AppWindow, ExternalLink, PanelsTopLeft } from '@/core/app-icons';

/** How each kind of item is named and explained, and the glyph that marks it. */
export const ITEM_KINDS = {
  LINK: {
    Glyph: ExternalLink,
    label: 'Link',
    summary: 'A tile that opens the address in a new tab.',
    opensLabel: 'opens in a new tab',
  },
  APP: {
    Glyph: AppWindow,
    label: 'App',
    summary: 'A tile that opens the address framed inside this page, with a way out to the browser.',
    opensLabel: 'opens inside this page',
  },
  FRAME: {
    Glyph: PanelsTopLeft,
    label: 'Frame',
    summary: 'The address shown inline on the page, across its full width.',
    opensLabel: 'shown on the page',
  },
} satisfies Record<ItemKind, { Glyph: unknown; label: string; summary: string; opensLabel: string }>;
