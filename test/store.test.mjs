import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameStore } from '../lib/store.mjs';
import { performAction } from '../lib/game.mjs';

const players = { players: ['Ana', 'Ben'] };
const quietLogger = () => {
  const errors = [];
  return { errors, error: (...args) => errors.push(args.map(String).join(' ')) };
};

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'monobank-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('memory store creates, reads and expires games', async () => {
  let clock = Date.now();
  const store = new GameStore({ ttlMs: 1000, now: () => clock });
  assert.equal(store.kind, 'memory');
  assert.equal(await store.init(), store);
  const game = await store.create(players);
  assert.equal(await store.get(game.id), game);
  assert.equal(store.size, 1);
  await store.save(game);
  clock += 5000;
  await assert.rejects(store.get(game.id), (error) => error.status === 404);
  assert.equal(store.size, 0);
});

test('memory store sweep removes only expired games', async () => {
  let clock = Date.now();
  const store = new GameStore({ ttlMs: 1000, now: () => clock });
  const old = await store.create(players);
  clock += 2000;
  const fresh = await store.create(players);
  fresh.updatedAt = new Date(clock).toISOString();
  await store.sweep();
  assert.equal(store.games.has(old.id), false);
  assert.equal(store.games.has(fresh.id), true);
});

test('rejects malformed and unknown game IDs', async () => {
  const store = new GameStore();
  for (const id of ['../etc/passwd', 'ABCDEF0123456789', '', undefined, '0123456789abcdef']) {
    await assert.rejects(store.get(id), (error) => error.status === 404, String(id));
  }
});

test('file store persists games and reloads them after a restart', async (t) => {
  const dir = await tempDir(t);
  const first = await new GameStore({ dataDir: dir }).init();
  assert.equal(first.kind, 'file');
  const game = await first.create(players);
  performAction(game, { type: 'transfer', fromId: game.players[0].id, toId: 'bank', amount: 200 });
  await first.save(game);
  assert.deepEqual((await readdir(dir)).sort(), [`${game.id}.json`, `watch-${game.viewToken}.json`].sort(), 'no temp files left behind');

  const restarted = await new GameStore({ dataDir: dir }).init();
  assert.equal(restarted.size, 1);
  const loaded = await restarted.get(game.id);
  assert.equal(loaded.players[0].balance, 1300);
  assert.equal(loaded.revision, game.revision);
  performAction(loaded, { type: 'undo' });
  assert.equal(loaded.players[0].balance, 1500, 'undo history survives a restart');
});

test('concurrent loads of the same game share one object', async (t) => {
  const dir = await tempDir(t);
  const game = await (await new GameStore({ dataDir: dir }).init()).create(players);
  const store = await new GameStore({ dataDir: dir }).init();
  const [a, b] = await Promise.all([store.get(game.id), store.get(game.id)]);
  assert.equal(a, b);
  assert.equal(store.loading.size, 0);
});

test('overlapping saves always leave the newest state on disk', async (t) => {
  const dir = await tempDir(t);
  const store = await new GameStore({ dataDir: dir }).init();
  const game = await store.create(players);
  const saves = [];
  for (let i = 0; i < 25; i++) {
    performAction(game, { type: 'transfer', fromId: game.players[0].id, toId: game.players[1].id, amount: 1 });
    saves.push(store.save(game));
  }
  await Promise.all(saves);
  await store.flush();
  const onDisk = JSON.parse(await readFile(join(dir, `${game.id}.json`), 'utf8'));
  assert.equal(onDisk.revision, game.revision);
  assert.equal(onDisk.players[1].balance, 1525);
  assert.equal(store.writes.size, 0);
});

test('expired games are deleted from disk on read and on sweep', async (t) => {
  const dir = await tempDir(t);
  let clock = Date.now();
  const store = await new GameStore({ dataDir: dir, ttlMs: 60_000, now: () => clock }).init();
  const readExpired = await store.create(players);
  const sweptInMemory = await store.create(players);
  clock += 120_000;
  await assert.rejects(store.get(readExpired.id), (error) => error.status === 404);
  assert.equal((await readdir(dir)).includes(`${readExpired.id}.json`), false);

  // A game only on disk (e.g. from before a restart), judged by file age.
  const diskOnly = await (await new GameStore({ dataDir: dir }).init()).create(players);
  const past = new Date(Date.now() - 10 * 60_000);
  await utimes(join(dir, `${diskOnly.id}.json`), past, past);
  const fresh = await store.create({ players: ['Cy', 'Di'] });
  fresh.updatedAt = new Date(clock).toISOString();
  clock = Date.now();
  store.ttlMs = 60_000;
  await store.sweep();
  const files = await readdir(dir);
  assert.equal(files.includes(`${diskOnly.id}.json`), false, 'old disk-only game removed');
  assert.equal(files.includes(`${fresh.id}.json`), true, 'fresh game kept');
  assert.equal(store.size, files.filter((file) => /^[a-f0-9]{16}\.json$/.test(file)).length);
  assert.ok(sweptInMemory);
});

test('ignores unrelated files and reports unreadable or corrupt games as missing', async (t) => {
  const dir = await tempDir(t);
  await writeFile(join(dir, 'notes.txt'), 'hello');
  await writeFile(join(dir, '0123456789abcdef.json'), '{not json');
  await writeFile(join(dir, 'fedcba9876543210.json'), JSON.stringify({ id: '0000000000000000' }));
  const logger = quietLogger();
  const store = await new GameStore({ dataDir: dir, logger }).init();
  assert.equal(store.size, 2);
  await assert.rejects(store.get('0123456789abcdef'), (error) => error.status === 404);
  await assert.rejects(store.get('fedcba9876543210'), (error) => error.status === 404);
  assert.equal(logger.errors.length, 2);
  assert.match(logger.errors[1], /does not match/);
});

test('write failures are logged and never thrown', async (t) => {
  const dir = await tempDir(t);
  const logger = quietLogger();
  const store = await new GameStore({ dataDir: dir, logger }).init();
  const game = await store.create(players);
  store.dataDir = join(dir, 'missing', 'nested');
  await store.save(game);
  assert.match(logger.errors[0], /Could not save game/);
});

test('delete and sweep log unexpected file-system errors', async (t) => {
  const dir = await tempDir(t);
  const logger = quietLogger();
  const store = await new GameStore({ dataDir: dir, logger }).init();
  const game = await store.create(players);
  // A directory where a game file is expected makes unlink fail with EISDIR/EPERM.
  await rm(join(dir, `${game.id}.json`));
  await (await import('node:fs/promises')).mkdir(join(dir, `${game.id}.json`));
  await store.delete(game.id);
  assert.match(logger.errors[0], /Could not delete game/);
  await store.delete('aaaaaaaaaaaaaaaa');
  assert.equal(logger.errors.length, 1, 'missing files are not an error');
});

test('init fails loudly when the data directory is unusable', async (t) => {
  const dir = await tempDir(t);
  const file = join(dir, 'not-a-directory');
  await writeFile(file, 'x');
  await assert.rejects(new GameStore({ dataDir: file }).init());
});

test('caps the number of active games, sweeping before refusing', async (t) => {
  let clock = Date.now();
  const memory = new GameStore({ maxGames: 2, ttlMs: 1000, now: () => clock });
  await memory.create(players);
  await memory.create(players);
  await assert.rejects(memory.create(players), (error) => error.status === 503 && /capacity/.test(error.message));
  clock += 5000;
  await memory.create(players);
  assert.equal(memory.size, 1);

  const dir = await tempDir(t);
  const disk = await new GameStore({ dataDir: dir, maxGames: 1 }).init();
  await disk.create(players);
  const restarted = await new GameStore({ dataDir: dir, maxGames: 1 }).init();
  await assert.rejects(restarted.create(players), (error) => error.status === 503, 'files on disk count after a restart');
});

test('sweep logs files that cannot be inspected and skips ones that vanish', async (t) => {
  const dir = await tempDir(t);
  const logger = quietLogger();
  const real = await import('node:fs/promises');
  const seed = await new GameStore({ dataDir: dir }).init();
  const locked = await seed.create(players);
  const vanished = await seed.create(players);
  const fs = {
    ...real,
    stat: async (path) => {
      if (path.includes(locked.id)) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      if (path.includes(vanished.id)) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
      return real.stat(path);
    }
  };
  const store = await new GameStore({ dataDir: dir, logger, fs }).init();
  await store.sweep();
  assert.equal(logger.errors.filter((message) => message.includes('Could not inspect game')).length, 1);
  assert.match(logger.errors[0], new RegExp(`Could not inspect game ${locked.id}`));
});

// ------------------------------------------------- retention and memory ----

const DAY_MS = 24 * 60 * 60 * 1000;

test('games are kept 30 days after the last move, finished games 7 days', async () => {
  const defaults = new GameStore();
  assert.equal(defaults.ttlMs, 30 * DAY_MS);
  assert.equal(defaults.endedTtlMs, 7 * DAY_MS);
  let clock = Date.now();
  const store = new GameStore({ now: () => clock });
  const paused = await store.create(players);
  const finished = await store.create(players);
  performAction(finished, { type: 'end-game' });
  clock = Date.parse(finished.updatedAt) + 6 * DAY_MS;
  assert.equal((await store.get(finished.id)).id, finished.id, 'a finished game is still viewable after 6 days');
  clock = Date.parse(finished.updatedAt) + 8 * DAY_MS;
  await assert.rejects(store.get(finished.id), (error) => error.status === 404);
  assert.equal((await store.get(paused.id)).id, paused.id, 'a paused game survives a week-long break');
  clock = Date.parse(paused.updatedAt) + 31 * DAY_MS;
  await assert.rejects(store.get(paused.id), (error) => error.status === 404);
  // A short active TTL (as in tests and configuration) also caps finished games.
  const short = new GameStore({ ttlMs: 1000, now: () => clock });
  const ended = await short.create(players);
  performAction(ended, { type: 'end-game' });
  clock = Date.parse(ended.updatedAt) + 2000;
  assert.equal(short.isExpired(ended), true);
});

test('idle games leave memory but stay on disk and load again', async (t) => {
  const dir = await tempDir(t);
  let clock = Date.now();
  const store = await new GameStore({ dataDir: dir, now: () => clock }).init();
  const idle = await store.create(players);
  const busy = await store.create({ players: ['Cy', 'Di'] });
  clock = Date.parse(idle.updatedAt) + 3 * 60 * 60 * 1000;
  busy.updatedAt = new Date(clock).toISOString();
  await store.sweep();
  assert.equal(store.games.has(idle.id), false, 'idle for 3 hours: unloaded');
  assert.equal(store.games.has(busy.id), true, 'recently active: kept');
  assert.equal(store.watch.has(idle.viewToken), false);
  assert.equal((await readdir(dir)).includes(`${idle.id}.json`), true, 'still saved on disk');
  const reloaded = await store.get(idle.id);
  assert.notEqual(reloaded, idle, 'loaded fresh from disk');
  assert.equal(reloaded.revision, idle.revision);
  assert.equal((await store.getByWatchToken(idle.viewToken)).id, idle.id, 'spectator links still work');
  assert.equal(store.size, 2);
});

test('a save from a request that held an unloaded game wins over a stale reload', async (t) => {
  const dir = await tempDir(t);
  let clock = Date.now();
  const store = await new GameStore({ dataDir: dir, now: () => clock }).init();
  const held = await store.create(players);
  clock = Date.parse(held.updatedAt) + 3 * 60 * 60 * 1000;
  await store.sweep();
  // Another request loads the (same-revision) copy from disk while the first one still holds the old object.
  const reloaded = await store.get(held.id);
  assert.notEqual(reloaded, held);
  performAction(held, { type: 'transfer', fromId: held.players[0].id, toId: 'bank', amount: 5 });
  await store.save(held);
  assert.equal(store.games.get(held.id), held, 'the newer copy becomes the working copy');
  // An older copy saved later never replaces the newer working copy.
  await store.save(reloaded);
  assert.equal(store.games.get(held.id), held);
  // A game saved while nothing is in memory is put back too.
  store.games.delete(held.id);
  await store.save(held);
  assert.equal(store.games.get(held.id), held);
});
