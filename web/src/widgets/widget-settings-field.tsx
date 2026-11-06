import { useMutation } from '@tanstack/react-query';
import { useId } from 'react';
import { type WidgetInput, WidgetPreviewDocument } from '@/__generated__/graphql';
import { bindToForm, type FieldProps, useFieldContext, useFieldError } from '@/components/app-form';
import { FormField } from '@/components/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/ui/code';
import { Plus } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { SegmentedButton, SegmentedGroup } from '@/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { FlaskConical, Trash2 } from '@/core/app-icons';
import { request } from '@/core/gql';
import { messageOf } from '@/lib/error-message';
import { usePageLimits } from '@/pages/use-pages';
import { emptyField, type FieldDraft, type HeaderDraft, toWidgetInput, type WidgetDraft } from './widget-draft';
import { WidgetResultView } from './widget-result-view';
import { HTTP_METHODS, VALUE_FORMATS, WEATHER_UNITS, WIDGET_TYPES } from './widget-types';

/** What a secret reference looks like, for the hints. */
const SECRET_HINT =
  // biome-ignore lint/suspicious/noTemplateCurlyInString: this is the secret reference syntax, shown to the reader.
  'Put a secret in as ${env:HOMEPAGE_NAME} or ${file:/run/secrets/name}; the server fills it in when it fetches.';
const ROW = 'grid gap-2 sm:grid-cols-2';

interface ChoiceSelectProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  /** Each choice and its name. */
  choices: Readonly<Record<T, string>>;
  id?: string | undefined;
  'aria-label'?: string | undefined;
}

/** A select over a closed set of words. */
function ChoiceSelect<T extends string>({ value, onValueChange, choices, ...rest }: ChoiceSelectProps<T>) {
  const keys = Object.keys(choices).filter((key): key is T => Object.hasOwn(choices, key));
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        const chosen = keys.find((key) => key === next);
        if (chosen !== undefined) {
          onValueChange(chosen);
        }
      }}
    >
      <SelectTrigger {...rest}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {keys.map((key) => (
          <SelectItem key={key} value={key}>
            {choices[key]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface RowsProps<T> {
  rows: T[];
  onRowsChange: (rows: T[]) => void;
}

/**
 * The headers an API widget sends, one row each.
 *
 * @param props - The rows and how to change them.
 * @returns The editor for them.
 */
function HeaderRows({ rows, onRowsChange, max }: RowsProps<HeaderDraft> & { max: number }) {
  const change = (at: number, patch: Partial<HeaderDraft>) =>
    onRowsChange(rows.map((row, index) => (index === at ? { ...row, ...patch } : row)));
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-1 font-medium text-sm">Headers</legend>
      {rows.map((row, index) => (
        // Rows have no id of their own; the index is their place, and they only change by these buttons.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <div key={index} className="flex items-center gap-2">
          <Input
            aria-label={`Header ${index + 1} name`}
            placeholder="X-Api-Key"
            value={row.name}
            spellCheck={false}
            autoCapitalize="none"
            onChange={(event) => change(index, { name: event.target.value })}
          />
          <Input
            aria-label={`Header ${index + 1} value`}
            placeholder="${env:HOMEPAGE_SONARR_KEY}"
            value={row.value}
            spellCheck={false}
            autoCapitalize="none"
            onChange={(event) => change(index, { value: event.target.value })}
          />
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Remove header ${index + 1}`}
            iconSlot={<Trash2 />}
            onClick={() => onRowsChange(rows.filter((_row, at) => at !== index))}
          />
        </div>
      ))}
      {rows.length < max ? (
        <Button
          size="xs"
          variant="outline"
          className="self-start"
          iconSlot={<Plus />}
          content="Add header"
          onClick={() => onRowsChange([...rows, { name: '', value: '' }])}
        />
      ) : null}
    </fieldset>
  );
}

/**
 * The values an API widget shows, one row each: a label, a JSONPath, a format and two thresholds.
 *
 * @param props - The rows and how to change them.
 * @returns The editor for them.
 */
function FieldRows({ rows, onRowsChange, max }: RowsProps<FieldDraft> & { max: number }) {
  const change = (at: number, patch: Partial<FieldDraft>) =>
    onRowsChange(rows.map((row, index) => (index === at ? { ...row, ...patch } : row)));
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      <legend className="mb-1 font-medium text-sm">Values to show</legend>
      <p className="text-foreground/60 text-xs">
        A path picks a value out of the answer: $.totalRecords, $.records[0].title, or $.records.length for a count.
      </p>
      {rows.map((row, index) => {
        const name = `Value ${index + 1}`;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id of their own; see HeaderRows
          <div key={index} className="flex flex-col gap-2 rounded-md border border-foreground/10 p-2">
            <div className="flex items-center gap-2">
              <Input
                aria-label={`${name} label`}
                placeholder="Downloading"
                value={row.label}
                onChange={(event) => change(index, { label: event.target.value })}
              />
              <Input
                aria-label={`${name} path`}
                placeholder="$.totalRecords"
                value={row.path}
                spellCheck={false}
                autoCapitalize="none"
                className="font-mono"
                onChange={(event) => change(index, { path: event.target.value })}
              />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove ${name.toLowerCase()}`}
                iconSlot={<Trash2 />}
                disabled={rows.length === 1}
                onClick={() => onRowsChange(rows.filter((_row, at) => at !== index))}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <ChoiceSelect
                aria-label={`${name} format`}
                value={row.format}
                choices={VALUE_FORMATS}
                onValueChange={(format) => change(index, { format })}
              />
              <Input
                aria-label={`${name}: warn above`}
                placeholder="Warn above"
                inputMode="decimal"
                value={row.warnAbove}
                onChange={(event) => change(index, { warnAbove: event.target.value })}
              />
              <Input
                aria-label={`${name}: warn below`}
                placeholder="Warn below"
                inputMode="decimal"
                value={row.warnBelow}
                onChange={(event) => change(index, { warnBelow: event.target.value })}
              />
            </div>
          </div>
        );
      })}
      {rows.length < max ? (
        <Button
          size="xs"
          variant="outline"
          className="self-start"
          iconSlot={<Plus />}
          content="Add value"
          onClick={() => onRowsChange([...rows, emptyField()])}
        />
      ) : null}
    </fieldset>
  );
}

/**
 * Runs the widget as it stands and shows what came back, and for an API widget the raw answer to write
 * paths against. Nothing is saved.
 *
 * @param props - The widget input to test.
 * @param props.input - The widget as it would be saved.
 * @returns The test button and its result.
 */
function WidgetTest({ input }: { input: WidgetInput }) {
  const test = useMutation({
    mutationFn: async (widget: WidgetInput) => (await request(WidgetPreviewDocument, { input: widget })).widgetPreview,
  });
  const preview = test.data;
  return (
    <div className="flex flex-col gap-3">
      <Button
        size="sm"
        variant="outline"
        className="self-start"
        iconSlot={<FlaskConical />}
        content="Test"
        loading={test.isPending}
        onClick={() => test.mutate(input)}
      />
      {test.isError ? (
        <Alert variant="destructive" title="The test didn't run" description={messageOf(test.error) ?? 'Try again.'} />
      ) : null}
      {preview?.error == null ? null : (
        <Alert variant="destructive" title="The test failed" description={preview.error} />
      )}
      {preview == null ? null : (
        <div className="grid gap-3 lg:grid-cols-2">
          {preview.result == null ? null : (
            <div className="rounded-md border border-foreground/10 p-3">
              <WidgetResultView result={preview.result} now={Date.now()} />
            </div>
          )}
          {preview.raw == null ? null : (
            <CodeBlock title="Answer" language="json" content={preview.raw} maxHeight="md" />
          )}
        </div>
      )}
    </div>
  );
}

/** The widget editor: its type, its source and what it shows, its timing, and a test. */
function BoundWidgetSettingsField(props: FieldProps) {
  const field = useFieldContext<WidgetDraft>();
  const draft = field.state.value;
  const limits = usePageLimits().data;
  // One base id, and a suffix per box, so each label points at its own control.
  const baseId = useId();
  const ids = {
    url: `${baseId}-url`,
    method: `${baseId}-method`,
    body: `${baseId}-body`,
    cache: `${baseId}-cache`,
    refresh: `${baseId}-refresh`,
    limit: `${baseId}-limit`,
    summary: `${baseId}-summary`,
    latitude: `${baseId}-latitude`,
    longitude: `${baseId}-longitude`,
    units: `${baseId}-units`,
  };

  /**
   * Changes part of the widget and marks the field touched.
   *
   * @param patch - What changed.
   */
  const update = (patch: Partial<WidgetDraft>): void => {
    field.handleChange({ ...draft, ...patch });
    field.handleBlur();
  };
  const updateApi = (patch: Partial<WidgetDraft['api']>) => update({ api: { ...draft.api, ...patch } });
  const updateRss = (patch: Partial<WidgetDraft['rss']>) => update({ rss: { ...draft.rss, ...patch } });
  const updateWeather = (patch: Partial<WidgetDraft['weather']>) => update({ weather: { ...draft.weather, ...patch } });

  return (
    <FormField
      {...props}
      asGroup
      error={useFieldError()}
      controlSlot={(wired) => (
        <fieldset {...wired} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
          <SegmentedGroup
            aria-label="What the widget shows"
            value={draft.type}
            onValueChange={(type) => {
              const chosen = Object.keys(WIDGET_TYPES).find((key) => key === type);
              if (chosen === 'API' || chosen === 'RSS' || chosen === 'WEATHER') {
                update({ type: chosen });
              }
            }}
          >
            {Object.entries(WIDGET_TYPES).map(([type, { Glyph, label }]) => (
              <SegmentedButton key={type} value={type} iconSlot={<Glyph />}>
                {label}
              </SegmentedButton>
            ))}
          </SegmentedGroup>
          <p className="text-foreground/60 text-sm">{WIDGET_TYPES[draft.type].summary}</p>

          {draft.type === 'API' ? (
            <>
              <FormField
                label="API address"
                htmlFor={ids.url}
                description={SECRET_HINT}
                controlSlot={
                  <Input
                    id={ids.url}
                    type="url"
                    inputMode="url"
                    spellCheck={false}
                    autoCapitalize="none"
                    placeholder="http://sonarr.lan:8989/api/v3/queue"
                    value={draft.api.url}
                    onChange={(event) => updateApi({ url: event.target.value })}
                  />
                }
              />
              <FormField
                label="Method"
                htmlFor={ids.method}
                controlSlot={
                  <ChoiceSelect
                    id={ids.method}
                    value={draft.api.method}
                    choices={HTTP_METHODS}
                    onValueChange={(method) => updateApi({ method })}
                  />
                }
              />
              <HeaderRows
                rows={draft.api.headers}
                max={limits?.maxWidgetHeaders ?? Number.POSITIVE_INFINITY}
                onRowsChange={(headers) => updateApi({ headers })}
              />
              {draft.api.method === 'POST' ? (
                <FormField
                  label="Body"
                  htmlFor={ids.body}
                  description="Sent as written. It may hold secret references too."
                  controlSlot={
                    <Textarea
                      id={ids.body}
                      rows={3}
                      spellCheck={false}
                      className="font-mono"
                      value={draft.api.body}
                      onChange={(event) => updateApi({ body: event.target.value })}
                    />
                  }
                />
              ) : null}
              <FieldRows
                rows={draft.api.fields}
                max={limits?.maxWidgetFields ?? Number.POSITIVE_INFINITY}
                onRowsChange={(fields) => updateApi({ fields })}
              />
            </>
          ) : null}

          {draft.type === 'RSS' ? (
            <>
              <FormField
                label="Feed address"
                htmlFor={ids.url}
                controlSlot={
                  <Input
                    id={ids.url}
                    type="url"
                    inputMode="url"
                    spellCheck={false}
                    autoCapitalize="none"
                    placeholder="https://example.com/feed.xml"
                    value={draft.rss.url}
                    onChange={(event) => updateRss({ url: event.target.value })}
                  />
                }
              />
              <div className={ROW}>
                <FormField
                  label="Entries to show"
                  htmlFor={ids.limit}
                  controlSlot={
                    <Input
                      id={ids.limit}
                      inputMode="numeric"
                      placeholder="8"
                      value={draft.rss.limit}
                      onChange={(event) => updateRss({ limit: event.target.value })}
                    />
                  }
                />
                <FormField
                  label="Show a line of each summary"
                  htmlFor={ids.summary}
                  controlSlot={
                    <Switch
                      id={ids.summary}
                      checked={draft.rss.showSummary}
                      onCheckedChange={(showSummary) => updateRss({ showSummary })}
                    />
                  }
                />
              </div>
            </>
          ) : null}

          {draft.type === 'WEATHER' ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <FormField
                label="Latitude"
                htmlFor={ids.latitude}
                controlSlot={
                  <Input
                    id={ids.latitude}
                    inputMode="decimal"
                    placeholder="52.37"
                    value={draft.weather.latitude}
                    onChange={(event) => updateWeather({ latitude: event.target.value })}
                  />
                }
              />
              <FormField
                label="Longitude"
                htmlFor={ids.longitude}
                controlSlot={
                  <Input
                    id={ids.longitude}
                    inputMode="decimal"
                    placeholder="4.89"
                    value={draft.weather.longitude}
                    onChange={(event) => updateWeather({ longitude: event.target.value })}
                  />
                }
              />
              <FormField
                label="Units"
                htmlFor={ids.units}
                controlSlot={
                  <ChoiceSelect
                    id={ids.units}
                    value={draft.weather.units}
                    choices={WEATHER_UNITS}
                    onValueChange={(units) => updateWeather({ units })}
                  />
                }
              />
            </div>
          ) : null}

          <div className={ROW}>
            <FormField
              label="Keep answers for (seconds)"
              htmlFor={ids.cache}
              description="Blank for the usual time. The server asks the source again after this."
              controlSlot={
                <Input
                  id={ids.cache}
                  inputMode="numeric"
                  value={draft.cacheSeconds}
                  onChange={(event) => update({ cacheSeconds: event.target.value })}
                />
              }
            />
            <FormField
              label="Refresh an open page every (seconds)"
              htmlFor={ids.refresh}
              description="Blank to only load it with the page."
              controlSlot={
                <Input
                  id={ids.refresh}
                  inputMode="numeric"
                  value={draft.refreshSeconds}
                  onChange={(event) => update({ refreshSeconds: event.target.value })}
                />
              }
            />
          </div>

          <WidgetTest input={toWidgetInput(draft)} />
        </fieldset>
      )}
    />
  );
}

/** The widget editor, bound to a form field holding a `WidgetDraft`. */
export const WidgetSettingsField = bindToForm<FieldProps, WidgetDraft>(BoundWidgetSettingsField, 'WidgetSettingsField');
