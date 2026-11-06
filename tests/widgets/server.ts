// A small source for the widget tests to fetch from, on a loopback port: each path is a handler, and
// every request is counted.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { portOf } from '../helpers.ts';

/** Answers one request. */
export type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

/** The running source. */
export interface TestSource {
  /** `http://127.0.0.1:<port>`. */
  base: string;
  /** What each path answers. Change it between requests to change the source. */
  routes: Map<string, Handler>;
  /** How many times each path was asked for. */
  hits: Map<string, number>;
  close(): Promise<void>;
}

/**
 * Answers with JSON.
 *
 * @param data - What to send.
 * @param [status] - The status.
 * @returns The handler.
 */
export function json(data: unknown, status = 200): Handler {
  return (_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
  };
}

/**
 * Answers with text.
 *
 * @param text - What to send.
 * @param [type] - Its content type.
 * @returns The handler.
 */
export function text(text: string, type = 'text/plain'): Handler {
  return (_req, res) => {
    res.writeHead(200, { 'content-type': type }).end(text);
  };
}

/**
 * Starts the source.
 *
 * @returns The source, listening.
 */
export async function startSource(): Promise<TestSource> {
  const routes = new Map<string, Handler>();
  const hits = new Map<string, number>();
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    hits.set(url.pathname, (hits.get(url.pathname) ?? 0) + 1);
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const handler = routes.get(url.pathname);
      if (handler === undefined) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        return;
      }
      handler(req, res, Buffer.concat(chunks).toString('utf-8'));
    });
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
