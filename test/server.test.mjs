import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.mjs';
import { GameStore } from '../lib/game.mjs';

async function startServer(t, store = new GameStore()) {
  const server = createAppServer({ store });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = (path, body, method = 'POST') => fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body)
  });
  return { base, json };
}

const createGame = async (json, body = { players: ['Ana', 'Ben'] }) => (await json('/api/games', body)).json();

test('runs a full game over the API: actions, undo, bankruptcy, end game', async (t) => {
  const { base, json } = await startServer(t);
  const game = await createGame(json, { players: ['Ana', 'Ben', 'Cy'] });
  const [ana, ben, cy] = game.players;
  const post = async (action) => {
    const current = await (await fetch(`${base}/api/games/${game.id}`)).json();
    return json(`/api/games/${game.id}/actions`, { ...action, expectedRevision: current.revision });
  };
  let response = await post({ type: 'transfer', fromId: ana.id, toId: ben.id, amount: 100 });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).undo.label, 'Ana paid Ben');
  response = await post({ type: 'undo' });
  assert.equal((await response.json()).players[0].balance, 1500);
  response = await post({ type: 'bankrupt', playerId: ana.id, creditorId: cy.id });
  const afterBankruptcy = await response.json();
  assert.equal(afterBankruptcy.players[0].bankrupt, true);
  assert.equal(afterBankruptcy.standings.at(-1).name, 'Ana');
  response = await post({ type: 'end-game' });
  const ended = await response.json();
  assert.equal(ended.status, 'ended');
  assert.deepEqual(ended.winnerIds, [cy.id]);
  response = await post({ type: 'transfer', fromId: ben.id, toId: 'bank', amount: 1 });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /game has ended/);
});

test('rejects stale revisions with 409', async (t) => {
  const { json } = await startServer(t);
  const game = await createGame(json);
  const response = await json(`/api/games/${game.id}/actions`, { type: 'transfer', fromId: game.players[0].id, toId: 'bank', amount: 1, expectedRevision: game.revision + 5 });
  assert.equal(response.status, 409);
});

test('returns 404 for unknown games and API routes', async (t) => {
  const { base, json } = await startServer(t);
  assert.equal((await fetch(`${base}/api/games/0123456789abcdef`)).status, 404);
  assert.equal((await json('/api/games/0123456789abcdef/actions', { type: 'undo' })).status, 404);
  assert.equal((await fetch(`${base}/api/unknown`)).status, 404);
  assert.equal((await fetch(`${base}/missing-file.txt`)).status, 404);
});

test('rejects invalid JSON, oversized bodies and invalid games', async (t) => {
  const { json } = await startServer(t);
  const invalid = await json('/api/games', '{not json');
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, 'Invalid JSON.');
  const huge = await json('/api/games', { players: ['A', 'B'], padding: 'x'.repeat(70 * 1024) });
  assert.equal(huge.status, 413);
  const tooFew = await json('/api/games', { players: ['Solo'] });
  assert.equal(tooFew.status, 400);
  assert.match((await tooFew.json()).error, /between 2 and 4/);
});

test('hides internal errors behind a generic 500', async (t) => {
  const store = new GameStore();
  store.create = () => { throw new Error('database exploded'); };
  const originalError = console.error;
  console.error = () => {};
  t.after(() => { console.error = originalError; });
  const { json } = await startServer(t, store);
  const response = await json('/api/games', { players: ['A', 'B'] });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'Something went wrong.');
});

test('serves the app shell, static assets and security headers', async (t) => {
  const { base } = await startServer(t);
  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);
  assert.match(home.headers.get('content-security-policy'), /style-src 'self'/);
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
  assert.equal(home.headers.get('cache-control'), 'no-cache');
  const gameRoute = await fetch(`${base}/game/0123456789abcdef`);
  assert.match(await gameRoute.text(), /Banker’s Console/);
  const script = await fetch(`${base}/qr.js`);
  assert.match(script.headers.get('content-type'), /text\/javascript/);
  assert.match(script.headers.get('cache-control'), /max-age=3600/);
  const manifest = await fetch(`${base}/manifest.webmanifest`);
  assert.match(manifest.headers.get('content-type'), /manifest\+json/);
});

test('blocks path traversal outside public/', async (t) => {
  const { base } = await startServer(t);
  for (const path of ['/../server.mjs', '/%2e%2e/server.mjs', '/..%2Fpackage.json']) {
    const response = await fetch(`${base}${path}`);
    assert.notEqual(response.status, 200, path);
  }
});

test('GameStore expires idle games on read and on sweep', () => {
  const store = new GameStore({ ttlMs: 1000 });
  const fresh = store.create({ players: ['A', 'B'] });
  const stale = store.create({ players: ['C', 'D'] });
  assert.equal(store.get(fresh.id), fresh);
  stale.updatedAt = new Date(Date.now() - 5000).toISOString();
  assert.throws(() => store.get(stale.id), (error) => error.status === 404);
  const swept = store.create({ players: ['E', 'F'] });
  swept.updatedAt = new Date(Date.now() - 5000).toISOString();
  store.sweep();
  assert.equal(store.games.has(swept.id), false);
  assert.equal(store.games.has(fresh.id), true);
});
