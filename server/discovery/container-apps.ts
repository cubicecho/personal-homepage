// Turns a running container into an app to suggest. Dockhand and the Docker socket both report containers
// in the Docker API's shape (names, labels, `Ports` with `PrivatePort`/`PublicPort`), so both use this.
//
// A container is suggested when it publishes a TCP port on an address other devices can reach, or says
// where it is with a Homepage-style `homepage.href` label. Homepage's labels, where present, also name it,
// describe it and pick its icon (https://gethomepage.dev/configs/docker/); OCI image labels are the
// fallback for the name and description. `homepage.hide=true` and Dockhand's `dockhand.hidden=true` keep a
// container out.
import { DISCOVERY_DEFAULTS } from '../core/defaults.ts';
import type { IconRef } from '../pages/page.ts';
import { isIconRef, isWebUrl } from '../pages/page-input.ts';
import type { Candidate, DiscoverySourceName } from './candidate.ts';

const { webPorts, httpsPorts } = DISCOVERY_DEFAULTS;

/** A published port, as the Docker API lists it. */
export interface ContainerPort {
  /** The address it is published on; a loopback one can't be reached from other devices. */
  IP?: string | undefined;
  PrivatePort: number;
  PublicPort?: number | undefined;
  Type: string;
}

/** A container, in the shape both Dockhand and the Docker API report. */
export interface ContainerSummary {
  name: string;
  image: string;
  labels: Record<string, string>;
  ports: ContainerPort[];
}

/** Where a container runs, for its address and its key. */
export interface ContainerHost {
  source: DiscoverySourceName;
  /** What tells this host apart from the source's others: Dockhand's environment name, or `local`. */
  key: string;
  /** The name or address other devices reach the host by. */
  address: string;
}

/** The value of a label that turns it on. */
const LABEL_TRUE = 'true';
/** Addresses a port published on can't be reached from another device. */
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', 'localhost']);
/** Homepage icon prefixes that name a set this app doesn't draw. */
const UNSUPPORTED_ICON_PREFIXES = ['mdi-', 'si-'];
/** Homepage's prefix for a selfh.st icon. */
const SELFHST_PREFIX = 'sh-';
/** A file extension at the end of an icon name, which Homepage allows. */
const ICON_EXTENSION = /\.(png|svg|webp)$/i;
const TCP = 'tcp';

/**
 * Reads a Homepage-style icon label as an icon reference.
 *
 * @param value - The label, such as `jellyfin.png`, `sh-jellyfin` or an image address.
 * @returns The reference (`di:jellyfin`, `sh:jellyfin`, or the address), or null for a set this app doesn't draw.
 */
export function iconFromLabel(value: string | undefined): IconRef | null {
  const label = (value ?? '').trim();
  if (label === '') {
    return null;
  }
  if (isWebUrl(label)) {
    return label;
  }
  const isUnsupported = UNSUPPORTED_ICON_PREFIXES.some((prefix) => label.startsWith(prefix));
  if (isUnsupported) {
    return null;
  }
  const name = label.replace(ICON_EXTENSION, '').toLowerCase();
  const icon = name.startsWith(SELFHST_PREFIX) ? `sh:${name.slice(SELFHST_PREFIX.length)}` : `di:${name}`;
  return isIconRef(icon, false) ? icon : null;
}

/**
 * Picks the port a container's web interface is most likely on.
 *
 * @param ports - Its published ports.
 * @returns The TCP port published on a reachable address, preferring the usual web ports; null when there is none.
 */
export function webPort(ports: readonly ContainerPort[]): ContainerPort | null {
  const reachable = ports.filter((port) => {
    const isPublished = port.PublicPort !== undefined && port.PublicPort > 0;
    const isLoopback = LOOPBACK_ADDRESSES.has(port.IP ?? '');
    return port.Type === TCP && isPublished && isLoopback === false;
  });
  const rank = (port: ContainerPort): number => {
    const index = webPorts.indexOf(port.PrivatePort);
    return index === -1 ? webPorts.length + port.PrivatePort : index;
  };
  const [best] = [...reachable].sort((a, b) => rank(a) - rank(b));
  return best ?? null;
}

/**
 * Works out where a container's web interface is.
 *
 * @param href - Its `homepage.href` label, if any.
 * @param port - Its web port, if any.
 * @param address - The name or address its host is reached by.
 * @returns The label's address when it is one, else the host and published port; null when there is neither.
 */
function containerUrl(href: string | undefined, port: ContainerPort | null, address: string): string | null {
  const labelled = (href ?? '').trim();
  if (isWebUrl(labelled)) {
    return labelled;
  }
  if (port === null) {
    return null;
  }
  const scheme = httpsPorts.includes(port.PrivatePort) ? 'https' : 'http';
  return `${scheme}://${address}:${port.PublicPort}/`;
}

/**
 * Turns a container into an app to suggest.
 *
 * @param container - The container.
 * @param host - Where it runs.
 * @returns The candidate, or null when it is hidden or has no address other devices could open.
 */
export function containerCandidate(container: ContainerSummary, host: ContainerHost): Candidate | null {
  const { labels } = container;
  const isHidden = labels['homepage.hide'] === LABEL_TRUE || labels['dockhand.hidden'] === LABEL_TRUE;
  if (isHidden) {
    return null;
  }
  const port = webPort(container.ports);
  const url = containerUrl(labels['homepage.href'], port, host.address);
  if (url === null) {
    return null;
  }
  const label = (key: string): string | null => {
    const value = (labels[key] ?? '').trim();
    return value === '' ? null : value;
  };
  return {
    source: host.source,
    sourceKey: `${host.source.toLowerCase()}:${host.key}:${container.name}`,
    url,
    probeUrl: null,
    fallbackName: container.name,
    explicit: {
      name: label('homepage.name') ?? label('org.opencontainers.image.title'),
      description: label('homepage.description') ?? label('org.opencontainers.image.description'),
      icon: iconFromLabel(labels['homepage.icon']),
    },
    metadata: {
      host: host.key,
      container: container.name,
      image: container.image,
      port: port === null ? null : { container: port.PrivatePort, published: port.PublicPort ?? null },
    },
  };
}
