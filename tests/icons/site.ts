// A small site for the icon tests to fetch favicons from, on a loopback port, counting its requests.
import { createServer, type Server } from 'node:http';
import { portOf } from '../helpers.ts';

/** A minimal PNG: the signature and a little more. */
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
/** A minimal ICO: its header and a little more. */
export const ICO_BYTES = new Uint8Array([0x00, 0x00, 0x01, 0x00, 1, 2, 3, 4]);
/** A small SVG. */
export const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>';

/** One response the site gives. */
export interface Route {
  status?: number;
  type?: string;
  body: string | Uint8Array;
}

/** The running site. */
export interface TestSite {
  /** `http://127.0.0.1:<port>`. */
  base: string;
  /** What each path answers. Change it between requests to change the site. */
  routes: Map<string, Route>;
  /** How many times each path was asked for. */
  hits: Map<string, number>;
  close(): Promise<void>;
}

/**
 * Starts the site.
 *
 * @returns The site, listening.
 */
export async function startSite(): Promise<TestSite> {
  const routes = new Map<string, Route>();
  const hits = new Map<string, number>();
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    hits.set(url.pathname, (hits.get(url.pathname) ?? 0) + 1);
    const route = routes.get(url.pathname);
    if (route === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    const headers: Record<string, string> = {};
    if (route.type !== undefined) {
      headers['content-type'] = route.type;
    }
    res.writeHead(route.status ?? 200, headers).end(route.body);
  });
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  return {
    base: `http://127.0.0.1:${portOf(server)}`,
    routes,
    hits,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
