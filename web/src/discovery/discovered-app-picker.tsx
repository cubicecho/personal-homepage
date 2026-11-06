import { useState } from 'react';
import { Combobox } from '@/components/combobox';
import { FormField } from '@/components/form-field';
import { SegmentedButton, SegmentedGroup } from '@/components/ui/segmented';
import { type DiscoveredApp, useDiscoveredApps } from './use-discovery';

/** Where a new item's details come from. */
const ItemSource = { Discovered: 'discovered', Manual: 'manual' } as const;
type ItemSource = (typeof ItemSource)[keyof typeof ItemSource];

interface DiscoveredAppPickerProps {
  /** The app the item is linked to now, or null. */
  discoveredId: string | null;
  /** Fills the form from an app and links the item to it. */
  onPick: (app: DiscoveredApp) => void;
  /** Unlinks the item; what was filled in stays, to be edited. */
  onManual: () => void;
}

/**
 * Says where an app was already added, for the picker's list.
 *
 * @param app - The app.
 * @returns "Jellyfin · nas.lan:8096", with "on Media" when it is already on a page.
 */
function optionLabel(app: DiscoveredApp): string {
  const host = URL.canParse(app.url) ? new URL(app.url).host : app.url;
  const pages = app.addedTo.map((placement) => placement.pageTitle);
  const placed = pages.length === 0 ? '' : ` · already on ${pages.join(', ')}`;
  return `${app.name} · ${host}${placed}`;
}

/**
 * The item dialog's first choice when adding: an app the server found, or details typed by hand. Draws
 * nothing when there are no found apps to offer, so the dialog is as it always was.
 *
 * @param props - The current link and what choosing does.
 * @returns The choice, and the list of found apps while that is chosen.
 */
export function DiscoveredAppPicker({ discoveredId, onPick, onManual }: DiscoveredAppPickerProps) {
  const apps = useDiscoveredApps(false).data ?? [];
  const [source, setSource] = useState<ItemSource>(discoveredId === null ? ItemSource.Manual : ItemSource.Discovered);
  if (apps.length === 0) {
    return null;
  }

  /**
   * Switches between a found app and typing the details.
   *
   * @param next - The choice.
   */
  const choose = (next: ItemSource): void => {
    setSource(next);
    if (next === ItemSource.Manual) {
      onManual();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <SegmentedGroup<ItemSource> aria-label="Where the details come from" value={source} onValueChange={choose}>
        <SegmentedButton value={ItemSource.Discovered}>Discovered app</SegmentedButton>
        <SegmentedButton value={ItemSource.Manual}>Enter manually</SegmentedButton>
      </SegmentedGroup>
      {source === ItemSource.Discovered ? (
        <FormField
          label="App"
          description="Found on your network. Choosing one fills in the details below, which you can still change."
          controlSlot={(wired) => (
            <Combobox
              {...wired}
              searchable
              placeholder="Choose an app"
              searchPlaceholder="Search found apps"
              emptyMessage="No found app matches."
              options={apps.map((app) => ({ value: app.id, label: optionLabel(app) }))}
              value={discoveredId ?? undefined}
              onValueChange={(id) => {
                const app = apps.find((candidate) => candidate.id === id);
                if (app !== undefined) {
                  onPick(app);
                }
              }}
            />
          )}
        />
      ) : null}
    </div>
  );
}
