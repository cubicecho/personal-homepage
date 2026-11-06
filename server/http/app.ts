import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { type Express, type Request } from 'express';
import { createYoga } from 'graphql-yoga';
import { type Access, AuthMode, authModeOf, readAccess } from '../auth/access.ts';
import type { AuthHost } from '../auth/auth-host.ts';
import { createForwardAuth, type ForwardAuth } from '../auth/forward-auth.ts';
import type { IconLinks } from '../auth/icon-links.ts';
import { createRateLimiter, type RateLimiter } from '../auth/rate-limit.ts';
import { authSecret, forwardAuthTrustedProxies, isProduction, trustProxy, weatherApiUrl } from '../core/config.ts';
import { type Context, type Services, UNKNOWN_IP } from '../core/context.ts';
import { HTTP_DEFAULTS } from '../core/defaults.ts';
import type { Database } from '../db/client.ts';
import { mountExport } from '../export/zip-export.ts';
import { createFrameChecker } from '../frames/frame-check.ts';
import { graphqlLogger } from '../graphql/logger.ts';
import { useOperationLimits } from '../graphql/operation-limits.ts';
import { buildSchema } from '../graphql/schema.ts';
import { mountIcons } from '../icons/http.ts';
import { createIconService } from '../icons/icon-service.ts';
import type { PageStore } from '../pages/page.ts';
import type { SiteSettings } from '../site/site-settings.ts';
import { createStatusChecker } from '../status/status-checker.ts';
import { createWidgetService } from '../widgets/widget-service.ts';
import { healthHandler } from './health.ts';
import { mountSso } from './sso.ts';

const GRAPHQL_ENDPOINT = '/graphql';
const HEALTH_ENDPOINT = '/healthz';
/** Every path but the server's own, so the web app's routes load index.html. */
const WEB_ROUTES = /^(?!\/(graphql|healthz|export\.zip)$)(?!\/icons\/|\/sso\/|\/api\/auth\/).*/;
/** Where `npm run build` puts the web app. */
export const WEB_DIST = fileURLToPath(new URL('../../dist', import.meta.url));

/** What the app is built from. Every service but the stores and the auth host is made here when left out. */
export interface AppDeps extends Partial<Omit<Services, 'pages' | 'site' | 'db' | 'authHost'>> {
  /** Where pages are kept. */
  pages: PageStore;
  /** Site-wide settings. */
  site: SiteSettings;
  /** The database users, sessions and the pairing are kept in. */
  db: Database;
  /** Hands out the current better-auth instance. */
  authHost: AuthHost;
  /** The data directory, where the icon caches live. */
  dataDir: string;
  /** What favicon links are signed with: the auth secret. The default is `authSecret()`. */
  authSecret?: string;
  /** Runs a trivial query, rejecting when the database doesn't answer. `/healthz` reports it. */
  checkDatabase: () => Promise<unknown>;
  /** The built web app's directory. Left out in tests. */
  dist?: string;
}

/** What Express hands Yoga beside the fetch request. */
interface ServerContext {
  req: Request;
}

/**
 * Copies Express's headers into fetch `Headers`.
 *
 * @param raw - The request's headers as Express parsed them.
 * @returns The same headers, repeated ones appended.
 */
function headersOf(raw: Request['headers']): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    for (const one of Array.isArray(value) ? value : [value ?? '']) {
      headers.append(name, one);
    }
  }
  return headers;
}

/**
 * Builds the Express app: GraphQL, health, the OIDC legs, export, icons, and the built web app when there
 * is one. It does not listen.
 *
 * @param deps - The stores, the database and auth host, the other services when a test replaces them, and
 * where things are.
 * @returns The app.
 */
export function createApp({
  dataDir,
  dist,
  checkDatabase,
  authSecret: secret = authSecret(),
  ...deps
}: AppDeps): Express {
  const forwardAuth: ForwardAuth = deps.forwardAuth ?? createForwardAuth(forwardAuthTrustedProxies());
  const limiter: RateLimiter = deps.limiter ?? createRateLimiter();
  const services: Services = {
    pages: deps.pages,
    site: deps.site,
    db: deps.db,
    authHost: deps.authHost,
    forwardAuth,
    limiter,
    status: deps.status ?? createStatusChecker(),
    frames: deps.frames ?? createFrameChecker(),
    icons: deps.icons ?? createIconService({ dataDir }),
    widgets: deps.widgets ?? createWidgetService({ weatherApiUrl: weatherApiUrl() }, { dataDir }),
  };
  const iconLinks = (): IconLinks => ({
    isRequired: authModeOf(services) === AuthMode.SignIn,
    secret,
    now: Date.now,
  });
  const accessFor = (req: Request): Promise<Access> =>
    readAccess(services, { headers: headersOf(req.headers), remoteAddress: req.socket.remoteAddress });

  const yoga = createYoga<ServerContext, Context>({
    schema: buildSchema(deps.db),
    graphqlEndpoint: GRAPHQL_ENDPOINT,
    logging: graphqlLogger,
    graphiql: isProduction() === false,
    plugins: [useOperationLimits()],
    context: async ({ request, req }) => ({
      ...services,
      // Asked per request: pairing a provider swaps the instance while the server runs.
      auth: services.authHost.current(),
      access: await accessFor(req),
      iconLinks: iconLinks(),
      headers: request.headers,
      ip: req.ip ?? UNKNOWN_IP,
    }),
  });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy());
  app.get(HEALTH_ENDPOINT, healthHandler(checkDatabase));
  app.use(GRAPHQL_ENDPOINT, express.json({ limit: HTTP_DEFAULTS.bodyLimit }));
  app.all(GRAPHQL_ENDPOINT, (req, res) => yoga(req, res, { req }));
  mountSso(app, services.authHost, services.db);
  mountExport(app, services, accessFor);
  mountIcons(app, services.pages, dataDir, { iconLinks });

  const hasWebBuild = dist !== undefined && existsSync(dist);
  if (hasWebBuild) {
    app.use(express.static(dist));
    app.get(WEB_ROUTES, (_req, res) => res.sendFile('index.html', { root: dist }));
  }
  return app;
}
