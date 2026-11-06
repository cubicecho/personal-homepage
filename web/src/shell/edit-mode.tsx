import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useCanEdit } from '@/auth/use-access';
import { Button } from '@/components/ui/button';
import { Check, Pencil } from '@/components/ui/icons';
import { canStartShortcut, chordLabel, EDIT_MODE_CHORD, matchesChord } from '@/search/hotkeys';
import { browserStorage, effectiveEditing, readStoredEditing, writeStoredEditing } from './edit-mode-state';

/** Edit mode, as the rest of the app reads and changes it. */
interface EditMode {
  /** Whether the page is drawn with its editing controls: menus, Add item, section actions. */
  isEditing: boolean;
  /** Whether the person may switch edit mode on at all. */
  canEdit: boolean;
  /** Switches edit mode on or off. Does nothing for someone who can't edit. */
  setEditing: (editing: boolean) => void;
}

const EditModeContext = createContext<EditMode | null>(null);

/**
 * Edit mode for the whole app: off by default, remembered per browser, and toggled by Ctrl/⌘+Shift+E.
 *
 * @param props - What it wraps.
 * @param props.children - The shell, whose pages read it.
 * @returns The provider.
 *
 * @remarks
 * Someone who can't edit is always in view mode and the chord does nothing for them. The chord follows
 * the same rules as every shortcut (`canStartShortcut`): never while typing, never behind a dialog or menu.
 */
export function EditModeProvider({ children }: { children: ReactNode }) {
  const canEdit = useCanEdit();
  const [wantsEditing, setWantsEditing] = useState(() => readStoredEditing(browserStorage()));

  const setEditing = useCallback(
    (editing: boolean): void => {
      if (canEdit === false) {
        return;
      }
      setWantsEditing(editing);
      writeStoredEditing(browserStorage(), editing);
    },
    [canEdit],
  );

  useEffect(() => {
    if (canEdit === false) {
      return;
    }
    /**
     * Toggles edit mode on Ctrl/⌘+Shift+E.
     *
     * @param event - The key press.
     */
    const onKeyDown = (event: KeyboardEvent): void => {
      const isToggle = matchesChord(event, EDIT_MODE_CHORD) && canStartShortcut(event);
      if (isToggle === false) {
        return;
      }
      event.preventDefault();
      setWantsEditing((current) => {
        writeStoredEditing(browserStorage(), current === false);
        return current === false;
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canEdit]);

  const value = useMemo(
    () => ({ isEditing: effectiveEditing(canEdit, wantsEditing), canEdit, setEditing }),
    [canEdit, wantsEditing, setEditing],
  );
  return <EditModeContext.Provider value={value}>{children}</EditModeContext.Provider>;
}

/**
 * Reads edit mode.
 *
 * @returns Edit mode. Outside `EditModeProvider` (the app view, the sign-in pages), always view mode.
 */
export function useEditMode(): EditMode {
  return useContext(EditModeContext) ?? { isEditing: false, canEdit: false, setEditing: () => {} };
}

/**
 * Whether the page is drawn with its editing controls.
 *
 * @returns True in edit mode, for someone who may edit.
 */
export function useIsEditing(): boolean {
  return useEditMode().isEditing;
}

interface EditModeToggleProps {
  /** `wide` for a page header, with its word; `icon` for the phone bar. */
  variant: 'wide' | 'icon';
}

/**
 * The Edit / Done button: switches edit mode, named with its shortcut. Nothing for someone who can't edit.
 *
 * @param props - How much room it has.
 * @returns The button, or nothing.
 */
export function EditModeToggle({ variant }: EditModeToggleProps) {
  const { isEditing, canEdit, setEditing } = useEditMode();
  if (canEdit === false) {
    return null;
  }
  const shortcut = chordLabel(EDIT_MODE_CHORD);
  const name = isEditing ? `Done editing (${shortcut})` : `Edit this homepage (${shortcut})`;
  const common = {
    'aria-pressed': isEditing,
    'aria-label': name,
    hint: name,
    iconSlot: isEditing ? <Check /> : <Pencil />,
    onClick: () => setEditing(isEditing === false),
  };
  if (variant === 'icon') {
    return <Button variant={isEditing ? 'info' : 'outline'} size="icon-sm" {...common} />;
  }
  return (
    <Button size="sm" variant={isEditing ? 'info' : 'outline'} content={isEditing ? 'Done' : 'Edit'} {...common} />
  );
}
