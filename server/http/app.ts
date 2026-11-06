import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import { createYoga } from 'graphql-yoga';
import { isProduction, trustProxy } from '../core/config.ts';
import type { Context } from '../core/context.ts';
import { HTTP_DEFAULTS } from '../core/defaults.ts';
import { graphqlLogger } from '../graphql/logger.ts';
import { useOperationLimits } from '../graphql/operation-limits.ts';
import { schema } from '../graphql/schema.ts';
import type { PageStore } from '../pages/page.ts';
import { healthHandler } from './health.ts';

const GRAPHQL_ENDPOINT = '/graphql';
const HEALTH_ENDPOINT = '/healthz';
/** Every path but the API's, so the web app's own routes load index.html. */
const WEB_ROUTES = /^(?!\/(graphql|healthz)$).*/;
/** Where `npm run build` puts the web app. */
const WEB_DIST = fileURLToPath(new URL('../../dist', import.meta.url));

/** What the app is built from. */
export interface AppDeps {
  /** Where pages are kept. Tests pass a store over a temporary directory. */
  pages: PageStore;
  /** The built web app's directory. Left out in tests. */
  dist?: string;
}

/**
 * Builds the Express app: GraphQL, health, and the built web app when there is one. It does not listen.
 *
 * @param deps - The page store, and where the built web app is.
 * @returns The app.
 */
export function createApp({ pages, dist }: AppDeps): Express {
  const yoga = createYoga<Record<string, never>, Context>({
    schema,
    graphqlEndpoint: GRAPHQL_ENDPOINT,
    logging: graphqlLogger,
    graphiql: isProduction() === false,
    plugins: [useOperationLimits()],
    context: () => ({ pages }),
  });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy());
  app.get(HEALTH_ENDPOINT, healthHandler());
  app.use(GRAPHQL_ENDPOINT, express.json({ limit: HTTP_DEFAULTS.bodyLimit }));
  app.all(GRAPHQL_ENDPOINT, (req, res) => yoga(req, res));

  const hasWebBuild = dist !== undefined && existsSync(dist);
  if (hasWebBuild) {
    app.use(express.static(dist));
    app.get(WEB_ROUTES, (_req, res) => res.sendFile('index.html', { root: dist }));
  }
  return app;
}

export { WEB_DIST };
