import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { eq } from 'drizzle-orm';
import express from 'express';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { fixedAuthHost } from '../../server/auth/auth-host.ts';
import { createAuth } from '../../server/auth/better-auth.ts';
import type { OidcConfig } from '../../server/core/config.ts';
import { ErrorCode } from '../../server/core/errors.ts';
import { HttpStatus } from '../../server/core/wire.ts';
import type { OpenedDatabase } from '../../server/db/client.ts';
import { users } from '../../server/db/schema.ts';
import { createApp } from '../../server/http/app.ts';
import { SSO_CALLBACK_PATH, SSO_START_PATH } from '../../server/http/sso.ts';
import { databaseDeps, openTestDatabase, resetTestDatabase, TEST_SECRET } from '../db.ts';
import { portOf } from '../helpers.ts';

// The whole OIDC sign-in through the real app, against a stand-in provider that does what heautou
// (oidc-provider) does: discovery, a JWKS, a code flow with a client secret in a Basic header, PKCE, and a
// signed ID token carrying the nonce and the groups claim.

const VERIFY = 'mutation ($token: String!) { verifyOneTimeToken(token: $token) { token userId } }';
const ACCESS = '{ access { mode canEdit viewer { email groups isAdmin via } } }';
const CLIENT_ID = 'homepage';
const CLIENT_SECRET = 'homepage-secret';

interface Profile {
  sub: string;
  email?: string;
  name?: string;
  groups?: string[];
}

interface FakeProvider {
  issuer: string;
  /** Who the next sign-in is. */
  profile: Profile;
  /**
   * Plays the browser at the authorize endpoint.
   *
   * @param url - The authorize URL the app sent the browser to.
   * @returns The code and state it would be sent back with.
   */
  authorize(url: string): { code: string; state: string };
  close(): Promise<void>;
}

/**
 * Listens on a free loopback port.
 *
 * @param app - What to serve.
 * @returns The server, and the origin it answers on.
 */
async function listen(app: express.Express): Promise<{ server: Server; origin: string }> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  return { server, origin: `http://127.0.0.1:${portOf(server)}` };
}

/**
 * Stops a server.
 *
 * @param server - The server.
 * @returns Once it has stopped.
 */
function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

/**
 * Starts the stand-in provider.
 *
 * @returns The provider, signing the next sign-in in as Ada of the family group.
 */
async function startProvider(): Promise<FakeProvider> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, { nonce: string; challenge: string; redirectUri: string; profile: Profile }>();
  const app = express();
  const { server, origin } = await listen(app);
  const issuer = `${origin}/oidc`;
  const provider: FakeProvider = {
    issuer,
    profile: { sub: 'u1', email: 'ada@example.com', name: 'Ada', groups: ['family'] },
    authorize(url) {
      const params = new URL(url).searchParams;
      expect(params.get('client_id')).toBe(CLIENT_ID);
      expect(params.get('scope')?.split(' ')).toEqual(expect.arrayContaining(['openid', 'email', 'groups']));
      expect(params.get('code_challenge_method')).toBe('S256');
      const code = randomUUID();
      codes.set(code, {
        nonce: params.get('nonce') ?? '',
        challenge: params.get('code_challenge') ?? '',
        redirectUri: params.get('redirect_uri') ?? '',
        profile: provider.profile,
      });
      return { code, state: params.get('state') ?? '' };
    },
    close: () => close(server),
  };

  app.get('/oidc/.well-known/openid-configuration', (_req, res) => {
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/auth`,
      token_endpoint: `${issuer}/token`,
      userinfo_endpoint: `${issuer}/me`,
      jwks_uri: `${issuer}/jwks`,
      id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic'],
    });
  });
  app.get('/oidc/jwks', (_req, res) => {
    res.json({ keys: [jwk] });
  });
  app.post('/oidc/token', express.urlencoded({ extended: false }), async (req, res) => {
    const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    if (req.headers.authorization !== `Basic ${basic}`) {
      res.status(HttpStatus.Unauthorized).json({ error: 'invalid_client' });
      return;
    }
    const grant = codes.get(req.body.code);
    codes.delete(req.body.code);
    const challenge = createHash('sha256').update(String(req.body.code_verifier)).digest('base64url');
    if (!grant || grant.challenge !== challenge || grant.redirectUri !== req.body.redirect_uri) {
      res.status(HttpStatus.BadRequest).json({ error: 'invalid_grant' });
      return;
    }
    const { profile } = grant;
    const idToken = await new SignJWT({
      ...profile,
      email_verified: profile.email ? true : undefined,
      nonce: grant.nonce,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(issuer)
      .setAudience(CLIENT_ID)
      .setSubject(profile.sub)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    res.json({ access_token: `at-${profile.sub}`, token_type: 'Bearer', expires_in: 300, id_token: idToken });
  });
  app.get('/oidc/me', (req, res) => {
    const sub = String(req.headers.authorization).replace('Bearer at-', '');
    res.json(sub === provider.profile.sub ? { ...provider.profile, email_verified: true } : {});
  });
  return provider;
}

let database: OpenedDatabase;
let provider: FakeProvider;
let homepage: Server;
let appUrl: string;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await resetTestDatabase(database.db);
  provider = await startProvider();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // createApp builds its routes before it listens, and APP_URL has to name the port it ends up on, so the
  // app is mounted into an outer one.
  const outer = express();
  ({ server: homepage, origin: appUrl } = await listen(outer));
  vi.stubEnv('APP_URL', appUrl);
  vi.stubEnv('SERVER_URL', appUrl);
  const oidc: OidcConfig = {
    issuer: provider.issuer,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    clientAuth: 'client_secret_basic',
    name: 'heautou',
  };
  const auth = createAuth(database.db, { secret: TEST_SECRET, oidc });
  const deps = await databaseDeps(database.db);
  outer.use(createApp({ ...deps, authHost: fixedAuthHost(auth, oidc), dataDir: '/nonexistent' }));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await close(homepage);
  await provider.close();
});

/**
 * Reads the cookies a response set, as a request's Cookie header.
 *
 * @param response - The response.
 * @returns The header value.
 */
function cookiesFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

/**
 * Walks the browser through a sign-in: the start route, the provider, the callback.
 *
 * @param [tamper] - Changes the provider's redirect before the browser follows it.
 * @returns Where the callback sent the browser, and the callback's response.
 */
async function signIn(tamper?: (callback: URL) => void): Promise<{ location: URL; callback: Response }> {
  const start = await fetch(`${appUrl}${SSO_START_PATH}`, { redirect: 'manual' });
  expect(start.status).toBe(HttpStatus.Found);
  const authorizeUrl = start.headers.get('location') ?? '';
  expect(authorizeUrl.startsWith(`${provider.issuer}/auth?`)).toBe(true);
  expect(new URL(authorizeUrl).searchParams.get('redirect_uri')).toBe(`${appUrl}${SSO_CALLBACK_PATH}`);
  const { code, state } = provider.authorize(authorizeUrl);
  const back = new URL(`${appUrl}${SSO_CALLBACK_PATH}`);
  back.searchParams.set('code', code);
  back.searchParams.set('state', state);
  back.searchParams.set('iss', provider.issuer);
  tamper?.(back);
  const callback = await fetch(back, { redirect: 'manual', headers: { cookie: cookiesFrom(start) } });
  expect(callback.status).toBe(HttpStatus.Found);
  return { location: new URL(callback.headers.get('location') ?? ''), callback };
}

/**
 * Sends one GraphQL operation to the app.
 *
 * @param query - The document.
 * @param [variables] - Its variables.
 * @param [token] - A bearer session.
 * @returns The answer.
 */
async function gql(
  query: string,
  variables: Record<string, unknown> = {},
  token?: string,
): Promise<{
  data?: Record<string, unknown> & { [key: string]: never };
  errors?: { extensions?: { code?: string } }[];
}> {
  const response = await fetch(`${appUrl}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  return response.json();
}

describe('OIDC sign-in', () => {
  it('lands on /auth/sso with a one-time token the app swaps for a session, with the groups claim kept', async () => {
    const { location, callback } = await signIn();
    expect(location.origin + location.pathname).toBe(`${appUrl}/auth/sso`);
    // The session goes to the app as a bearer token, never as a cookie.
    expect(callback.headers.getSetCookie().some((cookie) => cookie.includes('session_token'))).toBe(false);

    const token = location.searchParams.get('token') ?? '';
    const verified = await gql(VERIFY, { token });
    expect(verified.errors).toBeUndefined();
    const session = verified.data?.verifyOneTimeToken as unknown as { token: string; userId: string };

    const access = await gql(ACCESS, {}, session.token);
    expect(access.data?.access).toEqual({
      mode: 'SIGN_IN',
      canEdit: true,
      viewer: { email: 'ada@example.com', groups: ['family'], isAdmin: true, via: 'OIDC' },
    });

    // Spent, and a spent token is bad input, not a signed-out session.
    expect((await gql(VERIFY, { token })).errors?.[0]?.extensions?.code).toBe(ErrorCode.BadUserInput);
  });

  it('updates the groups at the next sign-in, and does not make a second account the admin', async () => {
    await gql(VERIFY, { token: (await signIn()).location.searchParams.get('token') ?? '' });
    provider.profile = { sub: 'u2', email: 'bob@example.com', name: 'Bob', groups: ['guests'] };
    const second = await gql(VERIFY, { token: (await signIn()).location.searchParams.get('token') ?? '' });
    const bob = second.data?.verifyOneTimeToken as unknown as { token: string; userId: string };
    const [row] = await database.db.select().from(users).where(eq(users.id, bob.userId));
    expect(row).toMatchObject({ groups: ['guests'], isAdmin: false });
    expect(
      (await gql('mutation { createPage(input: { title: "X" }) { slug } }', {}, bob.token)).errors?.[0]?.extensions
        ?.code,
    ).toBe(ErrorCode.Forbidden);

    provider.profile = { sub: 'u2', email: 'bob@example.com', name: 'Bob', groups: ['family'] };
    await gql(VERIFY, { token: (await signIn()).location.searchParams.get('token') ?? '' });
    const [after] = await database.db.select().from(users).where(eq(users.id, bob.userId));
    expect(after?.groups).toEqual(['family']);
  });

  it('signs in a user with no address, as heautou users can be, under a placeholder one', async () => {
    provider.profile = { sub: 'Abc-123', name: 'Ada' };
    const { location } = await signIn();
    expect(location.pathname).toBe('/auth/sso');
    const verified = await gql(VERIFY, { token: location.searchParams.get('token') ?? '' });
    const session = verified.data?.verifyOneTimeToken as unknown as { userId: string };
    const [row] = await database.db.select().from(users).where(eq(users.id, session.userId));
    expect(row).toMatchObject({ email: 'abc-123@oidc.invalid', name: 'Ada', emailVerified: false });
  });

  it('refuses a callback whose state does not match', async () => {
    const { location } = await signIn((back) => back.searchParams.set('state', 'forged'));
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('error')).toBeTruthy();
    expect(location.searchParams.get('token')).toBeNull();
  });

  it('ends the session on sign-out', async () => {
    const verified = await gql(VERIFY, { token: (await signIn()).location.searchParams.get('token') ?? '' });
    const session = verified.data?.verifyOneTimeToken as unknown as { token: string };
    expect((await gql('mutation { signOut { success } }', {}, session.token)).data?.signOut).toEqual({ success: true });
    expect((await gql(ACCESS, {}, session.token)).data?.access).toMatchObject({ viewer: null });
  });

  it('names the provider and where to start on the sign-in page', async () => {
    const config = await gql('{ authConfig { mode sso { name signInUrl } forwardAuth publicView } }');
    expect(config.data?.authConfig).toEqual({
      mode: 'SIGN_IN',
      sso: { name: 'heautou', signInUrl: `${appUrl}${SSO_START_PATH}` },
      forwardAuth: false,
      publicView: false,
    });
  });
});
