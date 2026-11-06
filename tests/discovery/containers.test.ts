import { createServer } from 'node:http';
import { DiscoverySourceName } from '../../server/discovery/candidate.ts';
import { containerCandidate, iconFromLabel, webPort } from '../../server/discovery/container-apps.ts';
import { createDockerSocketSource } from '../../server/discovery/docker-socket.ts';
import { createDockhandSource } from '../../server/discovery/dockhand.ts';
import { portOf } from '../helpers.ts';

const HOST = { source: DiscoverySourceName.Docker, key: 'local', address: 'nas.lan' };

describe('iconFromLabel', () => {
  it.each([
    ['jellyfin.png', 'di:jellyfin'],
    ['home-assistant', 'di:home-assistant'],
    ['sh-jellyfin.svg', 'sh:jellyfin'],
    ['https://cdn.example.com/x.png', 'https://cdn.example.com/x.png'],
  ])('reads %s as %s', (label, icon) => {
    expect(iconFromLabel(label)).toBe(icon);
  });

  it.each(['mdi-flask', 'si-github', '', undefined])('has no icon for %s', (label) => {
    expect(iconFromLabel(label)).toBeNull();
  });
});

describe('webPort', () => {
  it('prefers the usual web ports, and skips UDP, unpublished and loopback-only ports', () => {
    const ports = [
      { PrivatePort: 1900, PublicPort: 1900, Type: 'udp' },
      { PrivatePort: 7359, PublicPort: 7359, Type: 'tcp' },
      { PrivatePort: 8096, PublicPort: 8096, Type: 'tcp' },
      { PrivatePort: 80, Type: 'tcp' },
      { IP: '127.0.0.1', PrivatePort: 443, PublicPort: 8443, Type: 'tcp' },
    ];
    expect(webPort(ports)?.PrivatePort).toBe(8096);
    expect(webPort([{ PrivatePort: 80, Type: 'tcp' }])).toBeNull();
  });
});

describe('containerCandidate', () => {
  it('builds the address from the host and published port, preferring Homepage and OCI labels', () => {
    const candidate = containerCandidate(
      {
        name: 'jellyfin',
        image: 'jellyfin/jellyfin',
        labels: {
          'homepage.name': 'Jellyfin',
          'org.opencontainers.image.description': 'Media',
          'homepage.icon': 'jellyfin.png',
        },
        ports: [{ PrivatePort: 8096, PublicPort: 18096, Type: 'tcp' }],
      },
      HOST,
    );
    expect(candidate).toMatchObject({
      source: 'DOCKER',
      sourceKey: 'docker:local:jellyfin',
      url: 'http://nas.lan:18096/',
      fallbackName: 'jellyfin',
      explicit: { name: 'Jellyfin', description: 'Media', icon: 'di:jellyfin' },
    });
  });

  it('uses https for an https port and a homepage.href label over the port', () => {
    const https = containerCandidate(
      { name: 'proxmox', image: 'x', labels: {}, ports: [{ PrivatePort: 8443, PublicPort: 8006, Type: 'tcp' }] },
      HOST,
    );
    expect(https?.url).toBe('https://nas.lan:8006/');
    const labelled = containerCandidate(
      { name: 'app', image: 'x', labels: { 'homepage.href': 'https://app.lan/' }, ports: [] },
      HOST,
    );
    expect(labelled?.url).toBe('https://app.lan/');
  });

  it('leaves out hidden containers and ones with no address', () => {
    const ports = [{ PrivatePort: 80, PublicPort: 8080, Type: 'tcp' }];
    expect(containerCandidate({ name: 'a', image: 'x', labels: { 'homepage.hide': 'true' }, ports }, HOST)).toBeNull();
    expect(
      containerCandidate({ name: 'b', image: 'x', labels: { 'dockhand.hidden': 'true' }, ports }, HOST),
    ).toBeNull();
    expect(containerCandidate({ name: 'c', image: 'x', labels: {}, ports: [] }, HOST)).toBeNull();
  });
});

describe('the Docker socket source', () => {
  it('reads running containers from the API and maps them, with Docker names unslashed', async () => {
    const getJson = vi.fn(async () => [
      {
        Names: ['/grafana'],
        Image: 'grafana/grafana',
        Labels: {},
        Ports: [{ PrivatePort: 3000, PublicPort: 3001, Type: 'tcp' }],
      },
      { Names: ['/db'], Image: 'postgres', Labels: {}, Ports: [{ PrivatePort: 5432, Type: 'tcp' }] },
    ]);
    const source = createDockerSocketSource({ socketPath: '/nonexistent', hostAddress: 'nas.lan', getJson });
    const found = await source.scan();
    expect(getJson).toHaveBeenCalledWith('/containers/json');
    expect(found.map((candidate) => [candidate.sourceKey, candidate.url])).toEqual([
      ['docker:local:grafana', 'http://nas.lan:3001/'],
    ]);
  });

  it('fails with a sentence when the socket is not there', async () => {
    const source = createDockerSocketSource({ socketPath: '/nonexistent/docker.sock', hostAddress: 'nas.lan' });
    await expect(source.scan()).rejects.toThrow();
  });
});

describe('the Dockhand source', () => {
  /**
   * Starts a fake Dockhand that checks the token and lists two environments.
   *
   * @returns Its address, what it was asked, and a close.
   */
  async function startDockhand() {
    const asked: string[] = [];
    const server = createServer((req, res) => {
      asked.push(req.url ?? '');
      if (req.headers.authorization !== 'Bearer dh_test') {
        res.writeHead(401).end('{}');
        return;
      }
      const url = new URL(req.url ?? '/', 'http://x');
      res.setHeader('content-type', 'application/json');
      if (url.pathname === '/api/environments') {
        res.end(
          JSON.stringify([
            { id: 1, name: 'nas', connectionType: 'hawser-edge', host: null, publicIp: '192.168.1.20' },
            { id: 2, name: 'local', connectionType: 'socket', host: null, publicIp: null },
            { id: 3, name: 'nowhere', connectionType: 'hawser-edge', host: null, publicIp: null },
          ]),
        );
        return;
      }
      const containers: Record<string, unknown[]> = {
        '1': [
          {
            id: 'a',
            name: 'jellyfin',
            image: 'jellyfin/jellyfin',
            state: 'running',
            labels: { 'homepage.icon': 'jellyfin.png' },
            ports: [{ PrivatePort: 8096, PublicPort: 8096, Type: 'tcp' }],
          },
        ],
        '2': [
          {
            id: 'b',
            name: 'uptime-kuma',
            image: 'louislam/uptime-kuma',
            state: 'running',
            labels: {},
            ports: [{ PrivatePort: 3001, PublicPort: 3001, Type: 'tcp' }],
          },
        ],
      };
      res.end(JSON.stringify(containers[url.searchParams.get('env') ?? ''] ?? []));
    });
    server.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    return {
      base: `http://127.0.0.1:${portOf(server)}`,
      asked,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  it('lists each environment’s running containers at its public address, or Dockhand’s host for a socket', async () => {
    const dockhand = await startDockhand();
    try {
      const found = await createDockhandSource({ baseUrl: dockhand.base, token: 'dh_test' }).scan();
      expect(found.map((candidate) => [candidate.sourceKey, candidate.url, candidate.explicit.icon])).toEqual([
        ['dockhand:nas:jellyfin', 'http://192.168.1.20:8096/', 'di:jellyfin'],
        ['dockhand:local:uptime-kuma', 'http://127.0.0.1:3001/', null],
      ]);
      // The environment with no known address is never asked for its containers.
      expect(dockhand.asked).toEqual([
        '/api/environments',
        '/api/containers?env=1&all=false',
        '/api/containers?env=2&all=false',
      ]);
    } finally {
      await dockhand.close();
    }
  });

  it('says to check the token when Dockhand refuses it', async () => {
    const dockhand = await startDockhand();
    try {
      await expect(createDockhandSource({ baseUrl: dockhand.base, token: 'dh_wrong' }).scan()).rejects.toThrow(
        /401.*DOCKHAND_TOKEN/,
      );
    } finally {
      await dockhand.close();
    }
  });
});
