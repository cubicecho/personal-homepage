// The API widget: asks a JSON API and picks values out of the answer with each field's JSONPath.
import { type ApiWidgetSettings, HttpMethod, WidgetType } from '../pages/widget.ts';
import { type FetchLimits, fetchBody, hostOf } from './fetch-body.ts';
import { formatValues, isPastThreshold } from './format-value.ts';
import { selectJsonPath } from './json-path.ts';
import type { SecretResolver } from './secrets.ts';
import { type Fetched, WidgetError } from './widget-result.ts';

/** What the API fetcher needs beyond the widget's own settings. */
export interface ApiFetchDeps extends FetchLimits {
  secrets: SecretResolver;
  /** Longest value a row shows, in characters. */
  maxValueChars: number;
}

/**
 * Fills the secrets into a widget's headers.
 *
 * @param settings - The widget's settings.
 * @param secrets - The resolver.
 * @returns The headers to send.
 */
async function resolveHeaders(settings: ApiWidgetSettings, secrets: SecretResolver): Promise<Record<string, string>> {
  const entries = await Promise.all(
    settings.headers.map(async (header) => [header.name, await secrets.resolve(header.value)] as const),
  );
  return Object.fromEntries(entries);
}

/**
 * Asks an API widget's source and picks out its values.
 *
 * @param settings - The widget's settings, as written.
 * @param deps - The fetch, its limits, and the secret resolver.
 * @returns The rows, and the parsed answer for the editor's test.
 * @throws WidgetError when the request fails, or the answer isn't JSON.
 */
export async function fetchApi(settings: ApiWidgetSettings, deps: ApiFetchDeps): Promise<Fetched> {
  const { secrets } = deps;
  const isPost = settings.method === HttpMethod.Post;
  const body = isPost && settings.body !== null ? await secrets.resolve(settings.body) : undefined;
  const headers = { accept: 'application/json', ...(await resolveHeaders(settings, secrets)) };
  const text = await fetchBody(
    {
      url: await secrets.resolve(settings.url),
      writtenUrl: settings.url,
      init: { method: settings.method, headers, body },
    },
    deps,
  );
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new WidgetError(`${hostOf(settings.url)} answered with something that isn't JSON.`);
  }
  const rows = settings.fields.map((field) => {
    const values = selectJsonPath(data, field.path);
    return {
      label: field.label,
      value: formatValues(values, field.format, deps.maxValueChars),
      warn: isPastThreshold(values, field.warnAbove, field.warnBelow),
    };
  });
  return { result: { type: WidgetType.Api, rows }, raw: data };
}
