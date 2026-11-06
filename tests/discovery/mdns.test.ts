import { EventEmitter } from 'node:events';
import {
  createMdnsSource,
  type MdnsBrowser,
  type MdnsClientFactory,
  type MdnsService,
  mdnsCandidate,
  mdnsCandidates,
} from '../../server/discovery/mdns.ts';

/**
 * Makes an announced service.
 *
 * @param overrides - Fields to replace.
 * @returns The service.
 */
function service(overrides: Partial<MdnsService>): MdnsService {
  return {
    name: 'NAS',
    type: 'http',
    host: 'nas.local',
    port: 5000,
    fqdn: 'NAS._http._tcp.local',
    addresses: ['192.168.1.20', 'fe80::1'],
    ...overrides,
  };
}

describe('mdnsCandidate', () => {
  it('builds an http address from the host, port and path, fetching it at the address instead of the .local name', () => {
    const candidate = mdnsCandidate(service({ txt: { path: '/web/', u: 'admin', p: 'secret', vendor: 'Synology' } }));
    expect(candidate).toMatchObject({
      source: 'MDNS',
      sourceKey: 'mdns:NAS._http._tcp.local',
      url: 'http://nas.local:5000/web/',
      probeUrl: 'http://192.168.1.20:5000/web/',
      fallbackName: 'NAS',
    });
    // The username and password some devices announce are never kept.
    expect(candidate?.metadata.txt).toEqual({ path: '/web/', vendor: 'Synology' });
  });

  it('reads Home Assistant’s internal_url and a printer’s adminurl, and skips a printer without one', () => {
    const assistant = mdnsCandidate(
      service({ type: 'home-assistant', port: 8123, txt: { internal_url: 'http://homeassistant.local:8123' } }),
    );
    expect(assistant?.url).toBe('http://homeassistant.local:8123');
    const printer = mdnsCandidate(service({ type: 'ipp', port: 631, txt: { adminurl: 'http://printer.local/' } }));
    expect(printer?.url).toBe('http://printer.local/');
    expect(mdnsCandidate(service({ type: 'ipp', port: 631, txt: {} }))).toBeNull();
  });

  it('leaves out the default port and keeps a name that is not .local as it is', () => {
    const candidate = mdnsCandidate(service({ type: 'https', host: 'nas.lan.', port: 443 }));
    expect(candidate).toMatchObject({ url: 'https://nas.lan/', probeUrl: null });
  });
});

describe('mdnsCandidates', () => {
  it('keeps the most specific of several services pointing at the same page', () => {
    const found = mdnsCandidates([
      service({ name: 'printer http', type: 'http', port: 80, fqdn: 'p._http._tcp.local' }),
      service({ name: 'OctoPrint', type: 'octoprint', port: 80, fqdn: 'p._octoprint._tcp.local' }),
    ]);
    expect(found.map((candidate) => candidate.sourceKey)).toEqual(['mdns:p._octoprint._tcp.local']);
  });
});

describe('createMdnsSource', () => {
  /**
   * A fake client whose browsers hold the services given, and can announce one.
   *
   * @param services - What each browser has heard of, by type.
   * @returns The factory and its browsers, by type.
   */
  function fakeClient(services: Record<string, MdnsService[]>) {
    const browsers = new Map<string, MdnsBrowser & EventEmitter>();
    const openClient: MdnsClientFactory = () => ({
      find: (type) => {
        const browser = Object.assign(new EventEmitter(), {
          services: services[type] ?? [],
          update: vi.fn(),
          stop: vi.fn(),
        });
        browsers.set(type, browser);
        return browser;
      },
      destroy: vi.fn(),
    });
    return { openClient, browsers };
  }

  it('browses every type, scans what was heard, and asks for a scan when something is announced', async () => {
    const { openClient, browsers } = fakeClient({ http: [service({ txt: { path: '/' } })] });
    const source = createMdnsSource({ openClient }, { mdnsSettleSeconds: 0 });
    const onChange = vi.fn();
    source.start(onChange);
    expect([...browsers.keys()]).toEqual(['http', 'https', 'home-assistant', 'octoprint', 'ipp', 'ipps']);
    browsers.get('http')?.emit('up', service({}));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((await source.scan()).map((candidate) => candidate.url)).toEqual(['http://nas.local:5000/']);
    source.stop();
    expect(browsers.get('http')?.stop).toHaveBeenCalled();
  });

  it('warns once and finds nothing when the network has no multicast', async () => {
    const warn = vi.fn();
    const source = createMdnsSource(
      {
        openClient: (onError) => {
          onError(new Error('bind EADDRINUSE 0.0.0.0:5353'));
          onError(new Error('bind EADDRINUSE 0.0.0.0:5353'));
          throw new Error('no socket');
        },
        warn,
      },
      { mdnsSettleSeconds: 0 },
    );
    source.start(() => {});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/\[discovery\] mDNS: bind EADDRINUSE.*host networking/);
    expect(await source.scan()).toEqual([]);
  });
});
