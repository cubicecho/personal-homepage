// The widget part of the page model: what a WIDGET item shows and where it gets it from. Like page.ts,
// this is the contract everything above the store reads; the fetching itself is in server/widgets/.

/**
 * A secret reference inside a widget's URL, header value or body: `${env:HOMEPAGE_SONARR_KEY}` or
 * `${file:/run/secrets/sonarr}`. It is stored and sent over the API as written, and replaced with the
 * secret only when the server fetches.
 */
export const SECRET_REFERENCE = /\$\{(env|file):([^}]+)\}/g;

/** What a widget shows. */
export const WidgetType = {
  /** Values picked out of a JSON API's answer. */
  Api: 'API',
  /** The latest entries of an RSS or Atom feed. */
  Rss: 'RSS',
  /** The weather now and for the coming hours, from Open-Meteo. */
  Weather: 'WEATHER',
} as const;
export type WidgetType = (typeof WidgetType)[keyof typeof WidgetType];

/** How an API widget's value is written out. */
export const ValueFormat = {
  /** As a number, with thousands grouped. */
  Number: 'NUMBER',
  /** As it comes. */
  Text: 'TEXT',
  /** A count of bytes, as KiB, MiB and so on. */
  Bytes: 'BYTES',
  /** A number that is already a percentage: 42 is 42%. */
  Percent: 'PERCENT',
  /** A number of seconds, as hours, minutes and seconds. */
  Duration: 'DURATION',
  /** A date: an ISO 8601 string, or seconds or milliseconds since 1970. */
  Date: 'DATE',
} as const;
export type ValueFormat = (typeof ValueFormat)[keyof typeof ValueFormat];

/** The request methods an API widget can use. */
export const HttpMethod = { Get: 'GET', Post: 'POST' } as const;
export type HttpMethod = (typeof HttpMethod)[keyof typeof HttpMethod];

/** The units a weather widget reports in. */
export const WeatherUnits = {
  /** °C and km/h. */
  Metric: 'METRIC',
  /** °F and mph. */
  Imperial: 'IMPERIAL',
} as const;
export type WeatherUnits = (typeof WeatherUnits)[keyof typeof WeatherUnits];

/** One header an API widget sends. The value may hold `${env:NAME}` or `${file:/path}` secret references. */
export interface WidgetHeader {
  name: string;
  value: string;
}

/** One value an API widget shows. */
export interface ApiField {
  label: string;
  /** Where the value is in the answer, as a JSONPath: `$.totalRecords`, `$.records[0].title`, `$.records.length`. */
  path: string;
  format: ValueFormat;
  /** Mark the value when it is above this number. */
  warnAbove: number | null;
  /** Mark the value when it is below this number. */
  warnBelow: number | null;
}

/** What an API widget asks, and what it shows. Strings may hold secret references, resolved only when fetching. */
export interface ApiWidgetSettings {
  url: string;
  method: HttpMethod;
  headers: WidgetHeader[];
  /** Sent with a POST. Null for none. */
  body: string | null;
  fields: ApiField[];
}

/** Which feed an RSS widget reads, and how much it shows. */
export interface RssWidgetSettings {
  url: string;
  /** How many entries it shows. */
  limit: number;
  /** Whether each entry shows a line of its summary. */
  showSummary: boolean;
}

/** Where a weather widget reports for. */
export interface WeatherWidgetSettings {
  latitude: number;
  longitude: number;
  units: WeatherUnits;
}

/** What every widget has, whatever it shows. */
interface WidgetBase {
  /** How long the server reuses an answer, in seconds. */
  cacheSeconds: number;
  /** How often an open page asks again, in seconds. Null asks only when the page loads. */
  refreshSeconds: number | null;
}

/** An API widget. */
export interface ApiWidget extends WidgetBase {
  type: typeof WidgetType.Api;
  api: ApiWidgetSettings;
}

/** An RSS widget. */
export interface RssWidget extends WidgetBase {
  type: typeof WidgetType.Rss;
  rss: RssWidgetSettings;
}

/** A weather widget. */
export interface WeatherWidget extends WidgetBase {
  type: typeof WidgetType.Weather;
  weather: WeatherWidgetSettings;
}

/** A WIDGET item's widget: one of the three, told apart by `type`. */
export type Widget = ApiWidget | RssWidget | WeatherWidget;
