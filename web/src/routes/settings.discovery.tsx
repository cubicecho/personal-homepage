import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useAccess } from '@/auth/use-access';
import { DiscoveredAppsView } from '@/discovery/discovered-apps-view';

export const Route = createFileRoute('/settings/discovery')({ component: DiscoverySettingsRoute });

/**
 * Settings' Discovered apps section. Editors only: the list maps the network, so anyone else is sent back
 * to the first section.
 *
 * @returns The section, or a redirect.
 */
function DiscoverySettingsRoute() {
  const access = useAccess().data;
  if (access === undefined) {
    return null;
  }
  return access.canEdit ? <DiscoveredAppsView /> : <Navigate to="/settings" replace />;
}
