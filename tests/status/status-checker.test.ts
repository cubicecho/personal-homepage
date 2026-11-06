import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { HOME_SLUG, type Item, type Page } from '../../server/pages/page.ts';
import { createStatusChecker, StatusState } from '../../server/status/status-checker.ts';
import { linkFields, portOf } from '../helpers.ts';

/** How long the slow route waits before answering, past the short timeout the tests set. */
const SLOW_MS = 1500;
const SHORT_TIMEOUT_SECONDS = 0.2;
const CACHE_SECONDS = 30;
const MS_PER_SECOND = 1000;

/**
 * Builds a page with one item per URL, ids `a`, `b`, ….
 *
 * @param urls - Each item's URL; null leaves the item's check off.
 * @param [checkUrls] - A check URL per item, by index.
 * @returns The page.
 */
function pageOf(urls: Array<string | null>, checkUrls: Record<number, string> = {}): Page {
  const items: Item[] = urls.map((url, index) => ({
    id: String.fromCharCode('a'.charCodeAt(0) + index),
    ...linkFields(`Item ${index}`, {
      url: url ?? 'http://127.0.0.1/',
      check: { enabled: url !== null, url: checkUrls[index] ?? null },
    }),
  }));
  return {
    slug: HOME_SLUG,
    title: 'Home',
    icon: null,
    visibleTo: [],
    sections: [{ id: 'main', title: null, collapsed: false, visibleTo: [], items }],
  };
}

/**
 * Finds a port nothing listens on, by taking one and letting it go.
 *
 * @returns The port.
 */
async function freedPort(): Promise<number> {
  const probe = createServer().listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => probe.once('listening', resolve));
  const port = portOf(probe);
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

describe('status checker', () => {
  let server: Server;
  let base: string;
  const requests: Array<{ method: string; path: string }> = [];

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const path = req.url ?? '/';
      requests.push({ method: req.method ?? '', path });
      const answer = (status: number, headers: Record<string, string> = {}) => {
        res.writeHead(status, headers);
        res.end(req.method === 'HEAD' ? undefined : 'body');
      };
      if (path === '/ok') {
        answer(200);
      } else if (path === '/redirect') {
        answer(302, { location: '/ok' });
      } else if (path === '/sign-in') {
        answer(401);
      } else if (path === '/broken') {
        answer(500);
      } else if (path === '/no-head') {
        answer(req.method === 'HEAD' ? 405 : 200);
      } else if (path === '/slow') {
        setTimeout(() => answer(200), SLOW_MS);
      } else {
        answer(404);
      }
    });
    server.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${portOf(server)}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    requests.length = 0;
  });

  it('calls a success, a redirect and a sign-in up, and an error down', async () => {
    const checker = createStatusChecker();
    const statuses = await checker.forPage(
      pageOf([`${base}/ok`, `${base}/redirect`, `${base}/sign-in`, `${base}/broken`]),
    );
    expect(statuses.map(({ itemId, state, httpStatus }) => ({ itemId, state, httpStatus }))).toEqual([
      { itemId: 'a', state: StatusState.Up, httpStatus: 200 },
      { itemId: 'b', state: StatusState.Up, httpStatus: 302 },
      { itemId: 'c', state: StatusState.Up, httpStatus: 401 },
      { itemId: 'd', state: StatusState.Down, httpStatus: 500 },
    ]);
    expect(statuses[2]?.message).toMatch(/sign-in/);
    expect(statuses[3]?.message).toBe('It answered HTTP 500.');
    expect(statuses[0]?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(statuses[0]?.checkedAt ?? '')).not.toBeNaN();
    expect(requests.filter((request) => request.path === '/redirect')).toEqual([{ method: 'HEAD', path: '/redirect' }]);
  });

  it('falls back to GET when HEAD is refused', async () => {
    const [status] = await createStatusChecker().forPage(pageOf([`${base}/no-head`]));
    expect(status).toMatchObject({ state: StatusState.Up, httpStatus: 200 });
    expect(requests.map((request) => request.method)).toEqual(['HEAD', 'GET']);
  });

  it('checks the check URL instead of the item URL, and skips items with checking off', async () => {
    const statuses = await createStatusChecker().forPage(pageOf([`${base}/broken`, null], { 0: `${base}/ok` }));
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({ itemId: 'a', state: StatusState.Up });
    expect(requests.map((request) => request.path)).toEqual(['/ok']);
  });

  it('says nothing is listening on a closed port', async () => {
    const port = await freedPort();
    const [status] = await createStatusChecker().forPage(pageOf([`http://127.0.0.1:${port}/`]));
    expect(status).toMatchObject({ state: StatusState.Down, httpStatus: null, latencyMs: null });
    expect(status?.message).toBe(`Nothing is listening at 127.0.0.1:${port}.`);
  });

  it('passes on why fetch refused a URL it would not try', async () => {
    const [status] = await createStatusChecker().forPage(pageOf(['http://127.0.0.1:9/']));
    expect(status).toMatchObject({ state: StatusState.Down, message: "It couldn't be reached: bad port." });
  });

  it('calls a slow answer down after the timeout', async () => {
    const checker = createStatusChecker({ timeoutSeconds: SHORT_TIMEOUT_SECONDS });
    const [status] = await checker.forPage(pageOf([`${base}/slow`]));
    expect(status).toMatchObject({
      state: StatusState.Down,
      message: `No answer within ${SHORT_TIMEOUT_SECONDS} seconds.`,
    });
  });

  it('caches an answer until it goes stale, and shares one check between items with the same URL', async () => {
    let time = 1_000_000;
    const checker = createStatusChecker({ cacheSeconds: CACHE_SECONDS }, { now: () => time });
    const page = pageOf([`${base}/ok`, `${base}/ok`]);
    await Promise.all([checker.forPage(page), checker.forPage(page)]);
    expect(requests).toHaveLength(1);

    time += (CACHE_SECONDS - 1) * MS_PER_SECOND;
    await checker.forPage(page);
    expect(requests).toHaveLength(1);

    time += 2 * MS_PER_SECOND;
    await checker.forPage(page);
    expect(requests).toHaveLength(2);
  });

  it('runs at most the allowed number of checks at once', async () => {
    let active = 0;
    let most = 0;
    const slowFetch: typeof fetch = async () => {
      active += 1;
      most = Math.max(most, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return new Response(null, { status: 200 });
    };
    const urls = Array.from({ length: 10 }, (_unused, index) => `http://svc-${index}.lan/`);
    const statuses = await createStatusChecker({ maxConcurrentChecks: 3 }, { fetch: slowFetch }).forPage(pageOf(urls));
    expect(statuses.every((status) => status.state === StatusState.Up)).toBe(true);
    expect(most).toBe(3);
  });

  it('calls a server with an untrusted certificate up, with a note', async () => {
    const untrusted: typeof fetch = async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('self-signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }),
      });
    };
    const [status] = await createStatusChecker({}, { fetch: untrusted }).forPage(pageOf(['https://nas.lan/']));
    expect(status).toMatchObject({ state: StatusState.Up, httpStatus: null });
    expect(status?.message).toMatch(/certificate isn't trusted/);
  });

  it('says a name that does not resolve', async () => {
    const unresolved: typeof fetch = async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('getaddrinfo ENOTFOUND nope.lan'), { code: 'ENOTFOUND' }),
      });
    };
    const [status] = await createStatusChecker({}, { fetch: unresolved }).forPage(pageOf(['http://nope.lan:8080/']));
    expect(status).toMatchObject({ state: StatusState.Down, message: "The name nope.lan doesn't resolve." });
  });
});
