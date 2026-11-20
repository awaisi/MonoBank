import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createAppServer } from '../server.mjs';
import { GameStore } from '../lib/store.mjs';
import { GameStreams } from '../lib/streams.mjs';
import { createGame, publicGame, spectatorView } from '../lib/game.mjs';

// ------------------------------------------------------------- helpers ----

async function start(t, options = {}) {
  const server = createAppServer({ store: new GameStore(), ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { server, base, post };
}

/** Minimal SSE client: collects events and lets a test wait for the next one. */
async function subscribe(t, url) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  const events = [];
  const waiters = [];
  if (response.ok) {
    (async () => {
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let index;
          while ((index = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            const event = { type: 'message', data: '', comment: '' };
            for (const line of block.split('\n')) {
              if (line.startsWith(':')) event.comment += line.slice(1).trim();
              else if (line.startsWith('event: ')) event.type = line.slice(7);
              else if (line.startsWith('data: ')) event.data += line.slice(6);
              else if (line.startsWith('retry: ')) event.retry = Number(line.slice(7));
            }
            events.push(event);
            waiters.splice(0).forEach((wake) => wake());
          }
        }
      } catch { /* aborted */ }
    })();
  }
  t.after(() => controller.abort());
  const next = async (predicate = (event) => event.type === 'game', timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = events.findIndex(predicate);
      if (index >= 0) return events.splice(index, 1)[0];
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Timed out waiting for an event');
      await Promise.race([new Promise((resolve) => waiters.push(resolve)), new Promise((resolve) => setTimeout(resolve, remaining))]);
    }
  };
  return { response, next, close: () => controller.abort() };
}

const gameState = async (event) => JSON.parse(event.data);

// ------------------------------------------------------ live updates ----

test('event stream sends the game on connect and after every action', async (t) => {
  const { base, post } = await start(t);
  const game = await (await post('/api/games', { players: ['Ana', 'Ben'] })).json();
  const stream = await subscribe(t, `${base}/api/games/${game.id}/events`);
  assert.equal(stream.response.status, 200);
  assert.match(stream.response.headers.get('content-type'), /text\/event-stream/);
  assert.equal(stream.response.headers.get('cache-control'), 'no-store');
  assert.equal(stream.response.headers.get('x-robots-tag'), 'noindex');
  assert.equal((await stream.next((event) => event.retry != null)).retry, 3000);
  const initial = await gameState(await stream.next());
  assert.equal(initial.revision, game.revision);
  assert.equal(initial.id, game.id);

  await post(`/api/games/${game.id}/actions`, { type: 'transfer', fromId: game.players[0].id, toId: 'bank', amount: 100, expectedRevision: game.revision });
  const update = await gameState(await stream.next());
  assert.equal(update.revision, game.revision + 1);
  assert.equal(update.players[0].balance, 1400);
  assert.equal(update.history, undefined, 'snapshots are never streamed');
});

test('failed actions do not broadcast', async (t) => {
  const { base, post } = await start(t);
  const game = await (await post('/api/games', { players: ['Ana', 'Ben'] })).json();
  const stream = await subscribe(t, `${base}/api/games/${game.id}/events`);
  await stream.next();
  const rejected = await post(`/api/games/${game.id}/actions`, { type: 'transfer', fromId: game.players[0].id, toId: 'bank', amount: -1 });
  assert.equal(rejected.status, 400);
  await assert.rejects(stream.next(undefined, 300), /Timed out/);
});

test('streams for unknown games return 404', async (t) => {
  const { base } = await start(t);
  assert.equal((await fetch(`${base}/api/games/0123456789abcdef/events`)).status, 404);
  assert.equal((await fetch(`${base}/api/watch/0123456789abcdef/events`)).status, 404);
});

test('caps live connections per game with a 503', async (t) => {
  const { base, post } = await start(t, { streams: { maxPerGame: 1 } });
  const game = await (await post('/api/games', { players: ['Ana', 'Ben'] })).json();
  const first = await subscribe(t, `${base}/api/games/${game.id}/events`);
  await first.next();
  const second = await fetch(`${base}/api/games/${game.id}/events`);
  assert.equal(second.status, 503);
  assert.match((await second.json()).error, /Too many live connections/);
});

test('server.close ends open streams instead of hanging', async () => {
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const game = await (await fetch(`${base}/api/games`, { method: 'POST', body: JSON.stringify({ players: ['A', 'B'] }) })).json();
  const response = await fetch(`${base}/api/games/${game.id}/events`);
  const reader = response.body.getReader();
  await reader.read();
  assert.equal(server.streams.total, 1);
  await new Promise((resolve) => server.close(resolve));
  assert.equal(server.streams.total, 0);
  let done = false;
  while (!done) ({ done } = await reader.read());
});

// --------------------------------------------------------- spectators ----

test('spectator link shows the game read-only and never reveals the edit ID', async (t) => {
  const { base, post } = await start(t);
  // Balances visible to all, so the spectator payload can be checked for them too.
  const game = await (await post('/api/games', { players: ['Ana', 'Ben'], rules: { showAllBalances: true } })).json();
  assert.match(game.viewToken, /^[a-f0-9]{16}$/);
  assert.notEqual(game.viewToken, game.id);
  await post(`/api/games/${game.id}/actions`, { type: 'transfer', fromId: game.players[0].id, toId: 'bank', amount: 50 });

  const response = await fetch(`${base}/api/watch/${game.viewToken}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-robots-tag'), 'noindex');
  const text = await response.text();
  assert.equal(text.includes(game.id), false, 'the edit ID appears nowhere in the spectator payload');
  const view = JSON.parse(text);
  assert.equal(view.id, null);
  assert.equal(view.spectator, true);
  assert.equal(view.undo, null);
  assert.equal(view.players[0].balance, 1450);

  assert.equal((await post(`/api/watch/${game.viewToken}`, { type: 'undo' })).status, 404, 'no write route for spectators');
  assert.equal((await post(`/api/watch/${game.viewToken}/actions`, { type: 'undo' })).status, 404);
  assert.equal((await fetch(`${base}/api/watch/${game.id}`)).status, 404, 'the edit ID is not a spectator token');
  assert.equal((await fetch(`${base}/api/watch/not-a-token`)).status, 404);
  const page = await fetch(`${base}/watch/${game.viewToken}`);
  assert.match(await page.text(), /MonoBank/);
  assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
});

test('spectator streams receive live updates without the edit ID', async (t) => {
  const { base, post } = await start(t);
  const game = await (await post('/api/games', { players: ['Ana', 'Ben'], rules: { showAllBalances: true } })).json();
  const spectator = await subscribe(t, `${base}/api/watch/${game.viewToken}/events`);
  const player = await subscribe(t, `${base}/api/games/${game.id}/events`);
  assert.equal((await gameState(await spectator.next())).id, null);
  await player.next();
  await post(`/api/games/${game.id}/actions`, { type: 'transfer', fromId: 'bank', toId: game.players[1].id, amount: 200 });
  const watched = await spectator.next();
  assert.equal(watched.data.includes(game.id), false);
  assert.equal((await gameState(watched)).players[1].balance, 1700);
  assert.equal((await gameState(await player.next())).id, game.id);
});

test('spectatorView strips the ID and undo; publicGame keeps the view token for players', () => {
  const game = createGame({ players: ['A', 'B'] });
  assert.equal(publicGame(game).viewToken, game.viewToken);
  const view = spectatorView(game);
  assert.equal(view.id, null);
  assert.equal(view.undo, null);
  assert.equal(view.spectator, true);
  assert.equal(view.properties.length, 28);
});

// ------------------------------------------------------- GameStreams ----

function fakeConnection() {
  const req = new EventEmitter();
  const res = { chunks: [], headers: null, ended: false, writeHead(status, headers) { this.status = status; this.headers = headers; }, write(chunk) { this.chunks.push(chunk); }, end() { this.ended = true; } };
  return { req, res };
}

test('GameStreams sends heartbeats, cleans up on disconnect, and enforces a total cap', async () => {
  const streams = new GameStreams({ heartbeatMs: 20, maxTotal: 2, headers: { 'X-Test': '1' } });
  const game = { id: 'g1' };
  const a = fakeConnection();
  const b = fakeConnection();
  streams.open(a.req, a.res, game, () => ({ v: 1 }));
  streams.open(b.req, b.res, { id: 'g2' }, () => ({ v: 2 }));
  assert.equal(a.res.status, 200);
  assert.equal(a.res.headers['X-Test'], '1');
  assert.throws(() => streams.open(fakeConnection().req, fakeConnection().res, { id: 'g3' }, () => ({})), (error) => error.status === 503);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.ok(a.res.chunks.includes(': ping\n\n'), 'heartbeat comment sent');
  streams.publish({ id: 'g1' });
  assert.match(a.res.chunks.at(-1), /^event: game\ndata: \{"v":1\}\n\n$/);
  streams.publish({ id: 'nobody' });
  a.req.emit('close');
  a.req.emit('close');
  assert.equal(streams.total, 1);
  b.req.emit('close');
  assert.equal(streams.total, 0);
  assert.equal(streams.timer, null, 'heartbeat stops when nobody is listening');
  const c = fakeConnection();
  streams.open(c.req, c.res, game, () => ({}));
  streams.closeAll();
  assert.equal(c.res.ended, true);
  assert.equal(streams.total, 0);
});

// ------------------------------------------- store: spectator lookup ----

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'monobank-spectator-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const quietLogger = () => {
  const errors = [];
  return { errors, error: (...args) => errors.push(args.map(String).join(' ')) };
};

test('memory store finds games by spectator token and forgets them on delete', async () => {
  const store = new GameStore();
  const game = await store.create({ players: ['A', 'B'] });
  assert.equal(await store.getByWatchToken(game.viewToken), game);
  await assert.rejects(store.getByWatchToken('ffffffffffffffff'), (error) => error.status === 404);
  await assert.rejects(store.getByWatchToken('../x'), (error) => error.status === 404);
  await store.delete(game.id);
  await assert.rejects(store.getByWatchToken(game.viewToken), (error) => error.status === 404);
});

test('spectator links survive a restart and are removed with their game', async (t) => {
  const dir = await tempDir(t);
  const first = await new GameStore({ dataDir: dir }).init();
  const game = await first.create({ players: ['A', 'B'] });
  assert.deepEqual(JSON.parse(await readFile(join(dir, `watch-${game.viewToken}.json`), 'utf8')), { id: game.id });
  const restarted = await new GameStore({ dataDir: dir }).init();
  assert.equal((await restarted.getByWatchToken(game.viewToken)).id, game.id);
  await restarted.delete(game.id);
  assert.deepEqual(await readdir(dir), []);
});

test('games saved before spectator links existed get a token on load', async (t) => {
  const dir = await tempDir(t);
  const legacy = createGame({ players: ['A', 'B'] });
  delete legacy.viewToken;
  await writeFile(join(dir, `${legacy.id}.json`), JSON.stringify(legacy));
  const store = await new GameStore({ dataDir: dir }).init();
  const loaded = await store.get(legacy.id);
  assert.match(loaded.viewToken, /^[a-f0-9]{16}$/);
  await store.flush();
  const files = await readdir(dir);
  assert.ok(files.includes(`watch-${loaded.viewToken}.json`));
  assert.equal(JSON.parse(await readFile(join(dir, `${legacy.id}.json`), 'utf8')).viewToken, loaded.viewToken);
  const restarted = await new GameStore({ dataDir: dir }).init();
  assert.equal((await restarted.getByWatchToken(loaded.viewToken)).id, legacy.id);
});

test('rejects spectator files that are corrupt, invalid, or point at the wrong game', async (t) => {
  const dir = await tempDir(t);
  const logger = quietLogger();
  const seed = await new GameStore({ dataDir: dir }).init();
  const game = await seed.create({ players: ['A', 'B'] });
  await writeFile(join(dir, 'watch-aaaaaaaaaaaaaaaa.json'), '{nope');
  await writeFile(join(dir, 'watch-bbbbbbbbbbbbbbbb.json'), JSON.stringify({ id: '../../etc' }));
  await writeFile(join(dir, 'watch-cccccccccccccccc.json'), JSON.stringify({ id: game.id }));
  const store = await new GameStore({ dataDir: dir, logger }).init();
  await assert.rejects(store.getByWatchToken('aaaaaaaaaaaaaaaa'), (error) => error.status === 404);
  await assert.rejects(store.getByWatchToken('bbbbbbbbbbbbbbbb'), (error) => error.status === 404);
  await assert.rejects(store.getByWatchToken('cccccccccccccccc'), (error) => error.status === 404, 'token must match the game');
  await assert.rejects(store.getByWatchToken('dddddddddddddddd'), (error) => error.status === 404);
  assert.equal(logger.errors.length, 2);
});

test('sweep removes orphaned spectator files and logs unreadable ones', async (t) => {
  const dir = await tempDir(t);
  const logger = quietLogger();
  const real = await import('node:fs/promises');
  const seed = await new GameStore({ dataDir: dir }).init();
  const kept = await seed.create({ players: ['A', 'B'] });
  await writeFile(join(dir, 'watch-1111111111111111.json'), JSON.stringify({ id: 'ffffffffffffffff' }));
  await writeFile(join(dir, 'watch-2222222222222222.json'), JSON.stringify({ id: 'bad' }));
  await writeFile(join(dir, 'watch-3333333333333333.json'), JSON.stringify({ id: kept.id }));
  const fs = {
    ...real,
    readFile: async (path, ...rest) => {
      if (basename(path) === 'watch-3333333333333333.json') throw Object.assign(new Error('locked'), { code: 'EACCES' });
      return real.readFile(path, ...rest);
    }
  };
  const store = await new GameStore({ dataDir: dir, logger, fs }).init();
  await store.get(kept.id);
  await store.sweep();
  const files = (await readdir(dir)).sort();
  assert.deepEqual(files, [`${kept.id}.json`, 'watch-3333333333333333.json', `watch-${kept.viewToken}.json`].sort());
  assert.match(logger.errors.join('\n'), /Could not inspect spectator link 3333333333333333/);
});

test('sweep keeps spectator files whose game is only on disk, and rethrows unexpected stat errors as logs', async (t) => {
  const dir = await tempDir(t);
  const logger = quietLogger();
  const real = await import('node:fs/promises');
  const seed = await new GameStore({ dataDir: dir }).init();
  const diskOnly = await seed.create({ players: ['A', 'B'] });
  const other = await seed.create({ players: ['C', 'D'] });
  const fs = {
    ...real,
    stat: async (path) => {
      if (basename(path) === `${other.id}.json`) {
        const error = Object.assign(new Error('io'), { code: 'EIO' });
        throw error;
      }
      return real.stat(path);
    }
  };
  const store = await new GameStore({ dataDir: dir, logger, fs }).init();
  await store.sweep();
  const files = await readdir(dir);
  assert.ok(files.includes(`watch-${diskOnly.viewToken}.json`), 'game exists only on disk');
  assert.ok(files.includes(`watch-${other.viewToken}.json`), 'kept when the game cannot be checked');
  assert.match(logger.errors.join('\n'), /Could not inspect spectator link/);
});

test('spectator file write failures are logged, not thrown', async (t) => {
  const dir = await tempDir(t);
  const logger = quietLogger();
  const real = await import('node:fs/promises');
  const fs = {
    ...real,
    writeFile: async (path, ...rest) => {
      if (basename(path).startsWith('watch-')) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      return real.writeFile(path, ...rest);
    }
  };
  const store = await new GameStore({ dataDir: dir, logger, fs }).init();
  const game = await store.create({ players: ['A', 'B'] });
  assert.match(logger.errors[0], /Could not save spectator link/);
  assert.equal(await store.getByWatchToken(game.viewToken), game, 'still works from memory');
});
