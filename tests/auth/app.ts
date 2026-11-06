// Starts the real app on a loopback port for the sign-in tests, and talks to it as a browser or a proxy would.
import type { Server } from 'node:http';
import type { Database } from '../../server/db/client.ts';
import { type AppDeps, createApp } from '../../server/http/app.ts';
import { type DatabaseDeps, databaseDeps } from '../db.ts';
import { portOf } from '../helpers.ts';

/** A GraphQL answer, as the tests read it. */
export interface GraphQLAnswer {
  // biome-ignore lint/suspicious/noExplicitAny: each test reads its own fields.
  data?: any;
  errors?: { message: string; extensions?: { code?: string; reason?: string } }[];
}

/** The app, listening. */
export interface TestApp {
  /** Its origin: `http://127.0.0.1:<port>`. */
  base: string;
  /** What it was built from. */
  deps: DatabaseDeps;
  /**
   * Sends one GraphQL operation.
   *
   * @param query - The document.
   * @param [variables] - Its variables.
   * @param [headers] - Extra headers: a bearer token, or Remote-* as a proxy would send them.
   * @returns The answer.
   */
  gql(query: string, variables?: Record<string, unknown>, headers?: Record<string, string>): Promise<GraphQLAnswer>;
  /** Stops it. */
  close(): Promise<void>;
}

/**
 * Builds the app over a test database and listens on a free loopback port. Environment the app reads at
 * build time (FORWARD_AUTH_TRUSTED_PROXIES) must be stubbed before this is called.
 *
 * @param db - The test database, migrated.
 * @param [overrides] - Services to replace.
 * @returns The app.
 */
export async function startApp(db: Database, overrides: Partial<AppDeps> = {}): Promise<TestApp> {
  const deps = await databaseDeps(db);
  const server: Server = createApp({ ...deps, dataDir: '/nonexistent', ...overrides }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${portOf(server)}`;
  return {
    base,
    deps,
    async gql(query, variables = {}, headers = {}) {
      const response = await fetch(`${base}/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ query, variables }),
      });
      return response.json() as Promise<GraphQLAnswer>;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * Builds the headers a trusted proxy sends for a signed-in user.
 *
 * @param user - Remote-User.
 * @param [groups] - Remote-Groups.
 * @param [email] - Remote-Email.
 * @returns The headers.
 */
export function asProxyUser(user: string, groups: string[] = [], email?: string): Record<string, string> {
  return {
    'remote-user': user,
    'remote-name': user,
    'remote-groups': groups.join(','),
    ...(email === undefined ? {} : { 'remote-email': email }),
  };
}
