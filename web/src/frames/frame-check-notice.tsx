import { Alert } from '@/components/ui/alert';
import type { SlotNode } from '@/lib/utils';
import { useFrameCheck } from './use-frame-check';

/** How long an address being typed must hold still before the server is asked about it. */
const TYPING_SETTLE_MS = 600;

interface FrameCheckNoticeProps {
  /** The address that will be framed. */
  url: string;
  /** Whether the address is being typed, so it is only asked about once it settles. */
  isTyping?: boolean | undefined;
  /** The way out: switch the item to a link, or open the site in the browser. */
  actionSlot?: SlotNode | undefined;
}

/**
 * Warns that a site forbids being shown inside another page, so its frame would stay blank.
 *
 * @remarks
 * Draws nothing while it checks, when framing is allowed, and when the site can't be reached: the
 * last is for the status check to say, and the frame may still work once the site is up. It never
 * stops anything from being saved or opened.
 */
export function FrameCheckNotice({ url, isTyping = false, actionSlot }: FrameCheckNoticeProps) {
  const check = useFrameCheck(url, isTyping ? TYPING_SETTLE_MS : 0).data;
  if (check?.framable !== false) {
    return null;
  }
  return (
    <Alert
      variant="warning"
      title="This site won't show inside the homepage"
      description={`${check.reason ?? 'The site forbids being framed.'} The frame will stay blank.`}
      actionSlot={actionSlot}
    />
  );
}
