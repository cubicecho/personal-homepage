// Finds containers through Dockhand (https://dockhand.pro), which already reaches every Docker host it
// manages, so this server needs no Docker socket of its own.
//
// The endpoints, read from Dockhand's source (github.com/Finsys/dockhand, checked 2026-11-05):
// - `GET /api/environments` (src/routes/api/environments/+server.ts): `[{ id, name, connectionType, host,
//   port, publicIp, … }]`. `publicIp` is the address Dockhand itself links published ports to; `host` is
//   set for a direct TCP connection; a `socket` environment is Dockhand's own host.
// - `GET /api/containers?env=<id>&all=false` (src/routes/api/containers/+server.ts, listContainers in
//   src/lib/server/docker.ts): running containers as `[{ id, name, image, state, labels, ports }]`, with
//   `ports` passed through in the Docker API's shape. Containers labelled `dockhand.hidden=true` are left out.
// - An API token is sent as `Authorization: Bearer dh_…` (src/hooks.server.ts), and acts as its user.
import { z } from 'zod';
import { DISCOVERY_DEFAULTS, type DiscoverySettings } from '../core/defaults.ts';
import { MS_PER_SECOND } from '../core/wire.ts';
import type { Fetch } from '../icons/fetching.ts';
import { type Candidate, type DiscoverySource, DiscoverySourceName } from './candidate.ts';
import { type ContainerSummary, containerCandidate } from './container-apps.ts';

/** The environment kind that is Dockhand's own host. */
const SOCKET_CONNECTION = 'socket';

const environmentSchema = z.object({
  id: z.number(),
  name: z.string(),
  connectionType: z.string().nullish(),
  host: z.string().nullish(),
  publicIp: z.string().nullish(),
});
type Environment = z.output<typeof environmentSchema>;

const portSchema = z.object({
  IP: z.string().optional(),
  PrivatePort: z.number(),
  PublicPort: z.number().optional(),
  Type: z.string(),
});

const containerSchema = z.object({
  name: z.string(),
  image: z.string().default(''),
  labels: z.record(z.string(), z.string()).nullish(),
  ports: z.array(portSchema).nullish(),
});

/** Where Dockhand is and how to ask it. */
export interface DockhandOptions {
  /** Dockhand's address, without a trailing slash. */
  baseUrl: string;
  /** An API token, `dh_…`. Never logged. */
  token: string;
  fetch?: Fetch;
}

/**
 * Picks the address other devices reach an environment's containers by.
 *
 * @param environment - The environment.
 * @param baseUrl - Dockhand's address: a socket environment is Dockhand's own host.
 * @returns Its public address, else its host, else Dockhand's host for a socket environment; null when none is known.
 */
export function environmentAddress(environment: Environment, baseUrl: string): string | null {
  const named = (environment.publicIp ?? '').trim() || (environment.host ?? '').trim();
  if (named !== '') {
    return named;
  }
  return environment.connectionType === SOCKET_CONNECTION ? new URL(baseUrl).hostname : null;
}

/**
 * Builds the Dockhand source.
 *
 * @param options - Where Dockhand is, its token, and a fetch for tests.
 * @param [overrides] - Discovery settings to replace.
 * @returns The source. It is polled; it watches nothing.
 */
export function createDockhandSource(
  options: DockhandOptions,
  overrides: Partial<DiscoverySettings> = {},
): DiscoverySource {
  const { sourceTimeoutSeconds } = { ...DISCOVERY_DEFAULTS, ...overrides };
  const doFetch = options.fetch ?? globalThis.fetch;

  /**
   * Asks Dockhand for some JSON.
   *
   * @param path - The API path, with its query.
   * @returns The parsed body.
   * @throws When Dockhand can't be reached or answers with an error.
   */
  const getJson = async (path: string): Promise<unknown> => {
    const response = await doFetch(`${options.baseUrl}${path}`, {
      headers: { authorization: `Bearer ${options.token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(sourceTimeoutSeconds * MS_PER_SECOND),
    });
    if (response.ok === false) {
      await response.body?.cancel();
      throw new Error(`Dockhand answered ${response.status} to ${path.split('?')[0]}. Check DOCKHAND_TOKEN.`);
    }
    return response.json();
  };

  return {
    name: DiscoverySourceName.Dockhand,
    start: () => {},
    stop: () => {},
    scan: async () => {
      const environments = z.array(environmentSchema).parse(await getJson('/api/environments'));
      const candidates: Candidate[] = [];
      for (const environment of environments) {
        const address = environmentAddress(environment, options.baseUrl);
        if (address === null) {
          continue;
        }
        const listed = z.array(containerSchema).parse(await getJson(`/api/containers?env=${environment.id}&all=false`));
        for (const container of listed) {
          const summary: ContainerSummary = {
            name: container.name,
            image: container.image,
            labels: container.labels ?? {},
            ports: container.ports ?? [],
          };
          const host = { source: DiscoverySourceName.Dockhand, key: environment.name, address };
          const candidate = containerCandidate(summary, host);
          if (candidate !== null) {
            candidates.push(candidate);
          }
        }
      }
      return candidates;
    },
  };
}
