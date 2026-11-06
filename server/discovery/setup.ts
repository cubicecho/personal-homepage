// Builds discovery from the environment: which sources are set up, and for those that aren't, a line on
// how to set them up that the Discovered apps page shows.
import { accessSync, constants } from 'node:fs';
import { hostname } from 'node:os';
import {
  DEFAULT_DOCKER_SOCKET,
  discoveryDockerHost,
  discoveryMdns,
  dockerSocket,
  dockhandToken,
  dockhandUrl,
} from '../core/config.ts';
import type { Database } from '../db/client.ts';
import { type DiscoverySource, DiscoverySourceName } from './candidate.ts';
import { createDescriber } from './describe.ts';
import { createDockerSocketSource } from './docker-socket.ts';
import { createDockhandSource } from './dockhand.ts';
import { createMdnsSource } from './mdns.ts';
import { createDiscoveryService, type DisabledSource, type DiscoveryService } from './service.ts';
import { createDiscoveryStore } from './store.ts';

/**
 * Checks whether a socket can be read and written.
 *
 * @param path - The socket.
 * @returns True when this process may use it.
 */
function canUseSocket(path: string): boolean {
  try {
    accessSync(path, constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds discovery with the sources the environment sets up.
 *
 * @param db - The database, migrated.
 * @returns The service, not yet started.
 */
export function createConfiguredDiscovery(db: Database): DiscoveryService {
  const sources: DiscoverySource[] = [];
  const disabled: DisabledSource[] = [];

  if (discoveryMdns()) {
    sources.push(createMdnsSource());
  } else {
    disabled.push({
      source: DiscoverySourceName.Mdns,
      setupHint:
        'Turned off with DISCOVERY_MDNS=false. Remove it, and run with host networking, to find apps that announce themselves.',
    });
  }

  const url = dockhandUrl();
  const token = dockhandToken();
  if (url !== '' && token !== '') {
    sources.push(createDockhandSource({ baseUrl: url, token }));
  } else {
    disabled.push({
      source: DiscoverySourceName.Dockhand,
      setupHint:
        'Set DOCKHAND_URL and DOCKHAND_TOKEN (an API token from Dockhand) to find containers on every host Dockhand manages.',
    });
  }

  const socketPath = dockerSocket() || DEFAULT_DOCKER_SOCKET;
  if (canUseSocket(socketPath)) {
    // Inside a container with host networking, the host name is the Docker host's own.
    sources.push(createDockerSocketSource({ socketPath, hostAddress: discoveryDockerHost() || hostname() }));
  } else {
    disabled.push({
      source: DiscoverySourceName.Docker,
      setupHint: `Mount the Docker socket read-only at ${socketPath} (or set DOCKER_SOCKET), and set DISCOVERY_DOCKER_HOST to the name other devices reach this host by.`,
    });
  }

  return createDiscoveryService({
    store: createDiscoveryStore(db),
    describer: createDescriber(),
    sources,
    disabled,
  });
}
