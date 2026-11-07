import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { takeReturnTo } from '@/auth/return-to';
import { useFinishSignIn } from '@/auth/use-access';
import { CenteredCardLayout } from '@/components/centered-card-layout';
import { Button } from '@/components/ui/button';
import { messageOf } from '@/lib/error-message';

/** The one-time token the server put on the URL. */
interface SsoSearch {
  token?: string | undefined;
}

export const Route = createFileRoute('/auth/sso')({
  component: FinishSignInRoute,
  validateSearch: (search: Record<string, unknown>): SsoSearch => ({
    token: typeof search.token === 'string' ? search.token : undefined,
  }),
});

/**
 * Where the provider's sign-in lands: spends the one-time token for a session, then goes back to the page
 * that sent the browser to sign in, or home.
 *
 * @returns The page, while it works or when it failed.
 *
 * @remarks
 * The token works once, so it is spent once even though strict mode runs effects twice.
 */
function FinishSignInRoute() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const finish = useFinishSignIn();
  const hasStarted = useRef(false);

  useEffect(() => {
    if (hasStarted.current || token === undefined) {
      return;
    }
    hasStarted.current = true;
    finish.mutate(token, {
      // Back to the page that sent the browser to sign in (a bookmarklet's /add?…), or home.
      onSuccess: () => void navigate({ href: takeReturnTo() ?? '/', replace: true }),
    });
  }, [token, finish, navigate]);

  const isFailed = token === undefined || finish.isError;
  if (isFailed) {
    return (
      <CenteredCardLayout
        title="Not signed in"
        description={
          (finish.isError ? messageOf(finish.error) : undefined) ??
          'This link has no sign-in in it. Sign-ins have to be finished within a few minutes, and only once.'
        }
        footerActionsSlot={<Button variant="info" linkSlot={<Link to="/login" />} content="Sign in again" />}
      />
    );
  }
  return <CenteredCardLayout title="Signing you in…" loading contentSlot={null} />;
}
