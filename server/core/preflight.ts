// Runs before anything listens, so a misconfigured instance fails with a sentence, not a stack trace.
// Whether Postgres answers is not checked here: it coming up after the app is normal (db/wait.ts).
import { accessSync, constants, mkdirSync } from 'node:fs';
import { parseTrustedProxies } from '../auth/forward-auth.ts';
import {
  configuredAuthSecret,
  databaseUrl,
  databaseUrlProblem,
  dataDir,
  describeWeakSecret,
  dockhandProblem,
  dockhandToken,
  dockhandUrl,
  forwardAuthTrustedProxies,
  isProduction,
  OIDC_CLIENT_AUTH_METHODS,
} from './config.ts';
import { errorMessage } from './errors.ts';

/**
 * Logs and exits 1.
 *
 * @param message - What's wrong and how to fix it.
 * @returns Never.
 */
function fatal(message: string): never {
  console.error(`[preflight] ${message}`);
  process.exit(1);
}

const urlProblem = databaseUrlProblem(databaseUrl());
if (urlProblem !== null) {
  fatal(urlProblem);
}

const discoveryProblem = dockhandProblem(dockhandUrl(), dockhandToken());
if (discoveryProblem !== null) {
  fatal(discoveryProblem);
}

const signInProblem = signInConfigProblem();
if (signInProblem !== null) {
  fatal(signInProblem);
}

/**
 * Checks the sign-in settings, so half a setup fails at boot instead of leaving no way to sign in.
 *
 * @returns What is wrong, as a sentence that says how to fix it; null when nothing is.
 */
function signInConfigProblem(): string | null {
  const issuer = (process.env.OIDC_ISSUER ?? '').trim();
  const clientId = (process.env.OIDC_CLIENT_ID ?? '').trim();
  const isHalfSet = (issuer === '') !== (clientId === '');
  if (isHalfSet) {
    return 'Set both OIDC_ISSUER and OIDC_CLIENT_ID, or neither (and pair a provider from the app instead).';
  }
  const isIssuerUrl = issuer === '' || URL.canParse(issuer);
  if (isIssuerUrl === false) {
    return `OIDC_ISSUER "${issuer}" is not a URL. It is the provider's issuer, such as https://id.example.com/oidc.`;
  }
  const clientAuth = (process.env.OIDC_CLIENT_AUTH ?? '').trim();
  const isKnownAuth = clientAuth === '' || OIDC_CLIENT_AUTH_METHODS.some((method) => method === clientAuth);
  if (isKnownAuth === false) {
    return `OIDC_CLIENT_AUTH "${clientAuth}" is not one of ${OIDC_CLIENT_AUTH_METHODS.join(', ')}.`;
  }
  try {
    parseTrustedProxies(forwardAuthTrustedProxies());
  } catch (error) {
    return errorMessage(error);
  }
  // Unset is fine: the server makes one and keeps it (auth/secret.ts). Set, it has to be strong.
  const configured = configuredAuthSecret() ?? '';
  const weakness = configured === '' ? undefined : describeWeakSecret(configured);
  if (isProduction() && weakness !== undefined) {
    return `BETTER_AUTH_SECRET ${weakness}. Set a strong random value: generate one with \`openssl rand -hex 32\`.`;
  }
  return null;
}

try {
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  accessSync(dir, constants.R_OK | constants.W_OK);
} catch (error) {
  fatal(`DATA_DIR "${dataDir()}" is not a directory this process can read and write: ${errorMessage(error)}`);
}
