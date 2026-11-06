import { useEffect } from 'react';

/**
 * What counts as an open overlay: a menu, a dialog, a list box, or anything positioned by Radix's popper
 * (popovers, tooltips, combobox lists).
 */
const OVERLAY_SELECTOR =
  '[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"], [data-radix-popper-content-wrapper]';

/**
 * Finds the open overlay that should hold focus.
 *
 * @returns The last overlay in the document (the one on top), or null when none is open.
 */
function topOverlay(): HTMLElement | null {
  const overlays = document.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR);
  return overlays.item(overlays.length - 1);
}

/**
 * Sets every frame's `inert` to whether an overlay is open, so a click where a frame sits lands on the
 * page and closes a menu as any click outside it does.
 */
function syncFrames(): void {
  const hasOverlay = topOverlay() !== null;
  for (const frame of document.querySelectorAll('iframe')) {
    if (frame.inert !== hasOverlay) {
      frame.inert = hasOverlay;
    }
  }
}

/**
 * Keeps framed apps from taking focus out of an open menu, dialog or list. Mount once, in the shell.
 *
 * @remarks
 * Some framed apps focus themselves from script, over and over (Actual Budget does). Focus going into
 * a frame blurs this window, and a menu closes when the window blurs, which is meant for switching tabs:
 * so the ⋯ menus on a page with such an app opened and closed at once. `inert` stops clicks reaching a
 * frame but, in Chrome, not a cross-origin frame focusing itself. So while an overlay is open, a window
 * blur that left focus on one of those inert frames is stopped before the menu hears it, and focus goes
 * back to where it was in the overlay. A real tab or app switch leaves focus in the overlay and closes
 * the menu as before.
 */
export function useInertFramesUnderOverlays(): void {
  useEffect(() => {
    let lastFocusedInOverlay: HTMLElement | null = null;

    const rememberFocus = (event: FocusEvent): void => {
      const { target } = event;
      const isInOverlay = target instanceof HTMLElement && target.closest(OVERLAY_SELECTOR) !== null;
      if (isInOverlay) {
        lastFocusedInOverlay = target;
      }
    };

    const keepFocusFromFrames = (event: FocusEvent): void => {
      const overlay = topOverlay();
      const focused = document.activeElement;
      const isStolenByFrame = overlay !== null && focused instanceof HTMLIFrameElement && focused.inert;
      if (isStolenByFrame === false) {
        return;
      }
      event.stopImmediatePropagation();
      const isStillThere = lastFocusedInOverlay !== null && overlay.contains(lastFocusedInOverlay);
      const target = isStillThere && lastFocusedInOverlay !== null ? lastFocusedInOverlay : overlay;
      // Focusing during the blur only moves document.activeElement; keys would still go to the frame. On the
      // next tick, taking the window's focus back first returns the keyboard to the overlay.
      setTimeout(() => {
        window.focus();
        target.focus({ preventScroll: true });
      }, 0);
    };

    syncFrames();
    // Overlays mount in portals at the end of <body>, and frames come and go with the page.
    const observer = new MutationObserver(syncFrames);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('focusin', rememberFocus, true);
    // Capture, and registered before any menu mounts, so it runs before a menu's own blur listener.
    window.addEventListener('blur', keepFocusFromFrames, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('focusin', rememberFocus, true);
      window.removeEventListener('blur', keepFocusFromFrames, true);
    };
  }, []);
}
