import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SEARCH_DEFAULTS } from '../../server/core/defaults.ts';
import { createSiteSettings, type SiteSettings } from '../../server/site/site-settings.ts';
import { makeDataDir } from '../helpers.ts';

const SEARX = { prefix: 's', name: 'SearXNG', url: 'http://searx.local/search?q={query}' };

describe('site settings', () => {
  let dir: string;
  let remove: () => Promise<void>;
  let site: SiteSettings;
  let warn: ReturnType<typeof vi.spyOn>;

  const writeSite = (text: string) => writeFile(path.join(dir, 'site.yaml'), text);
  const defaultPrefix = async () => (await site.searchEngines()).find((engine) => engine.isDefault)?.prefix;
  const prefixes = async () => (await site.searchEngines()).map((engine) => engine.prefix);
  const builtInPrefixes = SEARCH_DEFAULTS.engines.map((engine) => engine.prefix);

  beforeEach(async () => {
    ({ dir, remove } = await makeDataDir());
    site = createSiteSettings({ dataDir: dir });
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    warn.mockRestore();
    await remove();
  });

  it('gives the default engines when there is no site.yaml, or no search key', async () => {
    expect(await prefixes()).toEqual(builtInPrefixes);
    expect(await defaultPrefix()).toBe(SEARCH_DEFAULTS.defaultPrefix);
    await writeSite('pageOrder: [media]\n');
    expect(await prefixes()).toEqual(builtInPrefixes);
    await writeSite('');
    expect(await prefixes()).toEqual(builtInPrefixes);
    expect(warn).not.toHaveBeenCalled();
  });

  it('reads engines and the default from site.yaml, on every call', async () => {
    await writeSite(
      [
        'search:',
        '  defaultPrefix: S',
        '  engines:',
        '    - prefix: g',
        '      name: Google',
        '      url: https://www.google.com/search?q={query}',
        `    - prefix: ${SEARX.prefix}`,
        `      name: ${SEARX.name}`,
        `      url: ${SEARX.url}`,
      ].join('\n'),
    );
    expect(await site.searchEngines()).toEqual([
      { prefix: 'g', name: 'Google', url: 'https://www.google.com/search?q={query}', isDefault: false },
      { ...SEARX, isDefault: true },
    ]);
    await writeSite(`search:\n  engines:\n    - ${JSON.stringify(SEARX)}\n`);
    expect(await site.searchEngines()).toEqual([{ ...SEARX, isDefault: true }]);
  });

  it('picks a default from the built-in engines when only defaultPrefix is set', async () => {
    await writeSite('search:\n  defaultPrefix: g\n');
    expect(await prefixes()).toEqual(builtInPrefixes);
    expect(await defaultPrefix()).toBe('g');
  });

  it.each([
    ['a URL with no {query}', `search:\n  engines:\n    - { prefix: s, name: S, url: "http://searx.local/" }\n`],
    ['a script URL', `search:\n  engines:\n    - { prefix: s, name: S, url: "javascript:alert('{query}')" }\n`],
    [
      'two engines with one prefix',
      `search:\n  engines:\n    - ${JSON.stringify(SEARX)}\n    - ${JSON.stringify(SEARX)}\n`,
    ],
    ['a prefix with a space', `search:\n  engines:\n    - { prefix: "s x", name: S, url: "${SEARX.url}" }\n`],
    ['no engines', 'search:\n  engines: []\n'],
    ['a default that is not an engine', 'search:\n  defaultPrefix: nope\n'],
    ['YAML that does not parse', 'search: [unclosed\n'],
  ])('ignores %s, falling back to the defaults and logging once', async (_case, text) => {
    await writeSite(text);
    expect(await prefixes()).toEqual(builtInPrefixes);
    expect(await defaultPrefix()).toBe(SEARCH_DEFAULTS.defaultPrefix);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/^\[site\] /);
  });

  it('logs a problem again once it was fixed and came back', async () => {
    await writeSite('search:\n  defaultPrefix: nope\n');
    await site.searchEngines();
    await writeSite('search:\n  defaultPrefix: g\n');
    await site.searchEngines();
    await writeSite('search:\n  defaultPrefix: nope\n');
    await site.searchEngines();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
