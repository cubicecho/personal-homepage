import { isLoopbackHost, originOf, siteUrls } from '../../server/core/config.ts';

// Where sign-ins come back to: APP_URL, else the address pairing recorded, else this server's localhost.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('siteUrls', () => {
  it('uses APP_URL over the recorded address', () => {
    vi.stubEnv('APP_URL', 'https://home.example.com/');
    expect(siteUrls('http://homepage.lan:3000')).toEqual({
      appUrl: 'https://home.example.com',
      serverUrl: 'https://home.example.com',
      redirectUri: 'https://home.example.com/api/auth/callback/oidc',
      source: 'ENV',
    });
  });

  it('uses the recorded address when APP_URL is unset', () => {
    vi.stubEnv('APP_URL', '');
    expect(siteUrls('http://homepage.lan:3000')).toMatchObject({
      appUrl: 'http://homepage.lan:3000',
      redirectUri: 'http://homepage.lan:3000/api/auth/callback/oidc',
      source: 'PAIRED',
    });
  });

  it('falls back to localhost on this server’s port', () => {
    vi.stubEnv('APP_URL', '');
    vi.stubEnv('PORT', '4321');
    expect(siteUrls(null)).toMatchObject({ appUrl: 'http://localhost:4321', source: 'FALLBACK' });
  });

  it('puts the callback under SERVER_URL when it is set', () => {
    vi.stubEnv('SERVER_URL', 'https://api.example.com/');
    expect(siteUrls('http://homepage.lan:3000')).toMatchObject({
      appUrl: 'http://homepage.lan:3000',
      serverUrl: 'https://api.example.com',
      redirectUri: 'https://api.example.com/api/auth/callback/oidc',
    });
  });
});

describe('originOf', () => {
  it.each([
    ['http://homepage.lan:3000', 'http://homepage.lan:3000'],
    ['http://homepage.lan:3000/', 'http://homepage.lan:3000'],
    [' https://Home.Example.com ', 'https://home.example.com'],
  ])('reads %j as %j', (value, origin) => {
    expect(originOf(value)).toBe(origin);
  });

  it.each([
    '',
    'homepage.lan',
    'ftp://homepage.lan',
    'http://homepage.lan/home',
    'http://a:b@homepage.lan',
    'http://homepage.lan/?x',
  ])('refuses %j', (value) => {
    expect(originOf(value)).toBeNull();
  });
});

describe('isLoopbackHost', () => {
  it.each(['localhost', 'app.localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]', '::ffff:127.0.0.1'])(
    'counts %j as this machine',
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each(['homepage.lan', '192.168.1.20', '10.0.0.1', 'localhost.example.com', 'unknown'])(
    'counts %j as elsewhere',
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    },
  );
});
