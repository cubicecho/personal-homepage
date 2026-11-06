import { createServer, type Server } from 'node:http';
import { ErrorCode } from '../../server/core/errors.ts';
import { createFrameChecker, type FrameChecker } from '../../server/frames/frame-check.ts';
import { createApp } from '../../server/http/app.ts';
import { databaseDeps, openTestDatabase } from '../db.ts';
import { makeDataDir, portOf } from '../helpers.ts';

/** How long the cache keeps an answer in these tests, in seconds. */
const CACHE_SECONDS = 60;
/** Shorter than the hanging route waits, so the timeout is what ends it. */
const TIMEOUT_SECONDS = 0.3;
const MS_PER_SECOND = 1000;

/** The headers each test route answers with. */
const ROUTES: Record<string, Record<string, string>> = {
  '/open': {},
  '/deny': { 'x-frame-options': 'DENY' },
  '/sameorigin': { 'x-frame-options': 'sameorigin' },
  '/allow-from': { 'x-frame-options': 'ALLOW-FROM https://example.com' },
  '/csp-none': { 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" },
  '/csp-self': { 'content-security-policy': "frame-ancestors 'self'" },
  '/csp-hosts': { 'content-security-policy': "frame-ancestors 'self' https://nas.local" },
  '/csp-star': { 'content-security-policy': 'frame-ancestors *', 'x-frame-options': 'DENY' },
  '/csp-other': { 'content-security-policy': "default-src 'self'", 'x-frame-options': 'DENY' },
  '/report-only': { 'content-security-policy-report-only': "frame-ancestors 'none'" },
};

describe('frame check', () => {
  let server: Server;
  let base: string;
  const hits = new Map<string, number>();

  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = req.url ?? '/';
      hits.set(path, (hits.get(path) ?? 0) + 1);
      if (path === '/redirect') {
        res.writeHead(302, { location: '/deny' }).end();
        return;
      }
      if (path === '/hang') {
        return;
      }
      if (path === '/endless') {
        // Headers, then a body that never ends: the check must not wait for it.
        res.writeHead(200, { 'x-frame-options': 'DENY' });
        res.write('<html>');
        return;
      }
      if (path === '/missing') {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, ROUTES[path] ?? {}).end('<html></html>');
    });
    server.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${portOf(server)}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const checker = (): FrameChecker =>
    createFrameChecker({ timeoutSeconds: TIMEOUT_SECONDS, cacheSeconds: CACHE_SECONDS });

  it.each([
    ['/open', true, /Nothing on the site forbids/],
    ['/deny', false, /X-Frame-Options: DENY/],
    ['/sameorigin', false, /X-Frame-Options: SAMEORIGIN/],
    ['/allow-from', true, /Nothing on the site forbids/],
    ['/csp-none', false, /frame-ancestors 'none'/],
    ['/csp-self', false, /frame-ancestors 'self'/],
    ['/csp-hosts', false, /only lets https:\/\/nas\.local show it/],
    ['/csp-star', true, /Nothing on the site forbids/],
    ['/csp-other', false, /X-Frame-Options: DENY/],
    ['/report-only', true, /Nothing on the site forbids/],
    ['/redirect', false, /X-Frame-Options: DENY/],
    ['/endless', false, /X-Frame-Options: DENY/],
    ['/missing', true, /answered HTTP 404/],
  ])('reads %s as framable %s', async (path, framable, reason) => {
    const result = await checker().check(`${base}${path}`);
    expect(result).toMatchObject({ url: `${base}${path}`, framable });
    expect(result.reason).toMatch(reason);
  });

  it('says it could not reach a site that does not answer', async () => {
    const result = await checker().check(`${base}/hang`);
    expect(result.framable).toBeNull();
    expect(result.reason).toMatch(/^Couldn't reach 127\.0\.0\.1:\d+ to check/);
  });

  it('says it could not reach a port nobody listens on', async () => {
    const closed = createServer();
    closed.listen(0);
    await new Promise<void>((resolve) => closed.once('listening', resolve));
    const port = portOf(closed);
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    expect((await checker().check(`http://127.0.0.1:${port}/`)).framable).toBeNull();
  });

  it('reuses an answer until it expires, and shares a check already running', async () => {
    let at = 0;
    const cached = createFrameChecker({ cacheSeconds: CACHE_SECONDS }, { now: () => at });
    const url = `${base}/deny?cache`;
    await Promise.all([cached.check(url), cached.check(url)]);
    await cached.check(url);
    expect(hits.get('/deny?cache')).toBe(1);
    at = CACHE_SECONDS * MS_PER_SECOND + 1;
    await cached.check(url);
    expect(hits.get('/deny?cache')).toBe(2);
  });

  it('is served as Query.frameCheck, refusing anything but http(s)', async () => {
    const data = await makeDataDir();
    const database = await openTestDatabase();
    const deps = await databaseDeps(database.db);
    const app = createApp({ ...deps, dataDir: data.dir, frames: checker() }).listen(0);
    await new Promise<void>((resolve) => app.once('listening', resolve));
    const post = async (url: string) => {
      const response = await fetch(`http://127.0.0.1:${portOf(app)}/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: 'query ($url: String!) { frameCheck(url: $url) { framable reason } }',
          variables: { url },
        }),
      });
      return response.json();
    };
    try {
      expect((await post(`${base}/deny`)).data.frameCheck.framable).toBe(false);
      const refused = await post('javascript:alert(1)');
      expect(refused.errors[0].extensions.code).toBe(ErrorCode.BadUserInput);
    } finally {
      app.closeAllConnections();
      await new Promise<void>((resolve) => app.close(() => resolve()));
      await database.close();
      await data.remove();
    }
  });
});
