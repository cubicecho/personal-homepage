// What a widget's fetch gives back, as the API serves it. One shape per widget type, told apart by `type`.
import type { WidgetType } from '../pages/widget.ts';

/** Why a widget's fetch failed, in a sentence a person can act on. Never holds a secret's value. */
export class WidgetError extends Error {}

/** One value an API widget shows. */
export interface ApiRow {
  label: string;
  /** The value, written out in the field's format. */
  value: string;
  /** Whether it is past one of the field's warning thresholds. */
  warn: boolean;
}

/** What an API widget shows. */
export interface ApiWidgetResult {
  type: typeof WidgetType.Api;
  rows: ApiRow[];
}

/** One entry of a feed. */
export interface RssEntry {
  title: string;
  /** The entry's http(s) link, or null when it has none (or one of another scheme). */
  url: string | null;
  /** The feed's own title. */
  source: string | null;
  /** When it was published, as an ISO 8601 time. */
  publishedAt: string | null;
  /** A line of its summary, as plain text, when the widget shows summaries. */
  summary: string | null;
}

/** What an RSS widget shows. */
export interface RssWidgetResult {
  type: typeof WidgetType.Rss;
  feedTitle: string | null;
  entries: RssEntry[];
}

/** The weather now. */
export interface WeatherNow {
  temperature: number;
  apparentTemperature: number | null;
  /** The WMO weather code. */
  weatherCode: number;
  /** The code in words: "Light rain". */
  description: string;
  windSpeed: number | null;
  isDay: boolean;
}

/** The weather in one coming hour. */
export interface WeatherHour {
  /** The hour, in the place's own time, as `YYYY-MM-DDTHH:MM`. */
  time: string;
  temperature: number;
  weatherCode: number;
  description: string;
  /** The chance of rain or snow, in percent. */
  precipitationChance: number | null;
  /** Whether the sun is up in that hour, so a clear night is drawn as a moon. */
  isDay: boolean;
}

/** What a weather widget shows. */
export interface WeatherWidgetResult {
  type: typeof WidgetType.Weather;
  /** As Open-Meteo writes it: `°C`, `°F`. */
  temperatureUnit: string;
  /** As Open-Meteo writes it: `km/h`, `mp/h`. */
  windSpeedUnit: string;
  now: WeatherNow;
  /** Today's highest temperature. */
  high: number | null;
  /** Today's lowest temperature. */
  low: number | null;
  hours: WeatherHour[];
}

/** Whatever a widget shows. */
export type WidgetResult = ApiWidgetResult | RssWidgetResult | WeatherWidgetResult;

/** A widget's latest answer, as `Query.widgetData` serves it. */
export interface WidgetData {
  /** When the result was fetched, as an ISO 8601 time. Null when there has been no good fetch yet. */
  fetchedAt: string | null;
  /** Whether the result is an older one, served because the latest fetch failed. */
  stale: boolean;
  /** Why the latest fetch failed. */
  error: string | null;
  result: WidgetResult | null;
}

/** A widget's test run from the editor, as `Query.widgetPreview` serves it. */
export interface WidgetPreview {
  result: WidgetResult | null;
  error: string | null;
  /** For an API widget, the answer as JSON, cut short at a limit, to write paths against. */
  raw: string | null;
}

/** What one fetch gives back: the result, and for an API widget its raw answer. */
export interface Fetched {
  result: WidgetResult;
  raw: unknown;
}
