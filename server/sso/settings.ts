import { eq } from 'drizzle-orm';
import { type OidcConfig, oidcConfig, type SiteUrls, siteUrls } from '../core/config.ts';
import type { Database } from '../db/client.ts';
import { oidcSettings } from '../db/schema.ts';

// The OIDC provider the instance signs in with comes from one of two places: the environment
// (OIDC_ISSUER), or a pairing made by pasting a setup URL (pairing.ts), kept in the `oidc_settings` row.
// The environment wins, so a deployment that pins its provider cannot be re-paired from the app.
//
// The pairing also records the address people opened the homepage at, which is where sign-ins come back
// to while APP_URL is unset (`siteUrls` in core/config.ts).

/** Where the provider in use came from. The GraphQL enum `SsoSource` has the same values. */
export const SsoSource = {
  Env: 'ENV',
  Paired: 'PAIRED',
  None: 'NONE',
} as const;
/** One of the values in `SsoSource`. */
export type SsoSource = (typeof SsoSource)[keyof typeof SsoSource];

/** The `oidc_settings` row, as pairing writes it. */
export interface PairedOidc {
  issuer: string;
  clientId: string;
  clientSecret: string | null;
  clientAuth: OidcConfig['clientAuth'];
  name: string;
  /** RFC 7592: the credential that updates or deletes the client at the provider. */
  registrationAccessToken: string | null;
  registrationClientUri: string | null;
  /** The address the homepage was opened at when it was paired, or null when none was recorded. */
  appUrl: string | null;
}

/** What sign-in uses now: the provider, where it came from, and the addresses it signs in at. */
export interface EffectiveOidc {
  config: OidcConfig | null;
  source: SsoSource;
  urls: SiteUrls;
}

/**
 * Reads the paired provider.
 *
 * @param db - The database.
 * @returns The pairing, or null when there is none.
 */
export async function readPairedOidc(db: Database): Promise<PairedOidc | null> {
  const [row] = await db.select().from(oidcSettings).limit(1);
  if (row === undefined) {
    return null;
  }
  return {
    issuer: row.issuer,
    clientId: row.clientId,
    clientSecret: row.clientSecret,
    clientAuth: row.clientAuth === 'client_secret_post' ? 'client_secret_post' : 'client_secret_basic',
    name: row.name,
    registrationAccessToken: row.registrationAccessToken,
    registrationClientUri: row.registrationClientUri,
    appUrl: row.appUrl,
  };
}

/**
 * Saves a pairing, replacing any before it.
 *
 * @param db - The database.
 * @param paired - What the provider registered.
 */
export async function savePairedOidc(db: Database, paired: PairedOidc): Promise<void> {
  await db
    .insert(oidcSettings)
    .values(paired)
    .onConflictDoUpdate({ target: oidcSettings.id, set: { ...paired, updatedAt: new Date() } });
}

/**
 * Changes what the pairing row says about the client's addresses, after the provider was told (or not).
 *
 * @param db - The database.
 * @param change - The recorded address, and the registration access token when the provider rotated it.
 */
export async function updatePairedOidc(
  db: Database,
  change: Pick<PairedOidc, 'appUrl'> & Partial<Pick<PairedOidc, 'registrationAccessToken'>>,
): Promise<void> {
  await db.update(oidcSettings).set(change).where(eq(oidcSettings.id, 'oidc'));
}

/**
 * Forgets the pairing.
 *
 * @param db - The database.
 */
export async function clearPairedOidc(db: Database): Promise<void> {
  await db.delete(oidcSettings);
}

/**
 * Reads the provider sign-in uses, where it came from, and the addresses it signs in at.
 *
 * @param db - The database.
 * @returns The environment's provider when OIDC_ISSUER is set, otherwise the pairing, otherwise none; and
 * the addresses from APP_URL, otherwise the pairing's recorded address, otherwise localhost.
 */
export async function effectiveOidc(db: Database): Promise<EffectiveOidc> {
  const env = oidcConfig();
  const paired = await readPairedOidc(db);
  const urls = siteUrls(paired?.appUrl ?? null);
  if (env !== null) {
    return { config: env, source: SsoSource.Env, urls };
  }
  if (paired === null) {
    return { config: null, source: SsoSource.None, urls };
  }
  return {
    config: {
      issuer: paired.issuer,
      clientId: paired.clientId,
      clientSecret: paired.clientSecret ?? undefined,
      clientAuth: paired.clientAuth,
      name: paired.name,
    },
    source: SsoSource.Paired,
    urls,
  };
}
