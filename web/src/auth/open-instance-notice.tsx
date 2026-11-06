import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useAccess } from './use-access';

/** Where this browser remembers that the notice was put away. */
const DISMISSED_KEY = 'homepage.open-instance-notice-dismissed';

/**
 * Reads whether this browser put the notice away.
 *
 * @returns True once it was dismissed here.
 */
function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Says, above a page, that anyone can change this homepage until sign-in is set up, and leads to where it
 * is set up. Each browser can put it away; the settings page still says so.
 *
 * @returns The notice, or nothing once sign-in is set up or it was put away.
 */
export function OpenInstanceNotice() {
  const isOpen = useAccess().data?.mode === 'OPEN';
  const [isDismissed, setDismissed] = useState(wasDismissed);
  if (isOpen === false || isDismissed) {
    return null;
  }

  /** Puts the notice away in this browser. */
  const dismiss = (): void => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, 'true');
    } catch {
      // Storage is blocked: it is put away until the page is reloaded.
    }
  };

  return (
    <Alert
      variant="warning"
      title="Anyone who can reach this homepage can change it"
      description="Set up sign-in, with heautou or another provider, so that only you can."
      actionSlot={
        <>
          <Button size="sm" variant="outline" linkSlot={<Link to="/settings" />} content="Set up sign-in" />
          <Button size="sm" variant="ghost" content="Dismiss" onClick={dismiss} />
        </>
      }
    />
  );
}
