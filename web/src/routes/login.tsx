import { createFileRoute, Link } from '@tanstack/react-router';
import { LogIn } from 'lucide-react';
import { CallbackNotice } from '@/auth/callback-notice';
import { useAccess, useAuthConfig, useSsoSetup } from '@/auth/use-access';
import { CenteredLayout } from '@/components/centered-layout';
import { QueryError } from '@/components/query-state';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/** What `?error=` says, from http/sso.ts or better-auth's callback. */
interface LoginSearch {
  error?: string | undefined;
}

export const Route = createFileRoute('/login')({
  component: LoginRoute,
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
});

/** The provider is gone: it was disconnected after this page loaded. */
const SSO_OFF = 'sso_off';

/**
 * Says what went wrong with the last sign-in, in words.
 *
 * @param code - The `?error=` the server sent the browser back with.
 * @returns The sentence.
 */
function errorSentence(code: string): string {
  if (code === SSO_OFF) {
    return 'Signing in through a provider is not set up any more.';
  }
  return 'Signing in did not work. Try again, and if it keeps failing, ask whoever runs this homepage.';
}

/**
 * The sign-in page: the provider's button, or where to sign in instead. Drawn without the app's shell.
 *
 * @returns The page.
 */
function LoginRoute() {
  const { error } = Route.useSearch();
  const config = useAuthConfig();
  // Read here too: a pairing that registered the wrong callback is fixed from this page, since nobody
  // can sign in to reach Settings.
  const setup = useSsoSetup().data;
  const viewer = useAccess().data?.viewer ?? null;
  const notice =
    error === undefined ? null : (
      <Alert variant="destructive" title="Not signed in" description={errorSentence(error)} />
    );

  if (config.isError) {
    return (
      <CenteredLayout
        title="Sign in"
        contentSlot={<QueryError error={config.error} onRetry={config.refetch} what="how to sign in" />}
      />
    );
  }
  if (config.data === undefined) {
    return <CenteredLayout title="Sign in" loading contentSlot={null} />;
  }

  const { mode, sso, forwardAuth } = config.data;
  if (viewer !== null || mode === 'OPEN') {
    return (
      <CenteredLayout
        title={viewer === null ? 'No sign-in needed' : 'You are signed in'}
        description={
          viewer === null
            ? 'Sign-in is not set up on this homepage, so anyone who can reach it can use it.'
            : `Signed in as ${viewer.name ?? viewer.email}.`
        }
        footerActionsSlot={<Button variant="info" linkSlot={<Link to="/" />} content="Go to the homepage" />}
      />
    );
  }

  return (
    <CenteredLayout
      iconSlot={<LogIn />}
      title="Sign in"
      description={
        sso === null
          ? 'This homepage signs you in through the proxy in front of it.'
          : `Sign in with ${sso.name} to see this homepage.`
      }
      contentSlot={
        <>
          {setup === undefined ? null : <CallbackNotice setup={setup} />}
          {notice}
          {sso === null && forwardAuth ? (
            <p className="text-foreground/70 text-sm">
              Open the homepage through the address your proxy serves it at, and sign in there.
            </p>
          ) : null}
        </>
      }
      footerActionsSlot={
        sso === null ? null : (
          // A full-page navigation: the browser leaves for the provider and comes back to /auth/sso.
          <Button variant="info" linkSlot={<a href={sso.signInUrl} />} content={`Sign in with ${sso.name}`} />
        )
      }
    />
  );
}
