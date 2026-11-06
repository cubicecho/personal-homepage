import { SEARCH_DEFAULTS } from '../../server/core/defaults.ts';
import { ErrorCode } from '../../server/core/errors.ts';
import type { OpenedDatabase } from '../../server/db/client.ts';
import { SITE_SETTINGS_ID, siteSettings } from '../../server/db/schema.ts';
import { createSiteSettings, type SiteSettings } from '../../server/site/site-settings.ts';
import { openTestDatabase, resetTestDatabase } from '../db.ts';

const SEARX = { prefix: 's', name: 'SearXNG', url: 'http://searx.local/search?q={query}' };
const GOOGLE = { prefix: 'g', name: 'Google', url: 'https://www.google.com/search?q={query}' };

describe('site settings', () => {
  let database: OpenedDatabase;
  let site: SiteSettings;
  let warn: ReturnType<typeof vi.spyOn>;

  const defaultPrefix = async () => (await site.searchEngines()).find((engine) => engine.isDefault)?.prefix;
  const prefixes = async () => (await site.searchEngines()).map((engine) => engine.prefix);
  const builtInPrefixes = SEARCH_DEFAULTS.engines.map((engine) => engine.prefix);
  /** Stores search settings as an import would, without the checks `setSearch` makes. */
  const storeRaw = (search: unknown) =>
    database.db
      .insert(siteSettings)
      .values({ id: SITE_SETTINGS_ID, search })
      .onConflictDoUpdate({ target: siteSettings.id, set: { search } });

  beforeAll(async () => {
    database = await openTestDatabase();
  });

  afterAll(() => database.close());

  beforeEach(async () => {
    await resetTestDatabase(database.db);
    site = createSiteSettings(database.db);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('gives the default engines when nothing is stored', async () => {
    expect(await prefixes()).toEqual(builtInPrefixes);
    expect(await defaultPrefix()).toBe(SEARCH_DEFAULTS.defaultPrefix);
    expect(await site.storedSearch()).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('stores engines and the default, and reads them back', async () => {
    const engines = await site.setSearch({ defaultPrefix: 'S', engines: [GOOGLE, SEARX] });
    expect(engines).toEqual([
      { ...GOOGLE, isDefault: false },
      { ...SEARX, isDefault: true },
    ]);
    expect(await site.searchEngines()).toEqual(engines);
    expect(await site.storedSearch()).toEqual({ defaultPrefix: 'S', engines: [GOOGLE, SEARX] });
  });

  it('picks a default from the built-in engines when only defaultPrefix is set', async () => {
    await site.setSearch({ defaultPrefix: 'g' });
    expect(await prefixes()).toEqual(builtInPrefixes);
    expect(await defaultPrefix()).toBe('g');
  });

  it('goes back to the defaults when given null', async () => {
    await site.setSearch({ engines: [SEARX] });
    await site.setSearch(null);
    expect(await prefixes()).toEqual(builtInPrefixes);
    expect(await site.storedSearch()).toBeNull();
  });

  it.each([
    ['a URL with no {query}', { engines: [{ prefix: 's', name: 'S', url: 'http://searx.local/' }] }],
    ['a script URL', { engines: [{ prefix: 's', name: 'S', url: "javascript:alert('{query}')" }] }],
    ['two engines with one prefix', { engines: [SEARX, SEARX] }],
    ['a prefix with a space', { engines: [{ ...SEARX, prefix: 's x' }] }],
    ['no engines', { engines: [] }],
    ['a default that is not an engine', { defaultPrefix: 'nope' }],
  ])('refuses %s, and keeps what was stored', async (_case, search) => {
    await site.setSearch({ engines: [SEARX] });
    await expect(site.setSearch(search)).rejects.toMatchObject({ extensions: { code: ErrorCode.BadUserInput } });
    expect(await prefixes()).toEqual(['s']);
  });

  it('falls back to the defaults for a stored value that no longer fits, logging it once', async () => {
    await storeRaw({ defaultPrefix: 'nope' });
    expect(await prefixes()).toEqual(builtInPrefixes);
    expect(await prefixes()).toEqual(builtInPrefixes);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/^\[site\] /);
  });
});
