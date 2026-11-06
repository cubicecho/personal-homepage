import { useState } from 'react';
import { useKnownGroups, VISIBLE_TO_COPY } from '@/auth/known-groups';
import { useAccess } from '@/auth/use-access';
import { CheckboxField, ComboboxField, InputField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormElement } from '@/components/ui/form-element';
import { messageOf } from '@/lib/error-message';
import { checkLength } from '@/pages/form-checks';
import { type Page, type Section, useAddSection, usePageLimits, useUpdateSection } from '@/pages/use-pages';

interface SectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The page the section is on, or is added to. */
  page: Page;
  /** The section to rename. Left out, the dialog adds one. */
  section?: Section | undefined;
}

/** What the form holds. */
interface SectionDraft {
  title: string;
  collapsed: boolean;
  /** The groups that may see it; empty for everyone. */
  visibleTo: string[];
}

/** Adds a section to a page, or changes one's heading and whether it starts folded. */
export function SectionDialog({ open, onOpenChange, page, section }: SectionDialogProps) {
  const limits = usePageLimits().data;
  const addSection = useAddSection();
  const updateSection = useUpdateSection();
  const [serverError, setServerError] = useState<string | undefined>(undefined);
  const isEdit = section !== undefined;
  const isSignInSet = useAccess().data?.mode === 'SIGN_IN';
  const knownGroups = useKnownGroups();

  const defaultValues: SectionDraft = {
    title: section?.title ?? '',
    collapsed: section?.collapsed ?? false,
    visibleTo: section?.visibleTo ?? [],
  };
  const form = useAppForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      setServerError(undefined);
      try {
        const title = value.title.trim();
        const input = { title: title === '' ? null : title, collapsed: value.collapsed, visibleTo: value.visibleTo };
        if (isEdit) {
          await updateSection.mutateAsync({ pageSlug: page.slug, id: section.id, input });
        } else {
          await addSection.mutateAsync({ pageSlug: page.slug, input });
        }
        onOpenChange(false);
      } catch (error) {
        setServerError(messageOf(error) ?? 'The section was not saved. Try again.');
      }
    },
  });

  return (
    <DialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? 'Edit section' : `Add a section to ${page.title}`}
      description={isEdit ? undefined : 'A section groups items under a heading that can be folded away.'}
      hasUnsavedChanges={() => form.state.isDefaultValue === false}
      contentSlot={
        <FormElement onSubmit={() => form.handleSubmit()}>
          <InputField
            form={form}
            name="title"
            label="Heading"
            autoFocus
            placeholder="Admin"
            description="Left blank, the items show with no heading."
            validators={{ onChange: ({ value }) => checkLength(value, limits?.maxTitleLength) }}
          />
          <CheckboxField
            form={form}
            name="collapsed"
            label="Start folded"
            description="Shown folded until someone opens it. Each browser remembers its own choice after that."
          />
          {isSignInSet ? (
            <ComboboxField
              form={form}
              name="visibleTo"
              label={VISIBLE_TO_COPY.label}
              description={VISIBLE_TO_COPY.description}
              placeholder={VISIBLE_TO_COPY.placeholder}
              createLabel={VISIBLE_TO_COPY.createLabel}
              multiple
              freeText
              options={knownGroups}
            />
          ) : null}
          {serverError === undefined ? null : (
            <Alert variant="destructive" title="Not saved" description={serverError} />
          )}
        </FormElement>
      }
      footerActionsSlot={(close) => (
        <>
          <Button variant="outline" onClick={close} content="Cancel" />
          <form.AppForm>
            {isEdit ? (
              <form.SubmitButton requireChanges content="Save changes" />
            ) : (
              <form.SubmitButton variant="info" content="Add section" pendingLabel="Adding…" />
            )}
          </form.AppForm>
        </>
      )}
    />
  );
}
