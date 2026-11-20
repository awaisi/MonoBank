import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RateLimiter } from '../lib/rate-limit.mjs';
import { GameStore } from '../lib/store.mjs';
import { createAppServer, clientAddress, storeFromEnv, limitsFromEnv, DEFAULT_LIMITS } from '../server.mjs';

// ------------------------------------------------------------ RateLimiter --

test('allows requests up to the limit, then reports when to retry', () => {
  let clock = 0;
  const limiter = new RateLimiter({ limit: 3, windowMs: 10_000, now: () => clock });
  assert.deepEqual(limiter.take('a'), { allowed: true, remaining: 2, retryAfterSeconds: 0 });
  limiter.take('a');
  assert.equal(limiter.take('a').remaining, 0);
  clock = 2500;
  assert.deepEqual(limiter.take('a'), { allowed: false, remaining: 0, retryAfterSeconds: 8 });
  assert.equal(limiter.take('b').allowed, true, 'keys are independent');
  clock = 10_000;
  assert.equal(limiter.take('a').allowed, true, 'a new window starts');
});

test('retry-after is never less than one second', () => {
  let clock = 0;
  const limiter = new RateLimiter({ limit: 1, windowMs: 1000, now: () => clock });
  limiter.take('a');
  clock = 999.9;
  assert.equal(limiter.take('a').retryAfterSeconds, 1);
});

test('sweep drops expired windows and the key table is bounded', () => {
  let clock = 0;
  const limiter = new RateLimiter({ limit: 5, windowMs: 1000, now: () => clock, maxKeys: 2 });
  limiter.take('a');
  limiter.take('b');
  clock = 1500;
  limiter.take('c'); // table full of expired windows: swept to make room
  assert.deepEqual([...limiter.windows.keys()], ['c']);
  limiter.take('d');
  limiter.take('e'); // table full of live windows: cleared rather than growing
  assert.deepEqual([...limiter.windows.keys()], ['e']);
  clock = 5000;
  limiter.sweep();
  assert.equal(limiter.windows.size, 0);
});

test('rejects invalid configuration', () => {
  assert.throws(() => new RateLimiter({ limit: 0, windowMs: 1000 }), /positive/);
  assert.throws(() => new RateLimiter({ limit: 1, windowMs: -1 }), /positive/);
});

// ------------------------------------------------------- server limiting --

async function start(t, options = {}) {
  const server = createAppServer({ store: new GameStore(), ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}
const create = (base, headers = {}) => fetch(`${base}/api/games`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ players: ['A', 'B'] })
});

test('limits game creation per client with 429 and Retry-After', async (t) => {
  const base = await start(t, { limits: { createPerHour: 2 } });
  assert.equal((await create(base)).status, 201);
  assert.equal((await create(base)).status, 201);
  const limited = await create(base);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 3000);
  assert.match((await limited.json()).error, /Too many requests/);
});

test('limits overall API traffic per client but never the health check or static files', async (t) => {
  const base = await start(t, { limits: { apiPerMinute: 3 } });
  const game = await (await create(base)).json();
  await fetch(`${base}/api/games/${game.id}`);
  await fetch(`${base}/api/games/${game.id}`);
  const limited = await fetch(`${base}/api/games/${game.id}`);
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('retry-after'));
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/`)).status, 200);
});

test('uses X-Forwarded-For only when the proxy is trusted', async (t) => {
  const trusted = await start(t, { limits: { createPerHour: 1 }, trustProxy: true });
  assert.equal((await create(trusted, { 'x-forwarded-for': '203.0.113.1, 10.0.0.1' })).status, 201);
  assert.equal((await create(trusted, { 'x-forwarded-for': '203.0.113.2' })).status, 201, 'different client');
  assert.equal((await create(trusted, { 'x-forwarded-for': '203.0.113.1' })).status, 429, 'same client');

  const untrusted = await start(t, { limits: { createPerHour: 1 } });
  assert.equal((await create(untrusted, { 'x-forwarded-for': '203.0.113.9' })).status, 201);
  assert.equal((await create(untrusted, { 'x-forwarded-for': '198.51.100.7' })).status, 429, 'spoofed header ignored');
});

test('clientAddress falls back to the socket address', () => {
  const req = (headers, remoteAddress) => ({ headers, socket: { remoteAddress } });
  assert.equal(clientAddress(req({ 'x-forwarded-for': ' 1.2.3.4 , 5.6.7.8' }, '9.9.9.9'), true), '1.2.3.4');
  assert.equal(clientAddress(req({}, '9.9.9.9'), true), '9.9.9.9');
  assert.equal(clientAddress(req({ 'x-forwarded-for': '1.2.3.4' }, '9.9.9.9'), false), '9.9.9.9');
  assert.equal(clientAddress(req({}, undefined), false), 'unknown');
});

test('capacity errors reach the client as 503', async (t) => {
  const base = await start(t, { store: new GameStore({ maxGames: 1 }) });
  assert.equal((await create(base)).status, 201);
  const full = await create(base);
  assert.equal(full.status, 503);
  assert.match((await full.json()).error, /capacity/);
});

test('health reports the storage mode', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'monobank-health-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const memory = await start(t);
  assert.deepEqual(await (await fetch(`${memory}/health`)).json(), { status: 'ok', service: 'monobank', storage: 'memory' });
  const file = await start(t, { store: await new GameStore({ dataDir: dir }).init() });
  assert.equal((await (await fetch(`${file}/health`)).json()).storage, 'file');
});

test('games survive a server restart when using file storage', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'monobank-restart-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const first = await start(t, { store: await new GameStore({ dataDir: dir }).init() });
  const game = await (await create(first)).json();
  const paid = await fetch(`${first}/api/games/${game.id}/actions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'transfer', fromId: game.players[0].id, toId: 'bank', amount: 250, expectedRevision: game.revision })
  });
  assert.equal(paid.status, 200);
  const second = await start(t, { store: await new GameStore({ dataDir: dir }).init() });
  const reloaded = await (await fetch(`${second}/api/games/${game.id}`)).json();
  assert.equal(reloaded.players[0].balance, 1250);
  assert.equal(reloaded.undo.label, 'A paid Bank');
});

// --------------------------------------------------------- configuration --

test('storeFromEnv picks memory, file, or falls back when the directory is unusable', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'monobank-env-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.equal((await storeFromEnv({})).kind, 'memory');
  const file = await storeFromEnv({ DATA_DIR: join(dir, 'games'), MAX_GAMES: '42' });
  assert.equal(file.kind, 'file');
  assert.equal(file.maxGames, 42);
  const blocker = join(dir, 'blocker');
  await writeFile(blocker, 'x');
  const errors = [];
  const fallback = await storeFromEnv({ DATA_DIR: blocker }, { error: (message) => errors.push(message) });
  assert.equal(fallback.kind, 'memory');
  assert.match(errors[0], /unavailable/);
  assert.equal((await storeFromEnv({ MAX_GAMES: 'lots' })).maxGames, 5000);
});

test('limitsFromEnv reads overrides and ignores invalid values', () => {
  assert.deepEqual(limitsFromEnv({}), DEFAULT_LIMITS);
  assert.deepEqual(limitsFromEnv({ RATE_LIMIT_CREATE_PER_HOUR: '5', RATE_LIMIT_API_PER_MINUTE: '50' }), { createPerHour: 5, apiPerMinute: 50 });
  assert.deepEqual(limitsFromEnv({ RATE_LIMIT_CREATE_PER_HOUR: 'many' }), DEFAULT_LIMITS);
});
