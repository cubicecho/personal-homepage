import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import { createYoga } from 'graphql-yoga';
import { isProduction, trustProxy } from '../core/config.ts';
import type { Context, Services } from '../core/context.ts';
import { HTTP_DEFAULTS } from '../core/defaults.ts';
import { mountExport } from '../export/zip-export.ts';
import { createFrameChecker } from '../frames/frame-check.ts';
import { graphqlLogger } from '../graphql/logger.ts';
import { useOperationLimits } from '../graphql/operation-limits.ts';
import { schema } from '../graphql/schema.ts';
import { mountIcons } from '../icons/http.ts';
import { createIconService } from '../icons/icon-service.ts';
import { createSiteSettings } from '../site/site-settings.ts';
import { createStatusChecker } from '../status/status-checker.ts';
import { healthHandler } from './health.ts';

const GRAPHQL_ENDPOINT = '/graphql';
const HEALTH_ENDPOINT = '/healthz';
/** Every path but the server's own, so the web app's routes load index.html. */
const WEB_ROUTES = /^(?!\/(graphql|healthz|export\.zip)$)(?!\/icons\/).*/;
/** Where `npm run build` puts the web app. */
export const WEB_DIST = fileURLToPath(new URL('../../dist', import.meta.url));

/** What the app is built from. Every service but the page store is made here when left out. */
export interface AppDeps extends Pick<Services, 'pages'>, Partial<Omit<Services, 'pages'>> {
  /** The data directory: what the export zips, and where icon caches live. */
  dataDir: string;
  /** The built web app's directory. Left out in tests. */
  dist?: string;
}

/**
 * Builds the Express app: GraphQL, health, export, icons, and the built web app when there is one. It does not listen.
 *
 * @param deps - The page store, the other services when a test replaces them, and where things are.
 * @returns The app.
 */
export function createApp({ dataDir, dist, ...deps }: AppDeps): Express {
  const services: Services = {
    pages: deps.pages,
    status: deps.status ?? createStatusChecker(),
    frames: deps.frames ?? createFrameChecker(),
    icons: deps.icons ?? createIconService({ dataDir }),
    site: deps.site ?? createSiteSettings(),
  };
  const yoga = createYoga<Record<string, never>, Context>({
    schema,
    graphqlEndpoint: GRAPHQL_ENDPOINT,
    logging: graphqlLogger,
    graphiql: isProduction() === false,
    plugins: [useOperationLimits()],
    context: () => services,
  });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy());
  app.get(HEALTH_ENDPOINT, healthHandler());
  app.use(GRAPHQL_ENDPOINT, express.json({ limit: HTTP_DEFAULTS.bodyLimit }));
  app.all(GRAPHQL_ENDPOINT, (req, res) => yoga(req, res));
  mountExport(app, dataDir);
  mountIcons(app, services.pages, dataDir);

  const hasWebBuild = dist !== undefined && existsSync(dist);
  if (hasWebBuild) {
    app.use(express.static(dist));
    app.get(WEB_ROUTES, (_req, res) => res.sendFile('index.html', { root: dist }));
  }
  return app;
}
