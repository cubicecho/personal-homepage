// Watches the local network for apps that announce themselves over mDNS (DNS-SD, RFC 6762/6763).
//
// The types browsed (DISCOVERY_DEFAULTS.mdnsTypes) and where each one's web address comes from:
// - `_http._tcp`, `_https._tcp`: the host and port, plus the TXT `path` key (dns-sd.org/txtrecords.html).
//   The `u` and `p` keys (a username and password) are ignored and never kept.
// - `_home-assistant._tcp`: the TXT `internal_url`, else `base_url`
//   (developers.home-assistant.io/docs/api/instance_discovery).
// - `_octoprint._tcp`: the host and port, plus `path`.
// - `_ipp._tcp`, `_ipps._tcp`: the TXT `adminurl`, a printer's own web page (Bonjour Printing Spec §9.2.9).
//   A printer that gives none is not suggested.
//
// Multicast doesn't cross Docker's default bridge network: run the server with host networking for this to
// find anything. Without it, the browser hears nothing, which is not an error.
import { Bonjour } from 'bonjour-service';
import { DISCOVERY_DEFAULTS, type DiscoverySettings } from '../core/defaults.ts';
import { errorMessage } from '../core/errors.ts';
import { MS_PER_SECOND } from '../core/wire.ts';
import { isWebUrl } from '../pages/page-input.ts';
import { type Candidate, type DiscoverySource, DiscoverySourceName, NO_EXPLICIT_DETAILS } from './candidate.ts';

/** One service an mDNS browser has heard of. The fields bonjour-service fills in. */
export interface MdnsService {
  /** The instance's name: "Jellyfin", "Brother HL-L2350DW". */
  name: string;
  /** The type without underscores: "http", "home-assistant". */
  type: string;
  /** The host it is on: "nas.local". */
  host: string;
  port: number;
  /** The full instance name, unique on the network: "Jellyfin._http._tcp.local". */
  fqdn: string;
  txt?: Record<string, unknown> | undefined;
  addresses?: string[] | undefined;
  referer?: { address: string } | undefined;
}

/** A browser for one service type. */
export interface MdnsBrowser {
  readonly services: MdnsService[];
  on(event: 'up' | 'down', listener: (service: MdnsService) => void): unknown;
  /** Asks the network again. */
  update(): void;
  stop(): void;
}

/** What browses: bonjour-service, or a fake in tests. */
export interface MdnsClient {
  find(type: string): MdnsBrowser;
  destroy(): void;
}

/** Opens an mDNS client, reporting socket failures to `onError` instead of throwing. */
export type MdnsClientFactory = (onError: (error: unknown) => void) => MdnsClient;

/** What the mDNS source is given. */
export interface MdnsSourceOptions {
  /** Opens the client: bonjour-service by default. */
  openClient?: MdnsClientFactory;
  /** Where a failure is reported, once: console.warn by default. */
  warn?: (message: string) => void;
}

/** The TXT keys never kept: a username and password some devices announce. */
const SECRET_TXT_KEYS = new Set(['u', 'p']);
/** The suffix of a name only mDNS resolves, which the server may not, inside a container. */
const MDNS_SUFFIX = '.local';
/** How specific each type is, for when one app announces several: the lowest wins. */
const TYPE_RANK: Readonly<Record<string, number>> = Object.freeze({
  'home-assistant': 0,
  octoprint: 0,
  ipp: 1,
  ipps: 1,
  https: 2,
  http: 3,
});
/** The rank of a type not listed above: after every listed one. */
const UNRANKED_TYPE = Object.keys(TYPE_RANK).length;
const DEFAULT_PORTS: Readonly<Record<string, number>> = Object.freeze({ 'http:': 80, 'https:': 443 });

/**
 * Opens bonjour-service.
 *
 * @param onError - Called with a socket failure, such as no multicast on this network.
 * @returns The client.
 */
const openBonjour: MdnsClientFactory = (onError) => {
  const bonjour = new Bonjour({}, onError);
  return {
    find: (type) => {
      const browser = bonjour.find({ type, protocol: 'tcp' });
      return {
        get services() {
          return browser.services;
        },
        on: (event, listener) => browser.on(event, listener),
        update: () => browser.update(),
        stop: () => browser.stop(),
      };
    },
    destroy: () => bonjour.destroy(),
  };
};

/**
 * Reads a TXT value as text.
 *
 * @param txt - The service's TXT keys.
 * @param key - The key.
 * @returns The value, trimmed, or an empty string when it is missing.
 */
function txtValue(txt: Record<string, unknown> | undefined, key: string): string {
  const value = txt?.[key];
  if (typeof value === 'string') {
    return value.trim();
  }
  return Buffer.isBuffer(value) ? value.toString('utf-8').trim() : '';
}

/**
 * Picks an address the server can reach the service at without resolving a `.local` name.
 *
 * @param service - The service.
 * @returns Its first IPv4 address, else any address it gave, else the one it answered from; null when there is none.
 */
function serviceAddress(service: MdnsService): string | null {
  const addresses = service.addresses ?? [];
  const ipv4 = addresses.find((address) => address.includes('.'));
  return ipv4 ?? addresses[0] ?? service.referer?.address ?? null;
}

/**
 * Builds an address from a host, a port and a path.
 *
 * @param scheme - `http` or `https`.
 * @param host - A name or an address; an IPv6 one is bracketed.
 * @param port - The port, left out when it is the scheme's default.
 * @param path - The path, from `/`.
 * @returns The address.
 */
function buildUrl(scheme: string, host: string, port: number, path: string): string {
  const bracketed = host.includes(':') ? `[${host}]` : host;
  const isDefaultPort = DEFAULT_PORTS[`${scheme}:`] === port;
  return `${scheme}://${bracketed}${isDefaultPort ? '' : `:${port}`}${path}`;
}

/**
 * Swaps a `.local` name in an address for the service's address, for the server's own requests.
 *
 * @param url - The address people open.
 * @param address - The service's address, if known.
 * @returns The address to fetch, or null when the original can be fetched as it is.
 */
function probeFor(url: string, address: string | null): string | null {
  const parsed = new URL(url);
  const isMdnsName = parsed.hostname.endsWith(MDNS_SUFFIX);
  if (isMdnsName === false || address === null) {
    return null;
  }
  parsed.hostname = address.includes(':') ? `[${address}]` : address;
  return parsed.href;
}

/**
 * Works out where a service's web page is.
 *
 * @param service - The service.
 * @param host - Its host name, without a trailing dot.
 * @returns The address, or null when the type gives none.
 */
function serviceUrl(service: MdnsService, host: string): string | null {
  const path = txtValue(service.txt, 'path');
  const safePath = path.startsWith('/') ? path : '/';
  switch (service.type) {
    case 'http':
    case 'octoprint':
      return buildUrl('http', host, service.port, safePath);
    case 'https':
      return buildUrl('https', host, service.port, safePath);
    case 'home-assistant': {
      const announced = [txtValue(service.txt, 'internal_url'), txtValue(service.txt, 'base_url')].find(isWebUrl);
      return announced ?? buildUrl('http', host, service.port, '/');
    }
    case 'ipp':
    case 'ipps': {
      const admin = txtValue(service.txt, 'adminurl');
      return isWebUrl(admin) ? admin : null;
    }
    default:
      return null;
  }
}

/**
 * Turns an announced service into an app to suggest.
 *
 * @param service - The service.
 * @returns The candidate, or null when it gives no web page.
 */
export function mdnsCandidate(service: MdnsService): Candidate | null {
  const host = service.host.replace(/\.$/, '');
  const url = serviceUrl(service, host);
  if (url === null || isWebUrl(url) === false) {
    return null;
  }
  const address = serviceAddress(service);
  const txt = Object.fromEntries(
    Object.keys(service.txt ?? {})
      .filter((key) => SECRET_TXT_KEYS.has(key) === false)
      .map((key) => [key, txtValue(service.txt, key)]),
  );
  return {
    source: DiscoverySourceName.Mdns,
    sourceKey: `mdns:${service.fqdn}`,
    url,
    probeUrl: probeFor(url, address),
    fallbackName: service.name,
    explicit: NO_EXPLICIT_DETAILS,
    metadata: { type: service.type, host, port: service.port, addresses: service.addresses ?? [], txt },
  };
}

/**
 * Keeps the most specific of the services that point at the same page, such as OctoPrint's own type over its
 * plain `_http._tcp`.
 *
 * @param services - The services heard of.
 * @returns One candidate per address.
 */
export function mdnsCandidates(services: readonly MdnsService[]): Candidate[] {
  const rank = (service: MdnsService): number => TYPE_RANK[service.type] ?? UNRANKED_TYPE;
  const ranked = [...services].sort((a, b) => rank(a) - rank(b));
  const byUrl = new Map<string, Candidate>();
  for (const service of ranked) {
    const candidate = mdnsCandidate(service);
    const isNewPage = candidate !== null && byUrl.has(candidate.url) === false;
    if (isNewPage) {
      byUrl.set(candidate.url, candidate);
    }
  }
  return [...byUrl.values()];
}

/**
 * Builds the mDNS source.
 *
 * @param [options] - The client to browse with and where to warn, for tests.
 * @param [overrides] - Discovery settings to replace.
 * @returns The source. It watches from `start` until `stop`.
 */
export function createMdnsSource(
  options: MdnsSourceOptions = {},
  overrides: Partial<DiscoverySettings> = {},
): DiscoverySource {
  const { mdnsTypes, mdnsSettleSeconds } = { ...DISCOVERY_DEFAULTS, ...overrides };
  const openClient = options.openClient ?? openBonjour;
  const warn = options.warn ?? ((message: string) => console.warn(message));
  let client: MdnsClient | null = null;
  let browsers: MdnsBrowser[] = [];
  let hasWarned = false;

  /**
   * Reports a failure once: a network without multicast fails the same way on every packet.
   *
   * @param error - What failed.
   */
  const reportOnce = (error: unknown): void => {
    if (hasWarned) {
      return;
    }
    hasWarned = true;
    warn(
      `[discovery] mDNS: ${errorMessage(error)}. Nothing will be found over mDNS; run with host networking to fix it.`,
    );
  };

  return {
    name: DiscoverySourceName.Mdns,
    start: (onChange) => {
      try {
        client = openClient(reportOnce);
        const opened = client;
        browsers = mdnsTypes.map((type) => {
          const browser = opened.find(type);
          browser.on('up', () => onChange());
          browser.on('down', () => onChange());
          return browser;
        });
      } catch (error) {
        reportOnce(error);
        client = null;
        browsers = [];
      }
    },
    scan: async () => {
      if (browsers.length === 0) {
        return [];
      }
      for (const browser of browsers) {
        browser.update();
      }
      await new Promise((resolve) => setTimeout(resolve, mdnsSettleSeconds * MS_PER_SECOND));
      return mdnsCandidates(browsers.flatMap((browser) => browser.services));
    },
    stop: () => {
      for (const browser of browsers) {
        browser.stop();
      }
      browsers = [];
      client?.destroy();
      client = null;
    },
  };
}
