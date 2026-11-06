import { useState } from 'react';
import type { SsoSetupFieldsFragment } from '@/__generated__/graphql';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { messageOf } from '@/lib/error-message';
import { useUpdateSsoAppUrl } from './use-access';

interface CallbackNoticeProps {
  /** How sign-in is set up. */
  setup: SsoSetupFieldsFragment;
}

/**
 * Checks whether a provider sends sign-ins somewhere this browser can't follow: the server's own localhost,
 * or a recorded address other than the one this page is open at.
 *
 * @param setup - How sign-in is set up.
 * @returns True when signing in from here would not come back here.
 */
export function isCallbackWrong(setup: SsoSetupFieldsFragment): boolean {
  if (setup.source === 'NONE') {
    return false;
  }
  const isElsewhere = setup.appUrlSource !== 'ENV' && setup.appUrl !== window.location.origin;
  return setup.callbackIsLocal || isElsewhere;
}

/**
 * Warns when sign-ins would not come back to this address, and, for a paired provider and someone who may
 * change it, offers to move the callback here and tell the provider.
 *
 * @param props - The setup.
 * @returns The warning, or nothing when the callback is right.
 */
export function CallbackNotice({ setup }: CallbackNoticeProps) {
  const update = useUpdateSsoAppUrl();
  const toast = useToast();
  const [handEdit, setHandEdit] = useState<string | null>(null);

  if (handEdit !== null) {
    return <Alert variant="warning" title="Change it in the provider too" description={handEdit} />;
  }
  if (isCallbackWrong(setup) === false) {
    return null;
  }

  const canFix = setup.source === 'PAIRED' && setup.canPair;
  const fixHint = canFix
    ? 'Fix it to send sign-ins back to this address instead.'
    : 'Set APP_URL on the server to the address you open the homepage at, and restart it.';
  const fix = async (): Promise<void> => {
    try {
      const result = await update.mutateAsync();
      if (result.providerUpdated) {
        toast(`Sign-ins now come back to ${result.setup.appUrl}.`);
        return;
      }
      setHandEdit(result.message ?? `Register ${result.setup.redirectUri} as the redirect URI in your provider.`);
    } catch (error) {
      toast(messageOf(error) ?? 'The callback address was not changed. Try again.');
    }
  };

  // The button goes under the warning rather than beside it: the sign-in card is narrow, and the address in
  // the warning is long.
  return (
    <div className="flex flex-col items-start gap-2">
      <Alert
        variant="warning"
        title="Sign-in comes back to the wrong address"
        description={`The provider sends people back to ${setup.redirectUri}, which this browser can't reach. ${fixHint}`}
      />
      {canFix ? (
        <Button
          size="sm"
          variant="outline"
          loading={update.isPending}
          onClick={() => void fix()}
          content="Fix the callback address"
        />
      ) : null}
    </div>
  );
}
