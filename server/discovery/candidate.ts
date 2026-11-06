// What every discovery source reports, and the contract a source keeps. A source only says what it
// sees; describing an app (its page and web manifest) and keeping it are the service's job.
import type { IconRef } from '../pages/page.ts';

/** Where an app was found. */
export const DiscoverySourceName = {
  /** Announced on the local network over mDNS (DNS-SD). */
  Mdns: 'MDNS',
  /** A container Dockhand manages, on any of its hosts. */
  Dockhand: 'DOCKHAND',
  /** A container on this host's Docker, read from its socket. */
  Docker: 'DOCKER',
} as const;
export type DiscoverySourceName = (typeof DiscoverySourceName)[keyof typeof DiscoverySourceName];

/** What a source chose to say about an app itself, such as Homepage-style container labels. It wins over the page. */
export interface ExplicitDetails {
  name: string | null;
  description: string | null;
  icon: IconRef | null;
}

/** One app a source sees. */
export interface Candidate {
  source: DiscoverySourceName;
  /** What the source calls it, the same on every sighting: the mDNS instance, or the host and container name. */
  sourceKey: string;
  /** The address people open it at. */
  url: string;
  /**
   * The address the server fetches to describe it, when `url` names a host the server may not resolve
   * itself, such as a `.local` name inside a container. Null fetches `url`.
   */
  probeUrl: string | null;
  /** What the source calls it, used when neither the labels nor the page say better. */
  fallbackName: string;
  /**
   * Other names the app goes by, most telling first, for finding its icon in a catalogue: a container's
   * name and its image's names, or an app's own mDNS service type. Never shown.
   */
  nameHints: string[];
  explicit: ExplicitDetails;
  /** What the source said, kept for working out why an app looks as it does. Never a password. */
  metadata: Record<string, unknown>;
}

/** A place apps are found. */
export interface DiscoverySource {
  name: DiscoverySourceName;
  /**
   * Starts watching, for a source that hears of apps as they appear.
   *
   * @param onChange - Called when something may have appeared or gone, so the service scans this source.
   */
  start(onChange: () => void): void;
  /**
   * Lists what the source sees now.
   *
   * @returns The apps.
   * @throws When the source can't be asked; the service records it as the source's error.
   */
  scan(): Promise<Candidate[]>;
  /** Stops watching and lets go of sockets. */
  stop(): void;
}

/** No details of an app's own. */
export const NO_EXPLICIT_DETAILS: Readonly<ExplicitDetails> = Object.freeze({
  name: null,
  description: null,
  icon: null,
});
