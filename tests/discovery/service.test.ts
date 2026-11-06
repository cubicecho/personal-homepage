import type { OpenedDatabase } from '../../server/db/client.ts';
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

  it('describes what someone typed without requiring a private address', async () => {
    const describer = fakeDescriber({ 'https://example.com/': { title: 'Example' } });
    const service = createDiscoveryService({ store: createDiscoveryStore(database.db), describer, sources: [] });
    expect((await service.describe('https://example.com/')).title).toBe('Example');
    expect(describer.describe).toHaveBeenCalledWith('https://example.com/', { requirePrivate: false });
  });
});
