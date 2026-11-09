import { useState } from 'react';
import type { SsoSetupFieldsFragment } from '@/__generated__/graphql';
import { InputField, useAppForm } from '@/components/app-form';
import { CardLayout } from '@/components/card-layout';
import { ConfirmButton } from '@/components/confirm-button';
import { LoadError } from '@/components/load-state';
import { PropertyList, PropertyRow } from '@/components/property-list';
import { Alert } from '@/components/ui/alert';
import { FormElement } from '@/components/ui/form-element';
import { useToast } from '@/components/ui/toast';
import { messageOf } from '@/lib/error-message';
import { CallbackNotice } from './callback-notice';
import { useAccess, useAuthConfig, usePairSso, useSsoSetup, useUnpairSso } from './use-access';

/** Where a provider can come from, in words. */
const SOURCE_LABELS = {
  ENV: 'Set in the server’s environment (OIDC_ISSUER)',
  PAIRED: 'Paired from a setup URL',
  NONE: 'None',
} as const;

/**
 * Says where the provider came from, under its name.
 *
 * @param source - Where it came from.
 * @param issuer - Its issuer, when the caller may see it.
 * @returns The line, or nothing when there is no provider.
 */
function providerHint(source: keyof typeof SOURCE_LABELS, issuer: string | null): string | undefined {
  if (source === 'NONE') {
    return undefined;
  }
  return issuer === null ? SOURCE_LABELS[source] : `${SOURCE_LABELS[source]}: ${issuer}`;
}

/**
 * Says where the callback address comes from, under it.
 *
 * @param setup - How sign-in is set up.
 * @returns The line.
 */
function callbackHint(setup: SsoSetupFieldsFragment): string {
  if (setup.source === 'ENV') {
    return 'Register this as the redirect URI with the provider.';
  }
  if (setup.appUrlSource === 'ENV') {
    return 'Under APP_URL, set on the server.';
  }
  if (setup.appUrlSource === 'PAIRED') {
    return 'Under the address the homepage was open at when it was paired.';
  }
  return 'Pairing registers it under the address you have the homepage open at, unless APP_URL is set.';
}

/** What a setup URL looks like, for the field's hint. */
const SETUP_URL_EXAMPLE = 'https://id.example.com/oidc#setup=…&name=heautou';

/**
 * Pastes a provider's setup URL to pair with it.
 *
 * @returns The form.
 */
function PairForm() {
  const pair = usePairSso();
  const [serverError, setServerError] = useState<string | undefined>(undefined);
  const form = useAppForm({
    defaultValues: { setupUrl: '' },
    onSubmit: async ({ value }) => {
      setServerError(undefined);
      try {
        await pair.mutateAsync(value.setupUrl.trim());
      } catch (error) {
        setServerError(messageOf(error) ?? 'The provider was not paired. Try again.');
      }
    },
  });
  return (
    <FormElement onSubmit={() => form.handleSubmit()}>
      <InputField
        form={form}
        name="setupUrl"
        label="Setup URL"
        description="In heautou: Clients, then Pair an app. Choose the groups that may sign in, then copy the setup URL here."
        placeholder={SETUP_URL_EXAMPLE}
        autoCapitalize="none"
        spellCheck={false}
        validators={{ onChange: ({ value }) => (value.trim() === '' ? 'Paste the setup URL.' : undefined) }}
      />
      {serverError === undefined ? null : <Alert variant="destructive" title="Not paired" description={serverError} />}
      <form.AppForm>
        <form.SubmitButton variant="info" createLabel="Pair" loadingLabel="Pairing…" />
      </form.AppForm>
    </FormElement>
  );
}

/**
 * How people sign in, and the controls to change it for whoever may.
 *
 * @returns The card.
 */
export function SignInSettings() {
  const setup = useSsoSetup();
  const config = useAuthConfig();
  const access = useAccess();
  const unpair = useUnpairSso();
  const toast = useToast();

  const failed = setup.error ?? config.error ?? access.error;
  if (failed) {
    return (
      <CardLayout
        title="Sign-in"
        level={2}
        contentSlot={<LoadError error={failed} onRetry={() => void setup.refetch()} what="how sign-in is set up" />}
      />
    );
  }
  const isLoading = setup.data === undefined || config.data === undefined || access.data === undefined;
  if (isLoading) {
    return <CardLayout title="Sign-in" level={2} loading contentSlot={null} />;
  }

  const { source, name, canPair, redirectUri, issuer } = setup.data;
  const isOpen = access.data.mode === 'OPEN';
  const whoEdits = isOpen
    ? 'Anyone who can reach this homepage.'
    : 'The admin (the first account), and members of ADMIN_GROUPS.';

  return (
    <CardLayout
      title="Sign-in"
      level={2}
      description="Who can see and change this homepage, and how they sign in."
      contentSlot={
        <div className="flex flex-col gap-4">
          {isOpen ? (
            <Alert
              variant="warning"
              title="Anyone who can reach this homepage can change it"
              description="Pair a provider below, such as heautou, so that people have to sign in. Or put it behind a proxy that does forward auth, and set FORWARD_AUTH_TRUSTED_PROXIES."
            />
          ) : null}
          <PropertyList
            contentSlot={
              <>
                <PropertyRow label="Who can change it" value={whoEdits} />
                <PropertyRow label="Provider" value={name ?? SOURCE_LABELS.NONE} hint={providerHint(source, issuer)} />
                <PropertyRow label="Forward auth" value={config.data.forwardAuth ? 'On' : 'Off'} />
                <PropertyRow
                  label="Without signing in"
                  value={config.data.publicView ? 'People can see the pages (PUBLIC_VIEW)' : 'Nothing can be seen'}
                />
                <PropertyRow label="Callback address" value={redirectUri} hint={callbackHint(setup.data)} />
              </>
            }
          />
          <CallbackNotice setup={setup.data} />
          {source === 'NONE' && canPair ? <PairForm /> : null}
          {source !== 'ENV' && canPair === false ? (
            <p className="text-foreground/70 text-sm">Only the admin can change how people sign in.</p>
          ) : null}
        </div>
      }
      footerActionsSlot={
        source === 'PAIRED' && canPair ? (
          <ConfirmButton
            size="sm"
            content={`Disconnect ${name ?? 'the provider'}`}
            title={`Disconnect ${name ?? 'the provider'}?`}
            description="Nobody will be able to sign in with it. Unless forward auth is on, anyone who can reach this homepage will be able to change it again."
            confirmLabel="Disconnect"
            onConfirm={() =>
              unpair.mutate(undefined, {
                onError: (error) => toast(messageOf(error) ?? 'The provider was not disconnected. Try again.'),
              })
            }
          />
        ) : null
      }
    />
  );
}
