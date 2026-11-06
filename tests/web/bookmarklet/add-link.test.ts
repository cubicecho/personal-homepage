import {
  bookmarkletCode,
  bookmarkletOrigin,
  capTitle,
  iconFromParam,
  isLocalOrigin,
  isWebAddress,
  parseAddLinkSearch,
} from '../../../web/src/bookmarklet/add-link.ts';

describe('parseAddLinkSearch', () => {
  it('keeps the known parameters, trimmed, and drops everything else', () => {
    expect(
      parseAddLinkSearch({ url: ' http://nas.lan:8096/web ', title: ' Jellyfin ', other: 'x', description: '' }),
    ).toEqual({ url: 'http://nas.lan:8096/web', title: 'Jellyfin', description: undefined, icon: undefined });
  });

  it('ignores parameters that are not strings', () => {
    expect(parseAddLinkSearch({ url: 42, title: ['a'], icon: null })).toEqual({
      url: undefined,
      title: undefined,
      description: undefined,
      icon: undefined,
    });
  });

  it('cuts a huge parameter', () => {
    expect(parseAddLinkSearch({ title: 'x'.repeat(5000) }).title).toHaveLength(500);
  });
});

describe('isWebAddress', () => {
  it.each([
    ['http://nas.lan:8096', true],
    ['https://example.com/a?b=c', true],
    ['javascript:alert(1)', false],
    ['data:text/html,hi', false],
    ['/relative', false],
    [undefined, false],
  ])('%s is %s', (url, expected) => {
    expect(isWebAddress(url)).toBe(expected);
  });
});

describe('iconFromParam', () => {
  it('keeps a catalogue reference or an image address, and nothing else', () => {
    expect(iconFromParam('DI:Jellyfin')).toBe('di:jellyfin');
    expect(iconFromParam('https://cdn.example.com/icon.png')).toBe('https://cdn.example.com/icon.png');
    expect(iconFromParam('javascript:alert(1)')).toBeNull();
    expect(iconFromParam('film')).toBeNull();
    expect(iconFromParam(undefined)).toBeNull();
  });
});

describe('capTitle', () => {
  it('cuts a title over the limit with an ellipsis, and leaves a short one alone', () => {
    expect(capTitle('Jellyfin', 80)).toBe('Jellyfin');
    expect(capTitle('a'.repeat(100), 80)).toHaveLength(80);
    expect(capTitle('a'.repeat(100), 80).endsWith('…')).toBe(true);
    expect(capTitle('a'.repeat(100))).toHaveLength(100);
  });
});

describe('bookmarkletOrigin', () => {
  const browser = 'http://framework.lan:29005';

  it('uses APP_URL or the address recorded at pairing', () => {
    expect(bookmarkletOrigin({ appUrl: 'https://home.example.com/', appUrlSource: 'ENV' }, browser)).toEqual({
      origin: 'https://home.example.com',
      source: 'configured',
    });
    expect(bookmarkletOrigin({ appUrl: 'http://home.lan', appUrlSource: 'PAIRED' }, browser)).toEqual({
      origin: 'http://home.lan',
      source: 'paired',
    });
  });

  it("prefers this browser's address to the server's localhost fallback, or when the server hasn't said", () => {
    expect(bookmarkletOrigin({ appUrl: 'http://localhost:3000', appUrlSource: 'FALLBACK' }, browser)).toEqual({
      origin: browser,
      source: 'browser',
    });
    expect(bookmarkletOrigin(undefined, browser).origin).toBe(browser);
  });
});

describe('isLocalOrigin', () => {
  it('spots addresses that only mean this machine', () => {
    expect(isLocalOrigin('http://localhost:3000')).toBe(true);
    expect(isLocalOrigin('http://127.0.0.1:3000')).toBe(true);
    expect(isLocalOrigin('http://framework.lan:29005')).toBe(false);
  });
});

describe('bookmarkletCode', () => {
  it('opens /add on the homepage with the page it is clicked on', () => {
    const code = bookmarkletCode('http://framework.lan:29005');
    expect(code.startsWith('javascript:')).toBe(true);
    const opened: string[] = [];
    const location = { href: 'https://example.com/a b?x=1&y=2' };
    const document = { title: 'Example & Co', querySelector: () => ({ content: 'An example site' }) };
    const window = { open: (url: string) => opened.push(url) };
    // Runs the bookmark's script against a stand-in page.
    const run = new Function('location', 'document', 'window', code.slice('javascript:'.length));
    run(location, document, window);
    expect(opened).toHaveLength(1);
    const url = new URL(opened[0] ?? '');
    expect(url.origin + url.pathname).toBe('http://framework.lan:29005/add');
    expect(url.searchParams.get('url')).toBe('https://example.com/a b?x=1&y=2');
    expect(url.searchParams.get('title')).toBe('Example & Co');
    expect(url.searchParams.get('description')).toBe('An example site');
  });
});
