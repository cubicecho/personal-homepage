import { AddToPageDialog } from '@/pages/add-to-page-dialog';
import type { DiscoveredApp } from './use-discovery';

interface AddDiscoveredDialogProps {
  app: DiscoveredApp;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Adds a discovered app to a page: first which page and section, then the item dialog, filled in from
 * the app and linked to it, to change anything before it is added.
 *
 * @param props - The app, and whether the dialog is open.
 * @returns The dialog for the step it is on.
 */
export function AddDiscoveredDialog({ app, open, onOpenChange }: AddDiscoveredDialogProps) {
  return (
    <AddToPageDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Add ${app.name} to a page`}
      prefill={{ title: app.name, url: app.url, icon: app.icon, description: app.description, discoveredId: app.id }}
    />
  );
}
