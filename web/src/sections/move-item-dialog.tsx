import { useState } from 'react';
import { SelectField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormElement } from '@/components/ui/form-element';
import { messageOf } from '@/lib/error-message';
import { type Item, type Page, sectionLabel, useMoveItem } from '@/pages/use-pages';

interface MoveItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: Page;
  item: Item;
  /** The section the item is in now. */
  sectionId: string;
}

/** Moves an item to the end of another section on its page. */
export function MoveItemDialog({ open, onOpenChange, page, item, sectionId }: MoveItemDialogProps) {
  const moveItem = useMoveItem();
  const [serverError, setServerError] = useState<string | undefined>(undefined);
  const options = page.sections.map((section) => ({
    value: section.id,
    label: section.id === sectionId ? `${sectionLabel(section)} (where it is now)` : sectionLabel(section),
  }));

  const form = useAppForm({
    defaultValues: { sectionId },
    onSubmit: async ({ value }) => {
      setServerError(undefined);
      const target = page.sections.find((section) => section.id === value.sectionId);
      try {
        await moveItem.mutateAsync({
          pageSlug: page.slug,
          id: item.id,
          toSectionId: value.sectionId,
          toIndex: target?.items.length ?? 0,
        });
        onOpenChange(false);
      } catch (error) {
        setServerError(messageOf(error) ?? 'The item was not moved. Try again.');
      }
    },
  });

  return (
    <DialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={`Move ${item.title}`}
      description="It goes to the end of the section you pick."
      contentSlot={
        <FormElement onSubmit={() => form.handleSubmit()}>
          <SelectField form={form} name="sectionId" label="Section" options={options} />
          {serverError === undefined ? null : (
            <Alert variant="destructive" title="Not moved" description={serverError} />
          )}
        </FormElement>
      }
      footerActionsSlot={(close) => (
        <>
          <Button variant="outline" onClick={close} content="Cancel" />
          <form.AppForm>
            <form.SubmitButton requireChanges variant="info" content="Move" pendingLabel="Moving…" />
          </form.AppForm>
        </>
      )}
    />
  );
}
