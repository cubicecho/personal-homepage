import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Radar } from '@/core/app-icons';
import { useDiscoveredApps } from './use-discovery';

interface LinkedAppNoteProps {
  /** The discovered app the item is linked to. */
  discoveredId: string;
  /** Unlinks the item; saving the dialog keeps the change. */
  onUnlink: () => void;
}

/**
 * Says an item came from a discovered app, with a way to unlink it.
 *
 * @param props - The linked app and what unlinking does.
 * @returns The note.
 */
export function LinkedAppNote({ discoveredId, onUnlink }: LinkedAppNoteProps) {
  const app = useDiscoveredApps(true).data?.find((candidate) => candidate.id === discoveredId);
  const name = app === undefined ? 'an app found on your network' : `${app.name}, found on your network`;
  return (
    <Alert
      variant="info"
      iconSlot={<Radar />}
      title="Linked to a discovered app"
      description={`Added from ${name}. Edit it like any other item; unlinking only removes it from that app's list.`}
      actionSlot={<Button variant="outline" size="sm" content="Unlink" onClick={onUnlink} />}
    />
  );
}
