import { BlockList, isIP } from 'node:net';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { accounts, users } from '../db/schema.ts';
import { claimFirstAdmin } from './admin.ts';

// Forward auth: a reverse proxy in front of the homepage asks an identity provider (heautou's Protected
// sites, Authelia, Authentik) about every request, and passes the signed-in user on in Remote-* headers.
// Those headers are believed only when the request comes straight from one of the proxies named in
// FORWARD_AUTH_TRUSTED_PROXIES; from anywhere else they are ignored, so nobody can claim to be someone
// by setting them. Each identity is an account like an OIDC one (the `forward-auth` provider), found by
// Remote-User, or linked by Remote-Email to an account the OIDC provider made.

/** The provider id forward-auth accounts are kept under. */
export const FORWARD_AUTH_PROVIDER_ID = 'forward-auth';

/** The headers a proxy sets: heautou's, Authelia's and Authentik's names. */
export const RemoteHeader = {
  User: 'remote-user',
  Name: 'remote-name',
  Email: 'remote-email',
  Groups: 'remote-groups',
} as const;

/** What a trusted proxy said about the request's user. */
export interface ForwardIdentity {
  /** Remote-User: the username at the provider. */
  user: string;
  name: string | null;
  email: string | null;
  groups: string[];
}

/** Reads the identity a trusted proxy passes on. */
export interface ForwardAuth {
  /** Whether any proxy is trusted. With none, forward auth is off. */
  isEnabled: boolean;
  /**
   * Reads the Remote-* headers, if the request came from a trusted proxy.
   *
   * @param headers - The request's headers.
   * @param remoteAddress - The address the connection came from (not X-Forwarded-For).
   * @returns The identity, or null when the caller is not a trusted proxy or sent no usable Remote-User.
   */
  identify(headers: Headers, remoteAddress: string | undefined): ForwardIdentity | null;
}

/** What an IPv4 address looks like when a dual-stack socket reports it. */
const IPV4_MAPPED = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;
/** The domain an account made from a Remote-User with no Remote-Email gets an address at. */
const NO_EMAIL_DOMAIN = 'forward-auth.invalid';
const IPV4 = 4;
/** Bits in an IPv4 address, the longest IPv4 prefix. */
const IPV4_BITS = 32;
/** Bits in an IPv6 address, the longest IPv6 prefix. */
const IPV6_BITS = 128;

/**
 * Reads an address the way the trust list holds it.
 *
 * @param address - As the socket reported it.
 * @returns The address, with an IPv4-mapped IPv6 address turned back into IPv4.
 */
function plainAddress(address: string): string {
  return IPV4_MAPPED.exec(address)?.[1] ?? address;
}

/**
 * Builds the list of trusted proxies.
 *
 * @param entries - Addresses (`192.168.1.2`, `::1`) and CIDR ranges (`172.18.0.0/16`).
 * @returns The list.
 * @throws When an entry is neither, saying which.
 */
export function parseTrustedProxies(entries: readonly string[]): BlockList {
  const list = new BlockList();
  for (const entry of entries) {
    const [address = '', prefix] = entry.split('/');
    const family = isIP(address);
    if (family === 0) {
      throw new Error(`FORWARD_AUTH_TRUSTED_PROXIES has "${entry}", which is not an address or a CIDR range.`);
    }
    const type = family === IPV4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) {
      list.addAddress(address, type);
      continue;
    }
    const bits = Number(prefix);
    const maxBits = family === IPV4 ? IPV4_BITS : IPV6_BITS;
    const isPrefix = /^\d+$/.test(prefix) && bits <= maxBits;
    if (isPrefix === false) {
      throw new Error(`FORWARD_AUTH_TRUSTED_PROXIES has "${entry}", whose prefix length is not 0 to ${maxBits}.`);
    }
    list.addSubnet(address, bits, type);
  }
  return list;
}

/**
 * Reads one header that must hold a single value.
 *
 * @param headers - The request's headers.
 * @param name - The header.
 * @returns Its value, trimmed; null when it is missing, blank, or several values were joined into it.
 */
function single(headers: Headers, name: string): string | null {
  const value = headers.get(name)?.trim() ?? '';
  const isSingle = value !== '' && value.includes(',') === false;
  return isSingle ? value : null;
}

/**
 * Builds the forward-auth reader.
 *
 * @param trusted - The trusted proxies, as `FORWARD_AUTH_TRUSTED_PROXIES` lists them.
 * @returns The reader. With no proxies it never identifies anyone.
 */
export function createForwardAuth(trusted: readonly string[]): ForwardAuth {
  const list = parseTrustedProxies(trusted);
  const isEnabled = trusted.length > 0;
  return {
    isEnabled,
    identify(headers, remoteAddress) {
      if (isEnabled === false || remoteAddress === undefined) {
        return null;
      }
      const address = plainAddress(remoteAddress);
      const family = isIP(address);
      const isTrusted = family !== 0 && list.check(address, family === IPV4 ? 'ipv4' : 'ipv6');
      if (isTrusted === false) {
        return null;
      }
      const user = single(headers, RemoteHeader.User);
      if (user === null) {
        return null;
      }
      const groups = (headers.get(RemoteHeader.Groups) ?? '')
        .split(',')
        .map((group) => group.trim())
        .filter((group) => group !== '');
      return {
        user,
        name: headers.get(RemoteHeader.Name)?.trim() || null,
        email: single(headers, RemoteHeader.Email)?.toLowerCase() ?? null,
        groups: [...new Set(groups)],
      };
    },
  };
}

/**
 * Checks whether two group lists hold the same names, in any order.
 *
 * @param a - One list.
 * @param b - The other.
 * @returns True when they match.
 */
function sameGroups(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((group) => b.includes(group));
}

/**
 * Finds the account a forward-auth identity belongs to, making it when this is its first visit, and
 * keeps its groups as the proxy last said.
 *
 * @param db - The database.
 * @param identity - What the proxy said.
 * @returns The user's id.
 */
export async function findOrCreateForwardUser(db: Database, identity: ForwardIdentity): Promise<string> {
  const [known] = await db
    .select({ id: users.id, groups: users.groups })
    .from(accounts)
    .innerJoin(users, eq(accounts.userId, users.id))
    .where(and(eq(accounts.providerId, FORWARD_AUTH_PROVIDER_ID), eq(accounts.accountId, identity.user)))
    .limit(1);
  if (known !== undefined) {
    if (sameGroups(known.groups, identity.groups) === false) {
      await db.update(users).set({ groups: identity.groups }).where(eq(users.id, known.id));
    }
    return known.id;
  }

  const email = identity.email ?? `${encodeURIComponent(identity.user).toLowerCase()}@${NO_EMAIL_DOMAIN}`;
  const [made] = await db
    .insert(users)
    .values({
      email,
      name: identity.name ?? identity.user,
      emailVerified: identity.email !== null,
      groups: identity.groups,
    })
    .onConflictDoNothing()
    .returning({ id: users.id });
  // Someone already has the address: the OIDC provider made them, or a request beside this one did.
  const [existing] =
    made === undefined ? await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1) : [made];
  if (existing === undefined) {
    throw new Error(`[auth] could not find or make the account for ${identity.user}`);
  }
  await db
    .insert(accounts)
    .values({ userId: existing.id, accountId: identity.user, providerId: FORWARD_AUTH_PROVIDER_ID })
    .onConflictDoNothing();
  await db.update(users).set({ groups: identity.groups }).where(eq(users.id, existing.id));
  if (made !== undefined) {
    await claimFirstAdmin(db, made.id);
  }
  return existing.id;
}
