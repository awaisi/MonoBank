import { createGzip, constants as zlibConstants } from 'node:zlib';
import { GameError } from './game.mjs';

/**
 * Server-sent event fan-out: every open stream for a game receives the new
 * game state after each change. Each subscriber has its own `view` function
 * (players get the full public game, spectators a read-only view).
 *
 * In-memory only, which matches MonoBank's single-instance hosting.
 */
export class GameStreams {
  constructor({ maxPerGame = 50, maxTotal = 2000, heartbeatMs = 25_000, headers = {} } = {}) {
    this.maxPerGame = maxPerGame;
    this.maxTotal = maxTotal;
    this.heartbeatMs = heartbeatMs;
    this.headers = headers;
    this.byGame = new Map();
    this.timer = null;
  }

  /** Number of open streams across all games. */
  get total() {
    let count = 0;
    for (const clients of this.byGame.values()) count += clients.size;
    return count;
  }

  /** Start streaming `game` to `res`. Throws a 503 GameError when limits are reached. */
  open(req, res, game, view) {
    const clients = this.byGame.get(game.id) ?? new Set();
    if (this.total >= this.maxTotal || clients.size >= this.maxPerGame) {
      throw new GameError('Too many live connections right now. The game still updates every few seconds.', 503);
    }
    // Each update is the full game state (tens of KB), so compress the stream when the client allows it.
    // Z_SYNC_FLUSH pushes every event out immediately instead of waiting for the compressor's buffer to fill.
    const gzip = /\bgzip\b/.test(String(req.headers?.['accept-encoding'] || ''));
    res.writeHead(200, {
      ...this.headers,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      'X-Robots-Tag': 'noindex',
      Vary: 'Accept-Encoding',
      ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
      Connection: 'keep-alive'
    });
    let out = res;
    if (gzip) {
      out = createGzip({ flush: zlibConstants.Z_SYNC_FLUSH });
      out.pipe(res);
    }
    out.write('retry: 3000\n\n');
    const client = { res, out, view };
    clients.add(client);
    this.byGame.set(game.id, clients);
    this.#send(client, game);
    req.on('close', () => this.#remove(game.id, client));
    this.#startHeartbeat();
    return client;
  }

  /** Send the latest state of `game` to everyone watching it. */
  publish(game) {
    for (const client of this.byGame.get(game.id) ?? []) this.#send(client, game);
  }

  /** End every stream (graceful shutdown). */
  closeAll() {
    for (const clients of this.byGame.values()) for (const client of clients) client.out.end();
    this.byGame.clear();
    this.#stopHeartbeat();
  }

  #send(client, game) {
    client.out.write(`event: game\ndata: ${JSON.stringify(client.view(game))}\n\n`);
  }

  #remove(gameId, client) {
    const clients = this.byGame.get(gameId);
    if (!clients) return;
    clients.delete(client);
    if (client.out !== client.res) client.out.destroy();
    if (!clients.size) this.byGame.delete(gameId);
    if (!this.byGame.size) this.#stopHeartbeat();
  }

  // Comment lines keep idle connections open through proxies and load balancers.
  #startHeartbeat() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      for (const clients of this.byGame.values()) for (const client of clients) client.out.write(': ping\n\n');
    }, this.heartbeatMs);
    this.timer.unref();
  }

  #stopHeartbeat() {
    clearInterval(this.timer);
    this.timer = null;
  }
}
