import { GraphQLError } from 'graphql';
import { PAGE_LIMIT_DEFAULTS, WIDGET_DEFAULTS } from '../../server/core/defaults.ts';
import { ErrorCode } from '../../server/core/errors.ts';
import { ItemKind } from '../../server/pages/page.ts';
import { parseItemFields, parseWidget } from '../../server/pages/page-input.ts';
import { HttpMethod, ValueFormat, WeatherUnits, WidgetType } from '../../server/pages/widget.ts';

/**
 * Runs a parse that should fail and returns its message.
 *
 * @param parse - The parse.
 * @returns The thrown BAD_USER_INPUT error's message.
 */
function refusal(parse: () => unknown): string {
  try {
    parse();
  } catch (error) {
    if (error instanceof GraphQLError && error.extensions.code === ErrorCode.BadUserInput) {
      return error.message;
    }
    throw error;
  }
  throw new Error('expected the parse to fail');
}

const apiInput = {
  type: WidgetType.Api,
  api: {
    url: 'http://sonarr.lan:8989/api/v3/queue?apikey=${env:HOMEPAGE_SONARR_KEY}',
    headers: [
      { name: 'X-Api-Key', value: '${env:HOMEPAGE_SONARR_KEY}' },
      { name: '', value: '' },
    ],
    fields: [{ label: 'Queue', path: '$.totalRecords', format: ValueFormat.Number, warnAbove: 10 }],
  },
};

describe('parseWidget', () => {
  it('fills in the defaults, keeps secret references as written, and drops blank headers', () => {
    expect(parseWidget(apiInput)).toEqual({
      type: WidgetType.Api,
      cacheSeconds: WIDGET_DEFAULTS.defaultApiCacheSeconds,
      refreshSeconds: null,
      api: {
        url: 'http://sonarr.lan:8989/api/v3/queue?apikey=${env:HOMEPAGE_SONARR_KEY}',
        method: HttpMethod.Get,
        headers: [{ name: 'X-Api-Key', value: '${env:HOMEPAGE_SONARR_KEY}' }],
        body: null,
        fields: [
          { label: 'Queue', path: '$.totalRecords', format: ValueFormat.Number, warnAbove: 10, warnBelow: null },
        ],
      },
    });
    expect(parseWidget({ type: WidgetType.Rss, rss: { url: 'https://example.com/feed' } })).toMatchObject({
      cacheSeconds: WIDGET_DEFAULTS.defaultRssCacheSeconds,
      rss: { limit: WIDGET_DEFAULTS.defaultRssEntries, showSummary: false },
    });
    expect(parseWidget({ type: WidgetType.Weather, weather: { latitude: 1, longitude: 2 } })).toMatchObject({
      weather: { units: WeatherUnits.Metric },
    });
  });

  it.each([
    ['no settings for its type', { type: WidgetType.Rss, api: apiInput.api }, /rss widget needs its settings/],
    [
      'a JSONPath it can not follow',
      { ...apiInput, api: { ...apiInput.api, fields: [{ label: 'A', path: '$..x' }] } },
      /path/,
    ],
    ['no fields', { ...apiInput, api: { ...apiInput.api, fields: [] } }, /at least one value/],
    [
      'a header value with a line break',
      { ...apiInput, api: { ...apiInput.api, headers: [{ name: 'A', value: 'x\r\nB: y' }] } },
      /one line/,
    ],
    [
      'a bad header name',
      { ...apiInput, api: { ...apiInput.api, headers: [{ name: 'A B', value: 'x' }] } },
      /header name/,
    ],
    ['a script URL', { type: WidgetType.Rss, rss: { url: 'javascript:alert(1)' } }, /http/],
    ['a cache too short', { ...apiInput, cacheSeconds: PAGE_LIMIT_DEFAULTS.minWidgetCacheSeconds - 1 }, /cacheSeconds/],
    ['a latitude off the globe', { type: WidgetType.Weather, weather: { latitude: 91, longitude: 0 } }, /latitude/],
    [
      'too many fields',
      {
        ...apiInput,
        api: {
          ...apiInput.api,
          fields: Array.from({ length: PAGE_LIMIT_DEFAULTS.maxWidgetFields + 1 }, () => apiInput.api.fields[0]),
        },
      },
      /fields/,
    ],
  ])('refuses %s', (_name, input, message) => {
    expect(refusal(() => parseWidget(input))).toMatch(message);
  });
});

describe('parseItemFields for a widget', () => {
  it('needs no URL, leaves checking off, and keeps the widget', () => {
    const fields = parseItemFields({ kind: ItemKind.Widget, title: 'Queue', widget: apiInput });
    expect(fields).toMatchObject({
      kind: ItemKind.Widget,
      url: null,
      opensIn: null,
      frameHeightPx: null,
      check: { enabled: false, url: null },
      widget: { type: WidgetType.Api },
    });
  });

  it('refuses a widget with no settings, and a link with no URL', () => {
    expect(refusal(() => parseItemFields({ kind: ItemKind.Widget, title: 'Queue' }))).toMatch(/needs its settings/);
    expect(refusal(() => parseItemFields({ kind: ItemKind.Link, title: 'Jellyfin' }))).toMatch(/Give it an address/);
  });

  it('drops a widget sent with another kind', () => {
    const fields = parseItemFields({ kind: ItemKind.Link, title: 'Jellyfin', url: 'http://jf.lan', widget: apiInput });
    expect(fields.widget).toBeNull();
  });
});
