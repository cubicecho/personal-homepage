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
//
// Anything that isn't one of those JSON answers is an error worded for the Discovered apps page: Dockhand
// sends a browser to /login for any path that isn't its API, and a name that resolves to loopback inside
// this container (`framework.lan` → 127.0.1.1) reaches this homepage's own page instead of Dockhand.
// Messages name the address asked, never the token.
import { z } from 'zod';
import { DISCOVERY_DEFAULTS, type DiscoverySettings } from '../core/defaults.ts';
import { errorMessage } from '../core/errors.ts';
import { HttpStatus, MS_PER_SECOND } from '../core/wire.ts';
import { type Fetch, readCapped } from '../icons/fetching.ts';
import { type Candidate, type DiscoverySource, DiscoverySourceName } from './candidate.ts';
import { type ContainerSummary, containerCandidate } from './container-apps.ts';

/** The environment kind that is Dockhand's own host. */
const SOCKET_CONNECTION = 'socket';
/** How much of a page that isn't JSON is read to say what it was. */
const PAGE_PEEK_BYTES = 262_144;
/** What this homepage's own index.html has and Dockhand's pages don't: the element the web app mounts in. */
const OWN_INDEX_MARKER = '<div id="root"></div>';
/** An example of the address DOCKHAND_URL wants. */
const DOCKHAND_URL_EXAMPLE = 'http://dockhand.lan:3000';
/** HTTP statuses Dockhand refuses a token with. */
const REFUSED_STATUSES: readonly number[] = [HttpStatus.Unauthorized, HttpStatus.Forbidden];
/** The lowest HTTP redirect status. */
const REDIRECT_MIN = 300;
/** The highest HTTP redirect status. */
const REDIRECT_MAX = 399;
/** Low-level network error codes, as Node's fetch puts them on `error.cause.code`. */
const NetworkCode = { Refused: 'ECONNREFUSED', NotFound: 'ENOTFOUND', NameRetry: 'EAI_AGAIN' } as const;

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
 * Writes an address for a message: no query, and no user name or password if the URL carried one.
 *
 * @param url - The address asked.
 * @returns It, safe to show.
 */
function shownAddress(url: string): string {
  const parsed = new URL(url);
  parsed.username = '';
  parsed.password = '';
  parsed.search = '';
  return parsed.toString();
}

/**
 * Explains why a request never got an answer.
 *
 * @param shown - The address asked.
 * @param error - What fetch threw.
 * @param timeoutSeconds - How long it waited.
 * @returns A sentence naming the address and the cause.
 */
function unreachableMessage(shown: string, error: unknown, timeoutSeconds: number): string {
  const { host, hostname } = new URL(shown);
  const isTimeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
  if (isTimeout) {
    return `Dockhand didn't answer ${shown} within ${timeoutSeconds} seconds.`;
  }
  const cause = error instanceof Error ? error.cause : undefined;
  const code = cause instanceof Error && 'code' in cause ? String(cause.code) : '';
  if (code === NetworkCode.Refused) {
    return `Nothing is listening at ${host} (connection refused). Check that Dockhand is running and DOCKHAND_URL is right.`;
  }
  const isUnknownName = code === NetworkCode.NotFound || code === NetworkCode.NameRetry;
  if (isUnknownName) {
    return `${hostname} doesn't resolve from this server. Use Dockhand's IP address in DOCKHAND_URL, or a name this container can look up.`;
  }
  return `Couldn't reach Dockhand at ${shown}: ${errorMessage(cause ?? error)}.`;
}

/**
 * Explains an answer that isn't JSON, telling this homepage's own page apart from any other.
 *
 * @param response - The answer, whose body is read here.
 * @param shown - The address asked.
 * @returns A sentence saying what came back and what to change.
 */
async function notJsonMessage(response: Response, shown: string): Promise<string> {
  const body = await readCapped(response, PAGE_PEEK_BYTES);
  const text = body === null ? '' : new TextDecoder().decode(body);
  const { hostname } = new URL(shown);
  if (text.includes(OWN_INDEX_MARKER)) {
    return `${shown} answered with this homepage's own page, not Dockhand's API: inside this container, ${hostname} points back at the homepage itself. Use Dockhand's IP address in DOCKHAND_URL, or add "${hostname}:host-gateway" to the homepage's extra_hosts.`;
  }
  return `${shown} answered with a web page, not Dockhand's API. DOCKHAND_URL must be Dockhand's base address, for example ${DOCKHAND_URL_EXAMPLE}.`;
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
   * @throws With a sentence saying what went wrong and what to change, when Dockhand can't be reached,
   * refuses the token, redirects, or answers with anything but JSON.
   */
  const getJson = async (path: string): Promise<unknown> => {
    const url = `${options.baseUrl}${path}`;
    const shown = shownAddress(url);
    let response: Response;
    try {
      response = await doFetch(url, {
        headers: { authorization: `Bearer ${options.token}`, accept: 'application/json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(sourceTimeoutSeconds * MS_PER_SECOND),
      });
    } catch (error) {
      throw new Error(unreachableMessage(shown, error, sourceTimeoutSeconds));
    }
    const isRedirect = response.status >= REDIRECT_MIN && response.status <= REDIRECT_MAX;
    if (isRedirect) {
      await response.body?.cancel();
      const location = response.headers.get('location') ?? 'another page';
      throw new Error(
        `Dockhand redirected ${shown} to ${location}. DOCKHAND_URL must be Dockhand's base address, for example ${DOCKHAND_URL_EXAMPLE}.`,
      );
    }
    if (REFUSED_STATUSES.includes(response.status)) {
      await response.body?.cancel();
      throw new Error(`Dockhand answered ${response.status} to ${shown}. Check DOCKHAND_TOKEN.`);
    }
    const isJson = (response.headers.get('content-type') ?? '').includes('json');
    if (response.ok === false) {
      await response.body?.cancel();
      const what = isJson ? '' : ' with a web page';
      throw new Error(`Dockhand answered ${response.status}${what} to ${shown}.`);
    }
    if (isJson === false) {
      throw new Error(await notJsonMessage(response, shown));
    }
    try {
      return await response.json();
    } catch {
      throw new Error(`${shown} said it was sending JSON, but what came back isn't. Is DOCKHAND_URL Dockhand?`);
    }
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
