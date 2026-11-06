// Whether this browser has the homepage in edit mode, kept apart from React so it can be tested alone.

/** Where this browser remembers edit mode. */
export const EDIT_MODE_STORAGE_KEY = 'homepage.edit-mode';
/** What the stored value is while editing. Anything else, or nothing, means view mode. */
const EDITING = 'true';

/** The part of `Storage` edit mode uses. */
export type EditModeStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Finds this browser's storage, which a private window or blocked site data can refuse.
 *
 * @returns `localStorage`, or null when it can't be reached.
 */
export function browserStorage(): EditModeStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Reads whether this browser last left edit mode on.
 *
 * @param storage - Where it is kept, or null when there is nowhere.
 * @returns True when it did; false when it didn't, or storage can't be read.
 */
export function readStoredEditing(storage: EditModeStorage | null): boolean {
  if (storage === null) {
    return false;
  }
  try {
    return storage.getItem(EDIT_MODE_STORAGE_KEY) === EDITING;
  } catch {
    return false;
  }
}

/**
 * Remembers whether edit mode is on. A browser that refuses storage just forgets.
 *
 * @param storage - Where it is kept, or null when there is nowhere.
 * @param editing - Whether edit mode is on now.
 */
export function writeStoredEditing(storage: EditModeStorage | null, editing: boolean): void {
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(EDIT_MODE_STORAGE_KEY, String(editing));
  } catch {
    // Blocked storage: edit mode still works, it is just not remembered.
  }
}

/**
 * Decides whether the page is drawn in edit mode.
 *
 * @param canEdit - Whether the person may change the homepage at all.
 * @param wantsEditing - Whether they switched edit mode on.
 * @returns True only for an editor who switched it on: someone who can't edit is always in view mode.
 */
export function effectiveEditing(canEdit: boolean, wantsEditing: boolean): boolean {
  return canEdit && wantsEditing;
}
