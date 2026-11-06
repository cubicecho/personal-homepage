// The one place that decides whether a key press may start a shortcut: never while the user is
// typing, and never behind an open dialog or menu (cubicecho_frontend interaction.md).

/** Layers that own the keyboard while they are open. A tooltip is not one: it opens on hover. */
const OPEN_LAYER_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';
/** Elements whose keys are text the user is typing. */
const TYPING_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/**
 * Checks whether a key press belongs to something the user is typing in.
 *
 * @param target - The event's target.
 * @returns True for a field, a text area, a select or editable content.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TYPING_SELECTOR) !== null;
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
 * Checks whether a key press is Ctrl+K, or ⌘K on a Mac.
 *
 * @param event - The key press.
 * @returns True for the palette's chord, with no other modifier.
 */
export function isPaletteChord(event: KeyboardEvent): boolean {
  const hasCommandKey = event.ctrlKey || event.metaKey;
  return hasCommandKey && event.altKey === false && event.shiftKey === false && event.key.toLowerCase() === 'k';
}

/**
 * Checks whether a key press types one visible character, with no command modifier.
 *
 * @param event - The key press.
 * @returns True for a letter, digit or symbol; false for a space, a named key or a chord.
 */
export function isPrintableKey(event: KeyboardEvent): boolean {
  const hasCommandKey = event.ctrlKey || event.metaKey || event.altKey;
  return hasCommandKey === false && /^\S$/u.test(event.key);
}

/**
 * Names the command modifier the way this computer's keyboard labels it.
 *
 * @returns `⌘` on Apple devices, `Ctrl` elsewhere.
 */
export function commandKeyLabel(): string {
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? '⌘' : 'Ctrl';
}
