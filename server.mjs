import { createServer as createNodeServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { brotliCompressSync, gzipSync, constants as zlibConstants } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { GameError, performAction, publicGame, spectatorView, ledgerPage, ledgerCsv, spectatorLedgerPage, balancesHidden } from './lib/game.mjs';
import { GameStore } from './lib/store.mjs';
import { RateLimiter } from './lib/rate-limit.mjs';
import { GameStreams } from './lib/streams.mjs';
import { summarizeGame, aggregateUsage, adminTokenMatches, bearerToken, RuntimeMetrics, MIN_ADMIN_TOKEN_LENGTH } from './lib/admin.mjs';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
export const DEFAULT_LIMITS = Object.freeze({ createPerHour: 20, apiPerMinute: 600 });

const ROOT = fileURLToPath(new URL('./public/', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8'
};

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  // Production is HTTPS-only; browsers ignore this header on plain-HTTP localhost.
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'self'; frame-ancestors 'none'"
};

// Compression: brotli for static files (compressed once per version and cached), gzip for dynamic
// responses (fast). Game state is very repetitive JSON, so this cuts what phones download by ~10x.
const MIN_COMPRESS = 1024;
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml|manifest\+json)|image\/svg\+xml)/;
const staticCache = new Map();

function acceptsEncoding(req, name) {
  return new RegExp(`\\b${name}\\b`).test(String(req?.headers['accept-encoding'] || ''));
}

/** Gzip a dynamic body when the client accepts it and it is worth it; returns [body, extra headers]. */
function compressDynamic(req, body) {
  if (body.length < MIN_COMPRESS || !acceptsEncoding(req, 'gzip')) return [body, { Vary: 'Accept-Encoding' }];
  return [gzipSync(body), { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' }];
}

function sendJson(res, status, value, headers = {}) {
  const [body, encoding] = compressDynamic(res.req, Buffer.from(JSON.stringify(value)));
  res.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', ...encoding, ...headers });
  res.end(body);
}

function sendCsv(res, game, options) {
  const [body, encoding] = compressDynamic(res.req, Buffer.from(ledgerCsv(game, options)));
  res.writeHead(200, {
    ...securityHeaders, 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', ...encoding,
    'Content-Disposition': `attachment; filename="monobank-activity-${new Date().toISOString().slice(0, 10)}.csv"`
  });
  res.end(body);
}

/** The static body to send: brotli or gzip when accepted (cached per file version), else the original. */
function staticBody(req, filePath, content, contentType, etag) {
  if (content.length < MIN_COMPRESS || !COMPRESSIBLE.test(contentType)) return { body: content, etag, headers: {} };
  const encoding = acceptsEncoding(req, 'br') ? 'br' : acceptsEncoding(req, 'gzip') ? 'gzip' : null;
  if (!encoding) return { body: content, etag, headers: { Vary: 'Accept-Encoding' } };
  const key = `${filePath}|${etag}|${encoding}`;
  if (!staticCache.has(key)) {
    for (const old of staticCache.keys()) if (old.startsWith(`${filePath}|`) && !old.startsWith(`${filePath}|${etag}|`)) staticCache.delete(old);
    staticCache.set(key, encoding === 'br'
      ? brotliCompressSync(content, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: content.length } })
      : gzipSync(content, { level: 9 }));
  }
  // Each encoding is a different representation, so it gets its own ETag.
  return { body: staticCache.get(key), etag: `${etag.slice(0, -1)}-${encoding}"`, headers: { 'Content-Encoding': encoding, Vary: 'Accept-Encoding' } };
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

/** Client address for rate limiting. Proxy headers are trusted only behind a known proxy. */
export function clientAddress(req, trustProxy) {
  const forwarded = trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
  return forwarded || req.socket.remoteAddress || 'unknown';
}

function enforce(limiter, key) {
  const result = limiter.take(key);
  if (!result.allowed) {
    const error = new GameError(`Too many requests. Please wait ${result.retryAfterSeconds} seconds and try again.`, 429);
    error.headers = { 'Retry-After': String(result.retryAfterSeconds) };
    throw error;
  }
}

// The admin page and its script exist only when an admin token is configured; they are never indexed.
const ADMIN_PAGES = { '/admin': 'admin.html', '/admin/': 'admin.html', '/admin.html': 'admin.html', '/admin.js': 'admin.js' };

export function createAppServer({ store = new GameStore(), limits = {}, trustProxy = false, streams: streamOptions = {}, adminToken = null, metrics = new RuntimeMetrics() } = {}) {
  const { createPerHour, apiPerMinute } = { ...DEFAULT_LIMITS, ...limits };
  const createLimiter = new RateLimiter({ limit: createPerHour, windowMs: HOUR });
  const apiLimiter = new RateLimiter({ limit: apiPerMinute, windowMs: MINUTE });
  // Wrong admin tokens are limited much harder than normal API use (10 per 15 minutes per address).
  const adminFailLimiter = new RateLimiter({ limit: 10, windowMs: 15 * MINUTE });
  const adminEnabled = typeof adminToken === 'string' && adminToken.length >= MIN_ADMIN_TOKEN_LENGTH;
  const streams = new GameStreams({ ...streamOptions, headers: securityHeaders });

  const openStream = (req, res, game, view) => {
    try {
      const client = streams.open(req, res, game, view);
      metrics.streams.opened += 1;
      return client;
    } catch (error) {
      metrics.streams.rejected += 1;
      throw error;
    }
  };

  const server = createNodeServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      res.on('finish', () => metrics.request(url.pathname, res.statusCode));
      if (req.method === 'GET' && url.pathname === '/health') {
        return sendJson(res, 200, { status: 'ok', service: 'monobank', storage: store.kind });
      }
      if (url.pathname.startsWith('/api/')) {
        const client = clientAddress(req, trustProxy);
        enforce(apiLimiter, client);
        if (req.method === 'POST' && url.pathname === '/api/games') enforce(createLimiter, client);
      }
      if (url.pathname === '/api/admin/stats') {
        if (!adminEnabled || req.method !== 'GET') throw new GameError('Not found.', 404);
        if (!adminTokenMatches(adminToken, bearerToken(req.headers.authorization))) {
          enforce(adminFailLimiter, clientAddress(req, trustProxy));
          const error = new GameError('That admin token is not right.', 401);
          error.headers = { 'WWW-Authenticate': 'Bearer' };
          throw error;
        }
        const { summaries, storageBytes } = await store.usage(summarizeGame);
        return sendJson(res, 200, {
          usage: aggregateUsage(summaries),
          storage: { kind: store.kind, bytes: storageBytes, gamesInMemory: store.games.size, retentionDays: Math.round(store.ttlMs / 86_400_000), finishedRetentionDays: Math.round(Math.min(store.endedTtlMs, store.ttlMs) / 86_400_000) },
          runtime: metrics.snapshot({ liveStreams: streams.total, memoryMb: Math.round(process.memoryUsage().rss / 1048576) })
        });
      }
      if (req.method === 'POST' && url.pathname === '/api/games') {
        const game = await store.create(await readJson(req));
        return sendJson(res, 201, publicGame(game));
      }
      const match = url.pathname.match(/^\/api\/games\/([a-f0-9]{16})(\/actions|\/events|\/transactions|\/activity\.csv)?$/);
      if (match) {
        const game = await store.get(match[1]);
        const [, , sub] = match;
        if (req.method === 'GET' && !sub) return sendJson(res, 200, publicGame(game));
        if (req.method === 'GET' && sub === '/events') return openStream(req, res, game, publicGame);
        if (req.method === 'GET' && sub === '/transactions') return sendJson(res, 200, ledgerPage(game, url.searchParams.get('before'), url.searchParams.get('limit') ?? undefined));
        if (req.method === 'GET' && sub === '/activity.csv') return sendCsv(res, game);
        if (req.method === 'POST' && sub === '/actions') {
          const action = await readJson(req);
          performAction(game, action);
          metrics.action(String(action.type));
          const saveStarted = performance.now();
          await store.save(game);
          metrics.save(performance.now() - saveStarted);
          streams.publish(game);
          return sendJson(res, 200, publicGame(game));
        }
      }
      // Spectator routes are read-only: there is no write route under /api/watch/.
      const watch = url.pathname.match(/^\/api\/watch\/([a-f0-9]{16})(\/events|\/transactions|\/activity\.csv)?$/);
      if (watch && req.method === 'GET') {
        const game = await store.getByWatchToken(watch[1]);
        if (watch[2] === '/events') return openStream(req, res, game, spectatorView);
        if (watch[2] === '/transactions') return sendJson(res, 200, spectatorLedgerPage(game, url.searchParams.get('before'), url.searchParams.get('limit') ?? undefined));
        if (watch[2] === '/activity.csv') return sendCsv(res, game, { hideBalances: balancesHidden(game) });
        return sendJson(res, 200, spectatorView(game));
      }
      if (url.pathname.startsWith('/api/')) throw new GameError('Not found.', 404);

      const adminPage = ADMIN_PAGES[url.pathname];
      if (adminPage && !adminEnabled) throw new GameError('Not found.', 404);
      const appRoute = url.pathname.startsWith('/game/') || url.pathname.startsWith('/watch/') || Boolean(adminPage);
      const requested = adminPage || (url.pathname === '/' || appRoute ? 'index.html' : url.pathname.slice(1));
      const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, '');
      const filePath = join(ROOT, safePath);
      if (!filePath.startsWith(ROOT)) throw new GameError('Not found.', 404);
      const content = await readFile(filePath);
      const extension = extname(filePath);
      // Every asset is revalidated (cheap 304s via ETag) so a deploy can never
      // leave browsers with new HTML but stale CSS or JavaScript.
      const contentType = MIME[extension] || 'application/octet-stream';
      const variant = staticBody(req, filePath, content, contentType, `"${createHash('sha1').update(content).digest('base64url')}"`);
      const etag = variant.etag;
      const headers = {
        ...securityHeaders,
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
        ETag: etag,
        ...variant.headers,
        // Game links and the admin page are private: keep them out of search results.
        ...(appRoute ? { 'X-Robots-Tag': 'noindex, nofollow' } : {}),
        ...(adminPage ? { 'Cache-Control': 'no-store' } : {})
      };
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, headers);
        return res.end();
      }
      res.writeHead(200, headers);
      res.end(variant.body);
    } catch (error) {
      if (error?.code === 'ENOENT') return sendJson(res, 404, { error: 'Not found.' });
      const status = error instanceof GameError ? error.status : 500;
      if (status === 500) console.error(error);
      metrics.error(status, error instanceof GameError ? error.code : undefined);
      const body = { error: status === 500 ? 'Something went wrong.' : error.message };
      if (status !== 500 && error.code) Object.assign(body, { code: error.code, details: error.details });
      sendJson(res, status, body, error.headers);
    }
  });
  const sweep = setInterval(() => {
    store.sweep().catch((error) => console.error('Sweep failed', error));
    createLimiter.sweep();
    apiLimiter.sweep();
  }, 15 * MINUTE);
  sweep.unref();
  server.on('close', () => clearInterval(sweep));
  // Open event streams would keep close() waiting forever, so end them first.
  const close = server.close.bind(server);
  server.close = (callback) => {
    streams.closeAll();
    return close(callback);
  };
  server.streams = streams;
  return server;
}

/** Build the store from environment settings, falling back to memory if the data directory is unusable. */
export async function storeFromEnv(env = process.env, logger = console) {
  const options = { maxGames: Number(env.MAX_GAMES) || undefined };
  if (!env.DATA_DIR) return new GameStore(options);
  try {
    return await new GameStore({ ...options, dataDir: env.DATA_DIR }).init();
  } catch (error) {
    logger.error(`Persistent storage at ${env.DATA_DIR} is unavailable; games will be kept in memory only.`, error);
    return new GameStore(options);
  }
}

/** The admin token from ADMIN_TOKEN, or null (admin page disabled) when unset or too short to be safe. */
export function adminTokenFromEnv(env = process.env, logger = console) {
  const token = String(env.ADMIN_TOKEN || '').trim();
  if (!token) return null;
  if (token.length < MIN_ADMIN_TOKEN_LENGTH) {
    logger.warn(`ADMIN_TOKEN is shorter than ${MIN_ADMIN_TOKEN_LENGTH} characters; the admin page stays disabled.`);
    return null;
  }
  return token;
}

export function limitsFromEnv(env = process.env) {
  return {
    createPerHour: Number(env.RATE_LIMIT_CREATE_PER_HOUR) || DEFAULT_LIMITS.createPerHour,
    apiPerMinute: Number(env.RATE_LIMIT_API_PER_MINUTE) || DEFAULT_LIMITS.apiPerMinute
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const store = await storeFromEnv();
  const server = createAppServer({ store, limits: limitsFromEnv(), trustProxy: process.env.TRUST_PROXY === '1', adminToken: adminTokenFromEnv() });
  server.listen(port, '0.0.0.0', () => console.log(`MonoBank is ready at http://localhost:${port} (${store.kind} storage)`));
  const shutdown = () => server.close(() => store.flush().finally(() => process.exit(0)));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
