// Validation for a widget as the API sends it (`WidgetInput`). It sits above the store with page-input.ts.
import { z } from 'zod';
import { PAGE_LIMIT_DEFAULTS, WIDGET_DEFAULTS } from '../core/defaults.ts';
import { JsonPathError, parseJsonPath } from '../widgets/json-path.ts';
import {
  HttpMethod,
  SECRET_REFERENCE,
  ValueFormat,
  WeatherUnits,
  type Widget,
  type WidgetHeader,
  WidgetType,
} from './widget.ts';

const {
  maxTitleLength,
  maxUrlLength,
  maxWidgetFields,
  maxWidgetHeaders,
  maxRssEntries,
  minWidgetCacheSeconds,
  maxWidgetCacheSeconds,
  minWidgetRefreshSeconds,
  maxWidgetBodyLength,
} = PAGE_LIMIT_DEFAULTS;
const { defaultApiCacheSeconds, defaultRssCacheSeconds, defaultWeatherCacheSeconds, defaultRssEntries } =
  WIDGET_DEFAULTS;

/** What a secret reference stands in for while a URL's shape is checked. */
const SECRET_PLACEHOLDER = 'secret';
/** A header name: an HTTP token. */
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
/** A line break, which would let a header value start a header of its own. */
const LINE_BREAK = /[\r\n]/;
/** The widest latitude, in degrees. */
const MAX_LATITUDE = 90;
/** The widest longitude, in degrees. */
const MAX_LONGITUDE = 180;

/** Each type's cache time when none is given. */
export const DEFAULT_CACHE_SECONDS: Readonly<Record<WidgetType, number>> = Object.freeze({
  [WidgetType.Api]: defaultApiCacheSeconds,
  [WidgetType.Rss]: defaultRssCacheSeconds,
  [WidgetType.Weather]: defaultWeatherCacheSeconds,
});

/**
 * Checks that a URL that may hold secret references is an http(s) URL once they are filled in.
 *
 * @param value - The URL as written.
 * @returns Whether it is an http(s) URL with its references taken as plain words.
 */
export function isWidgetUrl(value: string): boolean {
  const filled = value.replace(SECRET_REFERENCE, SECRET_PLACEHOLDER);
  const isParseable = URL.canParse(filled);
  return isParseable && ['http:', 'https:'].includes(new URL(filled).protocol);
}

/**
 * Checks a JSONPath this server can follow.
 *
 * @param path - The path as written.
 * @returns What is wrong with it, or null when nothing is.
 */
export function jsonPathProblem(path: string): string | null {
  try {
    parseJsonPath(path);
    return null;
  } catch (error) {
    if (error instanceof JsonPathError) {
      return error.message;
    }
    throw error;
  }
}

const widgetUrl = z
  .string()
  .trim()
  .max(maxUrlLength)
  .refine(isWidgetUrl, 'Use a full address starting with http:// or https://.');

const headerSchema = z.object({
  /** Blank for a row the editor left empty, which is dropped. */
  name: z
    .string()
    .trim()
    .refine((name) => name === '' || HEADER_NAME.test(name), 'Use a header name such as X-Api-Key.'),
  value: z
    .string()
    .max(maxUrlLength)
    .refine((value) => LINE_BREAK.test(value) === false, 'A header value is one line.'),
});

const fieldSchema = z.object({
  label: z.string().trim().min(1, 'Give the value a label.').max(maxTitleLength),
  path: z
    .string()
    .trim()
    .superRefine((path, context) => {
      const problem = jsonPathProblem(path);
      if (problem !== null) {
        context.addIssue({ code: 'custom', message: problem });
      }
    }),
  format: z.enum(Object.values(ValueFormat)).nullish(),
  warnAbove: z.number().finite().nullish(),
  warnBelow: z.number().finite().nullish(),
});

const apiSchema = z.object({
  url: widgetUrl,
  method: z.enum(Object.values(HttpMethod)).nullish(),
  headers: z.array(headerSchema).max(maxWidgetHeaders).nullish(),
  body: z.string().max(maxWidgetBodyLength).nullish(),
  fields: z.array(fieldSchema).min(1, 'Add at least one value to show.').max(maxWidgetFields),
});

const rssSchema = z.object({
  url: widgetUrl,
  limit: z.int().min(1).max(maxRssEntries).nullish(),
  showSummary: z.boolean().nullish(),
});

const weatherSchema = z.object({
  latitude: z.number().min(-MAX_LATITUDE).max(MAX_LATITUDE),
  longitude: z.number().min(-MAX_LONGITUDE).max(MAX_LONGITUDE),
  units: z.enum(Object.values(WeatherUnits)).nullish(),
});

/** `WidgetInput` as the API sends it: the type, timing, and the settings for that type. */
export const widgetInputSchema = z
  .object({
    type: z.enum(Object.values(WidgetType)),
    cacheSeconds: z.int().min(minWidgetCacheSeconds).max(maxWidgetCacheSeconds).nullish(),
    refreshSeconds: z.int().min(minWidgetRefreshSeconds).max(maxWidgetCacheSeconds).nullish(),
    api: apiSchema.nullish(),
    rss: rssSchema.nullish(),
    weather: weatherSchema.nullish(),
  })
  .superRefine((input, context) => {
    const settingsByType = { API: input.api, RSS: input.rss, WEATHER: input.weather };
    const hasSettings = (settingsByType[input.type] ?? null) !== null;
    if (hasSettings === false) {
      const key = input.type.toLowerCase();
      context.addIssue({ code: 'custom', path: [key], message: `A ${key} widget needs its settings.` });
    }
  });

/**
 * Builds a header list without blanks.
 *
 * @param headers - The headers as sent.
 * @returns The headers that have a name.
 */
function presentHeaders(headers: WidgetHeader[] | null | undefined): WidgetHeader[] {
  return (headers ?? []).filter((header) => header.name !== '');
}

/**
 * Turns validated widget input into the model, filling in the defaults.
 *
 * @param input - The parsed `WidgetInput`.
 * @returns The widget, with only its own type's settings.
 */
export function widgetFromInput(input: z.output<typeof widgetInputSchema>): Widget {
  const timing = {
    cacheSeconds: input.cacheSeconds ?? DEFAULT_CACHE_SECONDS[input.type],
    refreshSeconds: input.refreshSeconds ?? null,
  };
  const api = input.api ?? null;
  const rss = input.rss ?? null;
  const weather = input.weather ?? null;
  if (input.type === WidgetType.Api && api !== null) {
    const body = api.body ?? '';
    return {
      type: WidgetType.Api,
      ...timing,
      api: {
        url: api.url,
        method: api.method ?? HttpMethod.Get,
        headers: presentHeaders(api.headers),
        body: body === '' ? null : body,
        fields: api.fields.map((field) => ({
          label: field.label,
          path: field.path,
          format: field.format ?? ValueFormat.Text,
          warnAbove: field.warnAbove ?? null,
          warnBelow: field.warnBelow ?? null,
        })),
      },
    };
  }
  if (input.type === WidgetType.Rss && rss !== null) {
    return {
      type: WidgetType.Rss,
      ...timing,
      rss: { url: rss.url, limit: rss.limit ?? defaultRssEntries, showSummary: rss.showSummary ?? false },
    };
  }
  if (weather === null) {
    throw new Error('widgetInputSchema lets a widget through without its settings.');
  }
  return {
    type: WidgetType.Weather,
    ...timing,
    weather: { latitude: weather.latitude, longitude: weather.longitude, units: weather.units ?? WeatherUnits.Metric },
  };
}
