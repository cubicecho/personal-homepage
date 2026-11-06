import { createFileRoute } from '@tanstack/react-router';
import { AccountCard } from '@/auth/account-card';
import { SignInSettings } from '@/auth/sign-in-settings';
import { PageLayout } from '@/components/page-layout';

export const Route = createFileRoute('/settings')({ component: SettingsRoute });

/**
 * Settings: how people sign in, and who is signed in here.
 *
 * @returns The page.
 */
function SettingsRoute() {
  return (
    <PageLayout
      title="Settings"
      width="prose"
      contentSlot={
        <>
          <AccountCard />
          <SignInSettings />
        </>
      }
    />
  );
}
