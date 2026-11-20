import test from 'node:test';
import assert from 'node:assert/strict';
import * as realFs from 'node:fs/promises';
import { mkdtemp, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adminTokenMatches, bearerToken, summarizeGame, aggregateUsage, RuntimeMetrics, ACTION_TYPES, MIN_ADMIN_TOKEN_LENGTH } from '../lib/admin.mjs';
import { createGame, performAction } from '../lib/game.mjs';
import { GameStore } from '../lib/store.mjs';
import { createAppServer, adminTokenFromEnv } from '../server.mjs';

const TOKEN = 'test-admin-token-0123456789abcdef';
const DAY = 24 * 60 * 60 * 1000;
const makeGame = (names = ['Ana', 'Ben', 'Cy'], options = {}) => createGame({ players: names, startingBalance: 1500, ...options });
const act = (game, action) => performAction(game, action);

// ---------------------------------------------------------------- token ----

test('admin tokens match only exactly, and short tokens never match', () => {
  assert.equal(adminTokenMatches(TOKEN, TOKEN), true);
  assert.equal(adminTokenMatches(TOKEN, `${TOKEN}x`), false);
  assert.equal(adminTokenMatches(TOKEN, ''), false);
  assert.equal(adminTokenMatches(TOKEN, undefined), false);
  assert.equal(adminTokenMatches('short', 'short'), false, `tokens under ${MIN_ADMIN_TOKEN_LENGTH} characters are refused`);
  assert.equal(adminTokenMatches(null, TOKEN), false);
});

test('bearer tokens are read from the Authorization header', () => {
  assert.equal(bearerToken(`Bearer ${TOKEN}`), TOKEN);
  assert.equal(bearerToken(`bearer   ${TOKEN}  `), TOKEN);
  assert.equal(bearerToken(`Basic ${TOKEN}`), '');
  assert.equal(bearerToken(undefined), '');
});

test('the admin token comes from ADMIN_TOKEN only when it is long enough', () => {
  const warnings = [];
  const logger = { warn: (message) => warnings.push(message) };
  assert.equal(adminTokenFromEnv({}, logger), null);
  assert.equal(adminTokenFromEnv({ ADMIN_TOKEN: '   ' }, logger), null);
  assert.equal(adminTokenFromEnv({ ADMIN_TOKEN: 'too-short' }, logger), null);
  assert.match(warnings[0], /shorter than 24 characters/);
  assert.equal(adminTokenFromEnv({ ADMIN_TOKEN: `  ${TOKEN}\n` }, logger), TOKEN);
});

// ------------------------------------------------------------ summaries ----

test('a game summary counts moves, actions and notes, without IDs or names', () => {
  const game = makeGame(['Ana', 'Ben', 'Cy'], { rules: { freeParkingJackpot: true } });
  const [ana, ben, cy] = game.players;
  act(game, { type: 'transfer', fromId: 'bank', toId: ana.id, amount: 200, note: 'Passed GO' });
  act(game, { type: 'transfer', fromId: ben.id, toId: 'parking', amount: 200, note: 'Income Tax', category: 'tax' });
  act(game, { type: 'buy', playerId: cy.id, propertyId: 'boardwalk' });
  act(game, { type: 'rent', payerId: ana.id, propertyId: 'boardwalk' });
  act(game, { type: 'transfer', fromId: ana.id, toId: ben.id, amount: 5 });
  act(game, { type: 'undo' });
  const summary = summarizeGame(game);
  assert.equal(summary.players, 3);
  assert.equal(summary.moves, 4, 'opening, the undone move and the undo are not moves');
  assert.deepEqual(summary.actions, { system: 1, transfer: 1, tax: 1, purchase: 1, rent: 1, undo: 1 });
  assert.deepEqual(summary.notes, { 'passed go': 1, 'income tax': 1 });
  assert.equal(summary.rules.freeParkingJackpot, true);
  assert.equal(summary.finish, null);
  assert.equal(summary.playMinutes, null);
  const text = JSON.stringify(summary);
  for (const secret of [game.id, game.viewToken, 'Ana', 'Ben']) assert.ok(!text.includes(secret), `summary leaks ${secret}`);
  game.transactionsDropped = 10;
  assert.equal(summarizeGame(game).moves, 14, 'trimmed entries still count as moves');
});

test('summaries record how a finished game was decided and how long it took', () => {
  const byWorth = makeGame(['Ana', 'Ben']);
  act(byWorth, { type: 'transfer', fromId: 'bank', toId: byWorth.players[0].id, amount: 1 });
  byWorth.startedAt = '2026-01-01T19:00:00.000Z';
  byWorth.transactions[0].at = '2026-01-01T20:30:00.000Z';
  act(byWorth, { type: 'end-game' });
  assert.equal(summarizeGame(byWorth).finish, 'netWorth');
  assert.equal(summarizeGame(byWorth).playMinutes, 90);
  const byTable = makeGame(['Ana', 'Ben']);
  act(byTable, { type: 'end-game', winnerId: byTable.players[1].id });
  assert.equal(summarizeGame(byTable).finish, 'table');
  assert.equal(summarizeGame(byTable).playMinutes, null, 'no moves, no play time');
  const standing = makeGame(['Ana', 'Ben']);
  act(standing, { type: 'bankrupt', playerId: standing.players[0].id });
  assert.equal(summarizeGame(standing).finish, 'lastStanding');
  assert.equal(summarizeGame(standing).bankrupt, 1);
  assert.deepEqual(summarizeGame({ status: 'active' }).actions, {}, 'tolerates a minimal game');
});

// ---------------------------------------------------------- aggregation ----

const summary = (overrides) => ({
  createdAt: '2026-11-20T10:00:00.000Z', updatedAt: '2026-11-20T10:00:00.000Z', startedAt: null, status: 'active', players: 3, bankrupt: 0,
  startingBalance: 1500, rules: { freeParkingJackpot: false, doubleGoOnLanding: false, noRentInJail: false, auctions: true, evenBuilding: true, mortgageInterestPercent: 10 },
  moves: 0, actions: {}, notes: {}, finish: null, playMinutes: null, ...overrides
});

test('usage totals, funnel, timing, rules and notes add up', () => {
  const now = Date.parse('2026-11-20T12:00:00.000Z');
  const usage = aggregateUsage([
    summary({ updatedAt: '2026-11-20T11:55:00.000Z' }),
    summary({ createdAt: '2026-11-18T20:00:00.000Z', updatedAt: '2026-11-18T23:00:00.000Z', startedAt: '2026-11-18T20:05:00.000Z', moves: 12, actions: { transfer: 10, undo: 2, mystery: 4 }, notes: { 'passed go': 2 }, rules: { freeParkingJackpot: true, doubleGoOnLanding: true, noRentInJail: true, auctions: false, evenBuilding: false, mortgageInterestPercent: 0 } }),
    summary({ createdAt: '2026-11-10T01:00:00.000Z', updatedAt: '2026-11-10T03:00:00.000Z', moves: 40, status: 'ended', finish: 'table', playMinutes: 120, players: 5, bankrupt: 2, startingBalance: 2000, actions: { rent: 30, end: 1 }, notes: { 'passed go': 1, 'my secret note': 1 } }),
    summary({ createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z', moves: 3, status: 'ended', finish: 'lastStanding', rules: { auctions: true, evenBuilding: true } })
  ], { now });
  assert.deepEqual(usage.totals, { games: 4, created24h: 1, created7d: 2, created30d: 3, active15m: 1, active24h: 1, finished: 2 });
  assert.deepEqual(usage.funnel, { created: 4, started: 3, played: 2, finished: 2 });
  assert.deepEqual(usage.players, { 3: 3, 5: 1 });
  assert.deepEqual(usage.startingBalances, { 1500: 3, 2000: 1 });
  assert.deepEqual(usage.moves, { total: 55, median: 12, p90: 40 });
  assert.deepEqual(usage.playMinutes, { count: 1, median: 120, p90: 120 });
  assert.equal(usage.createdByDay.length, 30);
  assert.deepEqual(usage.createdByDay.at(-1), { date: '2026-11-20', count: 1 });
  assert.equal(usage.createdByDay.find((day) => day.date === '2026-11-18').count, 1);
  assert.equal(usage.startHourUtc[20], 1, 'started games count by their first move');
  assert.equal(usage.startHourUtc[1] + usage.startHourUtc[10], 2, 'otherwise by creation time');
  assert.deepEqual(usage.rules, { freeParkingJackpot: 1, doubleGoOnLanding: 1, noRentInJail: 1, auctionsOff: 1, evenBuildingOff: 1, mortgageInterestChanged: 1 });
  assert.equal(usage.actions.transfer, 10);
  assert.equal(usage.actions.rent, 30);
  assert.equal(usage.actions.mystery, undefined, 'unknown action types are ignored');
  assert.deepEqual(Object.keys(usage.actions), ACTION_TYPES);
  assert.equal(usage.undoPer100Moves, 3.6);
  assert.equal(usage.bankruptPlayers, 2);
  assert.deepEqual(usage.finish, { netWorth: 0, table: 1, lastStanding: 1 });
  assert.deepEqual(usage.topNotes, [{ note: 'passed go', count: 3 }], 'notes typed fewer than 3 times are hidden');
  assert.equal(usage.generatedAt, '2026-11-20T12:00:00.000Z');
});

test('empty usage has no medians and no undo rate', () => {
  const usage = aggregateUsage([]);
  assert.equal(usage.moves.median, null);
  assert.equal(usage.playMinutes.median, null);
  assert.equal(usage.undoPer100Moves, 0);
  assert.equal(usage.totals.games, 0);
});

// ------------------------------------------------------- runtime metrics ----

test('runtime metrics count requests, errors, actions, streams and save times', () => {
  let clock = 0;
  const metrics = new RuntimeMetrics({ now: () => clock });
  metrics.request('/api/games/x', 200);
  metrics.request('/app.js', 304);
  metrics.request('/api/games/x', 409);
  metrics.request('/api/games/x', 500);
  metrics.request('/ws', 101);
  for (const [status, code] of [[400, 'insufficient-funds'], [404], [409], [429], [500], [418]]) metrics.error(status, code);
  metrics.action('rent');
  metrics.action('rent');
  for (let i = 1; i <= 501; i += 1) metrics.save(i);
  clock = 125 * 60 * 1000;
  const snapshot = metrics.snapshot({ liveStreams: 3 });
  assert.deepEqual(snapshot.requests, { total: 5, api: 3, '2xx': 1, '3xx': 1, '4xx': 1, '5xx': 1 });
  assert.deepEqual(snapshot.errors, { 'insufficient-funds': 1, 'not-found': 1, conflict: 1, 'rate-limited': 1, 'server-error': 1, 'http-418': 1 });
  assert.deepEqual(snapshot.actions, { rent: 2 });
  assert.deepEqual(snapshot.saves, { count: 500, p50Ms: 252, p95Ms: 477, maxMs: 501 });
  assert.equal(snapshot.uptimeMinutes, 125);
  assert.equal(snapshot.liveStreams, 3);
  assert.deepEqual(new RuntimeMetrics().snapshot().saves, { count: 0, p50Ms: null, p95Ms: null, maxMs: null });
});

// ----------------------------------------------------------------- store ----

test('store usage summarizes memory games and skips expired ones', async () => {
  let clock = Date.now();
  const store = new GameStore({ now: () => clock });
  const kept = await store.create({ players: ['Ana', 'Ben'] });
  clock = Date.parse(kept.updatedAt) + 1000;
  const { summaries, storageBytes } = await store.usage(summarizeGame);
  assert.equal(summaries.length, 1);
  assert.equal(storageBytes, null);
  clock = Date.parse(kept.updatedAt) + 31 * DAY;
  assert.equal((await store.usage(summarizeGame)).summaries.length, 0);
});

test('store usage reads each game file once, re-reads changed files and skips broken ones', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'monobank-admin-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let reads = 0;
  let vanish = null;
  const fs = {
    ...realFs,
    readFile: (...args) => { reads += 1; return realFs.readFile(...args); },
    stat: async (path) => {
      if (vanish && path.endsWith(`${vanish}.json`)) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
      return realFs.stat(path);
    }
  };
  const errors = [];
  const store = await new GameStore({ dataDir: dir, fs, logger: { error: (...args) => errors.push(args.join(' ')) } }).init();
  const first = await store.create({ players: ['Ana', 'Ben'] });
  const second = await store.create({ players: ['Cy', 'Di'] });
  reads = 0;
  let usage = await store.usage(summarizeGame);
  assert.equal(usage.summaries.length, 2);
  assert.ok(usage.storageBytes > 0);
  assert.equal(reads, 2);
  usage = await store.usage(summarizeGame);
  assert.equal(reads, 2, 'unchanged files come from the cache');
  act(first, { type: 'transfer', fromId: first.players[0].id, toId: 'bank', amount: 10 });
  await store.save(first);
  const later = new Date(Date.now() + 5000);
  await utimes(join(dir, `${first.id}.json`), later, later);
  usage = await store.usage(summarizeGame);
  assert.equal(reads, 3, 'a changed file is read again');
  assert.equal(usage.summaries.find((entry) => entry.moves === 1).players, 2);
  // A broken file is logged and skipped; a file deleted mid-scan is skipped quietly and leaves the cache.
  await writeFile(join(dir, 'abcdefabcdefabcd.json'), '{not json');
  vanish = second.id;
  usage = await store.usage(summarizeGame);
  assert.equal(usage.summaries.length, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Could not summarize game abcdefabcdefabcd/);
  assert.equal(store.summaryCache.has(second.id), false);
});

// ------------------------------------------------------------------ API ----

async function startServer(t, options = {}) {
  const store = new GameStore();
  const server = createAppServer({ store, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return { store, base: `http://127.0.0.1:${server.address().port}` };
}

test('without an admin token the admin page and API do not exist', async (t) => {
  const { base } = await startServer(t);
  for (const path of ['/admin', '/admin.html', '/admin.js', '/api/admin/stats']) {
    assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  }
  const short = await startServer(t, { adminToken: 'short' });
  assert.equal((await fetch(`${short.base}/admin`)).status, 404, 'a too-short token keeps it disabled');
});

test('the admin page is private: noindex, never cached, not in robots or the sitemap', async (t) => {
  const { base } = await startServer(t, { adminToken: TOKEN });
  for (const path of ['/admin', '/admin/', '/admin.html', '/admin.js']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow', path);
    assert.equal(response.headers.get('cache-control'), 'no-store', path);
  }
  const html = await (await fetch(`${base}/admin`)).text();
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive">/);
  assert.match(html, /not affiliated with, sponsored or endorsed by Hasbro/);
  assert.doesNotMatch(await (await fetch(`${base}/sitemap.xml`)).text(), /admin/);
  assert.doesNotMatch(await (await fetch(`${base}/`)).text(), /\/admin/, 'nothing links to it');
});

test('admin stats need the token, limit wrong guesses, and never include game links', async (t) => {
  const { base } = await startServer(t, { adminToken: TOKEN, limits: { apiPerMinute: 1000 } });
  const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const game = await (await post('/api/games', { players: ['Ana', 'Ben'] })).json();
  const ok = await post(`/api/games/${game.id}/actions`, { type: 'transfer', fromId: 'bank', toId: game.players[0].id, amount: 200, note: 'Passed GO', expectedRevision: game.revision });
  assert.equal(ok.status, 200);
  assert.equal((await post(`/api/games/${game.id}/actions`, { type: 'transfer', fromId: 'bank', toId: game.players[0].id, amount: 1, expectedRevision: 0 })).status, 409);
  assert.equal((await post(`/api/games/${game.id}/actions`, { type: 'transfer', fromId: game.players[1].id, toId: 'bank', amount: 99999, expectedRevision: game.revision + 1 })).status, 400);
  const stats = (headers = {}) => fetch(`${base}/api/admin/stats`, { headers });
  const missing = await stats();
  assert.equal(missing.status, 401);
  assert.equal(missing.headers.get('www-authenticate'), 'Bearer');
  assert.equal((await stats({ authorization: 'Bearer wrong-token-wrong-token-wrong' })).status, 401);
  const good = await stats({ authorization: `Bearer ${TOKEN}` });
  assert.equal(good.status, 200);
  assert.equal(good.headers.get('cache-control'), 'no-store');
  assert.equal(good.headers.get('x-robots-tag'), 'noindex');
  const body = await good.json();
  assert.equal(body.usage.totals.games, 1);
  assert.equal(body.usage.funnel.started, 1);
  assert.equal(body.runtime.actions.transfer, 1);
  assert.equal(body.runtime.errors.conflict, 1);
  assert.equal(body.runtime.errors['insufficient-funds'], 1);
  assert.equal(body.storage.kind, 'memory');
  assert.equal(body.storage.retentionDays, 30);
  assert.equal(body.storage.finishedRetentionDays, 7);
  const text = JSON.stringify(body);
  for (const secret of [game.id, game.viewToken, 'Ana', 'Ben']) assert.ok(!text.includes(secret), `stats leak ${secret}`);
  assert.equal((await fetch(`${base}/api/admin/stats`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } })).status, 404);
  // Wrong guesses are limited to 10 per 15 minutes per address (2 used above).
  const codes = [];
  for (let i = 0; i < 9; i += 1) codes.push((await stats({ authorization: `Bearer guess-${i}-xxxxxxxxxxxxxxxxxxxxxxx` })).status);
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 401, 401, 401, 429]);
  assert.equal((await stats({ authorization: `Bearer ${TOKEN}` })).status, 200, 'the right token still works');
});

test('admin stats count live connections opened and refused', async (t) => {
  const { base } = await startServer(t, { adminToken: TOKEN, streams: { maxPerGame: 1 } });
  const game = await (await fetch(`${base}/api/games`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ players: ['Ana', 'Ben'] }) })).json();
  const controller = new AbortController();
  t.after(() => controller.abort());
  const open = await fetch(`${base}/api/games/${game.id}/events`, { signal: controller.signal });
  assert.equal(open.status, 200);
  assert.equal((await fetch(`${base}/api/games/${game.id}/events`)).status, 503);
  const body = await (await fetch(`${base}/api/admin/stats`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
  assert.deepEqual(body.runtime.streams, { opened: 1, rejected: 1 });
  assert.equal(body.runtime.liveStreams, 1);
});
