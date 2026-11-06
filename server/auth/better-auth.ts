import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, genericOAuth, oneTimeToken } from 'better-auth/plugins';
import { appUrl, authSecret, OIDC_PROVIDER_ID, type OidcConfig, oidcConfig, serverUrl } from '../core/config.ts';
import { AUTH_DEFAULTS } from '../core/defaults.ts';
import { SECONDS_PER_DAY } from '../core/wire.ts';
import type { Database } from '../db/client.ts';
import { accounts, sessions, users, verifications } from '../db/schema.ts';
import { claimFirstAdmin } from './admin.ts';

// Sign-in is better-auth's: sessions in the database, sent as `Authorization: Bearer`, opened through
// the paired OIDC provider. There are no passwords and no sign-in links: the homepage has no mail to send
// them with, and a provider (heautou) already proves who someone is. Server code calls `auth.api.*`; none
// of better-auth's REST routes are mounted but the OIDC start and callback (http/sso.ts).

/** The scopes asked of the provider. `groups` is heautou's, for ADMIN_GROUPS and `visibleTo`. */
const OIDC_SCOPES = ['openid', 'profile', 'email', 'groups'];

/** Overrides for tests. Production uses the defaults. */
export interface AuthOptions {
  /** What better-auth signs with. The default is `authSecret()`. */
  secret?: string;
  /** The OIDC provider to sign in with, or null for none. The default is `oidcConfig()`, the environment's. */
  oidc?: OidcConfig | null;
}

/**
 * Builds the better-auth instance.
 *
 * @param db - The database users and sessions are kept in.
 * @param [options] - Test overrides.
 * @returns The auth instance.
 */
export function createAuth(db: Database, { secret = authSecret(), oidc = oidcConfig() }: AuthOptions = {}) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    secret,
    // The OIDC callback is served here (http/sso.ts).
    baseURL: serverUrl(),
    // So a sign-in may finish on the app's pages when they are another origin.
    trustedOrigins: [new URL(appUrl()).origin],
    advanced: { database: { generateId: 'uuid' } },
    session: { expiresIn: AUTH_DEFAULTS.sessionTtlDays * SECONDS_PER_DAY },
    // Every account is made through the adapter, so this is the one place the first becomes the admin.
    // Forward auth makes its own (forward-auth.ts) and claims there.
    databaseHooks: { user: { create: { after: async (user) => claimFirstAdmin(db, user.id) } } },
    // An address the operator's own provider vouches for signs in to the account that has it, such as one
    // forward auth made first.
    ...(oidc ? { account: { accountLinking: { requireLocalEmailVerified: false } } } : {}),
    // Where an OIDC callback goes when it cannot tell where the sign-in came from: the sign-in page.
    onAPIError: { errorURL: `${appUrl()}/login` },
    plugins: [
      // Mutations return the raw token, and the client sends it back as `Authorization: Bearer`.
      bearer(),
      // How an OIDC sign-in reaches the app: the callback mints one, /auth/sso spends it over GraphQL.
      oneTimeToken({
        expiresIn: AUTH_DEFAULTS.oneTimeTokenTtlMinutes,
        storeToken: 'hashed',
        disableClientRequest: true,
        disableSetSessionCookie: true,
      }),
      ...(oidc ? [oidcPlugin(oidc)] : []),
    ],
  });
}

/** The better-auth instance `createAuth` builds. */
export type Auth = ReturnType<typeof createAuth>;

/**
 * The OIDC provider, through better-auth's generic OAuth plugin. Endpoints, keys and issuer come from the
 * discovery document, the ID token is checked against them, and better-auth runs the flow (state, PKCE,
 * nonce).
 *
 * @param oidc - The provider.
 * @returns The plugin.
 */
function oidcPlugin(oidc: OidcConfig) {
  return genericOAuth({
    config: [
      {
        providerId: OIDC_PROVIDER_ID,
        discoveryUrl: `${oidc.issuer}/.well-known/openid-configuration`,
        requireIdTokenVerification: true,
        clientId: oidc.clientId,
        clientSecret: oidc.clientSecret,
        tokenEndpointAuth: { method: oidc.clientSecret ? oidc.clientAuth : 'none' },
        pkce: true,
        scopes: OIDC_SCOPES,
        // A provider may release only a username, or no name at all: fall back to the address's local part.
        mapProfileToUser: (profile) => ({
          name:
            stringClaim(profile.name) ??
            stringClaim(profile.preferred_username) ??
            stringClaim(profile.email)?.split('@')[0] ??
            '',
        }),
      },
    ],
  });
}

/**
 * Reads a claim that should be text.
 *
 * @param value - The claim as the provider sent it.
 * @returns The text, or undefined when it is missing, blank or not a string.
 */
function stringClaim(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * Reads who a request's session belongs to.
 *
 * @param auth - The auth instance.
 * @param headers - The request's headers, carrying `Authorization: Bearer`.
 * @returns The user's id, or null when there is no live session.
 */
export async function sessionUserId(auth: Auth, headers: Headers): Promise<string | null> {
  const session = await auth.api.getSession({ headers });
  return session?.user.id ?? null;
}
