import { useState } from 'react';
import { SelectField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { Button } from '@/components/ui/button';
import { FormElement } from '@/components/ui/form-element';
import { ItemDialog } from '@/pages/item-dialog';
import { sectionLabel, usePages } from '@/pages/use-pages';
import type { DiscoveredApp } from './use-discovery';

interface AddDiscoveredDialogProps {
  app: DiscoveredApp;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Where the app goes. */
interface Target {
  pageSlug: string;
  sectionId: string;
}

/**
 * Adds a discovered app to a page: first which page and section, then the item dialog, filled in from
 * the app and linked to it, to change anything before it is added.
 *
 * @param props - The app, and whether the dialog is open.
 * @returns The dialog for the step it is on.
 */
export function AddDiscoveredDialog({ app, open, onOpenChange }: AddDiscoveredDialogProps) {
  const pages = usePages().data ?? [];
  const [target, setTarget] = useState<Target | null>(null);
  const firstPage = pages[0];
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
        prefill={{
          title: app.name,
          url: app.url,
          icon: app.icon,
          description: app.description,
          discoveredId: app.id,
        }}
      />
    );
  }

  return (
    <DialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={`Add ${app.name} to a page`}
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
            <form.SubmitButton variant="info" content="Continue" />
          </form.AppForm>
        </>
      )}
    />
  );
}
