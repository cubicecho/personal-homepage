import type { SiteUrls } from '../core/config.ts';
import { AUTH_DEFAULTS } from '../core/defaults.ts';
import { HttpStatus } from '../core/wire.ts';
import type { Database } from '../db/client.ts';
import { clearPairedOidc, type PairedOidc, readPairedOidc, savePairedOidc, updatePairedOidc } from './settings.ts';

// Pairing with an OIDC provider by pasting one URL, instead of copying a client id and secret into the
// environment. The provider (heautou, or any other that does OAuth 2.0 Dynamic Client Registration)
// hands its admin a setup URL:
//
//   <issuer>#setup=<initial access token>&name=<what to call it>
//
// The homepage reads the issuer's discovery document, registers itself at its registration endpoint
// with the token (RFC 7591), and keeps the client it gets back. Unpairing deletes that client at the
// provider (RFC 7592). The token is a credential: it is sent once, to the endpoint the issuer names, and
// never logged or stored.

/** Why pairing failed, for the app to say what to do next. Sent as `extensions.reason`. */
export const PairingFailure = {
  /** The text is not a setup URL. */
  BadUrl: 'BAD_URL',
  /** Nothing at the URL answers as an OIDC provider, or it names a different issuer. */
  NotAProvider: 'NOT_A_PROVIDER',
  /** The provider has no registration endpoint. */
  NoRegistration: 'NO_REGISTRATION',
  /** The setup URL has expired, was used already, or was cancelled. */
  Expired: 'EXPIRED',
  /** The provider would not register the homepage as described. */
  Refused: 'REFUSED',
  /** The provider is turning requests away for now. */
  RateLimited: 'RATE_LIMITED',
  /** The callback would be a localhost address that the browser pairing could never come back to. */
  BadAppUrl: 'BAD_APP_URL',
} as const;
/** One of the values in `PairingFailure`. */
export type PairingFailure = (typeof PairingFailure)[keyof typeof PairingFailure];

/** A pairing that did not happen, and why. */
export class PairingError extends Error {
  readonly reason: PairingFailure;

  /**
   * Makes the error.
   *
   * @param reason - Why, for the app.
   * @param message - What to tell the person pairing.
   */
  constructor(reason: PairingFailure, message: string) {
    super(message);
    this.name = 'PairingError';
    this.reason = reason;
  }
}

/** A setup URL, taken apart. */
export interface SetupUrl {
  issuer: string;
  token: string;
  name: string;
}

/** What the homepage asks the provider to call it. */
const CLIENT_NAME = 'Homepage';

/**
 * Takes a setup URL apart.
 *
 * @param text - What was pasted.
 * @returns The issuer, the initial access token and the provider's name.
 * @throws A `PairingError` (BAD_URL) when it is not a setup URL.
 */
export function parseSetupUrl(text: string): SetupUrl {
  const trimmed = text.trim();
  if (URL.canParse(trimmed) === false) {
    throw new PairingError(PairingFailure.BadUrl, 'That is not a URL. Paste the setup URL your provider gave you.');
  }
  const url = new URL(trimmed);
  const isWeb = url.protocol === 'https:' || url.protocol === 'http:';
  if (isWeb === false) {
    throw new PairingError(PairingFailure.BadUrl, 'A setup URL starts with https://.');
  }
  const params = new URLSearchParams(url.hash.slice(1));
  const token = params.get('setup') ?? '';
  if (token === '') {
    throw new PairingError(
      PairingFailure.BadUrl,
      'That URL has no setup token. Copy the whole setup URL from your provider.',
    );
  }
  url.hash = '';
  url.search = '';
  return {
    issuer: url.toString().replace(/\/+$/, ''),
    token,
    name: params.get('name')?.trim() || AUTH_DEFAULTS.oidcName,
  };
}

/**
 * Fetches with a timeout, calling any network failure the provider being unreachable.
 *
 * @param url - Where to send it.
 * @param [init] - The request.
 * @returns The response.
 * @throws A `PairingError` (NOT_A_PROVIDER) when nothing answered.
 */
async function call(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(AUTH_DEFAULTS.oidcPairingTimeoutMs) });
  } catch {
    throw new PairingError(PairingFailure.NotAProvider, `Could not reach ${new URL(url).origin}. Check the setup URL.`);
  }
}

/**
 * Reads a JSON object body.
 *
 * @param response - The response.
 * @returns The body, or an empty object when it has none or it is not an object.
 */
async function json(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return body !== null && typeof body === 'object' ? Object.fromEntries(Object.entries(body)) : {};
  } catch {
    return {};
  }
}

/**
 * Reads a field that should be text.
 *
 * @param value - The field.
 * @returns The text, or null when it is missing, empty or not a string.
 */
function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Finds the issuer's registration endpoint, once its discovery document has been checked as the issuer's own.
 *
 * @param issuer - The issuer from the setup URL.
 * @returns The registration endpoint.
 * @throws A `PairingError` when the document is missing, names another issuer, or has no endpoint.
 */
async function discover(issuer: string): Promise<string> {
  const response = await call(`${issuer}/.well-known/openid-configuration`, {
    headers: { accept: 'application/json' },
  });
  const doc = response.ok ? await json(response) : {};
  // A document naming another issuer would have the token sent wherever it says.
  if (text(doc.issuer)?.replace(/\/+$/, '') !== issuer) {
    throw new PairingError(
      PairingFailure.NotAProvider,
      `${issuer} is not an OpenID Connect provider. Check the setup URL.`,
    );
  }
  const endpoint = text(doc.registration_endpoint);
  if (endpoint === null) {
    throw new PairingError(
      PairingFailure.NoRegistration,
      'This provider does not support pairing. Set OIDC_ISSUER and OIDC_CLIENT_ID in the environment instead.',
    );
  }
  return endpoint;
}

/**
 * Says what the homepage asks to be registered as.
 *
 * @param redirectUri - Where the provider sends the browser back to.
 * @param [authMethod] - How the client proves itself at the token endpoint.
 * @returns The client metadata (RFC 7591).
 */
function clientMetadata(redirectUri: string, authMethod: PairedOidc['clientAuth'] = 'client_secret_basic') {
  return {
    client_name: CLIENT_NAME,
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: authMethod,
    grant_types: ['authorization_code'],
    response_types: ['code'],
  };
}

/** Where the homepage is reached, as pairing records it. */
export interface PairingAddress {
  /** The addresses sign-in will use: the callback registered is `urls.redirectUri`. */
  urls: SiteUrls;
  /** What to keep as the address people open the homepage at, or null to keep none (APP_URL decides). */
  recordedAppUrl: string | null;
}

/**
 * Turns a failed registration call into what to tell the person pairing.
 *
 * @param response - The provider's answer.
 * @returns The error, with its reason.
 */
async function refusal(response: Response): Promise<PairingError> {
  const body = await json(response);
  const description = text(body.error_description) ?? text(body.error);
  if (response.status === HttpStatus.Unauthorized || body.error === 'invalid_token') {
    return new PairingError(
      PairingFailure.Expired,
      'This setup URL has expired, was used already, or was cancelled. Ask your provider for a new one.',
    );
  }
  if (response.status === HttpStatus.TooManyRequests) {
    return new PairingError(
      PairingFailure.RateLimited,
      'The provider is turning requests away for now. Try again in a minute.',
    );
  }
  if (response.status === HttpStatus.BadRequest) {
    return new PairingError(
      PairingFailure.Refused,
      `The provider refused to register the homepage: ${description ?? 'no reason given'}.`,
    );
  }
  return new PairingError(
    PairingFailure.NotAProvider,
    `The provider answered ${response.status} when asked to register the homepage.`,
  );
}

/**
 * Registers the homepage with the provider a setup URL names, and keeps the client.
 *
 * @param db - The database.
 * @param setupUrl - What was pasted.
 * @param address - The callback to register, and the address to record.
 * @returns The pairing as saved. The caller rebuilds the auth instance (auth/auth-host.ts) to use it.
 * @throws A `PairingError` saying why, when nothing was paired.
 */
export async function pair(db: Database, setupUrl: string, address: PairingAddress): Promise<PairedOidc> {
  const setup = parseSetupUrl(setupUrl);
  const endpoint = await discover(setup.issuer);
  const response = await call(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${setup.token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(clientMetadata(address.urls.redirectUri)),
  });
  if (response.ok === false) {
    throw await refusal(response);
  }
  const body = await json(response);
  const clientId = text(body.client_id);
  if (clientId === null) {
    throw new PairingError(
      PairingFailure.NotAProvider,
      'The provider registered the homepage but sent back no client id.',
    );
  }
  const paired: PairedOidc = {
    issuer: setup.issuer,
    clientId,
    clientSecret: text(body.client_secret),
    // The provider may have registered another method than the one asked for; its answer is what counts.
    clientAuth: body.token_endpoint_auth_method === 'client_secret_post' ? 'client_secret_post' : 'client_secret_basic',
    name: setup.name,
    registrationAccessToken: text(body.registration_access_token),
    registrationClientUri: text(body.registration_client_uri),
    appUrl: address.recordedAppUrl,
  };
  await savePairedOidc(db, paired);
  return paired;
}

/** What re-pointing the paired client did. */
export interface RepointResult {
  /** Whether the provider now has the new callback registered. */
  providerUpdated: boolean;
  /** Why it does not, as a sentence that says what to do instead; null when it does. */
  message: string | null;
}

/**
 * Moves the paired client to a new address: records it, and asks the provider to register the new
 * callback in place of the old one (RFC 7592 client update).
 *
 * @param db - The database. There must be a pairing.
 * @param address - The new callback, and the address to record.
 * @returns Whether the provider took the change. The new address is recorded either way, so the
 * homepage's side is right and the provider's admin can fix theirs by hand.
 */
export async function repoint(db: Database, address: PairingAddress): Promise<RepointResult> {
  const paired = await readPairedOidc(db);
  if (paired === null) {
    return { providerUpdated: false, message: 'The homepage is not paired with a provider.' };
  }
  const handEdit = `Change the client's redirect URI to ${address.urls.redirectUri} in your provider instead.`;
  const { registrationClientUri, registrationAccessToken } = paired;
  if (registrationClientUri === null || registrationAccessToken === null) {
    await updatePairedOidc(db, { appUrl: address.recordedAppUrl });
    return { providerUpdated: false, message: `The provider gave no way to update the client. ${handEdit}` };
  }
  // RFC 7592 replaces the whole registration, so every field is sent again, with the client's own id
  // (and secret, which some providers check).
  const metadata = {
    ...clientMetadata(address.urls.redirectUri, paired.clientAuth),
    client_id: paired.clientId,
    ...(paired.clientSecret === null ? {} : { client_secret: paired.clientSecret }),
  };
  let response: Response;
  try {
    response = await fetch(registrationClientUri, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${registrationAccessToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(metadata),
      signal: AbortSignal.timeout(AUTH_DEFAULTS.oidcPairingTimeoutMs),
    });
  } catch {
    await updatePairedOidc(db, { appUrl: address.recordedAppUrl });
    return { providerUpdated: false, message: `Could not reach the provider. ${handEdit}` };
  }
  if (response.ok === false) {
    const body = await json(response);
    const reason = text(body.error_description) ?? text(body.error) ?? `it answered ${response.status}`;
    console.warn(`[auth] OIDC provider refused to update the client: ${reason}`);
    await updatePairedOidc(db, { appUrl: address.recordedAppUrl });
    return { providerUpdated: false, message: `The provider refused the change (${reason}). ${handEdit}` };
  }
  // Providers may rotate the registration access token on every update (heautou does).
  const body = await json(response);
  const rotated = text(body.registration_access_token);
  await updatePairedOidc(db, {
    appUrl: address.recordedAppUrl,
    ...(rotated === null ? {} : { registrationAccessToken: rotated }),
  });
  return { providerUpdated: true, message: null };
}

/**
 * Deletes the homepage's client at the provider and forgets the pairing.
 *
 * @param db - The database.
 * @returns Whether the provider confirmed the client is gone.
 *
 * @remarks
 * The pairing is forgotten even when the provider cannot be reached, so nobody is stuck with a provider
 * they want gone; the provider's admin can remove the client on their side.
 */
export async function unpair(db: Database): Promise<boolean> {
  const paired = await readPairedOidc(db);
  if (paired === null) {
    return true;
  }
  let removed = false;
  const { registrationClientUri, registrationAccessToken } = paired;
  if (registrationClientUri !== null && registrationAccessToken !== null) {
    try {
      const response = await fetch(registrationClientUri, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${registrationAccessToken}` },
        signal: AbortSignal.timeout(AUTH_DEFAULTS.oidcPairingTimeoutMs),
      });
      // A 401 or a 404: the client is already gone, which is what was wanted.
      removed = response.ok || response.status === HttpStatus.Unauthorized || response.status === HttpStatus.NotFound;
      if (removed === false) {
        console.warn(`[auth] OIDC provider answered ${response.status} to deleting the client`);
      }
    } catch (error) {
      console.warn('[auth] could not reach the OIDC provider to delete the client:', error);
    }
  }
  await clearPairedOidc(db);
  return removed;
}
