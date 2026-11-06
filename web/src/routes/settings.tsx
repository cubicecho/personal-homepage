import { createFileRoute, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useCanEdit } from '@/auth/use-access';
import { PageLayout } from '@/components/page-layout';
import { SegmentedButton, SegmentedGroup } from '@/components/ui/segmented';

export const Route = createFileRoute('/settings')({ component: SettingsRoute });

/** Settings' sections, by path. */
const SettingsSection = { General: '/settings', Discovery: '/settings/discovery' } as const;
type SettingsSection = (typeof SettingsSection)[keyof typeof SettingsSection];

/**
 * Settings: sign-in for everyone, and the apps found on the network for editors.
 *
 * @returns The page, with the open section under its title.
 */
function SettingsRoute() {
  const canEdit = useCanEdit();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const current: SettingsSection = pathname.startsWith(SettingsSection.Discovery)
    ? SettingsSection.Discovery
    : SettingsSection.General;
  return (
    <PageLayout
      title="Settings"
      width="prose"
      headerContentSlot={
        canEdit ? (
          <SegmentedGroup<SettingsSection>
            aria-label="Settings sections"
            value={current}
            onValueChange={(to) => void navigate({ to })}
          >
            <SegmentedButton value={SettingsSection.General}>General</SegmentedButton>
            <SegmentedButton value={SettingsSection.Discovery}>Discovered apps</SegmentedButton>
          </SegmentedGroup>
        ) : null
      }
      contentSlot={<Outlet />}
    />
  );
}
