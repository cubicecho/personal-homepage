// The weather widget: the weather now, today's high and low, and the coming hours, from Open-Meteo's
// forecast API (https://open-meteo.com/en/docs), which needs no key. `WEATHER_API_URL` points it at a
// self-hosted Open-Meteo instead.
import { z } from 'zod';
import { WeatherUnits, type WeatherWidgetSettings, WidgetType } from '../pages/widget.ts';
import { type FetchLimits, fetchBody, hostOf } from './fetch-body.ts';
import { type Fetched, type WeatherHour, WidgetError } from './widget-result.ts';

/** What the weather fetcher needs beyond the widget's own settings. */
export interface WeatherFetchDeps extends FetchLimits {
  /** The forecast endpoint. */
  apiUrl: string;
  /** How many coming hours to show. */
  hours: number;
}

/** What Open-Meteo is asked for now. */
const CURRENT = 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day';
/** What it is asked for by the hour. */
const HOURLY = 'temperature_2m,weather_code,precipitation_probability,is_day';
/** What it is asked for by the day. */
const DAILY = 'temperature_2m_max,temperature_2m_min';
/** Today and tomorrow, so the coming hours cross midnight. */
const FORECAST_DAYS = '2';

/** WMO weather codes, as Open-Meteo documents them, in words. */
const WEATHER_CODES: Readonly<Record<number, string>> = Object.freeze({
  0: 'Clear',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Freezing fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Heavy freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Heavy freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light showers',
  81: 'Showers',
  82: 'Heavy showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with heavy hail',
});

/**
 * Says a weather code in words.
 *
 * @param code - The WMO code.
 * @returns Its description, or "Unknown weather".
 */
export function describeWeather(code: number): string {
  return WEATHER_CODES[code] ?? 'Unknown weather';
}

const numberList = z.array(z.number().nullable());

/** The parts of Open-Meteo's answer the widget reads. */
const forecastSchema = z.object({
  current: z.object({
    time: z.string(),
    temperature_2m: z.number(),
    apparent_temperature: z.number().nullish(),
    weather_code: z.number(),
    wind_speed_10m: z.number().nullish(),
    is_day: z.number().nullish(),
  }),
  current_units: z.object({ temperature_2m: z.string(), wind_speed_10m: z.string().nullish() }),
  hourly: z.object({
    time: z.array(z.string()),
    temperature_2m: numberList,
    weather_code: numberList,
    precipitation_probability: numberList.nullish(),
    is_day: numberList.nullish(),
  }),
  daily: z.object({ temperature_2m_max: numberList, temperature_2m_min: numberList }).nullish(),
});

/**
 * Builds the forecast request.
 *
 * @param settings - Where and in which units.
 * @param apiUrl - The forecast endpoint.
 * @returns The URL to ask.
 */
export function forecastUrl(settings: WeatherWidgetSettings, apiUrl: string): string {
  const url = new URL(apiUrl);
  const isImperial = settings.units === WeatherUnits.Imperial;
  const params: Record<string, string> = {
    latitude: String(settings.latitude),
    longitude: String(settings.longitude),
    current: CURRENT,
    hourly: HOURLY,
    daily: DAILY,
    timezone: 'auto',
    forecast_days: FORECAST_DAYS,
    temperature_unit: isImperial ? 'fahrenheit' : 'celsius',
    wind_speed_unit: isImperial ? 'mph' : 'kmh',
  };
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.href;
}

/**
 * Asks Open-Meteo for a weather widget's forecast.
 *
 * @param settings - Where and in which units.
 * @param deps - The fetch, its limits, the endpoint and how many hours to show.
 * @returns The weather now, today's high and low, and the coming hours.
 * @throws WidgetError when the request fails or the answer isn't a forecast.
 */
export async function fetchWeather(settings: WeatherWidgetSettings, deps: WeatherFetchDeps): Promise<Fetched> {
  const url = forecastUrl(settings, deps.apiUrl);
  const text = await fetchBody({ url, writtenUrl: deps.apiUrl }, deps);
  let parsed: z.output<typeof forecastSchema>;
  try {
    parsed = forecastSchema.parse(JSON.parse(text));
  } catch {
    throw new WidgetError(`${hostOf(deps.apiUrl)} answered with something that isn't an Open-Meteo forecast.`);
  }
  const { current, current_units: units, hourly, daily } = parsed;
  // Both are the place's own time as `YYYY-MM-DDTHH:MM`, so they compare as text: the first hour after now.
  const start = hourly.time.findIndex((time) => time > current.time);
  const end = start === -1 ? start : Math.min(hourly.time.length, start + deps.hours);
  const hours: WeatherHour[] = [];
  for (let index = start; index < end; index += 1) {
    const temperature = hourly.temperature_2m[index] ?? null;
    const weatherCode = hourly.weather_code[index] ?? null;
    if (temperature === null || weatherCode === null) {
      continue;
    }
    hours.push({
      time: hourly.time[index] ?? '',
      temperature,
      weatherCode,
      description: describeWeather(weatherCode),
      precipitationChance: hourly.precipitation_probability?.[index] ?? null,
      isDay: hourly.is_day?.[index] !== 0,
    });
  }
  return {
    result: {
      type: WidgetType.Weather,
      temperatureUnit: units.temperature_2m,
      windSpeedUnit: units.wind_speed_10m ?? '',
      now: {
        temperature: current.temperature_2m,
        apparentTemperature: current.apparent_temperature ?? null,
        weatherCode: current.weather_code,
        description: describeWeather(current.weather_code),
        windSpeed: current.wind_speed_10m ?? null,
        isDay: current.is_day !== 0,
      },
      high: daily?.temperature_2m_max[0] ?? null,
      low: daily?.temperature_2m_min[0] ?? null,
      hours,
    },
    raw: null,
  };
}
