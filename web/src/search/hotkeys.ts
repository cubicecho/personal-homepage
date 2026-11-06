// The one place that decides whether a key press may start a shortcut, and which chord it is: never while
// the user is typing, never behind an open dialog or menu (cubicecho_frontend interaction.md), and never a
// bare key — every shortcut holds Ctrl, or ⌘ on a Mac.

/** Layers that own the keyboard while they are open. A tooltip is not one: it opens on hover. */
const OPEN_LAYER_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';
/** Elements whose keys are text the user is typing. */
const TYPING_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
/** User agents of Apple keyboards, whose command key is ⌘. */
const APPLE_AGENT = /Mac|iPhone|iPad|iPod/;

/** The parts of a key press a chord is read from. */
export type KeyPress = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

/** A shortcut: Ctrl (⌘ on a Mac), Shift when it says so, and one key. */
export interface Chord {
  /** The key, as `KeyboardEvent.key` names it in lower case: `k`, `/`. */
  key: string;
  /** The physical key, for one whose character changes with the layout or with Shift: `Slash`. */
  code?: string;
  /** Whether Shift is held too. */
  shift?: boolean;
}

/** Ctrl/⌘+K: the search launcher. */
export const SEARCH_CHORD: Chord = { key: 'k' };
/** Ctrl/⌘+B: fold the sidebar. */
export const FOLD_CHORD: Chord = { key: 'b' };
/** Ctrl/⌘+Shift+E: edit mode. Shift keeps the browser's own Ctrl+E (the address bar) working. */
export const EDIT_MODE_CHORD: Chord = { key: 'e', shift: true };
/** Ctrl/⌘+/: the keyboard shortcuts dialog. */
export const SHORTCUTS_CHORD: Chord = { key: '/', code: 'Slash' };

/**
 * Checks whether a key press belongs to something the user is typing in.
 *
 * @param target - The event's target.
 * @returns True for a field, a text area, a select or editable content.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  return typeof Element !== 'undefined' && target instanceof Element && target.closest(TYPING_SELECTOR) !== null;
}

/**
 * Checks whether a dialog, menu or list box is open and so owns the keyboard.
 *
 * @returns True when one is in the page.
 */
export function hasOpenLayer(): boolean {
  return document.querySelector(OPEN_LAYER_SELECTOR) !== null;
}

/**
 * Checks whether a key press may start a page-wide shortcut.
 *
 * @param event - The key press.
 * @returns False while typing, behind an open layer, mid-composition, or when something else took it.
 */
export function canStartShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing) {
    return false;
  }
  return isTypingTarget(event.target) === false && hasOpenLayer() === false;
}

/**
 * Checks whether a key press is a chord: Ctrl or ⌘, Shift exactly as the chord says, no Alt, and its key.
 *
 * @param event - The key press.
 * @param chord - The shortcut.
 * @returns True for that chord and nothing else.
 */
export function matchesChord(event: KeyPress, chord: Chord): boolean {
  const hasCommandKey = event.ctrlKey || event.metaKey;
  const wantsShift = chord.shift ?? false;
  if (hasCommandKey === false || event.altKey || event.shiftKey !== wantsShift) {
    return false;
  }
  const isKey = event.key.toLowerCase() === chord.key;
  const isCode = chord.code !== undefined && event.code === chord.code;
  return isKey || isCode;
}

/**
 * Checks whether a key press is Ctrl+K, or ⌘K on a Mac.
 *
 * @param event - The key press.
 * @returns True for the search launcher's chord.
 */
export function isPaletteChord(event: KeyPress): boolean {
  return matchesChord(event, SEARCH_CHORD);
}

/**
 * Checks whether a keyboard is an Apple one.
 *
 * @param [userAgent] - The browser's user agent; this browser's when left out.
 * @returns True on a Mac, iPhone or iPad.
 */
export function isAppleKeyboard(userAgent: string = navigator.userAgent): boolean {
  return APPLE_AGENT.test(userAgent);
}

/**
 * Names the command modifier the way this computer's keyboard labels it.
 *
 * @param [userAgent] - The browser's user agent; this browser's when left out.
 * @returns `⌘` on Apple devices, `Ctrl` elsewhere.
 */
export function commandKeyLabel(userAgent?: string): string {
  return isAppleKeyboard(userAgent) ? '⌘' : 'Ctrl';
}

/**
 * Spells a chord out as its keys, in the order they are pressed.
 *
 * @param chord - The shortcut.
 * @param [userAgent] - The browser's user agent; this browser's when left out.
 * @returns For example `['Ctrl', 'Shift', 'E']`, or `['⌘', '/']` on a Mac.
 */
export function chordKeys(chord: Chord, userAgent?: string): string[] {
  const keys = [commandKeyLabel(userAgent)];
  if (chord.shift === true) {
    keys.push(isAppleKeyboard(userAgent) ? '⇧' : 'Shift');
  }
  keys.push(chord.key.toUpperCase());
  return keys;
}

/**
 * Writes a chord as one short label, for a tooltip or a button's name.
 *
 * @param chord - The shortcut.
 * @param [userAgent] - The browser's user agent; this browser's when left out.
 * @returns For example `Ctrl Shift E`.
 */
export function chordLabel(chord: Chord, userAgent?: string): string {
  return chordKeys(chord, userAgent).join(' ');
}
