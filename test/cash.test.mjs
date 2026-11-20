import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, performAction } from '../lib/game.mjs';
import { createAppServer } from '../server.mjs';
import { GameStore } from '../lib/store.mjs';

const makeGame = (names = ['Ana', 'Ben']) => createGame({ players: names, startingBalance: 1500 });
const act = performAction;
const insufficient = (pattern) => (error) => {
  assert.equal(error.code, 'insufficient-funds');
  if (pattern) assert.match(error.message, pattern);
  return true;
};

test('payments that would make a balance negative are refused with details', () => {
  const game = makeGame();
  const [ana, ben] = game.players;
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'boardwalk' });
  let caught;
  try { act(game, { type: 'transfer', fromId: ana.id, toId: ben.id, amount: 1300 }); } catch (error) { caught = error; }
  assert.equal(caught.code, 'insufficient-funds');
  assert.deepEqual(caught.details, { playerId: ana.id, needed: 1300, balance: 1100, shortfall: 200, raisable: 200 });
  assert.match(caught.message, /Ana has \$1,100 but needs \$1,300\. Sell houses or mortgage deeds to raise \$200 first\./);
  assert.equal(ana.balance, 1100, 'nothing changed');
  act(game, { type: 'transfer', fromId: ana.id, toId: ben.id, amount: 1100 });
  assert.equal(ana.balance, 0, 'paying exactly everything is allowed');
});

test('suggests bankruptcy when selling everything is not enough', () => {
  const game = makeGame();
  const [ana, ben] = game.players;
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'boardwalk' });
  assert.throws(() => act(game, { type: 'transfer', fromId: ana.id, toId: 'bank', amount: 1500 }), insufficient(/Selling everything would raise only \$200, so Ana may need to declare bankruptcy\./));
  act(game, { type: 'mortgage', playerId: ana.id, propertyId: 'boardwalk' });
  act(game, { type: 'transfer', fromId: ana.id, toId: ben.id, amount: 1300 });
  assert.throws(() => act(game, { type: 'transfer', fromId: ana.id, toId: ben.id, amount: 1 }), insufficient(/Ana has \$0 but needs \$1\. Ana has nothing left to mortgage or sell/));
});

test('every way of spending money checks the balance', () => {
  const game = makeGame(['Ana', 'Ben']);
  const [ana, ben] = game.players;
  act(game, { type: 'transfer', fromId: ana.id, toId: 'bank', amount: 1451 });
  assert.equal(ana.balance, 49);
  assert.throws(() => act(game, { type: 'buy', playerId: ana.id, propertyId: 'mediterranean', amount: 60 }), insufficient(/Ana has \$49 but needs \$60/));
  assert.throws(() => act(game, { type: 'buy', playerId: ana.id, propertyId: 'boardwalk', amount: 300, auction: true }), insufficient(/needs \$300/));
  act(game, { type: 'buy', playerId: ben.id, propertyId: 'boardwalk' });
  assert.throws(() => act(game, { type: 'rent', payerId: ana.id, propertyId: 'boardwalk' }), insufficient(/Ana has \$49 but needs \$50/));
  assert.throws(() => act(game, { type: 'transfer', fromId: ana.id, toId: 'bank', amount: 50, category: 'tax' }), insufficient());
  assert.throws(() => act(game, { type: 'trade', firstPlayerId: ana.id, secondPlayerId: ben.id, firstCash: 100 }), insufficient(/needs \$100/));
  act(game, { type: 'trade', firstPlayerId: ana.id, secondPlayerId: ben.id, firstCash: 100, secondCash: 80 });
  assert.equal(ana.balance, 29, 'only the net payment needs covering');
  assert.throws(() => act(game, { type: 'trade', firstPlayerId: ben.id, secondPlayerId: ana.id, secondCash: 30 }), insufficient(/Ana has \$29 but needs \$30/));
  act(game, { type: 'transfer', fromId: 'bank', toId: ana.id, amount: 21 });
  act(game, { type: 'rent', payerId: ana.id, propertyId: 'boardwalk' });
  assert.equal(ana.balance, 0, 'rent of exactly the whole balance is allowed');
});

test('Free Parking payments also need the cash', () => {
  const game = createGame({ players: ['Ana', 'Ben'], startingBalance: 100, rules: { freeParkingJackpot: true } });
  const [ana] = game.players;
  assert.throws(() => act(game, { type: 'transfer', fromId: ana.id, toId: 'parking', amount: 200 }), insufficient());
  assert.equal(game.freeParking, 0);
});

test('buildings need enough cash, and a hotel cannot be bought on credit', () => {
  const game = makeGame();
  const [ana] = game.players;
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'park-place' });
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'boardwalk' });
  act(game, { type: 'building', direction: 'buy', playerId: ana.id, propertyId: 'park-place' });
  act(game, { type: 'building', direction: 'buy', playerId: ana.id, propertyId: 'boardwalk' });
  act(game, { type: 'building', direction: 'buy', playerId: ana.id, propertyId: 'park-place' });
  assert.equal(ana.balance, 150);
  assert.throws(() => act(game, { type: 'building', direction: 'buy', playerId: ana.id, propertyId: 'boardwalk' }), insufficient(/Ana has \$150 but needs \$200/));
  assert.equal(game.deeds.boardwalk.buildings, 1, 'nothing built');
  act(game, { type: 'transfer', fromId: 'bank', toId: ana.id, amount: 1050 });
  for (let i = 0; i < 5; i++) act(game, { type: 'building', direction: 'buy', playerId: ana.id, propertyId: i % 2 ? 'park-place' : 'boardwalk' });
  assert.equal(game.deeds['park-place'].buildings, 4);
  assert.equal(game.deeds.boardwalk.buildings, 4);
  act(game, { type: 'transfer', fromId: ana.id, toId: 'bank', amount: ana.balance - 150 });
  assert.throws(() => act(game, { type: 'building', direction: 'buy', playerId: ana.id, propertyId: 'boardwalk' }), insufficient(/needs \$200/), 'hotel refused without the cash');
  ana.balance = -40; // an older saved game with a negative balance
  assert.throws(() => act(game, { type: 'building', direction: 'buy', playerId: ana.id, propertyId: 'boardwalk' }), insufficient(/Ana has \$0 but needs \$200/));
  ana.balance = 200;
  act(game, { type: 'building', direction: 'buy', playerId: ana.id, propertyId: 'boardwalk' });
  assert.equal(game.deeds.boardwalk.buildings, 5, 'hotel bought once affordable');
});

test('unmortgaging needs enough cash', () => {
  const game = makeGame();
  const [ana] = game.players;
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'mediterranean' });
  act(game, { type: 'mortgage', playerId: ana.id, propertyId: 'mediterranean' });
  act(game, { type: 'transfer', fromId: ana.id, toId: 'bank', amount: ana.balance - 32 });
  assert.throws(() => act(game, { type: 'unmortgage', playerId: ana.id, propertyId: 'mediterranean' }), insufficient(/Ana has \$32 but needs \$33/));
  assert.equal(game.deeds.mediterranean.mortgaged, true);
});

test('the API returns the insufficient-funds code and details', async (t) => {
  const server = createAppServer({ store: new GameStore() });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const game = await (await post('/api/games', { players: ['Ana', 'Ben'] })).json();
  const response = await post(`/api/games/${game.id}/actions`, { type: 'transfer', fromId: game.players[0].id, toId: 'bank', amount: 2000 });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, 'insufficient-funds');
  assert.deepEqual(body.details, { playerId: game.players[0].id, needed: 2000, balance: 1500, shortfall: 500, raisable: 0 });
  assert.match(body.error, /declare bankruptcy/);
  const plain = await post(`/api/games/${game.id}/actions`, { type: 'nonsense' });
  assert.equal((await plain.json()).code, undefined, 'other errors carry no code');
});
