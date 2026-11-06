import { createDescriber, isPrivateAddress, pickManifestIcon, readHead } from '../../server/discovery/describe.ts';
import { startSite, type TestSite } from '../icons/site.ts';

const HTML = 'text/html; charset=utf-8';
const PRIVATE = { requirePrivate: true };
const ANY = { requirePrivate: false };

describe('isPrivateAddress', () => {
  it.each([
    '10.0.0.5',
    '127.0.0.1',
    '172.16.4.1',
    '172.31.255.1',
    '192.168.1.10',
    '169.254.3.3',
    '100.64.0.1',
    '::1',
    'fd00::1',
    'fe80::2',
    '::ffff:192.168.1.2',
  ])('calls %s private', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '172.32.0.1', '93.184.216.34', '2606:4700::1111', 'not-an-ip'])('calls %s public', (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

describe('readHead', () => {
  it('reads the manifest link, title, description and names, decoding entities', () => {
    const head = readHead(`
      <html><head>
        <title>  Jelly &amp; fin\n</title>
        <meta name="description" content="Films &amp; shows">
        <meta property="og:site_name" content='Jellyfin site'>
        <link rel="stylesheet" href="/s.css"><link href="/m.json" rel="manifest">
      </head></html>`);
    expect(head).toEqual({
      manifestHref: '/m.json',
      title: 'Jelly & fin',
      description: 'Films & shows',
      applicationName: null,
      siteName: 'Jellyfin site',
    });
  });
});

describe('pickManifestIcon', () => {
  const settings = { minIconSizePx: 48, preferredIconSizePx: 192 };

  it('skips maskable-only icons and picks the size closest to the preferred one', () => {
    const icons = [
      { src: 'mask.png', sizes: '192x192', purpose: 'maskable' },
      { src: 'small.png', sizes: '32x32' },
      { src: 'big.png', sizes: '512x512', purpose: 'any maskable' },
      { src: 'right.png', sizes: '180x180' },
    ];
    expect(pickManifestIcon(icons, settings)?.src).toBe('right.png');
  });

  it('falls back to the largest when none is big enough, and gives null for none', () => {
    expect(
      pickManifestIcon(
        [
          { src: 'a.png', sizes: '16x16' },
          { src: 'b.png', sizes: '32x32' },
        ],
        settings,
      )?.src,
    ).toBe('b.png');
    expect(pickManifestIcon([{ src: 'm.png', sizes: '512x512', purpose: 'maskable' }], settings)).toBeNull();
  });
});

describe('createDescriber', () => {
  let site: TestSite;

  beforeEach(async () => {
    site = await startSite();
  });

  afterEach(async () => {
    await site.close();
  });

  it('reads the name, description and icon from the web manifest, resolving the icon against it', async () => {
    site.routes.set('/', { type: HTML, body: '<title>Login</title><link rel="manifest" href="/app/manifest.json">' });
    site.routes.set('/app/manifest.json', {
      type: 'application/manifest+json',
      body: JSON.stringify({
        name: 'Jellyfin',
        description: 'The free media system',
        icons: [
          { src: 'icon-maskable.png', sizes: '512x512', purpose: 'maskable' },
          { src: 'icon-192.png', sizes: '192x192' },
        ],
      }),
    });
    const described = await createDescriber().describe(`${site.base}/`, PRIVATE);
    expect(described).toEqual({
      url: `${site.base}/`,
      title: 'Jellyfin',
      description: 'The free media system',
      icon: `${site.base}/app/icon-192.png`,
      problem: null,
    });
  });

  it('falls back to the page: title, description, then its best icon link, then favicon', async () => {
    site.routes.set('/', {
      type: HTML,
      body: '<title>Grafana</title><meta name="description" content="Dashboards"><link rel="apple-touch-icon" href="/touch.png">',
    });
    const withLink = await createDescriber().describe(`${site.base}/`, PRIVATE);
    expect(withLink).toMatchObject({ title: 'Grafana', description: 'Dashboards', icon: `${site.base}/touch.png` });

    site.routes.set('/plain', { type: HTML, body: '<title>Portainer</title>' });
    const plain = await createDescriber().describe(`${site.base}/plain`, PRIVATE);
    expect(plain).toMatchObject({ title: 'Portainer', description: null, icon: 'favicon', problem: null });
  });

  it('follows a redirect on the same host and refuses one to another host', async () => {
    site.routes.set('/', { status: 302, headers: { location: '/web/' }, body: '' });
    site.routes.set('/web/', { type: HTML, body: '<title>Moved</title>' });
    expect((await createDescriber().describe(`${site.base}/`, PRIVATE)).title).toBe('Moved');

    const elsewhere = `http://localhost:${new URL(site.base).port}/web/`;
    site.routes.set('/away', { status: 302, headers: { location: elsewhere }, body: '' });
    const refused = await createDescriber().describe(`${site.base}/away`, PRIVATE);
    expect(refused.title).toBeNull();
    expect(refused.problem).toMatch(/another host/);
  });

  it('refuses a found address that resolves to a public address, without fetching it', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const describer = createDescriber({ fetch, lookup: async () => ['93.184.216.34'] });
    const described = await describer.describe('http://evil.example/', PRIVATE);
    expect(described.problem).toMatch(/not an address on your network/);
    expect(fetch).not.toHaveBeenCalled();
    // Fill in fetches what the person typed, wherever it is.
    fetch.mockResolvedValue(new Response('<title>Public</title>', { headers: { 'content-type': HTML } }));
    expect((await describer.describe('http://evil.example/', ANY)).title).toBe('Public');
  });

  it('gives up on a page larger than the limit, and says why a page could not be read', async () => {
    site.routes.set('/', { type: HTML, body: `<title>Big</title>${'x'.repeat(2048)}` });
    const tooBig = await createDescriber({}, { maxPageBytes: 1024 }).describe(`${site.base}/`, PRIVATE);
    expect(tooBig.title).toBeNull();
    expect(tooBig.icon).toBe('favicon');

    site.routes.set('/json', { type: 'application/json', body: '{}' });
    expect((await createDescriber().describe(`${site.base}/json`, PRIVATE)).problem).toMatch(/not a web page/);
    expect((await createDescriber().describe(`${site.base}/missing`, PRIVATE)).problem).toMatch(/404/);
  });

  it('remembers a description for a while', async () => {
    site.routes.set('/', { type: HTML, body: '<title>Cached</title>' });
    const describer = createDescriber();
    await describer.describe(`${site.base}/`, PRIVATE);
    await describer.describe(`${site.base}/`, PRIVATE);
    expect(site.hits.get('/')).toBe(1);
  });
});
