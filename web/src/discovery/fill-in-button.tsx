import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { Wand } from '@/core/app-icons';
import { messageOf } from '@/lib/error-message';
import { type DescribedUrl, useDescribeUrl } from './use-discovery';

interface FillInButtonProps {
  /** The address as typed. The button is off until it is a full http(s) address. */
  url: string;
  /** Called with what the page says; the caller fills in only the fields that are still empty. */
  onDescribed: (described: DescribedUrl) => void;
}

/**
 * "Fill in from this address": asks the server what the page says, and hands it to the dialog.
 *
 * @param props - The address and what to do with the answer.
 * @returns The button.
 */
export function FillInButton({ url, onDescribed }: FillInButtonProps) {
  const describe = useDescribeUrl();
  const toast = useToast();
  const address = url.trim();
  const isUsable = URL.canParse(address) && ['http:', 'https:'].includes(new URL(address).protocol);

  /** Describes the address and reports how it went. */
  const fillIn = async (): Promise<void> => {
    try {
      const described = await describe.mutateAsync(address);
      if (described.problem !== null) {
        toast(described.problem, 'warning');
        return;
      }
      onDescribed(described);
      toast(`Filled in from ${new URL(address).host}.`, 'positive');
    } catch (error) {
      toast(messageOf(error) ?? 'The address could not be read. Try again.', 'error');
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="self-start"
      iconSlot={<Wand />}
      content="Fill in from this address"
      loading={describe.isPending}
      disabled={isUsable === false}
      onClick={() => void fillIn()}
    />
  );
}
