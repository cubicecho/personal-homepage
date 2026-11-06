import { useState } from 'react';
import type { ItemInput, ItemKind, OpensIn } from '@/__generated__/graphql';
import { useKnownGroups, VISIBLE_TO_COPY } from '@/auth/known-groups';
import { useAccess } from '@/auth/use-access';
import {
  ComboboxField,
  InputField,
  NumberField,
  SelectField,
  SwitchField,
  TextareaField,
  useAppForm,
} from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { RadioGroupField, type RadioOption } from '@/components/radio-group-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormElement } from '@/components/ui/form-element';
import { DiscoveredAppPicker } from '@/discovery/discovered-app-picker';
import { FillInButton } from '@/discovery/fill-in-button';
import { LinkedAppNote } from '@/discovery/linked-app-note';
import { FrameCheckNotice } from '@/frames/frame-check-notice';
import { messageOf } from '@/lib/error-message';
import { useLayoutColumns } from '@/sections/use-site-layout';
import { checkWidget, toWidgetInput, type WidgetDraft, widgetDraftOf } from '@/widgets/widget-draft';
import { WidgetSettingsField } from '@/widgets/widget-settings-field';
import { widthChoiceOf, widthFromChoice, widthOptions } from './column-span';
import { checkFrameHeight, checkLength, checkTitle, checkUrl } from './form-checks';
import { IconField } from './icon-field';
import { ITEM_KINDS, OPENS_IN } from './item-kinds';
import { type Item, type Page, sectionLabel, useAddItem, usePageLimits, useUpdateItem } from './use-pages';

interface ItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The page the item is on, or is added to. */
  page: Page;
  /** The item to edit. Left out, the dialog adds one. */
  item?: Item | undefined;
  /** The section a new item goes in, when the page has several. Left out, the first. */
  sectionId?: string | undefined;
  /** Details a new item starts with, such as a discovered app's, linked to it. Ignored when editing. */
  prefill?: ItemPrefill | undefined;
}

/** Details a new item starts with. */
export interface ItemPrefill {
  title: string;
  url: string;
  icon: string | null;
  description: string | null;
  /** The discovered app it comes from, or null. */
  discoveredId: string | null;
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
  /** A frame's or widget's width: DEFAULT for its kind's, FULL, or a number of columns as text. */
  width: string;
  /** The section a new item goes in. Unused when editing. */
  sectionId: string;
  checkEnabled: boolean;
  checkUrl: string;
  /** A widget's settings. Kept while another kind is chosen, so switching back loses nothing. */
  widget: WidgetDraft;
  /** The groups that may see it; empty for everyone. */
  visibleTo: string[];
  /** The discovered app it comes from, or null. */
  discoveredId: string | null;
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
 * @returns The input: trimmed, a blank description as null, and the height only for a frame. The check
 * address is kept while checking is off, so turning it back on finds it again.
 */
function toInput(draft: ItemDraft): ItemInput {
  const description = draft.description.trim();
  const isFrame = draft.kind === 'FRAME';
  const isWidget = draft.kind === 'WIDGET';
  const url = draft.url.trim();
  // A widget with no address has nothing to check unless it is given a check address.
  const hasSomethingToCheck = url !== '' || draft.checkUrl.trim() !== '';
  return {
    kind: draft.kind,
    opensIn: draft.kind === 'LINK' ? draft.opensIn : null,
    title: draft.title.trim(),
    url: isWidget && url === '' ? null : url,
    icon: draft.icon,
    description: description === '' ? null : description,
    frameHeightPx: isFrame ? draft.frameHeightPx : null,
    ...(draft.kind === 'LINK' ? { columnSpan: null, fullWidth: null } : widthFromChoice(draft.width)),
    checkEnabled: draft.checkEnabled && hasSomethingToCheck,
    checkUrl: draft.checkUrl.trim(),
    widget: isWidget ? toWidgetInput(draft.widget) : null,
    visibleTo: draft.visibleTo,
    discoveredId: draft.discoveredId,
  };
}

/** Adds an item to a page, or changes one. */
export function ItemDialog({ open, onOpenChange, page, item, sectionId, prefill }: ItemDialogProps) {
  const limits = usePageLimits().data;
  const layoutColumns = useLayoutColumns();
  const addItem = useAddItem();
  const updateItem = useUpdateItem();
  const [serverError, setServerError] = useState<string | undefined>(undefined);
  const isEdit = item !== undefined;
  const isSignInSet = useAccess().data?.mode === 'SIGN_IN';
  const knownGroups = useKnownGroups();
  const shouldPickSection = isEdit === false && page.sections.length > 1;
  const sectionOptions = page.sections.map((section) => ({ value: section.id, label: sectionLabel(section) }));
  const heightBounds = limits && { min: limits.minFrameHeightPx, max: limits.maxFrameHeightPx };

  const defaultValues: ItemDraft = {
    kind: item?.kind ?? 'LINK',
    opensIn: item?.opensIn ?? 'NEW_TAB',
    title: item?.title ?? prefill?.title ?? '',
    url: item?.url ?? prefill?.url ?? '',
    icon: item?.icon ?? prefill?.icon ?? null,
    description: item?.description ?? prefill?.description ?? '',
    frameHeightPx: item?.frameHeightPx ?? null,
    width: widthChoiceOf(item, item?.kind ?? 'LINK'),
    sectionId: sectionId ?? page.sections[0]?.id ?? '',
    checkEnabled: item?.checkEnabled ?? true,
    checkUrl: item?.checkUrl ?? '',
    widget: widgetDraftOf(item?.widget ?? null),
    visibleTo: item?.visibleTo ?? [],
    discoveredId: isEdit ? item.discoveredId : (prefill?.discoveredId ?? null),
  };

  /**
   * Fills the fields that are still empty from what a page says, keeping whatever was typed.
   *
   * @param found - The page's title, description and icon.
   * @param found.title - Its name, if it gave one.
   * @param found.description - Its description, if it gave one.
   * @param found.icon - Its icon reference, if any.
   */
  const fillEmpty = (found: { title: string | null; description: string | null; icon: string | null }): void => {
    const isTitleEmpty = form.getFieldValue('title').trim() === '';
    if (isTitleEmpty && found.title !== null) {
      form.setFieldValue('title', found.title);
    }
    const isDescriptionEmpty = form.getFieldValue('description').trim() === '';
    if (isDescriptionEmpty && found.description !== null) {
      form.setFieldValue('description', found.description);
    }
    if (form.getFieldValue('icon') === null && found.icon !== null) {
      form.setFieldValue('icon', found.icon);
    }
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
          await addItem.mutateAsync({ pageSlug: page.slug, sectionId: value.sectionId || null, input });
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
          <form.Subscribe selector={(state) => state.values.discoveredId}>
            {(discoveredId) =>
              isEdit ? (
                discoveredId === null ? null : (
                  <LinkedAppNote
                    discoveredId={discoveredId}
                    onUnlink={() => form.setFieldValue('discoveredId', null)}
                  />
                )
              ) : (
                <DiscoveredAppPicker
                  discoveredId={discoveredId}
                  onPick={(app) => {
                    form.setFieldValue('kind', 'LINK');
                    form.setFieldValue('title', app.name);
                    form.setFieldValue('url', app.url);
                    form.setFieldValue('description', app.description ?? '');
                    form.setFieldValue('icon', app.icon);
                    form.setFieldValue('discoveredId', app.id);
                  }}
                  onManual={() => form.setFieldValue('discoveredId', null)}
                />
              )
            }
          </form.Subscribe>
          {shouldPickSection ? (
            <SelectField form={form} name="sectionId" label="Section" options={sectionOptions} />
          ) : null}
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
          <form.Subscribe selector={(state) => state.values.kind === 'WIDGET'}>
            {(isWidget) => (
              <InputField
                key={isWidget ? 'widget-link' : 'address'}
                form={form}
                name="url"
                label={isWidget ? 'Link' : 'Address'}
                required={isWidget === false}
                type="url"
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="http://nas.local:8096"
                description={
                  isWidget
                    ? 'Optional. Where the widget’s title takes you, such as the service whose numbers it shows.'
                    : 'Use the address other devices on your network reach it at, not localhost.'
                }
                validators={{
                  onChange: ({ value }) =>
                    isWidget && value.trim() === '' ? undefined : checkUrl(value, limits?.maxUrlLength),
                }}
              />
            )}
          </form.Subscribe>
          <form.Subscribe selector={(state) => ({ url: state.values.url, isWidget: state.values.kind === 'WIDGET' })}>
            {({ url, isWidget }) => (isWidget ? null : <FillInButton url={url} onDescribed={fillEmpty} />)}
          </form.Subscribe>
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
          <form.Subscribe selector={(state) => state.values.kind}>
            {(kind) =>
              kind === 'LINK' ? null : (
                <SelectField
                  form={form}
                  name="width"
                  label="Width"
                  description={`How many of the page's ${layoutColumns} columns it takes (Settings → General). A narrow screen has fewer.`}
                  options={widthOptions(kind, layoutColumns, item)}
                />
              )
            }
          </form.Subscribe>
          <form.Subscribe selector={(state) => state.values.kind}>
            {(kind) =>
              kind === 'WIDGET' ? (
                <WidgetSettingsField
                  form={form}
                  name="widget"
                  label="Widget"
                  validators={{ onChange: ({ value }) => checkWidget(value, limits) }}
                />
              ) : null
            }
          </form.Subscribe>
          <form.Subscribe selector={(state) => state.values}>
            {({ kind, opensIn, url }) =>
              kind === 'FRAME' || (kind === 'LINK' && opensIn === 'APP') ? (
                <FrameCheckNotice
                  url={url}
                  isTyping
                  actionSlot={
                    <Button
                      variant="outline"
                      size="sm"
                      content="Open it in a new tab instead"
                      onClick={() => {
                        form.setFieldValue('kind', 'LINK');
                        form.setFieldValue('opensIn', 'NEW_TAB');
                      }}
                    />
                  }
                />
              ) : null
            }
          </form.Subscribe>
          <IconField form={form} name="icon" label="Icon" allowFavicon />
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
          <SwitchField
            form={form}
            name="checkEnabled"
            label="Check status"
            description="The server checks the address every half minute and shows whether it answers."
          />
          <form.Subscribe selector={(state) => state.values.checkEnabled}>
            {(checkEnabled) =>
              checkEnabled ? (
                <InputField
                  form={form}
                  name="checkUrl"
                  label="Check address instead"
                  type="url"
                  inputMode="url"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="http://nas.local:8096/health"
                  description="Optional. A health endpoint, or an address the server can reach when the main one needs a sign-in."
                  validators={{
                    onChange: ({ value }) => (value.trim() === '' ? undefined : checkUrl(value, limits?.maxUrlLength)),
                  }}
                />
              ) : null
            }
          </form.Subscribe>
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
