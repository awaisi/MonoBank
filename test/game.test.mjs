import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, calculateRent, performAction, GameStore } from '../lib/game.mjs';
import { createAppServer } from '../server.mjs';

const makeGame = () => createGame({ players: ['Awais', 'Friend'], startingBalance: 1500 });

test('creates a game for 2–4 unique players', () => {
  const game = makeGame();
  assert.match(game.id, /^[a-f0-9]{16}$/);
  assert.equal(game.players.length, 2);
  assert.equal(game.players[0].balance, 1500);
  assert.throws(() => createGame({ players: ['Same', 'same'] }), /unique/);
});

test('moves money between players and records the transfer', () => {
  const game = makeGame();
  const [first, second] = game.players;
  performAction(game, { type: 'transfer', fromId: first.id, toId: second.id, amount: 75, note: 'Railroad rent' });
  assert.equal(first.balance, 1425);
  assert.equal(second.balance, 1575);
  assert.equal(game.transactions[0].amount, 75);
});

test('buys Boardwalk and calculates its default $50 rent', () => {
  const game = makeGame();
  const [owner, tenant] = game.players;
  performAction(game, { type: 'buy', playerId: owner.id, propertyId: 'boardwalk' });
  assert.equal(owner.balance, 1100);
  assert.equal(calculateRent(game, 'boardwalk'), 50);
  performAction(game, { type: 'rent', payerId: tenant.id, propertyId: 'boardwalk' });
  assert.equal(owner.balance, 1150);
  assert.equal(tenant.balance, 1450);
});

test('mortgages and unmortgages Boardwalk using classic values', () => {
  const game = makeGame();
  const [owner] = game.players;
  performAction(game, { type: 'buy', playerId: owner.id, propertyId: 'boardwalk' });
  performAction(game, { type: 'mortgage', playerId: owner.id, propertyId: 'boardwalk' });
  assert.equal(owner.balance, 1300);
  assert.equal(game.deeds.boardwalk.mortgaged, true);
  performAction(game, { type: 'unmortgage', playerId: owner.id, propertyId: 'boardwalk' });
  assert.equal(owner.balance, 1080);
});

test('enforces color-set and even-building rules', () => {
  const game = makeGame();
  const [owner] = game.players;
  performAction(game, { type: 'buy', playerId: owner.id, propertyId: 'park-place' });
  assert.throws(() => performAction(game, { type: 'building', direction: 'buy', playerId: owner.id, propertyId: 'park-place' }), /complete color set/);
  performAction(game, { type: 'buy', playerId: owner.id, propertyId: 'boardwalk' });
  performAction(game, { type: 'building', direction: 'buy', playerId: owner.id, propertyId: 'park-place' });
  assert.throws(() => performAction(game, { type: 'building', direction: 'buy', playerId: owner.id, propertyId: 'park-place' }), /evenly/);
});

test('serves health and game API endpoints', async (t) => {
  const server = createAppServer({ store: new GameStore() });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const health = await fetch(`http://127.0.0.1:${port}/health`).then((response) => response.json());
  assert.equal(health.status, 'ok');
  const response = await fetch(`http://127.0.0.1:${port}/api/games`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ players: ['One', 'Two'], startingBalance: 1500 })
  });
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.properties.length, 28);
});
