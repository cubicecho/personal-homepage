import {
  type Chord,
  canStartShortcut,
  chordKeys,
  chordLabel,
  commandKeyLabel,
  EDIT_MODE_CHORD,
  FOLD_CHORD,
  type KeyPress,
  matchesChord,
  SEARCH_CHORD,
  SHORTCUTS_CHORD,
} from '../../../web/src/search/hotkeys.ts';

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15';
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0';

/**
 * Builds a key press.
 *
 * @param key - `KeyboardEvent.key`.
 * @param [mods] - Modifiers and the physical key.
 * @returns The press.
 */
function press(key: string, mods: Partial<KeyPress> = {}): KeyPress {
  return { key, code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods };
}

describe('matchesChord', () => {
  it.each<[string, KeyPress, Chord, boolean]>([
    ['Ctrl+K', press('k', { ctrlKey: true }), SEARCH_CHORD, true],
    ['⌘K', press('k', { metaKey: true }), SEARCH_CHORD, true],
    ['bare K', press('k'), SEARCH_CHORD, false],
    ['Ctrl+Shift+K', press('K', { ctrlKey: true, shiftKey: true }), SEARCH_CHORD, false],
    ['Ctrl+Alt+K', press('k', { ctrlKey: true, altKey: true }), SEARCH_CHORD, false],
    ['Ctrl+B', press('b', { ctrlKey: true }), FOLD_CHORD, true],
    ['Ctrl+Shift+E', press('E', { ctrlKey: true, shiftKey: true }), EDIT_MODE_CHORD, true],
    ['⌘⇧E', press('E', { metaKey: true, shiftKey: true }), EDIT_MODE_CHORD, true],
    ['Ctrl+E alone (the browser keeps it)', press('e', { ctrlKey: true }), EDIT_MODE_CHORD, false],
    ['bare E', press('e'), EDIT_MODE_CHORD, false],
    ['Ctrl+/', press('/', { ctrlKey: true }), SHORTCUTS_CHORD, true],
    ['Ctrl+/ on a layout where the key is not /', press('-', { ctrlKey: true, code: 'Slash' }), SHORTCUTS_CHORD, true],
    ['bare /', press('/'), SHORTCUTS_CHORD, false],
    ['Ctrl+? (Shift+/)', press('?', { ctrlKey: true, shiftKey: true, code: 'Slash' }), SHORTCUTS_CHORD, false],
  ])('%s', (_name, event, chord, expected) => {
    expect(matchesChord(event, chord)).toBe(expected);
  });
});

describe('keys for this keyboard', () => {
  it('names the command key per platform', () => {
    expect(commandKeyLabel(MAC)).toBe('⌘');
    expect(commandKeyLabel(LINUX)).toBe('Ctrl');
  });

  it('spells a chord out in the order it is pressed', () => {
    expect(chordKeys(EDIT_MODE_CHORD, LINUX)).toEqual(['Ctrl', 'Shift', 'E']);
    expect(chordKeys(EDIT_MODE_CHORD, MAC)).toEqual(['⌘', '⇧', 'E']);
    expect(chordKeys(SHORTCUTS_CHORD, MAC)).toEqual(['⌘', '/']);
    expect(chordLabel(SEARCH_CHORD, LINUX)).toBe('Ctrl K');
  });
});

describe('canStartShortcut', () => {
  /** Stands in for a DOM element: inside a field or not. */
  class FakeElement {
    readonly isField: boolean;
    constructor(isField: boolean) {
      this.isField = isField;
    }
    closest(): FakeElement | null {
      return this.isField ? this : null;
    }
  }
  let openLayer = false;

  beforeAll(() => {
    vi.stubGlobal('Element', FakeElement);
    vi.stubGlobal('document', { querySelector: () => (openLayer ? {} : null) });
  });
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => {
    openLayer = false;
  });

  /**
   * Builds a key press event aimed at a target.
   *
   * @param target - Where the key went.
   * @param [extra] - Other event fields.
   * @returns The event.
   */
  const eventAt = (target: unknown, extra: Partial<KeyboardEvent> = {}) =>
    ({ target, defaultPrevented: false, isComposing: false, ...extra }) as unknown as KeyboardEvent;

  it('lets a shortcut start on the page', () => {
    expect(canStartShortcut(eventAt(new FakeElement(false)))).toBe(true);
  });

  it('ignores keys typed in a field', () => {
    expect(canStartShortcut(eventAt(new FakeElement(true)))).toBe(false);
  });

  it('ignores keys while a dialog or menu is open', () => {
    openLayer = true;
    expect(canStartShortcut(eventAt(new FakeElement(false)))).toBe(false);
  });

  it('ignores keys something else took, and keys mid-composition', () => {
    expect(canStartShortcut(eventAt(new FakeElement(false), { defaultPrevented: true }))).toBe(false);
    expect(canStartShortcut(eventAt(new FakeElement(false), { isComposing: true }))).toBe(false);
  });
});
