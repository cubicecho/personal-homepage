import { useCallback, useEffect, useState } from 'react';
import { canStartShortcut } from '@/search/hotkeys';

/** Where this browser remembers whether the sidebar is folded. */
const FOLD_STORAGE_KEY = 'homepage.sidebar-folded';
/** What the stored value is while folded. Anything else, or nothing, means open. */
const FOLDED = 'true';

/**
 * Reads whether this browser last left the sidebar folded.
 *
 * @returns True when it did; false when it didn't, or storage can't be read.
 */
function readFolded(): boolean {
  try {
    return window.localStorage.getItem(FOLD_STORAGE_KEY) === FOLDED;
  } catch {
    return false;
  }
}

/**
 * Remembers whether the sidebar is folded. A browser that refuses storage just forgets.
 *
 * @param folded - Whether it is folded now.
 */
function writeFolded(folded: boolean): void {
  try {
    window.localStorage.setItem(FOLD_STORAGE_KEY, String(folded));
  } catch {
    // Private windows and blocked storage: the fold still works, it is just not remembered.
  }
}

/**
 * Checks whether a key press is Ctrl+B, or ⌘B on a Mac: the usual "toggle the sidebar" chord.
 *
 * @param event - The key press.
 * @returns True for the chord, with no other modifier.
 */
export function isFoldChord(event: KeyboardEvent): boolean {
  const hasCommandKey = event.ctrlKey || event.metaKey;
  return hasCommandKey && event.altKey === false && event.shiftKey === false && event.key.toLowerCase() === 'b';
}

/**
 * Whether the sidebar is folded to a rail of icons, remembered per browser, and toggled by Ctrl/⌘+B.
 *
 * @returns The fold, and the way to change it.
 *
 * @remarks
 * The chord follows the search launcher's rules (`canStartShortcut`): never while typing, and never
 * behind an open dialog or menu.
 */
export function useSidebarFold(): readonly [folded: boolean, setFolded: (folded: boolean) => void] {
  const [folded, setFoldedState] = useState(readFolded);

  const setFolded = useCallback((next: boolean): void => {
    setFoldedState(next);
    writeFolded(next);
  }, []);

  useEffect(() => {
    /**
     * Toggles the fold on Ctrl/⌘+B.
     *
     * @param event - The key press.
     */
    const onKeyDown = (event: KeyboardEvent): void => {
      const isToggle = isFoldChord(event) && canStartShortcut(event);
      if (isToggle === false) {
        return;
      }
      event.preventDefault();
      setFoldedState((current) => {
        writeFolded(current === false);
        return current === false;
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return [folded, setFolded] as const;
}
