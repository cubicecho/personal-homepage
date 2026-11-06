import { createFileRoute } from '@tanstack/react-router';
import { AccountCard } from '@/auth/account-card';
import { SignInSettings } from '@/auth/sign-in-settings';
import { LayoutSettings } from '@/sections/layout-settings';

export const Route = createFileRoute('/settings/')({ component: GeneralSettingsRoute });

/**
 * Settings' first section: who is signed in here, how the pages are laid out, and how people sign in.
 *
 * @returns The section.
 */
function GeneralSettingsRoute() {
  return (
    <div className="flex flex-col gap-6">
      <AccountCard />
      <LayoutSettings />
      <SignInSettings />
    </div>
  );
}
