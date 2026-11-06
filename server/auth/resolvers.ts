import { assertObjectType, extendSchema, type GraphQLSchema, parse } from 'graphql';
import { publicView } from '../core/config.ts';
import type { Context } from '../core/context.ts';
import { SSO_START_PATH } from '../http/sso.ts';
import type { Access } from './access.ts';

const AUTH_SDL = parse(`
  "Whether the instance asks anyone to sign in."
  enum AuthMode {
    "No way to sign in is set up: anyone who can reach the homepage may see and change it."
    OPEN
    "An OIDC provider or a forward-auth proxy is set up: seeing needs someone signed in (unless PUBLIC_VIEW), changing needs an editor."
    SIGN_IN
  }

  "How someone was recognised."
  enum SignInMethod {
    "Through the OIDC provider, with a bearer session."
    OIDC
    "Through a trusted proxy's Remote-User header."
    FORWARD_AUTH
  }

  "Someone signed in."
  type Viewer {
    id: ID!
    name: String
    email: String!
    "The groups they were last seen in, from the provider's groups claim or Remote-Groups."
    groups: [String!]!
    "Whether they are the instance's admin: its first account."
    isAdmin: Boolean!
    via: SignInMethod!
  }

  "What the caller may do."
  type Access {
    mode: AuthMode!
    "Who is signed in, or null."
    viewer: Viewer
    canView: Boolean!
    "Whether the caller may change pages, sections, items and settings: the admin and ADMIN_GROUPS, or anyone while OPEN."
    canEdit: Boolean!
  }

  "An OpenID Connect provider the sign-in page offers."
  type SsoProvider {
    "What the button calls it (OIDC_NAME, or the name in the setup URL)."
    name: String!
    "Where the button sends the browser. Absolute: in development the server is not the app's origin."
    signInUrl: String!
  }

  "Which ways of signing in this instance offers, so the sign-in page shows only those."
  type AuthConfig {
    mode: AuthMode!
    "The OIDC provider to sign in with (OIDC_ISSUER, or the paired one), or null when there is none."
    sso: SsoProvider
    "Whether a forward-auth proxy is trusted. Sign-in then happens at the proxy, not here."
    forwardAuth: Boolean!
    "Whether people who are not signed in may see the pages."
    publicView: Boolean!
  }

  extend type Query {
    "Who is asking and what they may do. Readable by anyone."
    access: Access!
    "How sign-in is set up. Readable by anyone, so the sign-in page can draw itself."
    authConfig: AuthConfig!
  }
`);

/**
 * Adds `access` and `authConfig` to the schema. Signing in and out are better-auth's own endpoints
 * (endpoints.ts), and pairing a provider is sso/resolvers.ts.
 *
 * @param schema - The schema so far.
 * @returns The schema with them.
 */
export function applyAuthExtension(schema: GraphQLSchema): GraphQLSchema {
  const extendedSchema = extendSchema(schema, AUTH_SDL);
  const queries = assertObjectType(extendedSchema.getType('Query')).getFields();

  const { access, authConfig } = queries;
  if (access === undefined || authConfig === undefined) {
    throw new Error('the auth extension did not add its fields');
  }
  access.resolve = (_parent: unknown, _args: unknown, context: Context): Access => context.access;
  authConfig.resolve = (_parent: unknown, _args: unknown, context: Context) => {
    // The provider the current instance was built with, which is the one the button can sign in with.
    const oidc = context.authHost.oidc();
    return {
      mode: context.access.mode,
      sso:
        oidc === null ? null : { name: oidc.name, signInUrl: `${context.authHost.urls().serverUrl}${SSO_START_PATH}` },
      forwardAuth: context.forwardAuth.isEnabled,
      publicView: publicView(),
    };
  };

  return extendedSchema;
}
