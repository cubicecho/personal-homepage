import { useState } from 'react';
import { SelectField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { Button } from '@/components/ui/button';
import { FormElement } from '@/components/ui/form-element';
import { ItemDialog, type ItemPrefill } from './item-dialog';
import { type Page, sectionLabel, usePages } from './use-pages';

interface AddToPageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The first step's title, such as "Add Jellyfin to a page". */
  title: string;
  /** What the new item starts with. */
  prefill: ItemPrefill;
  /** The page chosen to start with. Left out, or not a page, the first. */
  defaultPageSlug?: string | undefined;
  /** Runs "Fill in from this address" when the item dialog opens. */
  autoFillIn?: boolean | undefined;
  /** Called with the page the item was added to, and its title, once it is saved. */
  onAdded?: ((page: Page, title: string) => void) | undefined;
}

/** Where the item goes. */
interface Target {
  pageSlug: string;
  sectionId: string;
}

/**
 * Adds an item from somewhere else (a discovered app, a page the bookmarklet sent) in two steps: first
 * which page and section, then the item dialog filled in, to change anything before it is added.
 *
 * @param props - What to add, where to start, and what to do once it is added.
 * @returns The dialog for the step it is on.
 */
export function AddToPageDialog({
  open,
  onOpenChange,
  title,
  prefill,
  defaultPageSlug,
  autoFillIn = false,
  onAdded,
}: AddToPageDialogProps) {
  const pages = usePages().data ?? [];
  const [target, setTarget] = useState<Target | null>(null);
  const firstPage = pages.find((candidate) => candidate.slug === defaultPageSlug) ?? pages[0];
  const form = useAppForm({
    defaultValues: { pageSlug: firstPage?.slug ?? '', sectionId: firstPage?.sections[0]?.id ?? '' },
    onSubmit: ({ value }) => setTarget(value),
  });

  const page = target === null ? undefined : pages.find((candidate) => candidate.slug === target.pageSlug);
  if (page !== undefined && target !== null) {
    return (
      <ItemDialog
        open={open}
        onOpenChange={onOpenChange}
        page={page}
        sectionId={target.sectionId}
        prefill={prefill}
        autoFillIn={autoFillIn}
        onAdded={(added) => onAdded?.(page, added)}
      />
    );
  }

  return (
    <DialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      contentSlot={
        <FormElement onSubmit={() => form.handleSubmit()}>
          <SelectField
            form={form}
            name="pageSlug"
            label="Page"
            options={pages.map((candidate) => ({ value: candidate.slug, label: candidate.title }))}
            listeners={{
              onChange: ({ value }) => {
                const chosen = pages.find((candidate) => candidate.slug === value);
                form.setFieldValue('sectionId', chosen?.sections[0]?.id ?? '');
              },
            }}
          />
          <form.Subscribe selector={(state) => state.values.pageSlug}>
            {(pageSlug) => {
              const chosen = pages.find((candidate) => candidate.slug === pageSlug);
              const sections = chosen?.sections ?? [];
              return sections.length > 1 ? (
                <SelectField
                  form={form}
                  name="sectionId"
                  label="Section"
                  options={sections.map((section) => ({ value: section.id, label: sectionLabel(section) }))}
                />
              ) : null;
            }}
          </form.Subscribe>
        </FormElement>
      }
      footerActionsSlot={(close) => (
        <>
          <Button variant="outline" onClick={close} content="Cancel" />
          <form.AppForm>
            <form.SubmitButton variant="info" createLabel="Continue" />
          </form.AppForm>
        </>
      )}
    />
  );
}
