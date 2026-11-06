import {
  columnsThatFit,
  DEFAULT_ITEM_WIDTH,
  spanStyle,
  WidthChoice,
  widthChoiceOf,
  widthFromChoice,
  widthOptions,
} from '../../../web/src/pages/column-span.ts';

const REM = 16;

describe('columnsThatFit', () => {
  it.each([
    [358, 4, 1],
    [470, 6, 1],
    [500, 4, 2],
    [1150, 4, 4],
    [1150, 6, 6],
    [1150, 8, 6],
    [1150, 2, 2],
    [2400, 8, 8],
  ])('a %ipx section with a setting of %i has %i columns', (width, setting, expected) => {
    expect(columnsThatFit(width, setting, REM)).toBe(expected);
  });
});

describe('spanStyle', () => {
  it('spans the columns asked for, never more than there are, and the whole row when full width', () => {
    expect(spanStyle({ columnSpan: 2, fullWidth: false }, 4)).toEqual({ gridColumn: 'span 2 / span 2' });
    expect(spanStyle({ columnSpan: 6, fullWidth: false }, 3)).toEqual({ gridColumn: 'span 3 / span 3' });
    expect(spanStyle({ columnSpan: 2, fullWidth: true }, 4)).toEqual({ gridColumn: '1 / -1' });
  });
});

describe('width choices', () => {
  it('calls a kind default DEFAULT, and turns a choice back into what the API takes', () => {
    expect(widthChoiceOf(undefined, 'WIDGET')).toBe(WidthChoice.Default);
    expect(widthChoiceOf(DEFAULT_ITEM_WIDTH.FRAME, 'FRAME')).toBe(WidthChoice.Default);
    expect(widthChoiceOf({ columnSpan: 3, fullWidth: false }, 'WIDGET')).toBe('3');
    expect(widthChoiceOf({ columnSpan: 2, fullWidth: true }, 'WIDGET')).toBe(WidthChoice.Full);
    expect(widthFromChoice(WidthChoice.Default)).toEqual({ columnSpan: null, fullWidth: null });
    expect(widthFromChoice(WidthChoice.Full)).toEqual({ columnSpan: null, fullWidth: true });
    expect(widthFromChoice('5')).toEqual({ columnSpan: 5, fullWidth: false });
  });

  it('offers 1 to the Columns setting, and keeps a width wider than the setting, saying so', () => {
    expect(widthOptions('WIDGET', 3).map((option) => option.value)).toEqual(['DEFAULT', '1', '2', '3', 'FULL']);
    const options = widthOptions('WIDGET', 3, { columnSpan: 6, fullWidth: false });
    expect(options.find((option) => option.value === '6')?.label).toBe('6 columns (more than the page has)');
  });
});
