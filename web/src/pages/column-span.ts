import type { CSSProperties } from 'react';

// Plain functions with no app imports, so the tests reach them without the web app's path aliases.
// A section is one grid. It has as many columns as the Columns setting says, or fewer when the section
// is too narrow for cards of MIN_CARD_WIDTH_REM, so the sidebar folding re-flows it and a phone gets one
// column. A link takes one column; a frame or widget takes the columns it was given, clamped to the
// columns there are, or the whole row when it is full width. The clamp is only drawn, never saved.

/** The narrowest a card may get before its section's grid drops a column, in rem. */
export const MIN_CARD_WIDTH_REM = 10;
/** A section narrower than this, in rem, is one column whatever fits: a phone reads cards one at a time. */
export const SINGLE_COLUMN_BELOW_REM = 30;
/** The space between cards, in rem: the grid's `gap-4`. */
export const GRID_GAP_REM = 1;

/** How wide an item is. The same two fields the API has. */
export interface ItemWidth {
  /** Columns it spans when not full width. */
  columnSpan: number;
  /** Whether it takes a row of its own. */
  fullWidth: boolean;
}

/** The width each kind gets when none is chosen. Mirrors the server's DEFAULT_ITEM_WIDTH. */
export const DEFAULT_ITEM_WIDTH: Readonly<Record<ItemKind, ItemWidth>> = {
  LINK: { columnSpan: 1, fullWidth: false },
  FRAME: { columnSpan: 2, fullWidth: true },
  WIDGET: { columnSpan: 2, fullWidth: false },
};

/** An item's kind: the API's `ItemKind`, spelled out here so this module imports nothing from the app. */
export type ItemKind = 'LINK' | 'FRAME' | 'WIDGET';

/** The item dialog's Width choices besides a number of columns. */
export const WidthChoice = {
  /** Whatever the kind gets by default. */
  Default: 'DEFAULT',
  /** A row of its own. */
  Full: 'FULL',
} as const;

/**
 * Works out how many columns fit a section of a given width.
 *
 * @param widthPx - The section's width, in pixels.
 * @param maxColumns - The Columns setting.
 * @param remPx - Pixels in one rem.
 * @returns 1 under SINGLE_COLUMN_BELOW_REM; otherwise from 1 to `maxColumns`, as many cards of at least
 * MIN_CARD_WIDTH_REM as fit with their gaps.
 */
export function columnsThatFit(widthPx: number, maxColumns: number, remPx: number): number {
  const isNarrow = widthPx < SINGLE_COLUMN_BELOW_REM * remPx;
  if (isNarrow) {
    return 1;
  }
  const cardPx = MIN_CARD_WIDTH_REM * remPx;
  const gapPx = GRID_GAP_REM * remPx;
  const fitting = Math.floor((widthPx + gapPx) / (cardPx + gapPx));
  return Math.max(1, Math.min(maxColumns, fitting));
}

/**
 * Places an item in its section's grid.
 *
 * @param width - The item's width.
 * @param columns - The columns the grid has right now.
 * @returns The `grid-column` style: the whole row, or its span clamped to the columns there are.
 */
export function spanStyle(width: ItemWidth, columns: number): CSSProperties {
  if (width.fullWidth) {
    return { gridColumn: '1 / -1' };
  }
  return { gridColumn: `span ${Math.min(width.columnSpan, columns)} / span ${Math.min(width.columnSpan, columns)}` };
}

/**
 * Names a number of columns.
 *
 * @param columns - How many.
 * @returns "1 column", "3 columns".
 */
export function columnsLabel(columns: number): string {
  return columns === 1 ? '1 column' : `${columns} columns`;
}

/**
 * Names a width as the dialog says it.
 *
 * @param width - The width.
 * @returns "Full width" or a number of columns.
 */
export function widthLabel(width: ItemWidth): string {
  return width.fullWidth ? 'Full width' : columnsLabel(width.columnSpan);
}

/**
 * Picks the dialog's choice for an item's width.
 *
 * @param width - The item's width, or undefined for a new item.
 * @param kind - The item's kind.
 * @returns DEFAULT when it is the kind's default, FULL, or the number of columns as text.
 */
export function widthChoiceOf(width: ItemWidth | undefined, kind: ItemKind): string {
  const fallback = DEFAULT_ITEM_WIDTH[kind];
  const isDefault =
    width === undefined ||
    (width.fullWidth === fallback.fullWidth && (width.fullWidth || width.columnSpan === fallback.columnSpan));
  if (isDefault) {
    return WidthChoice.Default;
  }
  return width.fullWidth ? WidthChoice.Full : String(width.columnSpan);
}

/**
 * Turns the dialog's choice into what the API takes.
 *
 * @param choice - DEFAULT, FULL, or a number of columns as text.
 * @returns Both fields null for the default, otherwise the width.
 */
export function widthFromChoice(choice: string): { columnSpan: number | null; fullWidth: boolean | null } {
  if (choice === WidthChoice.Default) {
    return { columnSpan: null, fullWidth: null };
  }
  if (choice === WidthChoice.Full) {
    return { columnSpan: null, fullWidth: true };
  }
  return { columnSpan: Number(choice), fullWidth: false };
}

/**
 * Lists the dialog's Width choices: the kind's default first, then 1 to the Columns setting, then full
 * width. An item already wider than the setting keeps its width as a choice, saying so.
 *
 * @param kind - The item's kind.
 * @param columns - The Columns setting.
 * @param current - The item's width, when editing.
 * @returns The options.
 */
export function widthOptions(kind: ItemKind, columns: number, current?: ItemWidth): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [
    { value: WidthChoice.Default, label: `Default (${widthLabel(DEFAULT_ITEM_WIDTH[kind]).toLowerCase()})` },
  ];
  for (let span = 1; span <= columns; span += 1) {
    options.push({ value: String(span), label: columnsLabel(span) });
  }
  const isWiderThanPage = current !== undefined && current.fullWidth === false && current.columnSpan > columns;
  if (isWiderThanPage) {
    options.push({
      value: String(current.columnSpan),
      label: `${columnsLabel(current.columnSpan)} (more than the page has)`,
    });
  }
  options.push({ value: WidthChoice.Full, label: 'Full width' });
  return options;
}
