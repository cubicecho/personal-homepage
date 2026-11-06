// What the widget editor holds while it is being filled in, and how it becomes `WidgetInput`. Numbers are
// kept as typed so a half-written one can be shown and checked; the settings for every type are kept, so
// switching type and back loses nothing. The server checks all of it again.
import type {
  HttpMethod,
  ItemFieldsFragment,
  PageLimitsQuery,
  ValueFormat,
  WeatherUnits,
  WidgetInput,
  WidgetType,
} from '@/__generated__/graphql';

/** A widget as an item carries it. */
type SavedWidget = NonNullable<ItemFieldsFragment['widget']>;
/** The limits the server checks. */
type PageLimits = PageLimitsQuery['pageLimits'];

/** One value row being edited. */
export interface FieldDraft {
  label: string;
  path: string;
  format: ValueFormat;
  warnAbove: string;
  warnBelow: string;
}

/** One header row being edited. */
export interface HeaderDraft {
  name: string;
  value: string;
}

/** The widget editor's values. */
export interface WidgetDraft {
  type: WidgetType;
  /** Blank for the type's default. */
  cacheSeconds: string;
  /** Blank for no refresh. */
  refreshSeconds: string;
  api: { url: string; method: HttpMethod; headers: HeaderDraft[]; body: string; fields: FieldDraft[] };
  rss: { url: string; limit: string; showSummary: boolean };
  weather: { latitude: string; longitude: string; units: WeatherUnits };
}

/** A secret reference, which counts as text when an address's shape is checked. */
const SECRET_REFERENCE = /\$\{(env|file):[^}]+\}/g;
/** The widest latitude, in degrees. */
const MAX_LATITUDE = 90;
/** The widest longitude, in degrees. */
const MAX_LONGITUDE = 180;

/**
 * A new value row.
 *
 * @returns An empty row, shown as text.
 */
export function emptyField(): FieldDraft {
  return { label: '', path: '$.', format: 'TEXT', warnAbove: '', warnBelow: '' };
}

/**
 * Writes a number for a box, or nothing.
 *
 * @param value - The number, or null.
 * @returns It as text, or blank.
 */
function numberText(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * Starts the editor from a saved widget, or from nothing.
 *
 * @param widget - The item's widget, or null for a new one.
 * @returns The editor's values.
 */
export function widgetDraftOf(widget: SavedWidget | null): WidgetDraft {
  const { api, rss, weather } = widget ?? { api: null, rss: null, weather: null };
  return {
    type: widget?.type ?? 'API',
    cacheSeconds: numberText(widget?.cacheSeconds),
    refreshSeconds: numberText(widget?.refreshSeconds),
    api: {
      url: api?.url ?? '',
      method: api?.method ?? 'GET',
      headers: api?.headers.map(({ name, value }) => ({ name, value })) ?? [],
      body: api?.body ?? '',
      fields: api?.fields.map((field) => ({
        label: field.label,
        path: field.path,
        format: field.format,
        warnAbove: numberText(field.warnAbove),
        warnBelow: numberText(field.warnBelow),
      })) ?? [emptyField()],
    },
    rss: { url: rss?.url ?? '', limit: numberText(rss?.limit), showSummary: rss?.showSummary ?? false },
    weather: {
      latitude: numberText(weather?.latitude),
      longitude: numberText(weather?.longitude),
      units: weather?.units ?? 'METRIC',
    },
  };
}

/**
 * Reads a box that holds a number or nothing.
 *
 * @param text - What was typed.
 * @returns The number, null when blank, or NaN when it isn't one.
 */
function numberOrNull(text: string): number | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : Number(trimmed);
}

/**
 * Turns the editor's values into the API's input, with only the chosen type's settings.
 *
 * @param draft - The editor's values.
 * @returns The input. Blank rows are left out.
 */
export function toWidgetInput(draft: WidgetDraft): WidgetInput {
  const timing = {
    type: draft.type,
    cacheSeconds: numberOrNull(draft.cacheSeconds),
    refreshSeconds: numberOrNull(draft.refreshSeconds),
  };
  if (draft.type === 'RSS') {
    return {
      ...timing,
      rss: { url: draft.rss.url.trim(), limit: numberOrNull(draft.rss.limit), showSummary: draft.rss.showSummary },
    };
  }
  if (draft.type === 'WEATHER') {
    return {
      ...timing,
      weather: {
        latitude: numberOrNull(draft.weather.latitude) ?? Number.NaN,
        longitude: numberOrNull(draft.weather.longitude) ?? Number.NaN,
        units: draft.weather.units,
      },
    };
  }
  const { api } = draft;
  const isPost = api.method === 'POST';
  return {
    ...timing,
    api: {
      url: api.url.trim(),
      method: api.method,
      headers: api.headers
        .filter((header) => header.name.trim() !== '')
        .map((header) => ({ name: header.name.trim(), value: header.value })),
      body: isPost && api.body.trim() !== '' ? api.body : null,
      fields: api.fields
        .filter((field) => field.label.trim() !== '' || field.path.trim() !== '$.')
        .map((field) => ({
          label: field.label.trim(),
          path: field.path.trim(),
          format: field.format,
          warnAbove: numberOrNull(field.warnAbove),
          warnBelow: numberOrNull(field.warnBelow),
        })),
    },
  };
}

/**
 * Checks an address that may hold secret references.
 *
 * @param url - The address as typed.
 * @returns Whether it is an http(s) address once its references are taken as words.
 */
function isWidgetUrl(url: string): boolean {
  const filled = url.trim().replace(SECRET_REFERENCE, 'secret');
  return URL.canParse(filled) && ['http:', 'https:'].includes(new URL(filled).protocol);
}

/**
 * Checks the editor's values before they are sent, as far as the browser can.
 *
 * @param draft - The editor's values.
 * @param [limits] - The server's limits, once they are known.
 * @returns What is wrong first, or undefined when nothing the browser can see is.
 */
export function checkWidget(draft: WidgetDraft, limits?: PageLimits): string | undefined {
  const input = toWidgetInput(draft);
  const cacheSeconds = input.cacheSeconds ?? null;
  const refreshSeconds = input.refreshSeconds ?? null;
  if (
    cacheSeconds !== null &&
    (Number.isInteger(cacheSeconds) === false || cacheSeconds < (limits?.minWidgetCacheSeconds ?? 1))
  ) {
    return `Keep answers for at least ${limits?.minWidgetCacheSeconds ?? 1} seconds, as a whole number.`;
  }
  if (
    refreshSeconds !== null &&
    (Number.isInteger(refreshSeconds) === false || refreshSeconds < (limits?.minWidgetRefreshSeconds ?? 1))
  ) {
    return `Refresh at most every ${limits?.minWidgetRefreshSeconds ?? 1} seconds, as a whole number.`;
  }
  if (input.weather != null) {
    const { latitude, longitude } = input.weather;
    const isLatitude = Number.isFinite(latitude) && Math.abs(latitude) <= MAX_LATITUDE;
    const isLongitude = Number.isFinite(longitude) && Math.abs(longitude) <= MAX_LONGITUDE;
    return isLatitude && isLongitude ? undefined : 'Give a latitude from -90 to 90 and a longitude from -180 to 180.';
  }
  const url = input.api?.url ?? input.rss?.url ?? '';
  if (isWidgetUrl(url) === false) {
    return 'Use a full address starting with http:// or https://.';
  }
  const fields = input.api?.fields ?? null;
  if (fields === null) {
    return undefined;
  }
  if (fields.length === 0) {
    return 'Add at least one value to show.';
  }
  const unfinished = fields.find((field) => field.label === '' || field.path.startsWith('$') === false);
  if (unfinished !== undefined) {
    return 'Give every value a label and a path starting with $, such as $.totalRecords.';
  }
  return undefined;
}
