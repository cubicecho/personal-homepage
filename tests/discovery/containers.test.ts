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
      nameHints: ['jellyfin', 'jellyfin', 'jellyfin'],
      explicit: { name: 'Jellyfin', description: 'Media', icon: 'di:jellyfin' },
    });
  });

  it('gives the container’s name and its image’s names as hints for matching an icon', () => {
    const ports = [{ PrivatePort: 5006, PublicPort: 5006, Type: 'tcp' }];
    const budget = containerCandidate(
      { name: 'budget', image: 'ghcr.io/actualbudget/actual-server:latest', labels: {}, ports },
      HOST,
    );
    expect(budget?.nameHints).toEqual(['budget', 'actual-server', 'actualbudget']);
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
    await expect(source.scan()).rejects.toThrow(
      'There is no Docker socket at /nonexistent/docker.sock. Mount it read-only (/var/run/docker.sock:/var/run/docker.sock:ro), or set DOCKER_SOCKET.',
    );
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

  /**
   * Starts a server that answers every request the same way.
   *
   * @param status - The status to answer with.
   * @param headers - The headers to send.
   * @param body - The body to send.
   * @returns Its address and a close.
   */
  async function startAnswering(status: number, headers: Record<string, string>, body: string) {
    const server = createServer((_req, res) => {
      res.writeHead(status, headers).end(body);
    });
    server.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    return {
      base: `http://127.0.0.1:${portOf(server)}`,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  /**
   * Scans a fake Dockhand that answers every request the same way, and returns the error it fails with.
   *
   * @param status - The status to answer with.
   * @param headers - The headers to send.
   * @param body - The body to send.
   * @returns The message, and the address the source was pointed at.
   */
  async function failureFor(status: number, headers: Record<string, string>, body: string) {
    const server = await startAnswering(status, headers, body);
    try {
      const scanned = createDockhandSource({ baseUrl: server.base, token: 'dh_secret' }).scan();
      const error = await scanned.then(
        () => null,
        (failure: unknown) => failure,
      );
      return { message: error instanceof Error ? error.message : String(error), base: server.base };
    } finally {
      await server.close();
    }
  }

  it("says when it reached this homepage's own page, not Dockhand", async () => {
    const { message, base } = await failureFor(
      200,
      { 'content-type': 'text/html' },
      '<!doctype html><html><body><div id="root"></div></body></html>',
    );
    expect(message).toContain(`${base}/api/environments answered with this homepage's own page`);
    expect(message).toContain('"127.0.0.1:host-gateway"');
    expect(message).not.toContain('dh_secret');
  });

  it('says when another web page answered instead of the API', async () => {
    const { message } = await failureFor(200, { 'content-type': 'text/html' }, '<!doctype html><p>Sign in</p>');
    expect(message).toMatch(
      /answered with a web page, not Dockhand's API\. DOCKHAND_URL must be Dockhand's base address/,
    );
  });

  it('names where a redirect went instead of following it', async () => {
    const { message, base } = await failureFor(307, { location: '/login?redirect=%2Fapi' }, '');
    expect(message).toBe(
      `Dockhand redirected ${base}/api/environments to /login?redirect=%2Fapi. DOCKHAND_URL must be Dockhand's base address, for example http://dockhand.lan:3000.`,
    );
  });

  it('says to check the token on a JSON 401', async () => {
    const { message } = await failureFor(401, { 'content-type': 'application/json' }, '{"error":"unauthorized"}');
    expect(message).toMatch(/answered 401 to .*\/api\/environments\. Check DOCKHAND_TOKEN\./);
  });

  it('says a server error came back as a web page', async () => {
    const { message, base } = await failureFor(500, { 'content-type': 'text/html' }, '<h1>Oops</h1>');
    expect(message).toBe(`Dockhand answered 500 with a web page to ${base}/api/environments.`);
  });

  it('names the address when nothing is listening there', async () => {
    const server = await startAnswering(200, {}, '');
    const { base } = server;
    await server.close();
    const failure = await createDockhandSource({ baseUrl: base, token: 'dh_secret' })
      .scan()
      .then(
        () => null,
        (error: unknown) => error,
      );
    const message = failure instanceof Error ? failure.message : String(failure);
    expect(message).toBe(
      `Nothing is listening at ${new URL(base).host} (connection refused). Check that Dockhand is running and DOCKHAND_URL is right.`,
    );
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
