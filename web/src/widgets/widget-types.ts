import type { HttpMethod, ValueFormat, WeatherUnits, WidgetType } from '@/__generated__/graphql';
import { Moon, Sun } from '@/components/ui/icons';
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Gauge,
  Rss,
} from '@/core/app-icons';

/** How each widget type is named and explained, and the glyph that marks it. */
export const WIDGET_TYPES = {
  API: {
    Glyph: Gauge,
    label: 'API values',
    summary: 'Numbers or text picked out of a JSON API, such as a queue size.',
  },
  RSS: { Glyph: Rss, label: 'Feed', summary: 'The latest entries of an RSS or Atom feed.' },
  WEATHER: { Glyph: CloudSun, label: 'Weather', summary: 'The weather now and for the coming hours, from Open-Meteo.' },
} satisfies Record<WidgetType, { Glyph: unknown; label: string; summary: string }>;

/** How each value format is named in the editor. */
export const VALUE_FORMATS = {
  TEXT: 'Text, as it comes',
  NUMBER: 'Number',
  BYTES: 'Size in bytes',
  PERCENT: 'Percentage',
  DURATION: 'Seconds, as a duration',
  DATE: 'Date',
} satisfies Record<ValueFormat, string>;

/** How each request method is named in the editor. */
export const HTTP_METHODS = { GET: 'GET', POST: 'POST' } satisfies Record<HttpMethod, string>;

/** How each unit system is named in the editor. */
export const WEATHER_UNITS = { METRIC: '°C, km/h', IMPERIAL: '°F, mph' } satisfies Record<WeatherUnits, string>;

/** The first WMO code of each band of weather, highest first, with its glyph by day and by night. */
const WEATHER_GLYPHS = [
  { from: 95, day: CloudLightning, night: CloudLightning },
  { from: 71, day: CloudSnow, night: CloudSnow },
  { from: 61, day: CloudRain, night: CloudRain },
  { from: 51, day: CloudDrizzle, night: CloudDrizzle },
  { from: 45, day: CloudFog, night: CloudFog },
  { from: 3, day: Cloud, night: Cloud },
  { from: 1, day: CloudSun, night: CloudMoon },
  { from: 0, day: Sun, night: Moon },
] as const;
/** Rain and snow showers sit between the snow and thunder bands, and are drawn as their kind. */
const SHOWERS_FROM = 80;
const SNOW_SHOWERS_FROM = 85;

/**
 * Picks the glyph for a weather code.
 *
 * @param code - The WMO weather code.
 * @param isDay - Whether the sun is up.
 * @returns The glyph component.
 */
export function weatherGlyph(code: number, isDay: boolean) {
  if (code >= SHOWERS_FROM && code < SNOW_SHOWERS_FROM) {
    return CloudRain;
  }
  if (code >= SNOW_SHOWERS_FROM && code < WEATHER_GLYPHS[0].from) {
    return CloudSnow;
  }
  const band = WEATHER_GLYPHS.find((candidate) => code >= candidate.from) ?? WEATHER_GLYPHS[WEATHER_GLYPHS.length - 1];
  return isDay ? band.day : band.night;
}
