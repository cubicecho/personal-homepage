// Fetches widgets' data when a page is viewed, never in the background. Each answer is kept for the
// widget's `cacheSeconds`, keyed by page, item and a hash of its settings, so an edited widget asks again.
// Two views at once share one fetch. When a fetch fails, the last good answer is served marked stale,
// with the failure beside it, and the failure is kept as long as an answer would be, so a source that is
// down isn't asked on every view.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { WIDGET_DEFAULTS, type WidgetSettings } from '../core/defaults.ts';
import { errorMessage } from '../core/errors.ts';
import { MS_PER_SECOND } from '../core/wire.ts';
import type { Item } from '../pages/page.ts';
import { type Widget, WidgetType } from '../pages/widget.ts';
import { fetchApi } from './api.ts';
import { fetchRss } from './rss.ts';
import { createSecretResolver, type SecretResolver } from './secrets.ts';
import { fetchWeather } from './weather.ts';
import { type Fetched, type WidgetData, WidgetError, type WidgetPreview, type WidgetResult } from './widget-result.ts';

/** The folder under the data directory a `${file:…}` secret may always be read from. */
const DATA_SECRETS_DIR = 'secrets';
/** What a failure that isn't a widget's own is called, since its message may say anything. */
const UNEXPECTED_FAILURE = "The widget couldn't be fetched. The server log has the details.";
/** How the raw answer an API widget's test shows is cut short. */
const TRUNCATED = '\n… (cut short)';
/** Spaces a level of the raw answer is indented by. */
const RAW_INDENT = 2;
/** Hex characters of a settings hash kept in a cache key: enough that two settings never meet. */
const SETTINGS_HASH_CHARS = 16;

/** Gets and tests widgets' data. */
export interface WidgetService {
  /**
   * Gives a widget item's latest data, fetching it when the kept answer is too old.
   *
   * @param pageSlug - The page the item is on.
   * @param item - The item. One that isn't a widget gets an error.
   * @returns The data, maybe stale, with the last failure.
   */
  dataFor(pageSlug: string, item: Item): Promise<WidgetData>;
  /**
   * Fetches a widget that hasn't been saved, for the editor's test. Nothing is kept.
   *
   * @param widget - The widget as it would be saved.
   * @returns The result or the failure, and an API widget's raw answer.
   */
  preview(widget: Widget): Promise<WidgetPreview>;
}

/** What the service talks to. Tests pass their own. */
export interface WidgetServiceDeps {
  /** The data directory, whose `secrets/` folder file secrets may be read from. */
  dataDir: string;
  fetch?: typeof fetch;
  /** The clock, in milliseconds since 1970. */
  now?: () => number;
  /** The environment env secrets are read from. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Reads a secret file. */
  readSecretFile?: (file: string) => Promise<string>;
}

/** One kept answer. */
interface CacheEntry {
  /** The last good result and when it was fetched; kept through later failures. */
  good: { result: WidgetResult; fetchedAtMs: number } | null;
  /** The last fetch's failure, or null when it worked. */
  error: string | null;
  /** When to ask again. */
  expiresAtMs: number;
}

/**
 * Applies a function to every string in a JSON value.
 *
 * @param value - The value.
 * @param change - What to do to each string.
 * @returns A copy with every string changed.
 */
function mapStringsIn(value: unknown, change: (text: string) => string): unknown {
  if (typeof value === 'string') {
    return change(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => mapStringsIn(entry, change));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [change(key), mapStringsIn(entry, change)]));
  }
  return value;
}

/**
 * Applies a function to every string in a value, keeping its type.
 *
 * @typeParam T - The value's type: plain data, whose shape a string change can't alter.
 * @param value - The value.
 * @param change - What to do to each string.
 * @returns A copy with every string changed.
 */
function mapStrings<T>(value: T, change: (text: string) => string): T {
  // Only strings are replaced, by strings, so the copy has the shape of the value it was made from.
  return mapStringsIn(value, change) as T;
}

/**
 * Hashes a widget's settings, so editing them asks again.
 *
 * @param widget - The widget.
 * @returns A short hash of its settings as written.
 */
function settingsHash(widget: Widget): string {
  return createHash('sha256').update(JSON.stringify(widget)).digest('hex').slice(0, SETTINGS_HASH_CHARS);
}

/**
 * Builds the widget service.
 *
 * @param overrides - Widget settings to replace, such as the weather endpoint.
 * @param deps - The data directory, and the fetch, clock and secret sources tests replace.
 * @returns The service.
 */
export function createWidgetService(overrides: Partial<WidgetSettings>, deps: WidgetServiceDeps): WidgetService {
  const settings = { ...WIDGET_DEFAULTS, ...overrides };
  const fetchFn = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const secretDirs = [path.resolve(deps.dataDir, DATA_SECRETS_DIR), ...settings.secretFileDirs];
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<WidgetData>>();
  const limits = { fetch: fetchFn, timeoutSeconds: settings.timeoutSeconds, maxBytes: settings.maxResponseBytes };

  /**
   * Makes the secret resolver for one fetch.
   *
   * @returns A fresh resolver, which remembers only this fetch's secrets.
   */
  const newResolver = (): SecretResolver =>
    createSecretResolver({
      env: deps.env ?? process.env,
      readFile: deps.readSecretFile ?? ((file) => readFile(file, 'utf-8')),
      envPrefix: settings.secretEnvPrefix,
      fileDirs: secretDirs,
      maxFileBytes: settings.maxSecretFileBytes,
    });

  /**
   * Runs one widget's fetcher.
   *
   * @param widget - The widget.
   * @param secrets - The resolver for this fetch.
   * @returns What it fetched.
   */
  const runFetcher = (widget: Widget, secrets: SecretResolver): Promise<Fetched> => {
    if (widget.type === WidgetType.Api) {
      return fetchApi(widget.api, { ...limits, secrets, maxValueChars: settings.maxApiValueChars });
    }
    if (widget.type === WidgetType.Rss) {
      return fetchRss(widget.rss, { ...limits, secrets, maxSummaryChars: settings.maxRssSummaryChars });
    }
    return fetchWeather(widget.weather, { ...limits, apiUrl: settings.weatherApiUrl, hours: settings.weatherHours });
  };

  /**
   * Fetches a widget and scrubs every string that comes back of the secrets it used.
   *
   * @param widget - The widget.
   * @returns The fetched data and raw answer, or the failure as a sentence.
   */
  const fetchScrubbed = async (widget: Widget): Promise<{ fetched: Fetched | null; error: string | null }> => {
    const secrets = newResolver();
    try {
      const fetched = await runFetcher(widget, secrets);
      const redact = (text: string): string => secrets.redact(text);
      // A source that echoes a header back must not show it, in the result or the raw answer.
      return {
        fetched: { result: mapStrings(fetched.result, redact), raw: mapStrings(fetched.raw, redact) },
        error: null,
      };
    } catch (error) {
      if (error instanceof WidgetError) {
        return { fetched: null, error: secrets.redact(error.message) };
      }
      console.error(`[widgets] ${widget.type.toLowerCase()} fetch failed: ${secrets.redact(errorMessage(error))}`);
      return { fetched: null, error: UNEXPECTED_FAILURE };
    }
  };

  /**
   * Keeps the cache within its size, dropping the answers asked for longest ago.
   */
  const trim = (): void => {
    for (const key of cache.keys()) {
      if (cache.size <= settings.maxCachedAnswers) {
        return;
      }
      cache.delete(key);
    }
  };

  /**
   * Builds what the API serves from a kept answer.
   *
   * @param entry - The answer.
   * @returns The data.
   */
  const toData = (entry: CacheEntry): WidgetData => ({
    fetchedAt: entry.good === null ? null : new Date(entry.good.fetchedAtMs).toISOString(),
    stale: entry.good !== null && entry.error !== null,
    error: entry.error,
    result: entry.good?.result ?? null,
  });

  /**
   * Fetches a widget and keeps the answer, or the failure beside the last good answer.
   *
   * @param key - Where it is kept.
   * @param widget - The widget.
   * @returns The data.
   */
  const refresh = async (key: string, widget: Widget): Promise<WidgetData> => {
    const { fetched, error } = await fetchScrubbed(widget);
    const time = now();
    const previous = cache.get(key)?.good ?? null;
    const entry: CacheEntry = {
      good: fetched === null ? previous : { result: fetched.result, fetchedAtMs: time },
      error,
      expiresAtMs: time + widget.cacheSeconds * MS_PER_SECOND,
    };
    cache.delete(key);
    cache.set(key, entry);
    trim();
    return toData(entry);
  };

  return {
    dataFor: async (pageSlug, item) => {
      const widget = item.widget;
      if (widget === null) {
        return { fetchedAt: null, stale: false, error: 'This item is not a widget.', result: null };
      }
      const key = `${pageSlug}/${item.id}/${settingsHash(widget)}`;
      const kept = cache.get(key);
      if (kept !== undefined && kept.expiresAtMs > now()) {
        return toData(kept);
      }
      const running = inFlight.get(key);
      if (running !== undefined) {
        return running;
      }
      const started = refresh(key, widget).finally(() => inFlight.delete(key));
      inFlight.set(key, started);
      return started;
    },

    preview: async (widget) => {
      const { fetched, error } = await fetchScrubbed(widget);
      const rawValue = fetched?.raw ?? null;
      let raw: string | null = null;
      if (rawValue !== null) {
        const text = JSON.stringify(rawValue, null, RAW_INDENT);
        raw =
          text.length > settings.maxPreviewRawChars
            ? `${text.slice(0, settings.maxPreviewRawChars)}${TRUNCATED}`
            : text;
      }
      return { result: fetched?.result ?? null, error, raw };
    },
  };
}
