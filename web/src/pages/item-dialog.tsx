import { useState } from 'react';
import type { ItemInput, ItemKind, OpensIn } from '@/__generated__/graphql';
import { InputField, NumberField, TextareaField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { RadioGroupField, type RadioOption } from '@/components/radio-group-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormElement } from '@/components/ui/form-element';
import { messageOf } from '@/lib/error-message';
import { checkFrameHeight, checkLength, checkTitle, checkUrl } from './form-checks';
import { IconField } from './icon-field';
import { ITEM_KINDS, OPENS_IN } from './item-kinds';
import { type Item, type Page, useAddItem, usePageLimits, useUpdateItem } from './use-pages';

interface ItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The page the item is on, or is added to. */
  page: Page;
  /** The item to edit. Left out, the dialog adds one. */
  item?: Item | undefined;
}

/** What the form holds. */
interface ItemDraft {
  kind: ItemKind;
  opensIn: OpensIn;
  title: string;
  url: string;
  icon: string | null;
  description: string;
  frameHeightPx: number | null;
}

const KIND_OPTIONS: readonly RadioOption[] = Object.entries(ITEM_KINDS).map(([kind, { Glyph, label, summary }]) => ({
  value: kind,
  label,
  description: summary,
  iconSlot: <Glyph />,
}));

const OPENS_IN_OPTIONS: readonly RadioOption[] = Object.entries(OPENS_IN).map(
  ([opensIn, { Glyph, label, summary }]) => ({
    value: opensIn,
    label,
    description: summary,
    iconSlot: <Glyph />,
  }),
);

/**
 * Turns the form's values into the API's input.
 *
 * @param draft - The form's values.
 * @returns The input: trimmed, a blank description as null, and the height only for a frame.
 */
function toInput(draft: ItemDraft): ItemInput {
  const description = draft.description.trim();
  const isFrame = draft.kind === 'FRAME';
  return {
    kind: draft.kind,
    opensIn: isFrame ? null : draft.opensIn,
    title: draft.title.trim(),
    url: draft.url.trim(),
    icon: draft.icon,
    description: description === '' ? null : description,
    frameHeightPx: isFrame ? draft.frameHeightPx : null,
  };
}

/** Adds an item to a page, or changes one. */
export function ItemDialog({ open, onOpenChange, page, item }: ItemDialogProps) {
  const limits = usePageLimits().data;
  const addItem = useAddItem();
  const updateItem = useUpdateItem();
  const [serverError, setServerError] = useState<string | undefined>(undefined);
  const isEdit = item !== undefined;
  const heightBounds = limits && { min: limits.minFrameHeightPx, max: limits.maxFrameHeightPx };

  const defaultValues: ItemDraft = {
    kind: item?.kind ?? 'LINK',
    opensIn: item?.opensIn ?? 'NEW_TAB',
    title: item?.title ?? '',
    url: item?.url ?? '',
    icon: item?.icon ?? null,
    description: item?.description ?? '',
    frameHeightPx: item?.frameHeightPx ?? null,
  };
  const form = useAppForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      setServerError(undefined);
      try {
        const input = toInput(value);
        if (isEdit) {
          await updateItem.mutateAsync({ pageSlug: page.slug, id: item.id, input });
        } else {
          await addItem.mutateAsync({ pageSlug: page.slug, input });
        }
        onOpenChange(false);
      } catch (error) {
        setServerError(messageOf(error) ?? 'The item was not saved. Try again.');
      }
    },
  });

  return (
    <DialogLayout
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={isEdit ? 'Edit item' : `Add to ${page.title}`}
      hasUnsavedChanges={() => form.state.isDefaultValue === false}
      contentSlot={
        <FormElement onSubmit={() => form.handleSubmit()}>
          <RadioGroupField form={form} name="kind" label="Kind" variant="card" options={KIND_OPTIONS} />
          <InputField
            form={form}
            name="title"
            label="Title"
            required
            autoFocus
            placeholder="Jellyfin"
            validators={{ onChange: ({ value }) => checkTitle(value, limits?.maxTitleLength) }}
          />
          <InputField
            form={form}
            name="url"
            label="Address"
            required
            type="url"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="http://nas.local:8096"
            description="Use the address other devices on your network reach it at, not localhost."
            validators={{ onChange: ({ value }) => checkUrl(value, limits?.maxUrlLength) }}
          />
          <TextareaField
            form={form}
            name="description"
            label="Description"
            rows={2}
            placeholder="Films and shows"
            validators={{ onChange: ({ value }) => checkLength(value, limits?.maxDescriptionLength) }}
          />
          <form.Subscribe selector={(state) => state.values.kind}>
            {(kind) =>
              kind === 'LINK' ? (
                <RadioGroupField form={form} name="opensIn" label="Opens" variant="card" options={OPENS_IN_OPTIONS} />
              ) : null
            }
          </form.Subscribe>
          <form.Subscribe selector={(state) => state.values.kind}>
            {(kind) =>
              kind === 'FRAME' ? (
                <NumberField
                  form={form}
                  name="frameHeightPx"
                  label="Height in pixels"
                  integer
                  placeholder={limits ? String(limits.defaultFrameHeightPx) : undefined}
                  description={
                    limits ? `Left blank, the frame is ${limits.defaultFrameHeightPx} pixels tall.` : undefined
                  }
                  validators={{ onChange: ({ value }) => checkFrameHeight(value, heightBounds) }}
                />
              ) : null
            }
          </form.Subscribe>
          <IconField form={form} name="icon" label="Icon" allowFavicon />
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
              <form.SubmitButton variant="info" content="Add item" pendingLabel="Adding…" />
            )}
          </form.AppForm>
        </>
      )}
    />
  );
}
