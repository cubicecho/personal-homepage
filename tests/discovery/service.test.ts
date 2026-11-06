import type { OpenedDatabase } from '../../server/db/client.ts';
import { discoveredApps } from '../../server/db/schema.ts';
import { type Candidate, type DiscoverySource, DiscoverySourceName } from '../../server/discovery/candidate.ts';
import type { Describer, Description } from '../../server/discovery/describe.ts';
import { createDiscoveryService } from '../../server/discovery/service.ts';
import { createDiscoveryStore } from '../../server/discovery/store.ts';
import { openTestDatabase, resetTestDatabase } from '../db.ts';

let database: OpenedDatabase;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await resetTestDatabase(database.db);
});

/**
 * Makes a candidate.
 *
 * @param key - Its source key's last part.
 * @param overrides - Fields to replace.
 * @returns The candidate.
 */
function candidate(key: string, overrides: Partial<Candidate> = {}): Candidate {
  return {
    source: DiscoverySourceName.Dockhand,
    sourceKey: `dockhand:nas:${key}`,
    url: `http://nas.lan/${key}`,
    probeUrl: null,
    fallbackName: key,
    nameHints: [],
    explicit: { name: null, description: null, icon: null },
    metadata: {},
    ...overrides,
  };
}

/**
 * A source that reports what it is given.
 *
 * @param found - What each scan reports, or an error to throw.
 * @returns The source.
 */
function fakeSource(found: () => Candidate[]): DiscoverySource {
  return { name: DiscoverySourceName.Dockhand, start: () => {}, stop: () => {}, scan: async () => found() };
}

/** A describer that answers from a table, by address. */
function fakeDescriber(pages: Record<string, Partial<Description>>): Describer {
  return {
    describe: vi.fn(async (url: string) => ({
      url,
      title: null,
      names: [],
      description: null,
      icon: null,
      problem: null,
      ...pages[url],
    })),
  };
}

describe('the discovery service', () => {
  it('describes what a source sees and records it, letting labels win over the page', async () => {
    const describer = fakeDescriber({
      'http://nas.lan/jellyfin': { title: 'Jellyfin', description: 'Media', icon: 'http://nas.lan/icon.png' },
      'http://nas.lan/grafana': { title: 'Grafana Labs' },
    });
    const service = createDiscoveryService({
      store: createDiscoveryStore(database.db),
      describer,
      sources: [
        fakeSource(() => [
          candidate('jellyfin'),
          candidate('grafana', { explicit: { name: 'Graphs', description: null, icon: 'di:grafana' } }),
          candidate('unknown'),
        ]),
      ],
    });
    const report = await service.rescan();
    expect(report).toMatchObject({ found: 3, added: 3 });
    const apps = await service.list(false);
    expect(apps.map((app) => [app.name, app.description, app.icon])).toEqual([
      ['Graphs', null, 'di:grafana'],
      ['Jellyfin', 'Media', 'http://nas.lan/icon.png'],
      ['unknown', null, null],
    ]);
    // Found apps are only fetched when they resolve to private addresses.
    expect(describer.describe).toHaveBeenCalledWith('http://nas.lan/jellyfin', { requirePrivate: true });
  });

  it('updates a sighting instead of adding one, and keeps it dismissed', async () => {
    let name = 'first';
    const service = createDiscoveryService({
      store: createDiscoveryStore(database.db),
      describer: fakeDescriber({}),
      sources: [fakeSource(() => [candidate('app', { fallbackName: name })])],
    });
    await service.rescan();
    const [app] = await service.list(false);
    await service.setDismissed(app?.id ?? '', true);
    name = 'second';
    const again = await service.rescan();
    expect(again).toMatchObject({ found: 1, added: 0 });
    expect(await service.list(false)).toEqual([]);
    const [kept] = await service.list(true);
    expect(kept).toMatchObject({ id: app?.id, name: 'second', dismissed: true });
    await expect(service.setDismissed('nope', true)).rejects.toMatchObject({ extensions: { code: 'NOT_FOUND' } });
  });

  it('records a source’s failure in its status, warns once per message, and keeps scanning the rest', async () => {
    const warn = vi.fn();
    const broken: DiscoverySource = {
      name: DiscoverySourceName.Docker,
      start: () => {},
      stop: () => {},
      scan: async () => {
        throw new Error('The Docker socket did not answer in time.');
      },
    };
    const service = createDiscoveryService({
      store: createDiscoveryStore(database.db),
      describer: fakeDescriber({}),
      sources: [broken, fakeSource(() => [candidate('one')])],
      disabled: [{ source: DiscoverySourceName.Mdns, setupHint: 'Turn it on.' }],
      warn,
    });
    await service.rescan();
    await service.rescan();
    expect(warn).toHaveBeenCalledTimes(1);
    const statuses = service.statuses();
    expect(statuses.find((status) => status.source === 'DOCKER')).toMatchObject({
      isEnabled: true,
      found: 0,
      error: 'The Docker socket did not answer in time.',
    });
    expect(statuses.find((status) => status.source === 'DOCKHAND')).toMatchObject({ found: 1, error: null });
    expect(statuses.find((status) => status.source === 'MDNS')).toMatchObject({
      isEnabled: false,
      setupHint: 'Turn it on.',
    });
  });

  it('picks an icon: a label first, then a catalogue icon a name matches, then the page’s, then favicon', async () => {
    const describer = fakeDescriber({
      'http://nas.lan/labelled': { names: ['Jellyfin'], icon: 'http://nas.lan/a.png' },
      'http://nas.lan/budget': { names: ['Actual Budget'], icon: 'http://nas.lan/b.png' },
      'http://nas.lan/budget-container': { names: [], icon: 'favicon' },
      'http://nas.lan/own-icon': { names: ['Something Mine'], icon: 'http://nas.lan/c.png' },
      'http://nas.lan/plain': { names: [], icon: 'favicon' },
    });
    const asked: string[][] = [];
    const matchIcon = async (names: readonly string[]) => {
      asked.push([...names]);
      const known: Record<string, string> = { jellyfin: 'di:jellyfin', 'actual budget': 'di:actual-budget' };
      const hit = names.map((name) => known[name.toLowerCase()]).find((icon) => icon !== undefined);
      return hit ?? null;
    };
    const service = createDiscoveryService({
      store: createDiscoveryStore(database.db),
      describer,
      matchIcon,
      sources: [
        fakeSource(() => [
          candidate('labelled', { explicit: { name: null, description: null, icon: 'sh:jellyfin' } }),
          candidate('budget'),
          candidate('budget-container', { nameHints: ['budget', 'actual budget'] }),
          candidate('own-icon'),
          candidate('plain'),
        ]),
      ],
    });
    await service.rescan();
    const rows = await database.db.select().from(discoveredApps);
    const byKey = new Map(rows.map((row) => [row.sourceKey.split(':').at(-1), row]));
    const iconOf = (key: string) => {
      const row = byKey.get(key);
      const metadata = (row?.metadata ?? {}) as Record<string, unknown>;
      return [row?.icon, metadata.iconSource];
    };
    expect(iconOf('labelled')).toEqual(['sh:jellyfin', 'label']);
    expect(iconOf('budget')).toEqual(['di:actual-budget', 'catalogue']);
    expect(iconOf('budget-container')).toEqual(['di:actual-budget', 'catalogue']);
    expect(iconOf('own-icon')).toEqual(['http://nas.lan/c.png', 'page']);
    expect(iconOf('plain')).toEqual(['favicon', 'favicon']);
    // A label's icon wins without asking the catalogues; the others are asked with every name, page names first.
    expect(asked).toContainEqual(['Actual Budget', 'budget']);
    expect(asked).toContainEqual(['budget-container', 'budget', 'actual budget']);
    expect(asked.some((names) => names.includes('labelled'))).toBe(false);
  });

  it('fills in a typed address with a catalogue icon its name matches, else the page’s', async () => {
    const describer = fakeDescriber({
      'https://budget.lan/': { title: 'Actual', names: ['Actual Budget'], icon: 'https://budget.lan/icon.png' },
      'https://other.lan/': { title: 'Other', names: ['Other'], icon: 'https://other.lan/icon.png' },
    });
    const service = createDiscoveryService({
      store: createDiscoveryStore(database.db),
      describer,
      sources: [],
      matchIcon: async (names) => (names.includes('Actual Budget') ? 'di:actual-budget' : null),
    });
    expect((await service.describe('https://budget.lan/')).icon).toBe('di:actual-budget');
    expect((await service.describe('https://other.lan/')).icon).toBe('https://other.lan/icon.png');
  });

  it('describes what someone typed without requiring a private address', async () => {
    const describer = fakeDescriber({ 'https://example.com/': { title: 'Example' } });
    const service = createDiscoveryService({ store: createDiscoveryStore(database.db), describer, sources: [] });
    expect((await service.describe('https://example.com/')).title).toBe('Example');
    expect(describer.describe).toHaveBeenCalledWith('https://example.com/', { requirePrivate: false });
  });
});
