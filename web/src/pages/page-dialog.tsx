import { useState } from 'react';
import { useKnownGroups, VISIBLE_TO_COPY } from '@/auth/known-groups';
import { useAccess } from '@/auth/use-access';
import { ComboboxField, InputField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormElement } from '@/components/ui/form-element';
import { messageOf } from '@/lib/error-message';
import { checkSlug, checkTitle } from './form-checks';
import { IconField } from './icon-field';
import { type Page, useCreatePage, usePageLimits, useUpdatePage } from './use-pages';

interface PageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The page to edit. Left out, the dialog creates one. */
  page?: Page | undefined;
  /** Told the page as the server saved it, after the dialog closes. */
  onSaved?: ((page: Page) => void) | undefined;
}

/** What the form holds. */
interface PageDraft {
  title: string;
  slug: string;
  icon: string | null;
  /** The groups that may see it; empty for everyone. */
  visibleTo: string[];
}

/** Creates a page, or changes one's title and icon. */
export function PageDialog({ open, onOpenChange, page, onSaved }: PageDialogProps) {
  const limits = usePageLimits().data;
  const createPage = useCreatePage();
  const updatePage = useUpdatePage();
  const [serverError, setServerError] = useState<string | undefined>(undefined);
  const isEdit = page !== undefined;
  const isSignInSet = useAccess().data?.mode === 'SIGN_IN';
  const knownGroups = useKnownGroups();

  const defaultValues: PageDraft = {
    title: page?.title ?? '',
    slug: '',
    icon: page?.icon ?? null,
    visibleTo: page?.visibleTo ?? [],
  };
  const form = useAppForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      setServerError(undefined);
      try {
        const title = value.title.trim();
        const slug = value.slug.trim();
        const saved = isEdit
          ? await updatePage.mutateAsync({
              slug: page.slug,
              input: { title, icon: value.icon, visibleTo: value.visibleTo },
            })
          : await createPage.mutateAsync({
              title,
              icon: value.icon,
              visibleTo: value.visibleTo,
              ...(slug === '' ? {} : { slug }),
            });
        onOpenChange(false);
        onSaved?.(saved);
      } catch (error) {
        setServerError(messageOf(error) ?? 'The page was not saved. Try again.');
      }
    },
  });

  return (
    <DialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? 'Edit page' : 'New page'}
      description={
        isEdit ? undefined : 'A page holds its own tiles, links and frames, and gets a place in the sidebar.'
      }
      hasUnsavedChanges={() => form.state.isDefaultValue === false}
      contentSlot={
        <FormElement onSubmit={() => form.handleSubmit()}>
          <InputField
            form={form}
            name="title"
            label="Title"
            required
            autoFocus
            placeholder="Media"
            validators={{ onChange: ({ value }) => checkTitle(value, limits?.maxTitleLength) }}
          />
          {isEdit ? null : (
            <InputField
              form={form}
              name="slug"
              label="Address"
              description="The page's part of the URL, as in /pages/media. Left blank, it is made from the title."
              placeholder="media"
              autoCapitalize="none"
              spellCheck={false}
              validators={{ onChange: ({ value }) => checkSlug(value, limits?.maxSlugLength) }}
            />
          )}
          <IconField form={form} name="icon" label="Icon" />
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
              <form.SubmitButton variant="info" content="Create page" pendingLabel="Creating…" />
            )}
          </form.AppForm>
        </>
      )}
    />
  );
}
