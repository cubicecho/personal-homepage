import { assertObjectType, extendSchema, GraphQLError, type GraphQLSchema, parse } from 'graphql';
import { AuthMode } from '../auth/access.ts';
import { hasUsers } from '../auth/admin.ts';
import { AuthFlow, throttle } from '../auth/throttle.ts';
import { isLoopbackHost, originOf, type SiteUrls, siteUrls } from '../core/config.ts';
import type { Context } from '../core/context.ts';
import { badInput, conflict, ErrorCode, forbidden } from '../core/errors.ts';
import { type PairingAddress, PairingError, PairingFailure, pair, repoint, unpair } from './pairing.ts';
import { effectiveOidc, SsoSource } from './settings.ts';

// Pairing the instance with an OIDC provider from the app (pairing.ts): paste the setup URL the provider
// gave you, and its button appears on the sign-in page without a restart.
//
// Who may pair:
// - anyone while the instance is OPEN (no way to sign in is set up): anyone may change everything then,
//   and this is how it stops being open;
// - anyone while nobody has an account, so a pairing that went to the wrong provider can be undone before
//   anyone has signed in through it;
// - after that, editors only (the admin and ADMIN_GROUPS). Otherwise a stranger could point sign-in at a
//   provider of their own and sign in as any existing address.
// A provider set in the environment (OIDC_ISSUER) wins, and cannot be changed from here.
//
// The callback registered with the provider is under the address people open the homepage at: APP_URL,
// or else the browser's own address when it pairs (sent by the web app, or read from the Origin header).
// A callback on localhost that a browser on another machine could never come back to is refused.

const SSO_SDL = parse(`
  "Where the instance's OIDC provider comes from."
  enum SsoSource {
    "OIDC_ISSUER in the server's environment. Read-only from the app."
    ENV
    "Paired from a setup URL."
    PAIRED
    "There is none."
    NONE
  }

  "How sign-in through an OIDC provider is set up, and whether the caller may change it."
  type SsoSetup {
    source: SsoSource!
    "The provider's issuer URL. Only for a caller who may pair."
    issuer: String
    "What the sign-in page's button calls the provider."
    name: String
    "Whether the caller may pair a provider, or disconnect the paired one."
    canPair: Boolean!
    "The callback registered with the provider: the redirect URI, under appUrl (or SERVER_URL)."
    redirectUri: String!
    "Where sign-ins come back to: the address people open the homepage at."
    appUrl: String!
    "Where appUrl came from."
    appUrlSource: AppUrlSource!
    "Whether the callback is a localhost address, which only a browser on the server itself can reach."
    callbackIsLocal: Boolean!
  }

  "Where the address people open the homepage at came from."
  enum AppUrlSource {
    "APP_URL in the server's environment."
    ENV
    "Recorded from the browser when the provider was paired."
    PAIRED
    "Neither: the server's own localhost address."
    FALLBACK
  }

  "What moving the paired client to a new address did."
  type SsoCallbackUpdate {
    setup: SsoSetup!
    "Whether the provider now has the new callback registered."
    providerUpdated: Boolean!
    "Why it does not, and what to do in the provider instead. Null when it does."
    message: String
  }

  extend type Query {
    "Readable by anyone, so an open instance can offer to set sign-in up."
    ssoSetup: SsoSetup!
  }

  extend type Mutation {
    """
    Pairs with the provider a setup URL names (\`<issuer>#setup=<token>&name=<name>\`). \`appUrl\` is the
    address the browser has the homepage open at (\`window.location.origin\`), recorded as where sign-ins come
    back to while APP_URL is unset; the request's Origin header stands in when it is left out.
    BAD_USER_INPUT or TOO_MANY_REQUESTS with \`extensions.reason\` when the provider would not pair.
    """
    pairSso(setupUrl: String!, appUrl: String): SsoSetup!
    """
    Moves the paired provider's client to the address the homepage is open at now: records it, and asks the
    provider to register the new callback (RFC 7592). Same rule as pairSso. The address is recorded even when
    the provider refuses; \`message\` then says what to change in the provider by hand.
    """
    updateSsoAppUrl(appUrl: String): SsoCallbackUpdate!
    "Deletes the paired provider's client and stops offering it on the sign-in page. Same rule as pairSso."
    unpairSso: SsoSetup!
  }
`);

/**
 * Checks whether the caller may pair or disconnect a provider.
 *
 * @param ctx - The request.
 * @param source - Where the provider in use comes from.
 * @returns False for a provider from the environment; otherwise true while the instance is open or has no
 * accounts, and for editors.
 */
export async function canPairSso(ctx: Context, source: SsoSource): Promise<boolean> {
  if (source === SsoSource.Env) {
    return false;
  }
  if (ctx.access.mode === AuthMode.Open || ctx.access.canEdit) {
    return true;
  }
  return (await hasUsers(ctx.db)) === false;
}

/**
 * Answers `ssoSetup` for the caller.
 *
 * @param ctx - The request.
 * @returns How sign-in is set up, with the issuer only for a caller who may pair.
 */
async function ssoSetup(ctx: Context) {
  const { config, source, urls } = await effectiveOidc(ctx.db);
  const canPair = await canPairSso(ctx, source);
  return {
    source,
    issuer: canPair ? (config?.issuer ?? null) : null,
    name: config?.name ?? null,
    canPair,
    redirectUri: urls.redirectUri,
    appUrl: urls.appUrl,
    appUrlSource: urls.source,
    callbackIsLocal: isLocalCallback(urls),
  };
}

/**
 * Checks whether a callback only works from the server itself.
 *
 * @param urls - The addresses.
 * @returns True when the callback's host is localhost or a loopback address.
 */
function isLocalCallback(urls: SiteUrls): boolean {
  return isLoopbackHost(new URL(urls.redirectUri).hostname);
}

/**
 * Works out where a pairing should send sign-ins back to: APP_URL when set, otherwise the address the browser
 * has the homepage open at.
 *
 * @param ctx - The request.
 * @param sent - What the web app sent as `appUrl`, if anything.
 * @returns The addresses to register, and the browser's address to record.
 * @throws BAD_USER_INPUT when `appUrl` is not an http(s) origin, and BAD_USER_INPUT (reason BAD_APP_URL)
 * when the callback would be localhost but the browser is on another machine.
 */
function pairingAddress(ctx: Context, sent: string | null | undefined): PairingAddress {
  const hasSent = sent !== null && sent !== undefined && sent.trim() !== '';
  const sentOrigin = hasSent ? originOf(sent) : null;
  if (hasSent && sentOrigin === null) {
    throw badInput('appUrl must be an address such as http://homepage.lan:3000, with no path.');
  }
  const recordedAppUrl = sentOrigin ?? originOf(ctx.headers.get('origin') ?? '');
  const urls = siteUrls(recordedAppUrl);
  const isRemoteCaller = isLoopbackHost(ctx.ip) === false;
  if (isLocalCallback(urls) && isRemoteCaller) {
    throw new GraphQLError(
      `Sign-in would come back to ${urls.redirectUri}, which only works on the server itself. Set APP_URL to the ` +
        'address you open the homepage at (for example http://homepage.lan:3000), restart, and try again.',
      { extensions: { code: ErrorCode.BadUserInput, reason: PairingFailure.BadAppUrl } },
    );
  }
  return { urls, recordedAppUrl };
}

/**
 * Refuses a caller who may not pair.
 *
 * @param ctx - The request.
 * @returns Where the provider in use comes from.
 * @throws FORBIDDEN, saying where it can be changed instead.
 */
async function requirePairing(ctx: Context): Promise<SsoSource> {
  const { source } = await effectiveOidc(ctx.db);
  if (source === SsoSource.Env) {
    throw forbidden("Sign-in is set by OIDC_ISSUER in the server's environment. Change it there.");
  }
  if ((await canPairSso(ctx, source)) === false) {
    throw forbidden('Only the admin can change how people sign in.');
  }
  return source;
}

/**
 * Turns a pairing failure into an API error that carries its reason for the app.
 *
 * @param error - What pairing threw.
 * @returns The API error, or `error` itself when it is not a pairing failure.
 */
function pairingError(error: unknown): unknown {
  if (error instanceof PairingError === false) {
    return error;
  }
  const code = error.reason === PairingFailure.RateLimited ? ErrorCode.TooManyRequests : ErrorCode.BadUserInput;
  return new GraphQLError(error.message, { extensions: { code, reason: error.reason } });
}

/**
 * Adds `ssoSetup`, `pairSso`, `updateSsoAppUrl` and `unpairSso` to the schema.
 *
 * @param schema - The schema, which must already have a Mutation type.
 * @returns The extended schema.
 */
export function applySsoExtension(schema: GraphQLSchema): GraphQLSchema {
  const extendedSchema = extendSchema(schema, SSO_SDL);
  const queries = assertObjectType(extendedSchema.getType('Query')).getFields();
  const mutations = assertObjectType(extendedSchema.getType('Mutation')).getFields();
  const { ssoSetup: setupField } = queries;
  const { pairSso, updateSsoAppUrl, unpairSso } = mutations;
  const isMissing = setupField === undefined || pairSso === undefined || unpairSso === undefined;
  if (isMissing || updateSsoAppUrl === undefined) {
    throw new Error('the SSO extension did not add its fields');
  }

  setupField.resolve = (_parent: unknown, _args: unknown, context: Context) => ssoSetup(context);

  pairSso.resolve = async (_parent: unknown, args: { setupUrl: string; appUrl?: string | null }, context: Context) => {
    throttle(context, AuthFlow.PairSso);
    const source = await requirePairing(context);
    if (source === SsoSource.Paired) {
      throw conflict('The homepage is already paired with a provider. Disconnect it first.');
    }
    if (args.setupUrl.trim() === '') {
      throw badInput('Paste the setup URL your provider gave you.');
    }
    const address = pairingAddress(context, args.appUrl);
    try {
      await pair(context.db, args.setupUrl, address);
    } catch (error) {
      throw pairingError(error);
    }
    await context.authHost.rebuild();
    return ssoSetup(context);
  };

  updateSsoAppUrl.resolve = async (_parent: unknown, args: { appUrl?: string | null }, context: Context) => {
    throttle(context, AuthFlow.PairSso);
    const source = await requirePairing(context);
    if (source !== SsoSource.Paired) {
      throw badInput('Sign-in is not paired with a provider, so there is no callback to move.');
    }
    const result = await repoint(context.db, pairingAddress(context, args.appUrl));
    await context.authHost.rebuild();
    return { setup: await ssoSetup(context), ...result };
  };

  unpairSso.resolve = async (_parent: unknown, _args: unknown, context: Context) => {
    await requirePairing(context);
    await unpair(context.db);
    await context.authHost.rebuild();
    return ssoSetup(context);
  };

  return extendedSchema;
}
