// A widget as stored in an item's `widget` JSON column. The type's settings sit beside the type, headers
// are a mapping, words are lower case, and anything that holds its default is left out:
//
//   { "type": "api", "url": "http://sonarr.lan:8989/api/v3/queue",
//     "headers": { "X-Api-Key": "${env:HOMEPAGE_SONARR_KEY}" },
//     "fields": [{ "label": "Downloading", "path": "$.totalRecords", "format": "number", "warnAbove": 10 }] }
//   { "type": "rss", "url": "https://example.com/feed.xml", "limit": 5, "showSummary": true }
//   { "type": "weather", "latitude": 52.37, "longitude": 4.89, "units": "imperial" }
//
// The shape is the one the 1.x YAML files used under `widget:`, kept so stored rows need no migration.
// Secret references are stored and read as they are; storage never resolves them.
import { z } from 'zod';
import { PAGE_LIMIT_DEFAULTS } from '../core/defaults.ts';
import { storedWord, toStoredWord } from './stored-words.ts';
import { HttpMethod, ValueFormat, WeatherUnits, type Widget, WidgetType } from './widget.ts';
import { DEFAULT_CACHE_SECONDS, isWidgetUrl, jsonPathProblem, widgetFromInput } from './widget-input.ts';

const { maxWidgetFields, maxRssEntries, minWidgetCacheSeconds, maxWidgetCacheSeconds, minWidgetRefreshSeconds } =
  PAGE_LIMIT_DEFAULTS;

const storedUrl = z.string().trim().refine(isWidgetUrl, 'must be an http:// or https:// address');

const storedFieldSchema = z.object({
  label: z.string().trim().min(1, 'needs a label'),
  path: z
    .string()
    .trim()
    .superRefine((path, context) => {
      const problem = jsonPathProblem(path);
      if (problem !== null) {
        context.addIssue({ code: 'custom', message: problem });
      }
    }),
  format: storedWord(Object.values(ValueFormat)).nullish(),
  warnAbove: z.number().nullish(),
  warnBelow: z.number().nullish(),
});

/** A widget as read back from storage: lenient about case, and clamped to the current limits. */
export const storedWidgetSchema = z.object({
  type: storedWord(Object.values(WidgetType)),
  cacheSeconds: z.number().int().positive().nullish(),
  refreshSeconds: z.number().int().positive().nullish(),
  url: storedUrl.nullish(),
  method: storedWord(Object.values(HttpMethod)).nullish(),
  headers: z.record(z.string(), z.union([z.string(), z.number()]).transform(String)).nullish(),
  body: z.string().nullish(),
  fields: z.array(storedFieldSchema).nullish(),
  limit: z.number().int().positive().nullish(),
  showSummary: z.boolean().nullish(),
  latitude: z.number().nullish(),
  longitude: z.number().nullish(),
  units: storedWord(Object.values(WeatherUnits)).nullish(),
});
export type StoredWidget = z.output<typeof storedWidgetSchema>;

/**
 * Keeps a number inside a range.
 *
 * @param value - The number.
 * @param min - The lowest allowed.
 * @param max - The highest allowed.
 * @returns The number, inside the range.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Turns a stored widget into the model.
 *
 * @param stored - The widget as read from storage.
 * @returns The widget, or a sentence saying what it is missing.
 */
export function widgetFromStored(stored: StoredWidget): Widget | string {
  const cacheSeconds = stored.cacheSeconds ?? null;
  const refreshSeconds = stored.refreshSeconds ?? null;
  const input = {
    type: stored.type,
    cacheSeconds: cacheSeconds === null ? null : clamp(cacheSeconds, minWidgetCacheSeconds, maxWidgetCacheSeconds),
    refreshSeconds:
      refreshSeconds === null ? null : clamp(refreshSeconds, minWidgetRefreshSeconds, maxWidgetCacheSeconds),
  };
  const url = stored.url ?? null;
  if (stored.type === WidgetType.Weather) {
    const latitude = stored.latitude ?? null;
    const longitude = stored.longitude ?? null;
    if (latitude === null || longitude === null) {
      return 'a weather widget needs latitude and longitude';
    }
    return widgetFromInput({ ...input, weather: { latitude, longitude, units: stored.units ?? null } });
  }
  if (url === null) {
    return `a ${toStoredWord(stored.type)} widget needs a url`;
  }
  if (stored.type === WidgetType.Rss) {
    const limit = stored.limit ?? null;
    const rss = { url, limit: limit === null ? null : clamp(limit, 1, maxRssEntries), showSummary: stored.showSummary };
    return widgetFromInput({ ...input, rss });
  }
  const fields = (stored.fields ?? []).slice(0, maxWidgetFields);
  if (fields.length === 0) {
    return 'an api widget needs at least one field';
  }
  const headers = Object.entries(stored.headers ?? {}).map(([name, value]) => ({ name, value }));
  return widgetFromInput({ ...input, api: { url, method: stored.method, headers, body: stored.body, fields } });
}

/**
 * Builds what a widget stores, leaving out what holds its default.
 *
 * @param widget - The widget.
 * @returns The plain object to store as JSON.
 */
export function widgetToStored(widget: Widget): Record<string, unknown> {
  const written: Record<string, unknown> = { type: toStoredWord(widget.type) };
  if (widget.cacheSeconds !== DEFAULT_CACHE_SECONDS[widget.type]) {
    written.cacheSeconds = widget.cacheSeconds;
  }
  if (widget.refreshSeconds !== null) {
    written.refreshSeconds = widget.refreshSeconds;
  }
  if (widget.type === WidgetType.Weather) {
    const { latitude, longitude, units } = widget.weather;
    Object.assign(written, { latitude, longitude });
    if (units !== WeatherUnits.Metric) {
      written.units = toStoredWord(units);
    }
    return written;
  }
  if (widget.type === WidgetType.Rss) {
    written.url = widget.rss.url;
    written.limit = widget.rss.limit;
    if (widget.rss.showSummary) {
      written.showSummary = true;
    }
    return written;
  }
  const { url, method, headers, body, fields } = widget.api;
  written.url = url;
  if (method !== HttpMethod.Get) {
    written.method = toStoredWord(method);
  }
  if (headers.length > 0) {
    written.headers = Object.fromEntries(headers.map((header) => [header.name, header.value]));
  }
  if (body !== null) {
    written.body = body;
  }
  written.fields = fields.map((field) => {
    const stored: Record<string, unknown> = { label: field.label, path: field.path };
    if (field.format !== ValueFormat.Text) {
      stored.format = toStoredWord(field.format);
    }
    if (field.warnAbove !== null) {
      stored.warnAbove = field.warnAbove;
    }
    if (field.warnBelow !== null) {
      stored.warnBelow = field.warnBelow;
    }
    return stored;
  });
  return written;
}
