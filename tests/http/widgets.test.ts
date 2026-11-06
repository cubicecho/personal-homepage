import type { Server } from 'node:http';
import { ErrorCode } from '../../server/core/errors.ts';
import { createApp } from '../../server/http/app.ts';
import { createYamlPageStore } from '../../server/pages/yaml-page-store.ts';
import { createWidgetService } from '../../server/widgets/widget-service.ts';
import { makeDataDir, portOf } from '../helpers.ts';
import { json, startSource, type TestSource } from '../widgets/server.ts';

const SECRET = 'graphql-secret-987';

const WIDGET_DATA = /* GraphQL */ `
  query ($pageSlug: ID!, $itemId: ID!) {
    widgetData(pageSlug: $pageSlug, itemId: $itemId) {
      stale
      error
      result {
        __typename
        ... on ApiWidgetResult {
          rows {
            label
            value
            warn
          }
        }
      }
    }
  }
`;

describe('widgets over GraphQL', () => {
  let server: Server;
  let base: string;
  let source: TestSource;
  let remove: () => Promise<void>;

  beforeAll(async () => {
    source = await startSource();
    source.routes.set('/status', (req, res) =>
      json({ jobs: req.headers.authorization === `Bearer ${SECRET}` ? 4 : -1, echo: req.headers.authorization })(
        req,
        res,
        '',
      ),
    );
    const data = await makeDataDir();
    remove = data.remove;
    const pages = await createYamlPageStore({ dataDir: data.dir });
    const widgets = createWidgetService({}, { dataDir: data.dir, env: { HOMEPAGE_TOKEN: SECRET } });
    server = createApp({ pages, widgets, dataDir: data.dir }).listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${portOf(server)}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await source.close();
    await remove();
  });

  const post = async (query: string, variables: Record<string, unknown> = {}) => {
    const response = await fetch(`${base}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    return response.json();
  };

  const widgetInput = () => ({
    type: 'API',
    api: {
      url: `${source.base}/status`,
      headers: [{ name: 'Authorization', value: 'Bearer ${env:HOMEPAGE_TOKEN}' }],
      fields: [
        { label: 'Jobs', path: '$.jobs', format: 'NUMBER', warnAbove: 3 },
        { label: 'Echo', path: '$.echo' },
      ],
    },
  });

  it('saves a widget with its reference as written, and serves its data without the secret', async () => {
    const added = await post(
      'mutation ($input: ItemInput!) { addItem(pageSlug: "home", input: $input) { items { id kind url widget { type api { headers { value } } } } } }',
      { input: { kind: 'WIDGET', title: 'Jobs', widget: widgetInput() } },
    );
    expect(added.data.addItem.items).toEqual([
      {
        id: 'jobs',
        kind: 'WIDGET',
        url: null,
        widget: { type: 'API', api: { headers: [{ value: 'Bearer ${env:HOMEPAGE_TOKEN}' }] } },
      },
    ]);

    const response = await post(WIDGET_DATA, { pageSlug: 'home', itemId: 'jobs' });
    expect(response.data.widgetData).toEqual({
      stale: false,
      error: null,
      result: {
        __typename: 'ApiWidgetResult',
        rows: [
          { label: 'Jobs', value: '4', warn: true },
          { label: 'Echo', value: 'Bearer [secret]', warn: false },
        ],
      },
    });
    expect(JSON.stringify(response)).not.toContain(SECRET);
  });

  it('tests an unsaved widget, giving the raw answer', async () => {
    const { data } = await post(
      'query ($input: WidgetInput!) { widgetPreview(input: $input) { error raw result { __typename } } }',
      { input: widgetInput() },
    );
    expect(data.widgetPreview.error).toBeNull();
    expect(data.widgetPreview.result.__typename).toBe('ApiWidgetResult');
    expect(data.widgetPreview.raw).toContain('"jobs": 4');
    expect(data.widgetPreview.raw).not.toContain(SECRET);
  });

  it('refuses a bad widget, an unknown item, and an item that is not a widget', async () => {
    const bad = await post('query ($input: WidgetInput!) { widgetPreview(input: $input) { error } }', {
      input: { type: 'API', api: { url: 'javascript:alert(1)', fields: [{ label: 'A', path: '$.a' }] } },
    });
    expect(bad.errors[0].extensions.code).toBe(ErrorCode.BadUserInput);

    const unknown = await post(WIDGET_DATA, { pageSlug: 'home', itemId: 'nope' });
    expect(unknown.errors[0].extensions.code).toBe(ErrorCode.NotFound);

    await post('mutation ($input: ItemInput!) { addItem(pageSlug: "home", input: $input) { slug } }', {
      input: { kind: 'LINK', title: 'Router', url: 'http://192.168.1.1' },
    });
    const notWidget = await post(WIDGET_DATA, { pageSlug: 'home', itemId: 'router' });
    expect(notWidget.errors[0].extensions.code).toBe(ErrorCode.BadUserInput);
  });
});
