// Whether a section is open is the reader's choice, kept in this browser only. Until they choose,
// the section's own `collapsed` decides. Storage can be missing or refuse (a private window, blocked
// site data), so every access is guarded and the page still works without it.
import { useState } from 'react';
import type { Section } from '@/pages/use-pages';

const STORAGE_PREFIX = 'personal-homepage:section-open:';
const OPEN = 'open';
const SHUT = 'shut';

/**
 * Builds the storage key for one section's fold.
 *
 * @param pageSlug - The page's slug.
 * @param sectionId - The section's id.
 * @returns The key.
 */
function storageKey(pageSlug: string, sectionId: string): string {
  return `${STORAGE_PREFIX}${pageSlug}:${sectionId}`;
}

/**
 * Reads the reader's last choice for a section.
 *
 * @param key - The storage key.
 * @returns True or false for a stored choice, null when there is none or storage is unavailable.
 */
function readChoice(key: string): boolean | null {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === OPEN) {
      return true;
    }
    return stored === SHUT ? false : null;
  } catch {
    return null;
  }
}

/**
 * Remembers the reader's choice for a section, when storage allows.
 *
 * @param key - The storage key.
 * @param isOpen - Whether they opened it.
 */
function writeChoice(key: string, isOpen: boolean): void {
  try {
    window.localStorage.setItem(key, isOpen ? OPEN : SHUT);
  } catch {
    // Storage is unavailable: the choice lasts until the page is left.
  }
}

/**
 * Holds whether a section is open, remembered per browser.
 *
 * @param pageSlug - The page the section is on.
 * @param section - The section.
 * @returns Whether it is open, and a setter that also remembers the choice.
 */
export function useSectionOpen(pageSlug: string, section: Section): [boolean, (isOpen: boolean) => void] {
  const key = storageKey(pageSlug, section.id);
  const [choice, setChoice] = useState<boolean | null>(() => readChoice(key));

  /**
   * Opens or shuts the section and remembers it.
   *
   * @param isOpen - Whether it is now open.
   */
  const setOpen = (isOpen: boolean): void => {
    writeChoice(key, isOpen);
    setChoice(isOpen);
  };

  return [choice ?? section.collapsed === false, setOpen];
}
