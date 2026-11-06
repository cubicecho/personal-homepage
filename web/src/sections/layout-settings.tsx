import { useState } from 'react';
import { useCanEdit } from '@/auth/use-access';
import { SelectField, useAppForm } from '@/components/app-form';
import { CardLayout } from '@/components/card-layout';
import { DescriptionList, PropertyRow } from '@/components/description-list';
import { QueryError } from '@/components/query-state';
import { Alert } from '@/components/ui/alert';
import { FormElement } from '@/components/ui/form-element';
import { useToast } from '@/components/ui/toast';
import { messageOf } from '@/lib/error-message';
import { columnsLabel } from '@/pages/column-span';
import { type SiteLayout, useSetLayoutColumns, useSiteLayout } from './use-site-layout';

const TITLE = 'Layout';
const DESCRIPTION = 'How the cards on every page are laid out.';
const COLUMNS_HINT =
  'How many columns a section has on a wide screen, and so the widest a widget or frame can be set to. A narrower screen has fewer; a phone has one.';

/**
 * The Columns setting, as a form with its own Save.
 *
 * @param props - The layout the server has now.
 * @param props.layout - The columns in use and the bounds the setting may take.
 * @returns The form.
 */
function ColumnsForm({ layout }: { layout: SiteLayout }) {
  const setColumns = useSetLayoutColumns();
  const toast = useToast();
  const [serverError, setServerError] = useState<string | undefined>(undefined);
  const options = [];
  for (let columns = layout.minColumns; columns <= layout.maxColumns; columns += 1) {
    options.push({ value: String(columns), label: columnsLabel(columns) });
  }
  const form = useAppForm({
    defaultValues: { columns: String(layout.columns) },
    onSubmit: async ({ value }) => {
      setServerError(undefined);
      try {
        const saved = await setColumns.mutateAsync(Number(value.columns));
        form.reset({ columns: String(saved.columns) });
        toast(`Pages now have ${columnsLabel(saved.columns)}.`, 'positive');
      } catch (error) {
        setServerError(messageOf(error) ?? 'The columns were not saved. Try again.');
      }
    },
  });
  return (
    <FormElement onSubmit={() => form.handleSubmit()}>
      <SelectField form={form} name="columns" label="Columns" description={COLUMNS_HINT} options={options} />
      {serverError === undefined ? null : <Alert variant="destructive" title="Not saved" description={serverError} />}
      <form.AppForm>
        <form.SubmitButton requireChanges content="Save layout" pendingLabel="Saving…" />
      </form.AppForm>
    </FormElement>
  );
}

/**
 * Settings' layout card: the Columns setting for whoever may change it, the value for everyone else.
 *
 * @returns The card.
 */
export function LayoutSettings() {
  const layout = useSiteLayout();
  const canEdit = useCanEdit();

  if (layout.error) {
    return (
      <CardLayout
        title={TITLE}
        level={2}
        contentSlot={<QueryError error={layout.error} onRetry={() => void layout.refetch()} what="the layout" />}
      />
    );
  }
  if (layout.data === undefined) {
    return <CardLayout title={TITLE} level={2} loading contentSlot={null} />;
  }
  return (
    <CardLayout
      title={TITLE}
      level={2}
      description={DESCRIPTION}
      contentSlot={
        canEdit ? (
          <ColumnsForm key={layout.data.columns} layout={layout.data} />
        ) : (
          <DescriptionList
            contentSlot={<PropertyRow label="Columns" value={columnsLabel(layout.data.columns)} hint={COLUMNS_HINT} />}
          />
        )
      }
    />
  );
}
