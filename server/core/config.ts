// Getters, not constants, so a test sees the current environment.
import { createRequire } from 'node:module';
import { DATABASE_DEFAULTS, HTTP_DEFAULTS, STORE_DEFAULTS, WIDGET_DEFAULTS } from './defaults.ts';

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
