import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type Item, ItemKind } from '../../server/pages/page.ts';
import {
  type ApiWidget,
  HttpMethod,
  type RssWidget,
  ValueFormat,
  WeatherUnits,
  type WeatherWidget,
  type Widget,
  WidgetType,
} from '../../server/pages/widget.ts';
import { createWidgetService, type WidgetService } from '../../server/widgets/widget-service.ts';
import { linkFields, makeDataDir } from '../helpers.ts';
import { json, startSource, type TestSource, text } from './server.ts';

const SECRET = 's3cr3t-value-123';
const CACHE_SECONDS = 60;
const MS_PER_SECOND = 1000;
/** How long the slow route waits, past the short timeout the tests set. */
const SLOW_MS = 1500;

/**
 * Builds a widget item.
 *
 * @param id - Its id.
 * @param widget - Its widget.
 * @returns The item.
 */
function widgetItem(id: string, widget: Widget): Item {
  return {
    id,
    ...linkFields(id, {
      kind: ItemKind.Widget,
      url: null,
      opensIn: null,
      check: { enabled: false, url: null },
      widget,
    }),
  };
}

/**
 * Builds an API widget.
 *
 * @param url - What it asks.
 * @param [overrides] - Settings to replace.
 * @returns The widget.
 */
function apiWidget(url: string, overrides: Partial<ApiWidget['api']> = {}): ApiWidget {
  return {
    type: WidgetType.Api,
    cacheSeconds: CACHE_SECONDS,
    refreshSeconds: null,
    api: {
      url,
      method: HttpMethod.Get,
      headers: [],
      body: null,
      fields: [
        { label: 'Queue', path: '$.totalRecords', format: ValueFormat.Number, warnAbove: 10, warnBelow: null },
        { label: 'First', path: '$.records[0].title', format: ValueFormat.Text, warnAbove: null, warnBelow: null },
      ],
      ...overrides,
    },
  };
}

describe('widget service', () => {
  let source: TestSource;
  let dataDir: string;
  let remove: () => Promise<void>;
  let clock: number;
  let service: WidgetService;

  beforeAll(async () => {
    source = await startSource();
    ({ dir: dataDir, remove } = await makeDataDir());
  });

  afterAll(async () => {
    await source.close();
    await remove();
  });

  beforeEach(() => {
    source.routes.clear();
    source.hits.clear();
    clock = Date.parse('2026-11-05T12:00:00Z');
    service = createWidgetService(
      { timeoutSeconds: 0.5, weatherApiUrl: `${source.base}/forecast` },
      { dataDir, now: () => clock, env: { HOMEPAGE_KEY: SECRET, OTHER_KEY: 'nope' } },
    );
  });

  it('picks values out of an API answer, sending secret headers', async () => {
    source.routes.set('/queue', (req, res) => {
      const isAuthorized = req.headers['x-api-key'] === SECRET;
      json(
        isAuthorized ? { totalRecords: 12, records: [{ title: 'Show' }] } : { error: 'no' },
        isAuthorized ? 200 : 401,
      )(req, res, '');
    });
    const widget = apiWidget(`${source.base}/queue`, {
      headers: [{ name: 'X-Api-Key', value: '${env:HOMEPAGE_KEY}' }],
    });
    const data = await service.dataFor('home', widgetItem('queue', widget));
    expect(data).toEqual({
      fetchedAt: '2026-11-05T12:00:00.000Z',
      stale: false,
      error: null,
      result: {
        type: WidgetType.Api,
        rows: [
          { label: 'Queue', value: '12', warn: true },
          { label: 'First', value: 'Show', warn: false },
        ],
      },
    });
  });

  it('posts a body with secrets filled in', async () => {
    source.routes.set('/rpc', (req, res, body) =>
      json({ method: req.method, body: JSON.parse(body).key === SECRET })(req, res, ''),
    );
    const widget = apiWidget(`${source.base}/rpc`, {
      method: HttpMethod.Post,
      body: '{"key": "${env:HOMEPAGE_KEY}"}',
      fields: [
        { label: 'Method', path: '$.method', format: ValueFormat.Text, warnAbove: null, warnBelow: null },
        { label: 'Body', path: '$.body', format: ValueFormat.Text, warnAbove: null, warnBelow: null },
      ],
    });
    const data = await service.dataFor('home', widgetItem('rpc', widget));
    expect(data.result).toMatchObject({ rows: [{ value: 'POST' }, { value: 'true' }] });
  });

  it('reuses an answer until it is too old, and an edited widget asks again', async () => {
    source.routes.set('/queue', json({ totalRecords: 1, records: [] }));
    const widget = apiWidget(`${source.base}/queue`);
    await service.dataFor('home', widgetItem('queue', widget));
    await service.dataFor('home', widgetItem('queue', widget));
    expect(source.hits.get('/queue')).toBe(1);

    clock += CACHE_SECONDS * MS_PER_SECOND + 1;
    await service.dataFor('home', widgetItem('queue', widget));
    expect(source.hits.get('/queue')).toBe(2);

    const edited = apiWidget(`${source.base}/queue`, {
      method: HttpMethod.Get,
      body: null,
      headers: [{ name: 'X-A', value: 'b' }],
    });
    await service.dataFor('home', widgetItem('queue', edited));
    expect(source.hits.get('/queue')).toBe(3);
  });

  it('shares one fetch between views at once', async () => {
    source.routes.set('/slowish', (req, res) => {
      setTimeout(() => json({ totalRecords: 2, records: [] })(req, res, ''), 50);
    });
    const item = widgetItem('slowish', apiWidget(`${source.base}/slowish`));
    const answers = await Promise.all([service.dataFor('home', item), service.dataFor('home', item)]);
    expect(source.hits.get('/slowish')).toBe(1);
    expect(answers[0]).toEqual(answers[1]);
  });

  it('serves the last good answer, marked stale, when the source fails', async () => {
    source.routes.set('/flaky', json({ totalRecords: 5, records: [{ title: 'Up' }] }));
    const item = widgetItem('flaky', apiWidget(`${source.base}/flaky`));
    await service.dataFor('home', item);

    source.routes.set('/flaky', json({ error: 'boom' }, 503));
    clock += CACHE_SECONDS * MS_PER_SECOND + 1;
    const data = await service.dataFor('home', item);
    expect(data).toMatchObject({
      stale: true,
      error: expect.stringMatching(/answered 503/),
      fetchedAt: '2026-11-05T12:00:00.000Z',
      result: { rows: [{ value: '5' }, { value: 'Up' }] },
    });

    // The failure is kept as long as an answer, so a source that is down isn't asked on every view.
    await service.dataFor('home', item);
    expect(source.hits.get('/flaky')).toBe(2);
  });

  it('gives up on a slow source and an answer that is too large', async () => {
    source.routes.set('/slow', (req, res) => {
      setTimeout(() => json({})(req, res, ''), SLOW_MS);
    });
    const slow = await service.dataFor('home', widgetItem('slow', apiWidget(`${source.base}/slow`)));
    expect(slow).toMatchObject({ result: null, stale: false, error: expect.stringMatching(/didn't answer within/) });

    const small = createWidgetService({ maxResponseBytes: 100 }, { dataDir });
    source.routes.set('/big', json({ totalRecords: 'x'.repeat(500) }));
    const big = await small.dataFor('home', widgetItem('big', apiWidget(`${source.base}/big`)));
    expect(big.error).toMatch(/answered with more than 100 bytes/);
  });

  it('says plainly when an answer is not JSON, or a host does not answer', async () => {
    source.routes.set('/html', text('<html></html>', 'text/html'));
    const html = await service.dataFor('home', widgetItem('html', apiWidget(`${source.base}/html`)));
    expect(html.error).toMatch(/isn't JSON/);

    const refused = await service.dataFor('home', widgetItem('refused', apiWidget('http://127.0.0.1:1/x')));
    expect(refused.error).toMatch(/Couldn't reach 127\.0\.0\.1:1/);
  });

  describe('secrets', () => {
    it('never shows a secret, even when the source echoes it back', async () => {
      source.routes.set('/echo', (req, res) =>
        json({ totalRecords: 1, records: [{ title: `key is ${String(req.headers['x-api-key'])}` }] })(req, res, ''),
      );
      const widget = apiWidget(`${source.base}/echo`, {
        headers: [{ name: 'X-Api-Key', value: '${env:HOMEPAGE_KEY}' }],
      });
      const data = await service.dataFor('home', widgetItem('echo', widget));
      const preview = await service.preview(widget);
      const everything = JSON.stringify([data, preview]);
      expect(everything).not.toContain(SECRET);
      expect(everything).toContain('key is [secret]');
    });

    it('keeps a secret in the address out of failure messages', async () => {
      const widget = apiWidget('http://127.0.0.1:1/api?key=${env:HOMEPAGE_KEY}');
      const data = await service.dataFor('home', widgetItem('leaky', widget));
      expect(data.error).not.toContain(SECRET);
      expect(data.error).toMatch(/Couldn't reach/);
    });

    it('names a missing variable, refuses ones without the prefix, and never logs', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const missing = await service.preview(
        apiWidget(`${source.base}/x`, { headers: [{ name: 'A', value: '${env:HOMEPAGE_MISSING}' }] }),
      );
      expect(missing.error).toBe('The environment variable HOMEPAGE_MISSING is not set.');
      const other = await service.preview(
        apiWidget(`${source.base}/x`, { headers: [{ name: 'A', value: '${env:OTHER_KEY}' }] }),
      );
      expect(other.error).toMatch(/must be named HOMEPAGE_/);
      expect(other.error).not.toContain('nope');
      expect(error).not.toHaveBeenCalled();
      error.mockRestore();
    });

    it('reads file secrets only from a secrets directory', async () => {
      await mkdir(path.join(dataDir, 'secrets'), { recursive: true });
      await writeFile(path.join(dataDir, 'secrets', 'token'), `${SECRET}\n`);
      await writeFile(path.join(dataDir, 'outside'), 'outside');
      source.routes.set('/file', (req, res) =>
        json({ ok: req.headers.authorization === `Bearer ${SECRET}` })(req, res, ''),
      );
      const field = { label: 'Ok', path: '$.ok', format: ValueFormat.Text, warnAbove: null, warnBelow: null };
      const inside = await service.preview(
        apiWidget(`${source.base}/file`, {
          headers: [{ name: 'Authorization', value: `Bearer \${file:${path.join(dataDir, 'secrets', 'token')}}` }],
          fields: [field],
        }),
      );
      expect(inside.result).toMatchObject({ rows: [{ value: 'true' }] });

      const outside = await service.preview(
        apiWidget(`${source.base}/file`, {
          headers: [{ name: 'A', value: `\${file:${path.join(dataDir, 'outside')}}` }],
          fields: [field],
        }),
      );
      expect(outside.error).toMatch(/isn't in a secrets directory/);
      const escaping = await service.preview(
        apiWidget(`${source.base}/file`, {
          headers: [{ name: 'A', value: `\${file:${path.join(dataDir, 'secrets', '..', 'outside')}}` }],
          fields: [field],
        }),
      );
      expect(escaping.error).toMatch(/isn't in a secrets directory/);
    });
  });

  it('gives the raw answer in a preview, cut short past the limit', async () => {
    const short = createWidgetService({ maxPreviewRawChars: 40 }, { dataDir });
    source.routes.set('/long', json({ totalRecords: 1, records: [{ title: 'x'.repeat(100) }] }));
    const preview = await short.preview(apiWidget(`${source.base}/long`));
    expect(preview.raw?.startsWith('{\n  "totalRecords": 1')).toBe(true);
    expect(preview.raw?.endsWith('(cut short)')).toBe(true);
    expect(source.hits.get('/long')).toBe(1);
  });

  it('reads a feed', async () => {
    source.routes.set(
      '/feed.xml',
      text(
        '<rss><channel><title>News</title><item><title>One</title><link>https://example.com/1</link><description>A long summary of the first entry</description></item></channel></rss>',
        'application/rss+xml',
      ),
    );
    const widget: RssWidget = {
      type: WidgetType.Rss,
      cacheSeconds: CACHE_SECONDS,
      refreshSeconds: null,
      rss: { url: `${source.base}/feed.xml`, limit: 5, showSummary: true },
    };
    const data = await service.dataFor('home', widgetItem('news', widget));
    expect(data.result).toEqual({
      type: WidgetType.Rss,
      feedTitle: 'News',
      entries: [
        {
          title: 'One',
          url: 'https://example.com/1',
          source: 'News',
          publishedAt: null,
          summary: 'A long summary of the first entry',
        },
      ],
    });
    source.routes.set('/page', text('<html><body>Not a feed</body></html>', 'text/html'));
    const notFeed = await service.preview({ ...widget, rss: { ...widget.rss, url: `${source.base}/page` } });
    expect(notFeed.error).toMatch(/isn't an RSS or Atom feed/);
  });

  it('reads the weather from the forecast endpoint it was given', async () => {
    const asked: { params: URLSearchParams | null } = { params: null };
    source.routes.set('/forecast', (req, res) => {
      asked.params = new URL(req.url ?? '/', 'http://localhost').searchParams;
      json({
        current: {
          time: '2026-11-05T13:45',
          temperature_2m: 11.2,
          apparent_temperature: 9.8,
          weather_code: 61,
          wind_speed_10m: 14,
          is_day: 1,
        },
        current_units: { temperature_2m: '°F', wind_speed_10m: 'mp/h' },
        hourly: {
          time: ['2026-11-05T13:00', '2026-11-05T14:00', '2026-11-05T15:00'],
          temperature_2m: [11, 12, 13],
          weather_code: [61, 3, 0],
          precipitation_probability: [80, 40, 5],
        },
        daily: { temperature_2m_max: [14], temperature_2m_min: [6] },
      })(req, res, '');
    });
    const widget: WeatherWidget = {
      type: WidgetType.Weather,
      cacheSeconds: CACHE_SECONDS,
      refreshSeconds: null,
      weather: { latitude: 52.37, longitude: 4.89, units: WeatherUnits.Imperial },
    };
    const data = await service.dataFor('home', widgetItem('weather', widget));
    expect(asked.params?.get('temperature_unit')).toBe('fahrenheit');
    expect(asked.params?.get('latitude')).toBe('52.37');
    expect(data.result).toEqual({
      type: WidgetType.Weather,
      temperatureUnit: '°F',
      windSpeedUnit: 'mp/h',
      now: {
        temperature: 11.2,
        apparentTemperature: 9.8,
        weatherCode: 61,
        description: 'Light rain',
        windSpeed: 14,
        isDay: true,
      },
      high: 14,
      low: 6,
      hours: [
        { time: '2026-11-05T14:00', temperature: 12, weatherCode: 3, description: 'Overcast', precipitationChance: 40 },
        { time: '2026-11-05T15:00', temperature: 13, weatherCode: 0, description: 'Clear', precipitationChance: 5 },
      ],
    });
  });
});
