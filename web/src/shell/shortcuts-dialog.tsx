import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DialogLayout } from '@/components/dialog-layout';
import { Button } from '@/components/ui/button';
import {
  type Chord,
  canStartShortcut,
  chordKeys,
  commandKeyLabel,
  EDIT_MODE_CHORD,
  FOLD_CHORD,
  matchesChord,
  SEARCH_CHORD,
  SHORTCUTS_CHORD,
} from '@/search/hotkeys';
import { useSearchEngines } from '@/search/search-launcher';
import { useEditMode } from './edit-mode';

/** What the rest of the app can ask of the shortcuts dialog. */
interface ShortcutsControls {
  /** Opens the keyboard shortcuts dialog. */
  openShortcuts: () => void;
}

const ShortcutsContext = createContext<ShortcutsControls | null>(null);

/**
 * Holds the keyboard shortcuts dialog for the whole app, and opens and closes it on Ctrl/⌘+/.
 *
 * @param props - What it wraps.
 * @param props.children - The shell.
 * @returns The provider and the dialog.
 *
 * @remarks
 * The chord opens the dialog under the usual rules (`canStartShortcut`), and closes it again while it is
 * the dialog that is open.
 */
export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const openShortcuts = useCallback(() => setIsOpen(true), []);

  useEffect(() => {
    /**
     * Opens or closes the dialog on Ctrl/⌘+/.
     *
     * @param event - The key press.
     */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (matchesChord(event, SHORTCUTS_CHORD) === false) {
        return;
      }
      if (isOpen) {
        event.preventDefault();
        setIsOpen(false);
      } else if (canStartShortcut(event)) {
        event.preventDefault();
        setIsOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  const controls = useMemo(() => ({ openShortcuts }), [openShortcuts]);
  return (
    <ShortcutsContext.Provider value={controls}>
      {children}
      {isOpen ? <ShortcutsDialog onOpenChange={setIsOpen} /> : null}
    </ShortcutsContext.Provider>
  );
}

/**
 * The shortcuts dialog's controls, for a row or button that opens it.
 *
 * @returns The controls.
 * @throws When used outside `ShortcutsProvider`.
 */
export function useShortcuts(): ShortcutsControls {
  const controls = useContext(ShortcutsContext);
  if (controls === null) {
    throw new Error('useShortcuts is used outside ShortcutsProvider.');
  }
  return controls;
}

/**
 * Keys as the dialog draws them: one `<kbd>` each, side by side.
 *
 * @param props - The keys.
 * @param props.keys - In the order they are pressed.
 * @returns The keys.
 */
function Keys({ keys }: { keys: readonly string[] }) {
  return (
    <span className="flex shrink-0 flex-row items-center gap-1">
      {keys.map((key) => (
        <kbd
          key={key}
          className="min-w-6 rounded border border-foreground/20 bg-foreground/5 px-1.5 py-0.5 text-center font-sans text-foreground/80 text-xs"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

/** One shortcut: what it does, and its keys. */
interface ShortcutRow {
  label: string;
  keys: readonly string[];
}

/**
 * A list of shortcuts, each a line with what it does at the start and its keys at the end.
 *
 * @param props - The shortcuts.
 * @param props.rows - In the order they are shown.
 * @returns The list.
 */
function ShortcutList({ rows }: { rows: readonly ShortcutRow[] }) {
  return (
    <dl className="flex flex-col divide-y divide-foreground/10">
      {rows.map((row) => (
        <div key={row.label} className="flex flex-row items-center justify-between gap-4 py-2">
          <dt className="text-foreground text-sm">{row.label}</dt>
          <dd>
            <Keys keys={row.keys} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A row for one of the app's chords.
 *
 * @param label - What it does.
 * @param chord - Its keys.
 * @returns The row.
 */
function chordRow(label: string, chord: Chord): ShortcutRow {
  return { label, keys: chordKeys(chord) };
}

/**
 * The keyboard shortcuts dialog: every shortcut the app has, with this keyboard's keys.
 *
 * @param props - How it closes.
 * @param props.onOpenChange - Called with false when it closes.
 * @returns The dialog.
 */
function ShortcutsDialog({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { canEdit } = useEditMode();
  const engines = useSearchEngines().data ?? [];
  const command = commandKeyLabel();

  const appRows: ShortcutRow[] = [
    chordRow('Search items, pages and the web', SEARCH_CHORD),
    chordRow('Fold or unfold the sidebar', FOLD_CHORD),
    ...(canEdit ? [chordRow('Switch edit mode on or off', EDIT_MODE_CHORD)] : []),
    chordRow('Show these shortcuts', SHORTCUTS_CHORD),
  ];
  const searchRows: ShortcutRow[] = [
    { label: 'Open the highlighted result', keys: ['↵'] },
    { label: 'Open it in a new tab', keys: [command, '↵'] },
    { label: 'Close search', keys: ['Esc'] },
    ...engines.map((engine) => ({ label: `Search ${engine.name}`, keys: [`!${engine.prefix}`] })),
  ];

  return (
    <DialogLayout
      open
      onOpenChange={onOpenChange}
      title="Keyboard shortcuts"
      description="None of them work while you're typing in a field, or while a dialog or menu is open."
      contentSlot={
        <div className="flex flex-col gap-6">
          <section aria-labelledby="shortcuts-everywhere" className="flex flex-col gap-1">
            <h3 id="shortcuts-everywhere" className="font-semibold text-foreground/60 text-xs uppercase tracking-wide">
              Everywhere
            </h3>
            <ShortcutList rows={appRows} />
          </section>
          <section aria-labelledby="shortcuts-search" className="flex flex-col gap-1">
            <h3 id="shortcuts-search" className="font-semibold text-foreground/60 text-xs uppercase tracking-wide">
              In search
            </h3>
            <p className="text-foreground/60 text-sm">
              Start a search with a ! prefix and a space to send it to that search engine.
            </p>
            <ShortcutList rows={searchRows} />
          </section>
        </div>
      }
      footerActionsSlot={(close) => <Button variant="outline" onClick={close} content="Close" />}
    />
  );
}
