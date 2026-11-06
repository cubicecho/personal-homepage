import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { SelectField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormElement } from '@/components/ui/form-element';
import { useToast } from '@/components/ui/toast';
import { messageOf } from '@/lib/error-message';
import { type Item, type Page, sectionLabel, useMoveItem, useMoveItemToPage, usePages } from './use-pages';

interface MoveItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The page the item is on. */
  page: Page;
  item: Item;
  /** The section the item is in now. */
  sectionId: string;
}

/** Where the item goes. */
interface Target {
  pageSlug: string;
  sectionId: string;
}

/**
 * Moves an item to another section, on its own page or another, to the end of it.
 *
 * @param props - The item, where it is, and whether the dialog is open.
 * @returns The dialog.
 *
 * @remarks
 * A move to another page leaves the reader where they are, and the toast that says where the item went
 * holds a link to go there.
 */
export function MoveItemDialog({ open, onOpenChange, page, item, sectionId }: MoveItemDialogProps) {
  const pages = usePages().data ?? [page];
  const moveItem = useMoveItem();
  const moveToPage = useMoveItemToPage();
  const toast = useToast();
  const [serverError, setServerError] = useState<string | undefined>(undefined);

  /**
   * Moves the item where the form says.
   *
   * @param target - The page and section chosen.
   */
  const move = async ({ pageSlug, sectionId: toSectionId }: Target): Promise<void> => {
    const isSamePage = pageSlug === page.slug;
    if (isSamePage) {
      const section = page.sections.find((candidate) => candidate.id === toSectionId);
      await moveItem.mutateAsync({ pageSlug, id: item.id, toSectionId, toIndex: section?.items.length ?? 0 });
      return;
    }
    const { to } = await moveToPage.mutateAsync({
      pageSlug: page.slug,
      id: item.id,
      toPageSlug: pageSlug,
      toSectionId: toSectionId === '' ? null : toSectionId,
    });
    toast(`Moved ${item.title} to ${to.title}.`, 'positive', {
      actionSlot: (dismiss) => <GoToPageLink page={to} onFollow={dismiss} />,
    });
  };

  const form = useAppForm({
    defaultValues: { pageSlug: page.slug, sectionId } satisfies Target,
    onSubmit: async ({ value }) => {
      setServerError(undefined);
      try {
        await move(value);
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
      description="It goes to the end of the section you pick, with everything about it."
      contentSlot={
        <FormElement onSubmit={() => form.handleSubmit()}>
          <SelectField
            form={form}
            name="pageSlug"
            label="Page"
            options={pages.map((candidate) => ({
              value: candidate.slug,
              label: candidate.slug === page.slug ? `${candidate.title} (where it is now)` : candidate.title,
            }))}
            listeners={{
              onChange: ({ value }) => {
                const isHere = value === page.slug;
                const chosen = pages.find((candidate) => candidate.slug === value);
                form.setFieldValue('sectionId', isHere ? sectionId : (chosen?.sections[0]?.id ?? ''));
              },
            }}
          />
          <form.Subscribe selector={(state) => state.values.pageSlug}>
            {(pageSlug) => {
              const chosen = pages.find((candidate) => candidate.slug === pageSlug);
              const sections = chosen?.sections ?? [];
              const isHere = pageSlug === page.slug;
              return sections.length > 1 ? (
                <SelectField
                  form={form}
                  name="sectionId"
                  label="Section"
                  options={sections.map((section) => ({
                    value: section.id,
                    label:
                      isHere && section.id === sectionId
                        ? `${sectionLabel(section)} (where it is now)`
                        : sectionLabel(section),
                  }))}
                />
              ) : null;
            }}
          </form.Subscribe>
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

interface GoToPageLinkProps {
  /** The page the item went to. */
  page: Page;
  /** Called as the link is followed: closes the toast it sits in. */
  onFollow: () => void;
}

/**
 * A link-styled "Go to <page>", for the toast that says an item moved.
 *
 * @param props - The page, and what to do as the link is followed.
 * @returns The link.
 */
function GoToPageLink({ page, onFollow }: GoToPageLinkProps) {
  const link = page.isHome ? (
    <Link to="/" onClick={onFollow} />
  ) : (
    <Link to="/pages/$slug" params={{ slug: page.slug }} onClick={onFollow} />
  );
  return <Button variant="link" size="sm" className="h-auto px-0" linkSlot={link} content={`Go to ${page.title}`} />;
}
