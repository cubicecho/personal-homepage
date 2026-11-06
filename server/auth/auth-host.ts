import { type OidcConfig, type SiteUrls, siteUrls } from '../core/config.ts';
import type { Database } from '../db/client.ts';
import { effectiveOidc } from '../sso/settings.ts';
import { type Auth, type AuthOptions, createAuth } from './better-auth.ts';

// better-auth fixes its plugins and its addresses when it is created, and both depend on the pairing: the
// OIDC provider is a plugin, and the address sign-ins come back to may be the one pairing recorded.
// Pairing, re-pointing or unpairing while the server runs therefore means a new instance, so everything
// that signs people in asks this host for the current one, and for the current addresses, on each request
// instead of holding on to them from boot.

/** Where the current auth instance is. */
export interface AuthHost {
  /** The auth instance to use for this request. */
  current(): Auth;
  /** The OIDC provider `current()` was built with, or null. */
  oidc(): OidcConfig | null;
  /** The addresses `current()` was built with: where people open the homepage, and the OIDC callback. */
  urls(): SiteUrls;
  /** Builds a new instance from the provider and addresses in use now (sso/settings.ts). */
  rebuild(): Promise<void>;
}

/**
 * Builds a host from the environment and the database's pairing.
 *
 * @param db - The database. Migrations must have run: the pairing is read from it.
 * @param [opts] - Passed to every `createAuth`, for tests. `oidc` and `urls` are the host's to decide.
 * @returns The host, with its first instance built.
 */
export async function createAuthHost(db: Database, opts: Omit<AuthOptions, 'oidc' | 'urls'> = {}): Promise<AuthHost> {
  const build = async () => {
    const { config, urls } = await effectiveOidc(db);
    return { auth: createAuth(db, { ...opts, oidc: config, urls }), oidc: config, urls };
  };
  let built = await build();
  return {
    current: () => built.auth,
    oidc: () => built.oidc,
    urls: () => built.urls,
    async rebuild() {
      built = await build();
    },
  };
}

/**
 * Builds a host that never changes, for a caller that already has its instance.
 *
 * @param auth - The instance.
 * @param [oidc] - The provider it was built with.
 * @param [rebuild] - What to do when asked to rebuild. Nothing, by default.
 * @param [urls] - The addresses it was built with. From the environment alone, by default.
 * @returns The host.
 */
export function fixedAuthHost(
  auth: Auth,
  oidc: OidcConfig | null = null,
  rebuild = async () => {},
  urls: SiteUrls = siteUrls(null),
): AuthHost {
  return { current: () => auth, oidc: () => oidc, urls: () => urls, rebuild };
}
