import {
  applyBetterAuthGraphQL,
  betterAuthGraphQL,
  type JsonSchema,
  type OperationOptions,
} from '@cubicecho/graphql-better-auth';
import { GraphQLError, type GraphQLSchema } from 'graphql';
import type { Context } from '../core/context.ts';
import { badInput } from '../core/errors.ts';
import type { Database } from '../db/client.ts';
import { createAuth, sessionUserId } from './better-auth.ts';
import { AuthFlow, throttle } from './throttle.ts';

// better-auth's own endpoints, served as GraphQL by @cubicecho/graphql-better-auth: finishing an OIDC
// sign-in, and a person's sessions. Fields, arguments and types are read off the auth config, so a
// better-auth upgrade moves them with it. What the homepage adds is in the `operations` below: the
// throttle, and refusals that never sign anyone out.

/** The better-auth endpoints served, by name. */
export const BETTER_AUTH_OPERATIONS = [
  'verifyOneTimeToken',
  'getSession',
  'listSessions',
  'signOut',
  'revokeSession',
  'revokeSessions',
  'revokeOtherSessions',
];

/** What a one-time token that cannot be spent is told: the sign-in has to be started again. */
const BAD_SSO_TOKEN = 'Invalid or expired sign-in. Sign in again.';

/** A session as the client keeps it: the bearer token, and whose it is. */
const SESSION_RESULT: JsonSchema = {
  type: 'object',
  properties: {
    token: { type: 'string', description: 'The session, to send as `Authorization: Bearer <token>`.' },
    userId: { type: 'string', format: 'uuid', description: "The session's user." },
  },
  required: ['token', 'userId'],
};

/**
 * Runs a token-spending call, and answers any refusal from better-auth with one message.
 *
 * BAD_USER_INPUT, never the UNAUTHENTICATED better-auth's 401 maps to: that one is what the client drops
 * its session on, and a bad token must not sign anyone out. What is not a refusal is rethrown as it is.
 *
 * @param next - The call.
 * @param message - What the caller is told when the token is refused.
 * @returns What the call returned.
 */
async function refusedAs(next: () => Promise<unknown>, message: string): Promise<unknown> {
  try {
    return await next();
  } catch (error) {
    throw error instanceof GraphQLError ? badInput(message) : error;
  }
}

/**
 * Reads the session a verified one-time token opened.
 *
 * @param result - What better-auth answered.
 * @returns The bearer token and its user.
 * @throws When the answer is not a session, which better-auth never sends for a verified token.
 */
function sessionOf(result: unknown): { token: string; userId: string } {
  const answer = result !== null && typeof result === 'object' ? result : {};
  const session = 'session' in answer ? answer.session : null;
  const user = 'user' in answer ? answer.user : null;
  const token = session !== null && typeof session === 'object' && 'token' in session ? session.token : null;
  const userId = user !== null && typeof user === 'object' && 'id' in user ? user.id : null;
  if (typeof token !== 'string' || typeof userId !== 'string') {
    throw new Error('better-auth verified the token but sent back no session');
  }
  return { token, userId };
}

/**
 * The last leg of an OIDC sign-in: the app's /auth/sso page spends the one-time token http/sso.ts put on
 * its URL. Answers with the session's bearer token and user rather than better-auth's whole session row.
 */
const verifyOneTimeToken: OperationOptions<Context> = {
  result: () => SESSION_RESULT,
  around: async (call, next) => {
    throttle(call.context, AuthFlow.VerifyOneTimeToken);
    return sessionOf(await refusedAs(next, BAD_SSO_TOKEN));
  },
};

/** Ends the caller's session. Signing out with none is `success: false`, not an error. */
const signOut: OperationOptions<Context> = {
  // For a provider's logout page, which the homepage does not send anyone to.
  omitArgs: ['callbackURL', 'disableRedirect', 'state'],
  around: async (call, next) => {
    if ((await sessionUserId(call.context.auth, call.context.headers)) === null) {
      return { success: false };
    }
    return next();
  },
};

/**
 * Adds better-auth's endpoints to the schema. Each call goes to the request's own auth instance with the
 * request's headers, which is where better-auth finds the session.
 *
 * @param schema - The schema so far.
 * @param db - The database the auth instance that describes the fields is built over.
 * @returns The schema with them.
 */
export function applyBetterAuthExtension(schema: GraphQLSchema, db: Database): GraphQLSchema {
  // Described from an instance with no OIDC provider, whose discovery document describing would fetch.
  // A request's own instance is what is called.
  const describing = createAuth(db, { oidc: null });
  const built = betterAuthGraphQL<Context>(describing, {
    include: BETTER_AUTH_OPERATIONS,
    auth: (context) => context.auth,
    headers: (context) => context.headers,
    operations: { verifyOneTimeToken, signOut },
  });
  return applyBetterAuthGraphQL(schema, built);
}
