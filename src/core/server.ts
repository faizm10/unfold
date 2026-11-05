import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FlowState, LogLine } from './model.js';
import type { Session } from './session.js';

const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui');
const STATIC: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
};

export interface UiServer {
  url: string;
  /** Resolves when the first browser connects (or after `ms`). */
  waitForClient(ms: number): Promise<boolean>;
  close(): Promise<void>;
}

/** Serves the UI and streams state over SSE. Binds to loopback only. */
export async function startServer(session: Session, port = Number(process.env.UNFOLD_PORT) || 4317): Promise<UiServer> {
  const clients = new Set<ServerResponse>();
  let clientWaiters: (() => void)[] = [];
  let pendingLogs = new Map<number, LogLine>();
  let flushTimer: NodeJS.Timeout | undefined;
  let actualPort = port;

  const send = (res: ServerResponse, type: string, data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  const broadcast = (type: string, data: unknown) => clients.forEach((c) => send(c, type, data));

  const flush = () => {
    flushTimer = undefined;
    if (pendingLogs.size) broadcast('logs', [...pendingLogs.values()]);
    pendingLogs = new Map();
    broadcast('state', session.state satisfies FlowState);
  };

  session.subscribe((event) => {
    if (event.type === 'log') pendingLogs.set(event.line.seq, event.line);
    if (event.type === 'run.started' || event.type === 'run.ended' || event.type === 'fix.ready') {
      if (flushTimer) clearTimeout(flushTimer);
      if (event.type === 'run.started') broadcast('reset', null);
      flush();
    } else {
      flushTimer ??= setTimeout(flush, 60);
    }
  });

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    // Reject requests addressed to other hostnames (DNS-rebinding protection).
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (host !== '127.0.0.1' && host !== 'localhost') {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const path = (req.url ?? '/').split('?')[0]!;

    if (path === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      clients.add(res);
      send(res, 'snapshot', { state: session.state, logs: session.logs });
      clientWaiters.forEach((w) => w());
      clientWaiters = [];
      req.on('close', () => clients.delete(res));
      return;
    }
    if (path === '/api/state') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ state: session.state, logs: session.logs }));
      return;
    }
    const file = STATIC[path];
    if (req.method === 'GET' && file) {
      try {
        const body = await readFile(join(UI_DIR, file[0]));
        res.writeHead(200, { 'content-type': file[1], 'cache-control': 'no-store' }).end(body);
      } catch {
        res.writeHead(500).end('UI assets missing. Run `npm run build`.');
      }
      return;
    }
    res.writeHead(404).end('Not found');
  };

  const server: Server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve, reject) => {
    const tryListen = (p: number, attempts: number) => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && attempts > 0) tryListen(p === 0 ? 0 : p + 1, attempts - 1);
        else reject(err);
      });
      server.listen(p, '127.0.0.1', () => {
        actualPort = (server.address() as { port: number }).port;
        resolve();
      });
    };
    tryListen(port, 20);
  });

  return {
    url: `http://127.0.0.1:${actualPort}/`,
    waitForClient(ms) {
      if (clients.size) return Promise.resolve(true);
      return new Promise((resolve) => {
        const t = setTimeout(() => resolve(false), ms);
        clientWaiters.push(() => {
          clearTimeout(t);
          resolve(true);
        });
      });
    },
    close() {
      clients.forEach((c) => c.end());
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
