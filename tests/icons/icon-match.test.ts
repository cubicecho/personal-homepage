import { DASHBOARD_ICONS, DASHBOARD_ICONS_METADATA, SELFHST } from '../../server/icons/catalogues.ts';
import { imageNames, indexIcons, matchIcon, nameSlugs, slugOfName } from '../../server/icons/icon-match.ts';
import { createIconService } from '../../server/icons/icon-service.ts';
import { makeDataDir } from '../helpers.ts';

/**
 * Makes catalogue icons from names.
 *
 * @param names - The icons' names.
 * @returns The icons, each in SVG.
 */
function icons(...names: string[]) {
  return names.map((name) => ({ name, label: name, formats: ['svg' as const] }));
}

describe('slugOfName and nameSlugs', () => {
  it.each([
    ['Jellyfin', ['jellyfin']],
    ['Home Assistant', ['home-assistant']],
    ['Actual Budget', ['actual-budget']],
    ['Paperless-ngx', ['paperless-ngx']],
    ['paperless_ngx', ['paperless-ngx']],
    ['Uptime Kuma', ['uptime-kuma']],
    ['Médiathèque', ['mediatheque']],
    ['  Grafana.Labs  ', ['grafana-labs']],
    ['actual-server', ['actual-server', 'actual']],
    ['vaultwarden-web', ['vaultwarden-web', 'vaultwarden']],
    ['code-server', ['code-server', 'code']],
    ['-server', ['server']],
    ['!!!', []],
  ])('%s gives %j', (name, slugs) => {
    expect(nameSlugs(name)).toEqual(slugs);
  });

  it('writes a name the way icon names are written', () => {
    expect(slugOfName('Home  Assistant (beta)')).toBe('home-assistant-beta');
  });
});

describe('imageNames', () => {
  it.each([
    ['lscr.io/linuxserver/jellyfin:latest', ['jellyfin', 'linuxserver']],
    ['linuxserver/jellyfin', ['jellyfin', 'linuxserver']],
    ['ghcr.io/actualbudget/actual-server:latest', ['actual-server', 'actualbudget']],
    ['ghcr.io/home-assistant/home-assistant:stable', ['home-assistant', 'home-assistant']],
    ['jellyfin/jellyfin@sha256:0123abcd', ['jellyfin', 'jellyfin']],
    ['library/nginx:1.27', ['nginx']],
    ['grafana', ['grafana']],
    ['localhost:5000/team/app:dev', ['app', 'team']],
    ['', []],
  ])('%s gives %j', (image, names) => {
    expect(imageNames(image)).toEqual(names);
  });
});

describe('matchIcon', () => {
  const indexes = {
    di: indexIcons(icons('jellyfin', 'home-assistant', 'actual-budget', 'uptime-kuma', 'paperless-ngx'), [
      { name: 'uptime-kuma', label: 'Uptime Kuma', formats: [], aliases: ['status-page'] },
      // An alias of an icon the image listing doesn't have can't be used.
      { name: 'not-published', label: 'Gone', formats: [], aliases: ['ghost'] },
      // An alias never takes another icon's own name.
      { name: 'paperless-ngx', label: 'Paperless', formats: [], aliases: ['jellyfin'] },
    ]),
    sh: indexIcons(icons('jellyfin', 'navidrome', 'actual')),
  };

  it.each([
    [['Jellyfin'], 'di:jellyfin'],
    [['Home Assistant'], 'di:home-assistant'],
    [['homeassistant'], 'di:home-assistant'],
    [['Actual Budget'], 'di:actual-budget'],
    [['Paperless-ngx'], 'di:paperless-ngx'],
    [['Status Page'], 'di:uptime-kuma'],
    [['navidrome'], 'sh:navidrome'],
    [['actual-server'], 'sh:actual'],
    [['ghost'], null],
    [['Jelly'], null],
    [['Totally Unknown'], null],
  ])('%j gives %s', (names, expected) => {
    expect(matchIcon(names, indexes)).toBe(expected);
  });

  it('prefers dashboard-icons over selfh.st for the same name', () => {
    expect(matchIcon(['jellyfin'], indexes)).toBe('di:jellyfin');
  });

  it('tries names in order, so the most telling one wins', () => {
    // The image's namespace names the app better than its repository here, but comes later.
    expect(matchIcon(['My Budget', 'actual-server', 'actualbudget'], indexes)).toBe('sh:actual');
    expect(matchIcon(['My Budget', 'actualbudget'], indexes)).toBe('di:actual-budget');
  });
});

describe('the icon service matchName', () => {
  let dataDir: string;
  let remove: () => Promise<void>;
  let isOffline: boolean;
  let calls: string[];
  let warn: ReturnType<typeof vi.spyOn>;

  const listings = new Map<string, unknown>([
    [DASHBOARD_ICONS.listingUrl, { svg: ['jellyfin.svg', 'actual-budget.svg', 'uptime-kuma.svg'], png: [] }],
    [DASHBOARD_ICONS_METADATA.listingUrl, { 'uptime-kuma': { base: 'svg', aliases: ['Status Page'] } }],
    [SELFHST.listingUrl, [{ Name: 'Navidrome', Reference: 'navidrome', SVG: 'Yes', PNG: 'Yes', WebP: 'No' }]],
  ]);

  /** Answers the three listing URLs, or fails when offline. */
  const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    if (isOffline) {
      throw new Error('ENOTFOUND');
    }
    const listing = listings.get(url);
    return listing === undefined
      ? new Response('not found', { status: 404 })
      : new Response(JSON.stringify(listing), { headers: { 'content-type': 'application/json' } });
  };

  const open = () => createIconService({ dataDir, fetch: fakeFetch as typeof fetch, now: () => Date.UTC(2026, 10, 6) });

  beforeEach(async () => {
    ({ dir: dataDir, remove } = await makeDataDir());
    isOffline = false;
    calls = [];
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    warn.mockRestore();
    await remove();
  });

  it('matches names, aliases and the other catalogue, downloading each listing once', async () => {
    const icons = open();
    expect(await icons.matchName(['Jellyfin'])).toBe('di:jellyfin');
    expect(await icons.matchName(['Actual Budget'])).toBe('di:actual-budget');
    expect(await icons.matchName(['status page'])).toBe('di:uptime-kuma');
    expect(await icons.matchName(['Navidrome'])).toBe('sh:navidrome');
    expect(await icons.matchName(['Something else', ''])).toBeNull();
    expect(calls.sort()).toEqual(
      [DASHBOARD_ICONS.listingUrl, DASHBOARD_ICONS_METADATA.listingUrl, SELFHST.listingUrl].sort(),
    );
  });

  it('finds nothing, without throwing, when no listing can be downloaded', async () => {
    isOffline = true;
    expect(await open().matchName(['Jellyfin'])).toBeNull();
  });

  it('matches from the listings kept on disk when it is offline later', async () => {
    await open().matchName(['Jellyfin']);
    isOffline = true;
    expect(await open().matchName(['Jellyfin'])).toBe('di:jellyfin');
  });
});
