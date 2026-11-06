// A widget as the YAML store writes it under an item's `widget:` key. The type's settings sit beside the
// type, headers are a mapping, words are lower case, and anything that holds its default is left out:
//
//   widget:
//     type: api
//     cacheSeconds: 30                 # left out at the type's default
//     refreshSeconds: 60               # left out when the page only asks on load
//     url: http://sonarr.lan:8989/api/v3/queue
//     method: post                     # left out for get
//     headers: { X-Api-Key: "${env:HOMEPAGE_SONARR_KEY}" }
//     body: '{"page": 1}'
//     fields:
//       - label: Downloading
//         path: $.totalRecords
//         format: number               # left out for text
//         warnAbove: 10
//
//   widget: { type: rss, url: https://example.com/feed.xml, limit: 5, showSummary: true }
//   widget: { type: weather, latitude: 52.37, longitude: 4.89, units: imperial }
//
// Secret references are written and read as they are; the store never resolves them.
import { z } from 'zod';
import { PAGE_LIMIT_DEFAULTS } from '../core/defaults.ts';
import { diskWord, toDiskWord } from './disk-words.ts';
import { HttpMethod, ValueFormat, WeatherUnits, type Widget, WidgetType } from './widget.ts';
import { DEFAULT_CACHE_SECONDS, isWidgetUrl, jsonPathProblem, widgetFromInput } from './widget-input.ts';

const { maxWidgetFields, maxRssEntries, minWidgetCacheSeconds, maxWidgetCacheSeconds, minWidgetRefreshSeconds } =
  PAGE_LIMIT_DEFAULTS;

const diskUrl = z.string().trim().refine(isWidgetUrl, 'must be an http:// or https:// address');

const diskFieldSchema = z.object({
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
  format: diskWord(Object.values(ValueFormat)).nullish(),
  warnAbove: z.number().nullish(),
  warnBelow: z.number().nullish(),
});

/** A widget as read from a file: lenient about case, and clamped where a hand edit went too far. */
export const diskWidgetSchema = z.object({
  type: diskWord(Object.values(WidgetType)),
  cacheSeconds: z.number().int().positive().nullish(),
  refreshSeconds: z.number().int().positive().nullish(),
  url: diskUrl.nullish(),
  method: diskWord(Object.values(HttpMethod)).nullish(),
  headers: z.record(z.string(), z.union([z.string(), z.number()]).transform(String)).nullish(),
  body: z.string().nullish(),
  fields: z.array(diskFieldSchema).nullish(),
  limit: z.number().int().positive().nullish(),
  showSummary: z.boolean().nullish(),
  latitude: z.number().nullish(),
  longitude: z.number().nullish(),
  units: diskWord(Object.values(WeatherUnits)).nullish(),
});
export type DiskWidget = z.output<typeof diskWidgetSchema>;

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
 * Turns a widget read from a file into the model.
 *
 * @param disk - The widget as read.
 * @returns The widget, or a sentence saying what it is missing.
 */
export function widgetFromDisk(disk: DiskWidget): Widget | string {
  const cacheSeconds = disk.cacheSeconds ?? null;
  const refreshSeconds = disk.refreshSeconds ?? null;
  const input = {
    type: disk.type,
    cacheSeconds: cacheSeconds === null ? null : clamp(cacheSeconds, minWidgetCacheSeconds, maxWidgetCacheSeconds),
    refreshSeconds:
      refreshSeconds === null ? null : clamp(refreshSeconds, minWidgetRefreshSeconds, maxWidgetCacheSeconds),
  };
  const url = disk.url ?? null;
  if (disk.type === WidgetType.Weather) {
    const latitude = disk.latitude ?? null;
    const longitude = disk.longitude ?? null;
    if (latitude === null || longitude === null) {
      return 'a weather widget needs latitude and longitude';
    }
    return widgetFromInput({ ...input, weather: { latitude, longitude, units: disk.units ?? null } });
  }
  if (url === null) {
    return `a ${toDiskWord(disk.type)} widget needs a url`;
  }
  if (disk.type === WidgetType.Rss) {
    const limit = disk.limit ?? null;
    const rss = { url, limit: limit === null ? null : clamp(limit, 1, maxRssEntries), showSummary: disk.showSummary };
    return widgetFromInput({ ...input, rss });
  }
  const fields = (disk.fields ?? []).slice(0, maxWidgetFields);
  if (fields.length === 0) {
    return 'an api widget needs at least one field';
  }
  const headers = Object.entries(disk.headers ?? {}).map(([name, value]) => ({ name, value }));
  return widgetFromInput({ ...input, api: { url, method: disk.method, headers, body: disk.body, fields } });
}

/**
 * Builds what a widget holds on disk, leaving out what holds its default.
 *
 * @param widget - The widget.
 * @returns The plain object to write as YAML.
 */
export function widgetToDisk(widget: Widget): Record<string, unknown> {
  const written: Record<string, unknown> = { type: toDiskWord(widget.type) };
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
      written.units = toDiskWord(units);
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
    written.method = toDiskWord(method);
  }
  if (headers.length > 0) {
    written.headers = Object.fromEntries(headers.map((header) => [header.name, header.value]));
  }
  if (body !== null) {
    written.body = body;
  }
  written.fields = fields.map((field) => {
    const disk: Record<string, unknown> = { label: field.label, path: field.path };
    if (field.format !== ValueFormat.Text) {
      disk.format = toDiskWord(field.format);
    }
    if (field.warnAbove !== null) {
      disk.warnAbove = field.warnAbove;
    }
    if (field.warnBelow !== null) {
      disk.warnBelow = field.warnBelow;
    }
    return disk;
  });
  return written;
}
