import { createServer as createNodeServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameError, GameStore, performAction, publicGame } from './lib/game.mjs';

const ROOT = fileURLToPath(new URL('./public/', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json'
};

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'self'; frame-ancestors 'none'"
};

function sendJson(res, status, value) {
  res.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new GameError('Request is too large.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new GameError('Invalid JSON.'); }
}

export function createAppServer({ store = new GameStore() } = {}) {
  const server = createNodeServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') {
        return sendJson(res, 200, { status: 'ok', service: 'monobank' });
      }
      if (req.method === 'POST' && url.pathname === '/api/games') {
        const game = store.create(await readJson(req));
        return sendJson(res, 201, publicGame(game));
      }
      const match = url.pathname.match(/^\/api\/games\/([a-f0-9]{16})(?:\/actions)?$/);
      if (match) {
        const game = store.get(match[1]);
        if (req.method === 'GET' && !url.pathname.endsWith('/actions')) return sendJson(res, 200, publicGame(game));
        if (req.method === 'POST' && url.pathname.endsWith('/actions')) {
          performAction(game, await readJson(req));
          return sendJson(res, 200, publicGame(game));
        }
      }
      if (url.pathname.startsWith('/api/')) throw new GameError('Not found.', 404);

      const requested = url.pathname === '/' || url.pathname.startsWith('/game/') ? 'index.html' : url.pathname.slice(1);
      const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, '');
      const filePath = join(ROOT, safePath);
      if (!filePath.startsWith(ROOT)) throw new GameError('Not found.', 404);
      const content = await readFile(filePath);
      const extension = extname(filePath);
      res.writeHead(200, {
        ...securityHeaders,
        'Content-Type': MIME[extension] || 'application/octet-stream',
        'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=3600'
      });
      res.end(content);
    } catch (error) {
      if (error?.code === 'ENOENT') return sendJson(res, 404, { error: 'Not found.' });
      const status = error instanceof GameError ? error.status : 500;
      if (status === 500) console.error(error);
      sendJson(res, status, { error: status === 500 ? 'Something went wrong.' : error.message });
    }
  });
  const sweep = setInterval(() => store.sweep(), 15 * 60 * 1000);
  sweep.unref();
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const server = createAppServer();
  server.listen(port, '0.0.0.0', () => console.log(`MonoBank is ready at http://localhost:${port}`));
}
