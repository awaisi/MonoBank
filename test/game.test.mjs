import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, calculateRent, performAction, DEFAULT_RULES, normalizeRules } from '../lib/game.mjs';
import { GameStore } from '../lib/store.mjs';
import { createAppServer } from '../server.mjs';

const makeGame = () => createGame({ players: ['Awais', 'Friend'], startingBalance: 1500 });

test('creates a game for 2–8 unique players', () => {
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

const makeRulesGame = (rules) => createGame({ players: ['Awais', 'Friend'], startingBalance: 1500, rules });

test('uses classic rules by default and validates house rules', () => {
  const game = makeGame();
  assert.deepEqual(game.rules, DEFAULT_RULES);
  assert.equal(game.freeParking, 0);
  assert.equal(game.players[0].inJail, false);
  assert.throws(() => normalizeRules({ auctions: 'yes' }), /on or off/);
  assert.throws(() => normalizeRules({ mortgageInterestPercent: 101 }), /0% and 100%/);
  assert.throws(() => normalizeRules({ freeParkingSeed: -5 }), /non-negative/);
  assert.equal(normalizeRules({ freeParkingSeed: 500 }).freeParkingSeed, 0, 'seed is ignored without the jackpot');
});

test('balances are private by default; the table can choose to show everyone’s money', () => {
  assert.equal(makeGame().rules.showAllBalances, false);
  assert.equal(normalizeRules({ showAllBalances: true }).showAllBalances, true);
  assert.throws(() => normalizeRules({ showAllBalances: 'yes' }), /Show everyone’s money must be on or off/);
  const open = createGame({ players: ['Ana', 'Ben'], rules: { showAllBalances: true } });
  assert.match(open.transactions[0].detail, /Everyone sees all balances/, 'recorded in the opening entry');
  assert.doesNotMatch(makeGame().transactions[0].detail, /balances/);
});

test('Free Parking jackpot collects payments and reseeds the pot', () => {
  const game = makeRulesGame({ freeParkingJackpot: true, freeParkingSeed: 500 });
  const [first, second] = game.players;
  assert.equal(game.freeParking, 500);
  performAction(game, { type: 'transfer', fromId: first.id, toId: 'parking', amount: 200, category: 'tax', note: 'Income Tax' });
  assert.equal(first.balance, 1300);
  assert.equal(game.freeParking, 700);
  assert.equal(game.transactions[0].label, 'Awais paid Free Parking');
  assert.throws(() => performAction(game, { type: 'transfer', fromId: 'parking', toId: second.id, amount: 10 }), /Collect Free Parking/);
  performAction(game, { type: 'collect-parking', playerId: second.id });
  assert.equal(second.balance, 2200);
  assert.equal(game.freeParking, 500);
  assert.equal(game.transactions[0].type, 'parking');
});

test('Free Parking is unavailable when the jackpot is off', () => {
  const game = makeGame();
  const [first] = game.players;
  assert.throws(() => performAction(game, { type: 'transfer', fromId: first.id, toId: 'parking', amount: 50 }), /jackpot is off/);
  assert.throws(() => performAction(game, { type: 'collect-parking', playerId: first.id }), /jackpot is off/);
});

test('an empty Free Parking pot cannot be collected', () => {
  const game = makeRulesGame({ freeParkingJackpot: true });
  assert.throws(() => performAction(game, { type: 'collect-parking', playerId: game.players[0].id }), /empty/);
});

test('no rent is collected while the owner is in jail when the rule is on', () => {
  const game = makeRulesGame({ noRentInJail: true });
  const [owner, tenant] = game.players;
  performAction(game, { type: 'buy', playerId: owner.id, propertyId: 'boardwalk' });
  performAction(game, { type: 'jail', playerId: owner.id, inJail: true });
  assert.equal(owner.inJail, true);
  assert.throws(() => performAction(game, { type: 'rent', payerId: tenant.id, propertyId: 'boardwalk' }), /in jail/);
  assert.throws(() => performAction(game, { type: 'jail', playerId: owner.id, inJail: true }), /already/);
  performAction(game, { type: 'jail', playerId: owner.id, inJail: false });
  performAction(game, { type: 'rent', payerId: tenant.id, propertyId: 'boardwalk' });
  assert.equal(tenant.balance, 1450);
});

test('rent is still collected from jail under classic rules', () => {
  const game = makeGame();
  const [owner, tenant] = game.players;
  performAction(game, { type: 'buy', playerId: owner.id, propertyId: 'boardwalk' });
  performAction(game, { type: 'jail', playerId: owner.id, inJail: true });
  performAction(game, { type: 'rent', payerId: tenant.id, propertyId: 'boardwalk' });
  assert.equal(owner.balance, 1150);
});

test('auctions can be turned off', () => {
  const game = makeRulesGame({ auctions: false });
  const [buyer] = game.players;
  assert.throws(() => performAction(game, { type: 'buy', playerId: buyer.id, propertyId: 'boardwalk', amount: 400, auction: true }), /Auctions are off/);
  assert.throws(() => performAction(game, { type: 'buy', playerId: buyer.id, propertyId: 'boardwalk', amount: 250 }), /list price/);
  performAction(game, { type: 'buy', playerId: buyer.id, propertyId: 'boardwalk', amount: 400 });
  assert.equal(buyer.balance, 1100);
});

test('uneven building is allowed when even building is off', () => {
  const game = makeRulesGame({ evenBuilding: false });
  const [owner] = game.players;
  performAction(game, { type: 'buy', playerId: owner.id, propertyId: 'park-place' });
  performAction(game, { type: 'buy', playerId: owner.id, propertyId: 'boardwalk' });
  performAction(game, { type: 'building', direction: 'buy', playerId: owner.id, propertyId: 'boardwalk' });
  performAction(game, { type: 'building', direction: 'buy', playerId: owner.id, propertyId: 'boardwalk' });
  assert.equal(game.deeds.boardwalk.buildings, 2);
  assert.equal(game.deeds['park-place'].buildings, 0);
  performAction(game, { type: 'building', direction: 'sell', playerId: owner.id, propertyId: 'boardwalk' });
  assert.equal(game.deeds.boardwalk.buildings, 1);
});

test('mortgage interest follows the house rule', () => {
  const game = makeRulesGame({ mortgageInterestPercent: 0 });
  const [owner] = game.players;
  performAction(game, { type: 'buy', playerId: owner.id, propertyId: 'boardwalk' });
  performAction(game, { type: 'mortgage', playerId: owner.id, propertyId: 'boardwalk' });
  performAction(game, { type: 'unmortgage', playerId: owner.id, propertyId: 'boardwalk' });
  assert.equal(owner.balance, 1100);
  assert.equal(game.transactions[0].detail, 'Mortgage value + 0%');
});

test('records house rules in the opening ledger entry', () => {
  const game = makeRulesGame({ freeParkingJackpot: true, freeParkingSeed: 500, doubleGoOnLanding: true, auctions: false });
  const opening = game.transactions.at(-1).detail;
  assert.match(opening, /Free Parking jackpot \(seeded \$500\)/);
  assert.match(opening, /\$400 for landing on GO/);
  assert.match(opening, /No auctions/);
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
  assert.deepEqual(created.rules, DEFAULT_RULES);

  const withRules = await fetch(`http://127.0.0.1:${port}/api/games`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ players: ['One', 'Two'], rules: { freeParkingJackpot: true, freeParkingSeed: 250 } })
  }).then((res) => res.json());
  assert.equal(withRules.rules.freeParkingJackpot, true);
  assert.equal(withRules.freeParking, 250);

  const invalid = await fetch(`http://127.0.0.1:${port}/api/games`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ players: ['One', 'Two'], rules: { auctions: 'nope' } })
  });
  assert.equal(invalid.status, 400);
});
