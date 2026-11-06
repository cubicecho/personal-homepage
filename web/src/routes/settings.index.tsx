import { createFileRoute } from '@tanstack/react-router';
import { AccountCard } from '@/auth/account-card';
import { SignInSettings } from '@/auth/sign-in-settings';

export const Route = createFileRoute('/settings/')({ component: GeneralSettingsRoute });

/**
 * Settings' first section: how people sign in, and who is signed in here.
 *
 * @returns The section.
 */
function GeneralSettingsRoute() {
  return (
    <div className="flex flex-col gap-6">
      <AccountCard />
      <SignInSettings />
    </div>
  );
}
