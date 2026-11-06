// Finds containers on this host through the Docker socket, for people who don't run Dockhand. Mount it
// read-only: only `GET /containers/json` (running containers) is asked. Docker's API is plain HTTP over
// the socket, so no client library is needed.
import { request } from 'node:http';
import { z } from 'zod';
import { DISCOVERY_DEFAULTS, type DiscoverySettings } from '../core/defaults.ts';
import { MS_PER_SECOND } from '../core/wire.ts';
import { type Candidate, type DiscoverySource, DiscoverySourceName } from './candidate.ts';
import { containerCandidate } from './container-apps.ts';

/** What the socket source is given in tests instead of a socket. */
export type GetJson = (path: string) => Promise<unknown>;

/** Where the socket is and what this host is called. */
export interface DockerSocketOptions {
  /** The socket's path. */
  socketPath: string;
  /** The name or address other devices reach this host by. */
  hostAddress: string;
  /** Reads JSON from the API: the socket by default. */
  getJson?: GetJson;
}

/** The host key containers on this host's socket are filed under. */
const LOCAL_HOST_KEY = 'local';
/** The largest answer read from the socket, in bytes: a busy host lists a few hundred containers. */
const MAX_LIST_BYTES = 8_388_608;
const HTTP_OK = 200;
/** The errors opening a Unix socket fails with when it isn't there, or isn't ours to read. */
const SocketCode = { Missing: 'ENOENT', Denied: 'EACCES' } as const;

const containerSchema = z.object({
  Names: z.array(z.string()).default([]),
  Image: z.string().default(''),
  Labels: z.record(z.string(), z.string()).nullish(),
  Ports: z
    .array(
      z.object({
        IP: z.string().optional(),
        PrivatePort: z.number(),
        PublicPort: z.number().optional(),
        Type: z.string(),
      }),
    )
    .nullish(),
});

/**
 * Reads JSON from the Docker API over its socket.
 *
 * @param socketPath - The socket.
 * @param path - The API path.
 * @param timeoutMs - How long to wait.
 * @returns The parsed body.
 * @throws When the socket can't be reached, answers with an error, or says too much.
 */
function socketJson(socketPath: string, path: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path, method: 'GET', timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_LIST_BYTES) {
          req.destroy(new Error('The Docker socket answered with more than this server reads.'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        if (res.statusCode !== HTTP_OK) {
          reject(new Error(`The Docker socket answered ${res.statusCode} to ${path}.`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
        } catch {
          reject(new Error(`The Docker socket's answer to ${path} wasn't JSON. Is ${socketPath} Docker's socket?`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('The Docker socket did not answer in time.')));
    req.on('error', (error) => reject(new Error(socketErrorMessage(socketPath, error))));
    req.end();
  });
}

/**
 * Explains why the socket couldn't be read.
 *
 * @param socketPath - The socket.
 * @param error - What the request failed with.
 * @returns A sentence naming the socket and what to change.
 */
function socketErrorMessage(socketPath: string, error: Error): string {
  const code = 'code' in error ? String(error.code) : '';
  if (code === SocketCode.Missing) {
    return `There is no Docker socket at ${socketPath}. Mount it read-only (/var/run/docker.sock:/var/run/docker.sock:ro), or set DOCKER_SOCKET.`;
  }
  if (code === SocketCode.Denied) {
    return `This server isn't allowed to read ${socketPath}. Give the container the socket's group (group_add with the docker group's id).`;
  }
  return `Couldn't read the Docker socket at ${socketPath}: ${error.message}`;
}

/**
 * Builds the Docker socket source.
 *
 * @param options - The socket, this host's address, and a reader for tests.
 * @param [overrides] - Discovery settings to replace.
 * @returns The source. It is polled; it watches nothing.
 */
export function createDockerSocketSource(
  options: DockerSocketOptions,
  overrides: Partial<DiscoverySettings> = {},
): DiscoverySource {
  const { sourceTimeoutSeconds } = { ...DISCOVERY_DEFAULTS, ...overrides };
  const getJson =
    options.getJson ?? ((path: string) => socketJson(options.socketPath, path, sourceTimeoutSeconds * MS_PER_SECOND));
  const host = { source: DiscoverySourceName.Docker, key: LOCAL_HOST_KEY, address: options.hostAddress };

  return {
    name: DiscoverySourceName.Docker,
    start: () => {},
    stop: () => {},
    scan: async () => {
      const listed = z.array(containerSchema).parse(await getJson('/containers/json'));
      return listed.flatMap((container): Candidate[] => {
        // Docker names start with a slash: "/jellyfin".
        const name = (container.Names[0] ?? '').replace(/^\//, '');
        const candidate = containerCandidate(
          { name, image: container.Image, labels: container.Labels ?? {}, ports: container.Ports ?? [] },
          host,
        );
        return candidate === null ? [] : [candidate];
      });
    },
  };
}
