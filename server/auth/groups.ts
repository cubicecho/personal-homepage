import { and, desc, eq } from 'drizzle-orm';
import { OIDC_PROVIDER_ID, oidcGroupsClaim } from '../core/config.ts';
import type { Database } from '../db/client.ts';
import { accounts, users } from '../db/schema.ts';

// A user's groups decide what they may edit (ADMIN_GROUPS) and see (`visibleTo`). For an OIDC sign-in
// they come from the ID token's groups claim, read once the callback has verified the token
// (http/sso.ts), and kept on the user until the next sign-in.

/** The parts of a JWT: header, payload, signature. */
const JWT_PARTS = 3;

/**
 * Reads the payload of a JWT whose signature has already been checked.
 *
 * @param token - The JWT.
 * @returns The claims, or an empty object when it is not a JWT.
 */
function claimsOf(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== JWT_PARTS) {
    return {};
  }
  try {
    const claims: unknown = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf-8'));
    return claims !== null && typeof claims === 'object' ? Object.fromEntries(Object.entries(claims)) : {};
  } catch {
    return {};
  }
}

/**
 * Reads the groups an ID token names.
 *
 * @param idToken - The verified ID token.
 * @param claim - The claim to read.
 * @returns The group names: from a list of strings, or a single string; empty when the claim is missing.
 */
export function groupsFromIdToken(idToken: string, claim: string): string[] {
  const value = claimsOf(idToken)[claim];
  const list = Array.isArray(value) ? value : [value];
  const names = list.filter((group): group is string => typeof group === 'string').map((group) => group.trim());
  return [...new Set(names.filter((group) => group !== ''))];
}

/**
 * Copies the groups from a user's latest OIDC ID token onto the user.
 *
 * @param db - The database.
 * @param userId - The user who just signed in.
 * @returns The groups now on the user.
 */
export async function syncOidcGroups(db: Database, userId: string): Promise<string[]> {
  const [account] = await db
    .select({ idToken: accounts.idToken })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, OIDC_PROVIDER_ID)))
    .orderBy(desc(accounts.updatedAt))
    .limit(1);
  const groups = account?.idToken ? groupsFromIdToken(account.idToken, oidcGroupsClaim()) : [];
  await db.update(users).set({ groups }).where(eq(users.id, userId));
  return groups;
}
