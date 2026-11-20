import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, performAction, calculateRent, normalizeRules, MAX_PLAYERS, MIN_PLAYERS } from '../lib/game.mjs';

const makeGame = () => createGame({ players: ['Ana', 'Ben'], startingBalance: 1500 });
const act = performAction;

test('railroad rent doubles with each railroad owned', () => {
  const game = makeGame();
  const [ana] = game.players;
  const railroads = ['reading-railroad', 'pennsylvania-railroad', 'bo-railroad', 'short-line'];
  const expected = [25, 50, 100, 200];
  railroads.forEach((id, index) => {
    act(game, { type: 'buy', playerId: ana.id, propertyId: id });
    assert.equal(calculateRent(game, 'reading-railroad'), expected[index]);
  });
});

test('utility rent is 4× the dice with one utility and 10× with both', () => {
  const game = makeGame();
  const [ana, ben] = game.players;
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'electric-company' });
  assert.equal(calculateRent(game, 'electric-company', 7), 28);
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'water-works' });
  assert.equal(calculateRent(game, 'electric-company', 7), 70);
  act(game, { type: 'rent', payerId: ben.id, propertyId: 'water-works', diceTotal: 12 });
  assert.equal(ben.balance, 1380);
  assert.throws(() => calculateRent(game, 'water-works', 13), /2 to 12/);
  assert.throws(() => calculateRent(game, 'water-works', 1), /2 to 12/);
  assert.throws(() => calculateRent(game, 'water-works'), /Dice total/);
});

test('street rent doubles for a full color set and follows the building table', () => {
  const game = makeGame();
  const [ana] = game.players;
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'mediterranean' });
  assert.equal(calculateRent(game, 'mediterranean'), 2);
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'baltic' });
  assert.equal(calculateRent(game, 'mediterranean'), 4);
  act(game, { type: 'building', direction: 'buy', playerId: ana.id, propertyId: 'mediterranean' });
  assert.equal(calculateRent(game, 'mediterranean'), 10);
});

test('mortgaged deeds collect no rent', () => {
  const game = makeGame();
  const [ana, ben] = game.players;
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'boardwalk' });
  act(game, { type: 'mortgage', playerId: ana.id, propertyId: 'boardwalk' });
  assert.equal(calculateRent(game, 'boardwalk'), 0);
  assert.throws(() => act(game, { type: 'rent', payerId: ben.id, propertyId: 'boardwalk' }), /mortgaged/);
});

test('rent and deed actions validate ownership', () => {
  const game = makeGame();
  const [ana, ben] = game.players;
  assert.throws(() => calculateRent(game, 'boardwalk'), /no owner/);
  assert.throws(() => act(game, { type: 'rent', payerId: ben.id, propertyId: 'boardwalk' }), /no owner/);
  assert.throws(() => calculateRent(game, 'atlantis'), /Property not found/);
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'boardwalk' });
  assert.throws(() => act(game, { type: 'buy', playerId: ben.id, propertyId: 'boardwalk' }), /already owned/);
  assert.throws(() => act(game, { type: 'rent', payerId: ana.id, propertyId: 'boardwalk' }), /pay themselves/);
  assert.throws(() => act(game, { type: 'mortgage', playerId: ben.id, propertyId: 'boardwalk' }), /does not own/);
  assert.throws(() => act(game, { type: 'unmortgage', playerId: ana.id, propertyId: 'boardwalk' }), /not mortgaged/);
  act(game, { type: 'mortgage', playerId: ana.id, propertyId: 'boardwalk' });
  assert.throws(() => act(game, { type: 'mortgage', playerId: ana.id, propertyId: 'boardwalk' }), /already mortgaged/);
});

test('purchases support auction prices and validate the amount', () => {
  const game = makeGame();
  const [ana] = game.players;
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'boardwalk', amount: 250, auction: true });
  assert.equal(ana.balance, 1250);
  assert.equal(game.transactions[0].type, 'auction');
  assert.throws(() => act(game, { type: 'buy', playerId: ana.id, propertyId: 'park-place', amount: 0 }), /at least \$1/);
});

test('building rules: streets only, unmortgaged full set, hotel cap, even selling', () => {
  const game = makeGame();
  const [ana] = game.players;
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'short-line' });
  assert.throws(() => act(game, { type: 'building', direction: 'buy', playerId: ana.id, propertyId: 'short-line' }), /only be placed on streets/);
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'mediterranean' });
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'baltic' });
  act(game, { type: 'mortgage', playerId: ana.id, propertyId: 'baltic' });
  assert.throws(() => act(game, { type: 'building', direction: 'buy', playerId: ana.id, propertyId: 'baltic' }), /Unmortgage this deed/);
  assert.throws(() => act(game, { type: 'building', direction: 'buy', playerId: ana.id, propertyId: 'mediterranean' }), /complete color set/);
  act(game, { type: 'unmortgage', playerId: ana.id, propertyId: 'baltic' });
  assert.throws(() => act(game, { type: 'building', direction: 'sell', playerId: ana.id, propertyId: 'baltic' }), /no buildings/);
  assert.throws(() => act(game, { type: 'building', direction: 'sideways', playerId: ana.id, propertyId: 'baltic' }), /buy or sell/);
  for (let i = 0; i < 5; i++) {
    act(game, { type: 'building', direction: 'buy', playerId: ana.id, propertyId: 'mediterranean' });
    act(game, { type: 'building', direction: 'buy', playerId: ana.id, propertyId: 'baltic' });
  }
  assert.match(game.transactions[0].label, /added a hotel/);
  assert.throws(() => act(game, { type: 'building', direction: 'buy', playerId: ana.id, propertyId: 'baltic' }), /already has a hotel/);
  act(game, { type: 'building', direction: 'sell', playerId: ana.id, propertyId: 'baltic' });
  assert.throws(() => act(game, { type: 'building', direction: 'sell', playerId: ana.id, propertyId: 'baltic' }), /Sell evenly/);
  assert.throws(() => act(game, { type: 'mortgage', playerId: ana.id, propertyId: 'mediterranean' }), /Sell all buildings/);
});

test('trades move deeds and cash atomically and validate both sides', () => {
  const game = makeGame();
  const [ana, ben] = game.players;
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'boardwalk' });
  act(game, { type: 'buy', playerId: ben.id, propertyId: 'park-place' });
  act(game, { type: 'trade', firstPlayerId: ana.id, secondPlayerId: ben.id, firstPropertyIds: ['boardwalk'], secondPropertyIds: ['park-place'], firstCash: 50 });
  assert.equal(game.deeds.boardwalk.ownerId, ben.id);
  assert.equal(game.deeds['park-place'].ownerId, ana.id);
  assert.equal(ben.balance, 1500 - 350 + 50);
  assert.match(game.transactions[0].detail, /Ana: Boardwalk · Ana: \$50 · Ben: Park Place/);
  assert.throws(() => act(game, { type: 'trade', firstPlayerId: ana.id, secondPlayerId: ana.id }), /two different players/);
  assert.throws(() => act(game, { type: 'trade', firstPlayerId: ana.id, secondPlayerId: ben.id }), /Add cash or deeds/);
  assert.throws(() => act(game, { type: 'trade', firstPlayerId: ana.id, secondPlayerId: ben.id, firstPropertyIds: ['park-place'], secondPropertyIds: ['park-place'] }), /both sides/);
});

test('deeds in a color set with buildings cannot be traded', () => {
  const game = makeGame();
  const [ana, ben] = game.players;
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'mediterranean' });
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'baltic' });
  act(game, { type: 'building', direction: 'buy', playerId: ana.id, propertyId: 'baltic' });
  assert.throws(() => act(game, { type: 'trade', firstPlayerId: ana.id, secondPlayerId: ben.id, firstPropertyIds: ['mediterranean'] }), /Sell all buildings/);
});

test('transfers validate accounts and amounts', () => {
  const game = makeGame();
  const [ana] = game.players;
  assert.throws(() => act(game, { type: 'transfer', fromId: ana.id, toId: ana.id, amount: 5 }), /two different accounts/);
  assert.throws(() => act(game, { type: 'transfer', fromId: 'bank', toId: 'bank', amount: 5 }), /two different accounts/);
  assert.throws(() => act(game, { type: 'transfer', fromId: ana.id, toId: 'bank', amount: 0 }), /at least \$1/);
  assert.throws(() => act(game, { type: 'transfer', fromId: ana.id, toId: 'bank', amount: 2.5 }), /whole number/);
  assert.throws(() => act(game, { type: 'transfer', fromId: 'ghost', toId: 'bank', amount: 5 }), /Player not found/);
  act(game, { type: 'transfer', fromId: 'bank', toId: ana.id, amount: 200, note: '  Passed GO  ', category: 'transfer' });
  assert.equal(game.transactions[0].detail, 'Passed GO');
  assert.equal(game.transactions[0].label, 'Bank paid Ana');
});

test('the Bank can seed the Free Parking pot directly', () => {
  const game = createGame({ players: ['Ana', 'Ben'], rules: { freeParkingJackpot: true } });
  act(game, { type: 'transfer', fromId: 'bank', toId: 'parking', amount: 250 });
  assert.equal(game.freeParking, 250);
});

test('game creation validates players, balance and rules', () => {
  assert.throws(() => createGame({ players: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] }), /between 2 and 8/);
  assert.throws(() => createGame({ players: ['Solo'] }), /between 2 and 8/);
  assert.throws(() => createGame({ players: 'Ana, Ben' }), /between 2 and 8/);
  assert.throws(() => createGame({ players: ['A', '  '] }), /needs a name/);
  assert.throws(() => createGame({ players: ['A', 'B'], startingBalance: 0 }), /between \$1/);
  assert.throws(() => createGame({ players: ['A', 'B'], startingBalance: 2_000_000 }), /between \$1/);
  assert.throws(() => createGame({ players: ['A', 'B'], rules: [] }), /must be an object/);
  assert.equal(createGame({ players: [{ name: 'A' }, { name: 'B' }] }).players[1].name, 'B');
  assert.equal(createGame({ players: ['A', 'B'], rules: null }).rules.auctions, true);
  assert.throws(() => normalizeRules({ freeParkingJackpot: true, freeParkingSeed: 100_001 }), /\$100,000 or less/);
  assert.throws(() => normalizeRules({ evenBuilding: 1 }), /on or off/);
});

test('actions require an object and a valid jail flag', () => {
  const game = makeGame();
  assert.throws(() => act(game, null), /Action is required/);
  assert.throws(() => act(game, 'transfer'), /Action is required/);
  assert.throws(() => act(game, { type: 'jail', playerId: game.players[0].id, inJail: 'yes' }), /on or off/);
  assert.throws(() => act(game, { type: 'jail', playerId: game.players[0].id, inJail: false }), /not in jail/);
});

test('supports up to 8 players, each with a distinct color and token', async () => {
  const names = ['Ana', 'Ben', 'Cy', 'Di', 'Eve', 'Fay', 'Gus', 'Hal'];
  const game = createGame({ players: names });
  assert.equal(game.players.length, MAX_PLAYERS);
  assert.equal(MIN_PLAYERS, 2);
  assert.equal(new Set(game.players.map((player) => player.color)).size, 8);
  assert.equal(new Set(game.players.map((player) => player.token)).size, 8);
  assert.ok(game.players.every((player) => /^#[0-9a-f]{6}$/.test(player.color) && player.token));
  const [ana, , , , , , , hal] = game.players;
  performAction(game, { type: 'transfer', fromId: ana.id, toId: hal.id, amount: 100 });
  performAction(game, { type: 'bankrupt', playerId: hal.id, creditorId: ana.id });
  assert.equal(game.status, 'active', 'seven players remain');
  assert.equal(ana.balance, 1500 - 100 + 1600);

  // The setup form colors in public/app.js must match the server's seat colors.
  const { readFile } = await import('node:fs/promises');
  const client = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const clientColors = JSON.parse(client.match(/const PLAYER_COLORS = (\[[^\]]+\])/)[1].replaceAll("'", '"'));
  assert.deepEqual(clientColors, game.players.map((player) => player.color));
  assert.equal(Number(client.match(/const MAX_PLAYERS = (\d+)/)[1]), MAX_PLAYERS);
});
