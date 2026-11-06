import type { Server } from 'node:http';
import express from 'express';
import { ErrorCode } from '../../server/core/errors.ts';
import type { OpenedDatabase } from '../../server/db/client.ts';
import { users } from '../../server/db/schema.ts';
import { PairingFailure, parseSetupUrl } from '../../server/sso/pairing.ts';
import { readPairedOidc } from '../../server/sso/settings.ts';
import { startApp, type TestApp } from '../auth/app.ts';
import { openTestDatabase, resetTestDatabase } from '../db.ts';
import { portOf } from '../helpers.ts';

// Pairing with a provider by pasting a setup URL, against a stand-in for heautou's Dynamic Client
// Registration: discovery naming a registration endpoint, registration on an initial access token
// (RFC 7591), and deleting the client on its registration access token (RFC 7592).

const SETUP = '{ ssoSetup { source issuer name canPair redirectUri } }';
const PAIR = 'mutation ($url: String!) { pairSso(setupUrl: $url) { source name canPair } }';
const UNPAIR = 'mutation { unpairSso { source } }';
const CONFIG = '{ authConfig { mode sso { name } } }';
const TOKEN = 'iat-good';
const RAT = 'rat-1';
const ROTATED_RAT = 'rat-2';
/** Where people open the homepage in these tests: a LAN address, not this machine. */
const LAN_APP = 'http://homepage.lan:3000';
const LAN_CALLBACK = `${LAN_APP}/api/auth/callback/oidc`;
const PAIR_AT = `mutation ($url: String!, $appUrl: String) {
  pairSso(setupUrl: $url, appUrl: $appUrl) { source redirectUri appUrl appUrlSource callbackIsLocal }
}`;
const REPOINT = `mutation ($appUrl: String) {
  updateSsoAppUrl(appUrl: $appUrl) { providerUpdated message setup { redirectUri appUrlSource callbackIsLocal } }
}`;

interface FakeDcr {
  issuer: string;
  /** What discovery says the issuer is. Set to something else to forge it. */
  claimedIssuer: string;
  /** Whether discovery names a registration endpoint. */
  canRegister: boolean;
  /** Bodies and auth headers registration was called with. */
  registrations: { body: Record<string, unknown>; authorization: string | undefined }[];
  /** Auth headers the client was deleted with. */
  deletions: (string | undefined)[];
  /** Bodies and auth headers the client was updated with (RFC 7592). */
  updates: { body: Record<string, unknown>; authorization: string | undefined }[];
  /** What an update answers. 200 rotates the registration access token, as heautou does. */
  updateStatus: number;
  close(): Promise<void>;
}

/**
 * Starts the stand-in provider, ready to register one client.
 *
 * @returns The provider and what it was asked.
 */
async function startDcr(): Promise<FakeDcr> {
  const app = express();
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const issuer = `http://127.0.0.1:${portOf(server)}/oidc`;
  const fake: FakeDcr = {
    issuer,
    claimedIssuer: issuer,
    canRegister: true,
    registrations: [],
    deletions: [],
    updates: [],
    updateStatus: 200,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  app.get('/oidc/.well-known/openid-configuration', (_req, res) => {
    res.json({
      issuer: fake.claimedIssuer,
      authorization_endpoint: `${issuer}/auth`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      ...(fake.canRegister ? { registration_endpoint: `${issuer}/reg` } : {}),
    });
  });
  app.post('/oidc/reg', express.json(), (req, res) => {
    fake.registrations.push({ body: req.body, authorization: req.headers.authorization });
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    res.status(201).json({
      client_id: 'homepage-client',
      client_secret: 'homepage-secret',
      token_endpoint_auth_method: 'client_secret_basic',
      registration_access_token: RAT,
      registration_client_uri: `${issuer}/reg/homepage-client`,
    });
  });
  app.delete('/oidc/reg/homepage-client', (req, res) => {
    fake.deletions.push(req.headers.authorization);
    res.status(204).end();
  });
  app.put('/oidc/reg/homepage-client', express.json(), (req, res) => {
    fake.updates.push({ body: req.body, authorization: req.headers.authorization });
    if (fake.updateStatus !== 200) {
      res.status(fake.updateStatus).json({ error: 'invalid_redirect_uri', error_description: 'not allowed here' });
      return;
    }
    res.json({ ...req.body, registration_access_token: ROTATED_RAT });
  });
  return fake;
}

let database: OpenedDatabase;
let dcr: FakeDcr;
let app: TestApp;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await resetTestDatabase(database.db);
  dcr = await startDcr();
  app = await startApp(database.db);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await app.close();
  await dcr.close();
});

/**
 * Builds a setup URL for the stand-in provider.
 *
 * @param [token] - The initial access token.
 * @returns The URL.
 */
function setupUrl(token = TOKEN): string {
  return `${dcr.issuer}#setup=${token}&name=heautou`;
}

describe('setup URLs', () => {
  it('are taken apart into issuer, token and name', () => {
    expect(parseSetupUrl('https://id.example.com/oidc/#setup=abc&name=heautou')).toEqual({
      issuer: 'https://id.example.com/oidc',
      token: 'abc',
      name: 'heautou',
    });
    expect(parseSetupUrl('https://id.example.com/oidc#setup=abc').name).toBe('SSO');
  });

  it.each(['not a url', 'ftp://id.example.com#setup=x', 'https://id.example.com/oidc'])('refuse %j', (text) => {
    expect(() => parseSetupUrl(text)).toThrow(expect.objectContaining({ reason: PairingFailure.BadUrl }));
  });
});

describe('pairing', () => {
  it('registers the homepage on an open instance, and puts the button up without a restart', async () => {
    expect((await app.gql(SETUP)).data.ssoSetup).toMatchObject({ source: 'NONE', canPair: true });
    const paired = await app.gql(PAIR, { url: setupUrl() });
    expect(paired.errors).toBeUndefined();
    expect(dcr.registrations[0]?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(dcr.registrations[0]?.body.redirect_uris).toEqual([expect.stringMatching(/\/api\/auth\/callback\/oidc$/)]);
    expect((await app.gql(CONFIG)).data.authConfig).toEqual({ mode: 'SIGN_IN', sso: { name: 'heautou' } });
    expect(await readPairedOidc(database.db)).toMatchObject({
      clientId: 'homepage-client',
      registrationAccessToken: RAT,
    });
  });

  it('says a spent setup URL has expired, and saves nothing', async () => {
    const answer = await app.gql(PAIR, { url: setupUrl('used') });
    expect(answer.errors?.[0]?.extensions).toMatchObject({
      code: ErrorCode.BadUserInput,
      reason: PairingFailure.Expired,
    });
    expect(await readPairedOidc(database.db)).toBeNull();
  });

  it('refuses a discovery document naming another issuer before the token goes anywhere', async () => {
    dcr.claimedIssuer = 'https://evil.example.com/oidc';
    const answer = await app.gql(PAIR, { url: setupUrl() });
    expect(answer.errors?.[0]?.extensions?.reason).toBe(PairingFailure.NotAProvider);
    expect(dcr.registrations).toEqual([]);
  });

  it('says when the provider cannot pair', async () => {
    dcr.canRegister = false;
    const answer = await app.gql(PAIR, { url: setupUrl() });
    expect(answer.errors?.[0]?.extensions?.reason).toBe(PairingFailure.NoRegistration);
  });

  it('refuses to pair over an existing pairing', async () => {
    await app.gql(PAIR, { url: setupUrl() });
    expect((await app.gql(PAIR, { url: setupUrl() })).errors?.[0]?.extensions?.code).toBe(ErrorCode.Conflict);
  });

  it('lets anyone undo a pairing nobody has signed in through yet, then only editors', async () => {
    await app.gql(PAIR, { url: setupUrl() });
    expect((await app.gql(SETUP)).data.ssoSetup.canPair).toBe(true);

    const [admin, guest] = await database.db
      .insert(users)
      .values([
        { email: 'admin@example.com', isAdmin: true },
        { email: 'guest@example.com', isAdmin: false },
      ])
      .returning({ id: users.id });
    const authContext = await app.deps.authHost.current().$context;
    const guestSession = await authContext.internalAdapter.createSession(guest?.id ?? '');
    const adminSession = await authContext.internalAdapter.createSession(admin?.id ?? '');

    expect((await app.gql(SETUP)).data.ssoSetup).toMatchObject({ canPair: false, issuer: null });
    const asGuest = await app.gql(UNPAIR, {}, { authorization: `Bearer ${guestSession.token}` });
    expect(asGuest.errors?.[0]?.extensions?.code).toBe(ErrorCode.Forbidden);

    const asAdmin = await app.gql(UNPAIR, {}, { authorization: `Bearer ${adminSession.token}` });
    expect(asAdmin.data.unpairSso).toEqual({ source: 'NONE' });
    expect(dcr.deletions).toEqual([`Bearer ${RAT}`]);
    expect((await app.gql(CONFIG)).data.authConfig).toEqual({ mode: 'OPEN', sso: null });
  });

  it('registers the callback under the address the browser has the homepage open at, and keeps it', async () => {
    const paired = await app.gql(PAIR_AT, { url: setupUrl(), appUrl: `${LAN_APP}/` });
    expect(paired.data.pairSso).toEqual({
      source: 'PAIRED',
      redirectUri: LAN_CALLBACK,
      appUrl: LAN_APP,
      appUrlSource: 'PAIRED',
      callbackIsLocal: false,
    });
    expect(dcr.registrations[0]?.body.redirect_uris).toEqual([LAN_CALLBACK]);
    expect((await readPairedOidc(database.db))?.appUrl).toBe(LAN_APP);
    const config = await app.gql('{ authConfig { sso { signInUrl } } }');
    expect(config.data.authConfig.sso.signInUrl).toBe(`${LAN_APP}/sso/oidc`);
  });

  it('falls back to the Origin header when the app sends no address', async () => {
    await app.gql(PAIR, { url: setupUrl() }, { origin: LAN_APP });
    expect(dcr.registrations[0]?.body.redirect_uris).toEqual([LAN_CALLBACK]);
  });

  it('lets APP_URL win over the browser address', async () => {
    vi.stubEnv('APP_URL', 'https://home.example.com');
    const paired = await app.gql(PAIR_AT, { url: setupUrl(), appUrl: LAN_APP });
    expect(paired.data.pairSso).toMatchObject({
      redirectUri: 'https://home.example.com/api/auth/callback/oidc',
      appUrlSource: 'ENV',
    });
  });

  it('refuses an address that is not a bare origin', async () => {
    const answer = await app.gql(PAIR_AT, { url: setupUrl(), appUrl: `${LAN_APP}/home?x=1` });
    expect(answer.errors?.[0]?.extensions?.code).toBe(ErrorCode.BadUserInput);
    expect(dcr.registrations).toEqual([]);
  });

  it('refuses a localhost callback when the browser is on another machine, and says to set APP_URL', async () => {
    await app.close();
    vi.stubEnv('TRUST_PROXY', '1');
    app = await startApp(database.db);
    const fromLan = { 'x-forwarded-for': '192.168.1.20' };
    const answer = await app.gql(PAIR, { url: setupUrl() }, fromLan);
    expect(answer.errors?.[0]?.extensions).toMatchObject({
      code: ErrorCode.BadUserInput,
      reason: PairingFailure.BadAppUrl,
    });
    expect(answer.errors?.[0]?.message).toMatch(/APP_URL/);
    expect(dcr.registrations).toEqual([]);

    const fine = await app.gql(PAIR_AT, { url: setupUrl(), appUrl: LAN_APP }, fromLan);
    expect(fine.errors).toBeUndefined();
  });

  it('moves a localhost callback to the browser address and tells the provider (RFC 7592)', async () => {
    const paired = await app.gql(PAIR_AT, { url: setupUrl() });
    expect(paired.data.pairSso).toMatchObject({ appUrlSource: 'FALLBACK', callbackIsLocal: true });

    const moved = await app.gql(REPOINT, { appUrl: LAN_APP });
    expect(moved.data.updateSsoAppUrl).toEqual({
      providerUpdated: true,
      message: null,
      setup: { redirectUri: LAN_CALLBACK, appUrlSource: 'PAIRED', callbackIsLocal: false },
    });
    expect(dcr.updates[0]).toEqual({
      authorization: `Bearer ${RAT}`,
      body: expect.objectContaining({
        client_id: 'homepage-client',
        client_secret: 'homepage-secret',
        redirect_uris: [LAN_CALLBACK],
      }),
    });
    expect(await readPairedOidc(database.db)).toMatchObject({
      appUrl: LAN_APP,
      registrationAccessToken: ROTATED_RAT,
    });
  });

  it('records the new address anyway when the provider refuses, and says what to change there', async () => {
    await app.gql(PAIR_AT, { url: setupUrl() });
    dcr.updateStatus = 400;
    const moved = await app.gql(REPOINT, { appUrl: LAN_APP });
    expect(moved.data.updateSsoAppUrl).toMatchObject({ providerUpdated: false, setup: { redirectUri: LAN_CALLBACK } });
    expect(moved.data.updateSsoAppUrl.message).toContain(LAN_CALLBACK);
    expect(await readPairedOidc(database.db)).toMatchObject({ appUrl: LAN_APP, registrationAccessToken: RAT });
  });

  it('has nothing to move before pairing', async () => {
    const answer = await app.gql(REPOINT, { appUrl: LAN_APP });
    expect(answer.errors?.[0]?.extensions?.code).toBe(ErrorCode.BadUserInput);
  });

  it('leaves a provider set in the environment alone', async () => {
    vi.stubEnv('OIDC_ISSUER', dcr.issuer);
    vi.stubEnv('OIDC_CLIENT_ID', 'from-env');
    expect((await app.gql(SETUP)).data.ssoSetup).toMatchObject({ source: 'ENV', canPair: false });
    expect((await app.gql(PAIR, { url: setupUrl() })).errors?.[0]?.extensions?.code).toBe(ErrorCode.Forbidden);
  });
});
