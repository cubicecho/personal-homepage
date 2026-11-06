import { eq } from 'drizzle-orm';
import { createForwardAuth, findOrCreateForwardUser, parseTrustedProxies } from '../../server/auth/forward-auth.ts';
import { ErrorCode } from '../../server/core/errors.ts';
import type { OpenedDatabase } from '../../server/db/client.ts';
import { users } from '../../server/db/schema.ts';
import { openTestDatabase, resetTestDatabase } from '../db.ts';
import { asProxyUser, startApp } from './app.ts';

const PROXY = '172.18.0.5';

/**
 * Builds the headers a proxy sends.
 *
 * @param values - Header values by name.
 * @returns The headers.
 */
function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

describe('the trusted proxy list', () => {
  it('takes addresses and CIDR ranges, of either family', () => {
    const list = parseTrustedProxies(['10.0.0.1', '172.18.0.0/16', '::1', 'fd00::/8']);
    expect(list.check('172.18.4.4', 'ipv4')).toBe(true);
    expect(list.check('fd00::42', 'ipv6')).toBe(true);
    expect(list.check('10.0.0.2', 'ipv4')).toBe(false);
  });

  it.each(['proxy.lan', '10.0.0.0/33', '10.0.0.0/x', ''])('refuses %j, naming it', (entry) => {
    expect(() => parseTrustedProxies([entry])).toThrow(/FORWARD_AUTH_TRUSTED_PROXIES/);
  });
});

describe('reading the Remote-* headers', () => {
  const forward = createForwardAuth([`${PROXY}/32`]);
  const sent = headers({
    'remote-user': 'ada',
    'remote-email': 'Ada@Example.com',
    'remote-groups': 'family, admins,family',
  });

  it('believes them from a trusted proxy, IPv4-mapped or not', () => {
    const expected = { user: 'ada', name: null, email: 'ada@example.com', groups: ['family', 'admins'] };
    expect(forward.identify(sent, PROXY)).toEqual(expected);
    expect(forward.identify(sent, `::ffff:${PROXY}`)).toEqual(expected);
  });

  it('ignores them from anywhere else, and with no address', () => {
    expect(forward.identify(sent, '172.18.0.6')).toBeNull();
    expect(forward.identify(sent, undefined)).toBeNull();
  });

  it('ignores a Remote-User that is blank or holds several values', () => {
    expect(forward.identify(headers({ 'remote-user': ' ' }), PROXY)).toBeNull();
    expect(forward.identify(headers({ 'remote-user': 'ada, eve' }), PROXY)).toBeNull();
  });

  it('is off with no proxies', () => {
    const off = createForwardAuth([]);
    expect(off.isEnabled).toBe(false);
    expect(off.identify(sent, PROXY)).toBeNull();
  });
});

describe('forward-auth accounts', () => {
  let database: OpenedDatabase;

  beforeAll(async () => {
    database = await openTestDatabase();
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(database.db);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('makes one account per Remote-User, keeps its groups current, and links by address', async () => {
    const [existing] = await database.db
      .insert(users)
      .values({ email: 'bob@example.com', name: 'Bob' })
      .returning({ id: users.id });
    const first = await findOrCreateForwardUser(database.db, { user: 'ada', name: 'Ada', email: null, groups: ['a'] });
    const again = await findOrCreateForwardUser(database.db, { user: 'ada', name: 'Ada', email: null, groups: ['b'] });
    expect(again).toBe(first);
    const [row] = await database.db.select().from(users).where(eq(users.id, first));
    expect(row).toMatchObject({ email: 'ada@forward-auth.invalid', groups: ['b'] });

    const bob = await findOrCreateForwardUser(database.db, {
      user: 'bob',
      name: null,
      email: 'bob@example.com',
      groups: [],
    });
    expect(bob).toBe(existing?.id);
  });

  it('ignores headers from an address it does not trust', async () => {
    vi.stubEnv('FORWARD_AUTH_TRUSTED_PROXIES', '10.9.9.9');
    const app = await startApp(database.db);
    try {
      const answer = await app.gql('{ pages { slug } }', {}, asProxyUser('ada'));
      expect(answer.errors?.[0]?.extensions?.code).toBe(ErrorCode.Unauthenticated);
      expect(await database.db.select().from(users)).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
