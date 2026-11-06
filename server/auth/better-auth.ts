import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, genericOAuth, oneTimeToken } from 'better-auth/plugins';
import { authSecret, OIDC_PROVIDER_ID, type OidcConfig, oidcConfig, type SiteUrls, siteUrls } from '../core/config.ts';
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
  /** Where people open the homepage and where the callback is. The default is the environment's alone. */
  urls?: SiteUrls;
}

/**
 * Builds the better-auth instance.
 *
 * @param db - The database users and sessions are kept in.
 * @param [options] - Test overrides.
 * @returns The auth instance.
 */
export function createAuth(
  db: Database,
  { secret = authSecret(), oidc = oidcConfig(), urls = siteUrls(null) }: AuthOptions = {},
) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    secret,
    // The OIDC callback is served here (http/sso.ts).
    baseURL: urls.serverUrl,
    // So a sign-in may finish on the app's pages when they are another origin.
    trustedOrigins: [new URL(urls.appUrl).origin],
    advanced: { database: { generateId: 'uuid' } },
    session: { expiresIn: AUTH_DEFAULTS.sessionTtlDays * SECONDS_PER_DAY },
    // Every account is made through the adapter, so this is the one place the first becomes the admin.
    // Forward auth makes its own (forward-auth.ts) and claims there.
    databaseHooks: { user: { create: { after: async (user) => claimFirstAdmin(db, user.id) } } },
    // An address the operator's own provider vouches for signs in to the account that has it, such as one
    // forward auth made first.
    ...(oidc ? { account: { accountLinking: { requireLocalEmailVerified: false } } } : {}),
    // Where an OIDC callback goes when it cannot tell where the sign-in came from: the sign-in page.
    onAPIError: { errorURL: `${urls.appUrl}/login` },
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
        // heautou's users need not have an address, and better-auth refuses a sign-in without one, so an
        // account with none gets a placeholder made from its subject, at a domain that can never be real.
        mapProfileToUser: (profile) => {
          const email = stringClaim(profile.email);
          return {
            name: stringClaim(profile.name) ?? stringClaim(profile.preferred_username) ?? email?.split('@')[0] ?? '',
            ...(email === undefined ? { email: placeholderEmail(profile), emailVerified: false } : {}),
          };
        },
      },
    ],
  });
}

/** The domain placeholder addresses are at: `.invalid` is reserved, so no real address can be there. */
const NO_EMAIL_DOMAIN = 'oidc.invalid';

/**
 * Makes an address for a provider user who has none.
 *
 * @param profile - The provider's claims.
 * @param profile.sub - The user's subject: unique and stable at the provider.
 * @returns `<subject>@oidc.invalid`, lower case.
 */
function placeholderEmail(profile: { sub?: unknown; id?: unknown }): string {
  const subject = stringClaim(profile.sub) ?? stringClaim(profile.id) ?? 'unknown';
  return `${encodeURIComponent(subject).toLowerCase()}@${NO_EMAIL_DOMAIN}`;
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
