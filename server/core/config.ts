// Getters, not constants, so a test sees the current environment.
import { createRequire } from 'node:module';
import { AUTH_DEFAULTS, DATABASE_DEFAULTS, HTTP_DEFAULTS, STORE_DEFAULTS, WIDGET_DEFAULTS } from './defaults.ts';

const NODE_ENV_PRODUCTION = 'production';
/** The TRUST_PROXY value that trusts no hop. */
const TRUST_PROXY_OFF = 'false';
/** A hop count: digits only. */
const HOP_COUNT = /^\d+$/;
const UNKNOWN_VERSION = 'unknown';

/**
 * Reads a positive number.
 *
 * @param value - The raw env value.
 * @param fallback - Used when the value is unset, not a number, or not above zero.
 * @returns The number.
 */
function envNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  const isUsable = Number.isFinite(parsed) && parsed > 0;
  return isUsable ? parsed : fallback;
}

/**
 * The port to listen on.
 *
 * @returns `PORT`, or `HTTP_DEFAULTS.port`.
 */
export const port = (): number => envNumber(process.env.PORT, HTTP_DEFAULTS.port);

/**
 * Whether this is a production run. GraphiQL is off and the built web app is served.
 *
 * @returns True when `NODE_ENV` is "production".
 */
export const isProduction = (): boolean => process.env.NODE_ENV === NODE_ENV_PRODUCTION;

/** What DATABASE_URL must look like when it is set: a Postgres connection URL. */
export const POSTGRES_URL = /^postgres(ql)?:\/\//;

/**
 * The Postgres server to keep pages in.
 *
 * @returns `DATABASE_URL`, trimmed; an empty string when unset, which means the built-in database under DATA_DIR.
 */
export const databaseUrl = (): string => (process.env.DATABASE_URL ?? '').trim();

/**
 * Checks a DATABASE_URL before anything connects with it.
 *
 * @param url - The value, trimmed.
 * @returns What is wrong with it, as a sentence that says how to fix it; null when it is empty or a postgres:// URL.
 */
export function databaseUrlProblem(url: string): string | null {
  const isUsable = url === '' || (POSTGRES_URL.test(url) && URL.canParse(url) && new URL(url).host !== '');
  if (isUsable) {
    return null;
  }
  return `DATABASE_URL must be a postgres:// URL, such as postgres://homepage:secret@postgres:5432/homepage. Leave it unset to keep pages in the built-in database under DATA_DIR.`;
}

/**
 * How long boot waits for Postgres before exiting.
 *
 * @returns `DB_CONNECT_TIMEOUT_MS`, or `DATABASE_DEFAULTS.connectTimeoutMs`, in milliseconds.
 */
export const dbConnectTimeoutMs = (): number =>
  envNumber(process.env.DB_CONNECT_TIMEOUT_MS, DATABASE_DEFAULTS.connectTimeoutMs);

/**
 * The directory the server writes to: the built-in database and the icon caches.
 *
 * @returns `DATA_DIR`, or `STORE_DEFAULTS.dataDir` when unset or blank.
 */
export const dataDir = (): string => {
  const raw = (process.env.DATA_DIR ?? '').trim();
  return raw === '' ? STORE_DEFAULTS.dataDir : raw;
};

/**
 * The Open-Meteo forecast endpoint weather widgets ask.
 *
 * @returns `WEATHER_API_URL`, for a self-hosted Open-Meteo, or `WIDGET_DEFAULTS.weatherApiUrl` when unset or blank.
 */
export const weatherApiUrl = (): string => {
  const raw = (process.env.WEATHER_API_URL ?? '').trim();
  return raw === '' ? WIDGET_DEFAULTS.weatherApiUrl : raw;
};

/** The value that turns a switch off. */
const SWITCH_OFF = 'false';
/** The Docker socket read when `DOCKER_SOCKET` is unset. */
export const DEFAULT_DOCKER_SOCKET = '/var/run/docker.sock';
/** The only schemes DOCKHAND_URL may use. */
const WEB_PROTOCOLS = ['http:', 'https:'];

/**
 * Whether the server watches mDNS for apps.
 *
 * @returns False only when `DISCOVERY_MDNS` is "false".
 */
export const discoveryMdns = (): boolean => (process.env.DISCOVERY_MDNS ?? '').trim().toLowerCase() !== SWITCH_OFF;

/**
 * Where Dockhand is, to ask it for containers.
 *
 * @returns `DOCKHAND_URL` without a trailing slash, or an empty string when unset.
 */
export const dockhandUrl = (): string => (process.env.DOCKHAND_URL ?? '').trim().replace(/\/+$/, '');

/**
 * The API token Dockhand is asked with.
 *
 * @returns `DOCKHAND_TOKEN`, or an empty string when unset.
 */
export const dockhandToken = (): string => (process.env.DOCKHAND_TOKEN ?? '').trim();

/**
 * The Docker socket to read containers from.
 *
 * @returns `DOCKER_SOCKET`, or an empty string when unset, in which case the usual path is tried.
 */
export const dockerSocket = (): string => (process.env.DOCKER_SOCKET ?? '').trim();

/**
 * The name other devices reach this Docker host by, for the addresses of its containers.
 *
 * @returns `DISCOVERY_DOCKER_HOST`, or an empty string when unset.
 */
export const discoveryDockerHost = (): string => (process.env.DISCOVERY_DOCKER_HOST ?? '').trim();

/**
 * Checks the Dockhand settings before anything asks it.
 *
 * @param url - `DOCKHAND_URL`.
 * @param token - `DOCKHAND_TOKEN`.
 * @returns What is wrong, as a sentence that says how to fix it; null when they are usable or both unset.
 */
export function dockhandProblem(url: string, token: string): string | null {
  const isUnset = url === '' && token === '';
  if (isUnset) {
    return null;
  }
  const isHalfSet = url === '' || token === '';
  if (isHalfSet) {
    return 'Set both DOCKHAND_URL and DOCKHAND_TOKEN to find containers through Dockhand, or neither.';
  }
  const isWebUrl = URL.canParse(url) && WEB_PROTOCOLS.includes(new URL(url).protocol);
  if (isWebUrl === false) {
    return `DOCKHAND_URL is "${url}". Use Dockhand's address, for example http://dockhand.lan:3000.`;
  }
  return null;
}

/**
 * Express `trust proxy`: which hops may set X-Forwarded-For.
 *
 * @returns `HTTP_DEFAULTS.trustProxy` when `TRUST_PROXY` is unset, false for "false", a hop count for digits, otherwise the value as given.
 */
export const trustProxy = (): boolean | number | string => {
  const raw = (process.env.TRUST_PROXY ?? '').trim();
  if (raw === '') {
    return HTTP_DEFAULTS.trustProxy;
  }
  if (raw === TRUST_PROXY_OFF) {
    return false;
  }
  const isHopCount = HOP_COUNT.test(raw);
  return isHopCount ? Number(raw) : raw;
};

/**
 * Reads an environment variable, trimmed.
 *
 * @param name - The variable.
 * @returns Its value, or an empty string when it is unset.
 */
function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

/**
 * Splits a comma-separated list.
 *
 * @param raw - The value.
 * @returns Its entries, trimmed, without blanks.
 */
function commaList(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/** What signs sessions when `BETTER_AUTH_SECRET` is unset. Preflight refuses it in production. */
export const DEV_SECRET = 'dev-secret-change-this-before-production';
/** The value `.env.example` ships. Public, so as good as no secret at all. */
export const PLACEHOLDER_SECRET = 'change-me-to-a-long-random-string';

/**
 * Says why a secret must not sign production sessions.
 *
 * @param secret - `BETTER_AUTH_SECRET` as set.
 * @returns The reason, as the end of a sentence ("is not set"), or undefined when it may.
 */
export function describeWeakSecret(secret: string | undefined): string | undefined {
  if (secret === undefined || secret === '') {
    return 'is not set';
  }
  if (secret === DEV_SECRET || secret === PLACEHOLDER_SECRET) {
    return 'is a published default';
  }
  if (secret.length < AUTH_DEFAULTS.minSecretLength) {
    return `is shorter than ${AUTH_DEFAULTS.minSecretLength} characters`;
  }
  return undefined;
}

/**
 * The secret as configured, for preflight to judge.
 *
 * @returns `BETTER_AUTH_SECRET`, or undefined when unset.
 */
export const configuredAuthSecret = (): string | undefined => process.env.BETTER_AUTH_SECRET;

/**
 * What better-auth signs with.
 *
 * @returns `BETTER_AUTH_SECRET`, or `DEV_SECRET` when unset, so development needs no .env entry.
 */
export const authSecret = (): string => configuredAuthSecret() || DEV_SECRET;

/**
 * Where people open the homepage: where the OIDC sign-in sends the browser back to.
 *
 * @returns `APP_URL` without a trailing slash, or this server's own localhost address.
 */
export const appUrl = (): string => env('APP_URL').replace(/\/+$/, '') || `http://localhost:${port()}`;

/**
 * Where a browser reaches this server: where the OIDC sign-in's start and callback live. The same as
 * `APP_URL` unless the app is served from somewhere else.
 *
 * @returns `SERVER_URL` without a trailing slash, or `appUrl()`.
 */
export const serverUrl = (): string => env('SERVER_URL').replace(/\/+$/, '') || appUrl();

/** The id the OIDC provider is registered under in better-auth, and so the last part of its callback path. */
export const OIDC_PROVIDER_ID = 'oidc';
/** The `OIDC_CLIENT_AUTH` values a provider can expect. */
export const OIDC_CLIENT_AUTH_METHODS = ['client_secret_basic', 'client_secret_post'] as const;

/** An OIDC provider to sign in with: the environment's, or a pairing's. */
export interface OidcConfig {
  issuer: string;
  clientId: string;
  /** Absent for a public client. */
  clientSecret?: string | undefined;
  clientAuth: (typeof OIDC_CLIENT_AUTH_METHODS)[number];
  /** What the sign-in button calls it. */
  name: string;
}

/**
 * Reads the OIDC provider set in the environment. Preflight refuses one of `OIDC_ISSUER` and
 * `OIDC_CLIENT_ID` without the other, and an `OIDC_CLIENT_AUTH` it does not know.
 *
 * @returns The provider when `OIDC_ISSUER` and `OIDC_CLIENT_ID` are both set, otherwise null.
 */
export function oidcConfig(): OidcConfig | null {
  const issuer = env('OIDC_ISSUER').replace(/\/+$/, '');
  const clientId = env('OIDC_CLIENT_ID');
  const isComplete = issuer !== '' && clientId !== '';
  if (isComplete === false) {
    return null;
  }
  const clientAuth = env('OIDC_CLIENT_AUTH');
  const isPost = clientAuth === 'client_secret_post';
  return {
    issuer,
    clientId,
    clientSecret: env('OIDC_CLIENT_SECRET') || undefined,
    clientAuth: isPost ? 'client_secret_post' : AUTH_DEFAULTS.oidcClientAuth,
    name: env('OIDC_NAME') || AUTH_DEFAULTS.oidcName,
  };
}

/**
 * Names the address to register with an OIDC provider as this client's redirect URI.
 *
 * @returns better-auth's callback for the provider, under `serverUrl()`.
 */
export const oidcRedirectUri = (): string => `${serverUrl()}/api/auth/callback/${OIDC_PROVIDER_ID}`;

/**
 * The ID token claim groups are read from.
 *
 * @returns `OIDC_GROUPS_CLAIM`, or `AUTH_DEFAULTS.oidcGroupsClaim`.
 */
export const oidcGroupsClaim = (): string => env('OIDC_GROUPS_CLAIM') || AUTH_DEFAULTS.oidcGroupsClaim;

/**
 * The proxies whose Remote-User, Remote-Groups and friends are believed, as written.
 *
 * @returns The addresses and CIDR ranges in `FORWARD_AUTH_TRUSTED_PROXIES`; empty when forward auth is off.
 */
export const forwardAuthTrustedProxies = (): string[] => commaList(env('FORWARD_AUTH_TRUSTED_PROXIES'));

/**
 * The groups whose members may edit, besides the admin.
 *
 * @returns The names in `ADMIN_GROUPS`.
 */
export const adminGroups = (): string[] => commaList(env('ADMIN_GROUPS'));

/**
 * Whether people who are not signed in may see the pages (but not edit them) once sign-in is set up.
 *
 * @returns True when `PUBLIC_VIEW` is "true".
 */
export const publicView = (): boolean => env('PUBLIC_VIEW') === 'true';

/**
 * Reads the version from package.json, which the Dockerfile copies.
 *
 * @returns The released version, or "unknown".
 */
function readVersion(): string {
  try {
    const manifest: { version?: string } = createRequire(import.meta.url)('../../package.json');
    return manifest.version || UNKNOWN_VERSION;
  } catch {
    return UNKNOWN_VERSION;
  }
}

/** Stamped into the build, not configured. */
const VERSION = readVersion();

/**
 * The version this build was released as.
 *
 * @returns The released version, or "unknown".
 */
export const version = (): string => VERSION;
