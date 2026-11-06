import { useNavigate } from '@tanstack/react-router';
import { CardLayout } from '@/components/card-layout';
import { DescriptionList, PropertyRow } from '@/components/description-list';
import { Button } from '@/components/ui/button';
import { useAccess, useSignOut } from './use-access';

/** The addresses the server makes up for an account with none (server/auth/better-auth.ts, forward-auth.ts). */
const PLACEHOLDER_EMAIL = /@(oidc|forward-auth)\.invalid$/;

/**
 * Checks whether an address was made up for an account that has none.
 *
 * @param email - The account's address.
 * @returns True for a placeholder, which means nothing to the person.
 */
function isPlaceholderEmail(email: string): boolean {
  return PLACEHOLDER_EMAIL.test(email);
}

/**
 * Who is signed in here, and the way out. Drawn only when someone is.
 *
 * @returns The card, or nothing.
 */
export function AccountCard() {
  const viewer = useAccess().data?.viewer ?? null;
  const signOut = useSignOut();
  const navigate = useNavigate();
  if (viewer === null) {
    return null;
  }
  const isOidc = viewer.via === 'OIDC';
  return (
    <CardLayout
      title="Your account"
      level={2}
      contentSlot={
        <DescriptionList
          contentSlot={
            <>
              <PropertyRow
                label="Signed in as"
                value={viewer.name ?? viewer.email}
                hint={isPlaceholderEmail(viewer.email) ? undefined : viewer.email}
              />
              <PropertyRow label="Groups" value={viewer.groups.length === 0 ? 'None' : viewer.groups.join(', ')} />
              <PropertyRow label="Role" value={viewer.isAdmin ? 'Admin' : 'Member'} />
              <PropertyRow
                label="Signed in through"
                value={isOidc ? 'The provider' : 'The proxy in front of this homepage'}
              />
            </>
          }
        />
      }
      footerActionsSlot={
        isOidc ? (
          <Button
            size="sm"
            variant="outline"
            content="Sign out"
            loading={signOut.isPending}
            onClick={() => signOut.mutate(undefined, { onSettled: () => void navigate({ to: '/login' }) })}
          />
        ) : null
      }
    />
  );
}
