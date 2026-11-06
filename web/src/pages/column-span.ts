import type { ColumnSpan, ItemKind } from '@/__generated__/graphql';

// A section is one grid. Its columns follow the width the section has, not the window's, so the
// sidebar folding or unfolding re-flows it: one column under 32rem, two from 32rem, three from 48rem,
// four from 64rem. A link takes one column; a frame or widget takes the span it was given, clamped
// to the columns there are, so on a phone everything is one column wide.

/** The grid a section's items sit in. Its parent must be the `@container`. */
export const SECTION_GRID = 'grid grid-cols-1 gap-4 @lg:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4';

/** The classes that make an item span its columns, at each width the grid has them. */
export const SPAN_CLASSES = {
  ONE: '',
  TWO: '@lg:col-span-2',
  THREE: '@lg:col-span-2 @3xl:col-span-3',
  FOUR: '@lg:col-span-2 @3xl:col-span-3 @5xl:col-span-4',
  FULL: 'col-span-full',
} satisfies Record<ColumnSpan, string>;

/** How each width is named in the item dialog. */
export const SPAN_LABELS = {
  ONE: '1 column',
  TWO: '2 columns',
  THREE: '3 columns',
  FOUR: '4 columns',
  FULL: 'Full width',
} satisfies Record<ColumnSpan, string>;

/** The width each kind gets when none is chosen. Mirrors the server's DEFAULT_COLUMN_SPAN. */
export const DEFAULT_SPAN = {
  LINK: 'ONE',
  FRAME: 'FULL',
  WIDGET: 'TWO',
} satisfies Record<ItemKind, ColumnSpan>;
