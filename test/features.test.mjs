import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, performAction, publicGame, spectatorView, netWorth, standings, calculateRent, playTime } from '../lib/game.mjs';

const makeGame = (names = ['Ana', 'Ben', 'Cy'], options = {}) => createGame({ players: names, startingBalance: 1500, ...options });
const act = (game, action) => performAction(game, action);
const byName = (game, name) => game.players.find((entry) => entry.name === name);

// ---------------------------------------------------------------- undo ----

test('undo restores balances after a transfer and marks the entry', () => {
  const game = makeGame();
  const [ana, ben] = game.players;
  act(game, { type: 'transfer', fromId: ana.id, toId: ben.id, amount: 300 });
  const paymentId = game.transactions[0].id;
  act(game, { type: 'undo' });
  assert.equal(ana.balance, 1500);
  assert.equal(ben.balance, 1500);
  assert.equal(game.transactions.find((entry) => entry.id === paymentId).undone, true);
  assert.equal(game.transactions[0].type, 'undo');
  assert.equal(game.transactions[0].label, 'Undid: Ana paid Ben');
});

test('undo walks back several actions in reverse order', () => {
  const game = makeGame();
  const [ana] = game.players;
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'park-place' });
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'boardwalk' });
  act(game, { type: 'building', direction: 'buy', playerId: ana.id, propertyId: 'boardwalk' });
  act(game, { type: 'undo' });
  assert.equal(game.deeds.boardwalk.buildings, 0);
  act(game, { type: 'undo' });
  assert.equal(game.deeds.boardwalk.ownerId, null);
  assert.equal(game.deeds['park-place'].ownerId, ana.id);
  act(game, { type: 'undo' });
  assert.equal(game.deeds['park-place'].ownerId, null);
  assert.equal(ana.balance, 1500);
  assert.throws(() => act(game, { type: 'undo' }), /nothing to undo/);
});

test('undo reverses trades, mortgages, jail, and the Free Parking pot', () => {
  const game = makeGame(['Ana', 'Ben'], { rules: { freeParkingJackpot: true, freeParkingSeed: 100, noRentInJail: true } });
  const [ana, ben] = game.players;
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'boardwalk' });
  act(game, { type: 'trade', firstPlayerId: ana.id, secondPlayerId: ben.id, firstPropertyIds: ['boardwalk'], secondCash: 500 });
  act(game, { type: 'undo' });
  assert.equal(game.deeds.boardwalk.ownerId, ana.id);
  assert.equal(ben.balance, 1500);

  act(game, { type: 'mortgage', playerId: ana.id, propertyId: 'boardwalk' });
  act(game, { type: 'undo' });
  assert.equal(game.deeds.boardwalk.mortgaged, false);

  act(game, { type: 'jail', playerId: ana.id, inJail: true });
  act(game, { type: 'undo' });
  assert.equal(ana.inJail, false);

  act(game, { type: 'transfer', fromId: ben.id, toId: 'parking', amount: 200 });
  act(game, { type: 'collect-parking', playerId: ana.id });
  assert.equal(game.freeParking, 100);
  act(game, { type: 'undo' });
  assert.equal(game.freeParking, 300);
  assert.equal(ana.balance, 1100);
});

test('undo keeps the revision moving forward and requires the current revision', () => {
  const game = makeGame();
  const [ana, ben] = game.players;
  act(game, { type: 'transfer', fromId: ana.id, toId: ben.id, amount: 10 });
  const revision = game.revision;
  assert.throws(() => act(game, { type: 'undo', expectedRevision: revision - 1 }), (error) => error.status === 409);
  act(game, { type: 'undo', expectedRevision: revision });
  assert.equal(game.revision, revision + 1);
});

test('publicGame exposes the next undo but never the history snapshots', () => {
  const game = makeGame();
  assert.equal(publicGame(game).undo, null);
  act(game, { type: 'transfer', fromId: game.players[0].id, toId: 'bank', amount: 50 });
  const view = publicGame(game);
  assert.equal(view.history, undefined);
  assert.deepEqual(view.undo, { label: 'Ana paid Bank', transactionId: game.transactions[0].id });
});

test('undo history is capped at the 50 most recent actions', () => {
  const game = makeGame();
  const [ana, ben] = game.players;
  for (let i = 0; i < 55; i++) act(game, { type: 'transfer', fromId: ana.id, toId: ben.id, amount: 1 });
  assert.equal(game.history.length, 50);
  for (let i = 0; i < 50; i++) act(game, { type: 'undo' });
  assert.equal(ana.balance, 1495, 'the five oldest payments are beyond the undo window');
  assert.throws(() => act(game, { type: 'undo' }), /nothing to undo/);
});

test('failed actions leave the game unchanged (atomic actions)', () => {
  const game = makeGame(['Ana', 'Ben']);
  const [ana, ben] = game.players;
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'boardwalk' });
  const snapshot = JSON.stringify(publicGame(game));
  assert.throws(() => act(game, { type: 'trade', firstPlayerId: ana.id, secondPlayerId: ben.id, firstPropertyIds: ['boardwalk'], secondPropertyIds: ['park-place'] }), /does not own/);
  assert.throws(() => act(game, { type: 'transfer', fromId: ana.id, toId: ben.id, amount: -5 }), /non-negative/);
  assert.throws(() => act(game, { type: 'nonsense' }), /Unknown action/);
  assert.equal(JSON.stringify(publicGame(game)), snapshot);
});

// ----------------------------------------------------------- bankruptcy ----

test('bankruptcy to a player hands over cash, deeds and building proceeds', () => {
  const game = makeGame();
  const ana = byName(game, 'Ana');
  const cy = byName(game, 'Cy');
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'park-place' });
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'boardwalk' });
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'reading-railroad' });
  act(game, { type: 'mortgage', playerId: ana.id, propertyId: 'reading-railroad' });
  act(game, { type: 'building', direction: 'buy', playerId: ana.id, propertyId: 'park-place' });
  act(game, { type: 'building', direction: 'buy', playerId: ana.id, propertyId: 'boardwalk' });
  // 1500 - 350 - 400 - 200 + 100 - 200 - 200 = 250 cash; two houses sell for $100 each
  assert.equal(ana.balance, 250);
  act(game, { type: 'bankrupt', playerId: ana.id, creditorId: cy.id });
  assert.equal(ana.bankrupt, true);
  assert.equal(ana.balance, 0);
  assert.equal(cy.balance, 1500 + 250 + 200);
  assert.equal(game.deeds.boardwalk.ownerId, cy.id);
  assert.equal(game.deeds.boardwalk.buildings, 0);
  assert.equal(game.deeds['reading-railroad'].mortgaged, true, 'mortgaged deeds transfer still mortgaged');
  assert.match(game.transactions[0].detail, /3 deeds and \$450 to Cy · buildings sold for \$200/);
  assert.equal(game.status, 'active', 'two players remain');
});

test('bankruptcy to the Bank returns deeds unowned and unmortgaged', () => {
  const game = makeGame();
  const ana = byName(game, 'Ana');
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'boardwalk' });
  act(game, { type: 'mortgage', playerId: ana.id, propertyId: 'boardwalk' });
  act(game, { type: 'bankrupt', playerId: ana.id });
  assert.equal(game.deeds.boardwalk.ownerId, null);
  assert.equal(game.deeds.boardwalk.mortgaged, false);
  assert.equal(game.transactions[0].toId, 'bank');
});

test('a negative balance from an older saved game is written off, not taken from the creditor', () => {
  const game = makeGame();
  const [ana, ben] = game.players;
  ana.balance = -300; // balances can no longer go negative; older saved games may still have one
  act(game, { type: 'bankrupt', playerId: ana.id, creditorId: ben.id });
  assert.equal(ben.balance, 1500);
  assert.equal(game.transactions[0].amount, null);
});

test('bankrupt players are blocked from further actions and hidden from lists', () => {
  const game = makeGame();
  const [ana, ben, cy] = game.players;
  act(game, { type: 'bankrupt', playerId: ana.id, creditorId: ben.id });
  assert.throws(() => act(game, { type: 'transfer', fromId: ana.id, toId: ben.id, amount: 5 }), /bankrupt/);
  assert.throws(() => act(game, { type: 'transfer', fromId: cy.id, toId: ana.id, amount: 5 }), /bankrupt/);
  assert.throws(() => act(game, { type: 'buy', playerId: ana.id, propertyId: 'boardwalk' }), /bankrupt/);
  assert.throws(() => act(game, { type: 'bankrupt', playerId: ana.id }), /bankrupt/);
  assert.throws(() => act(game, { type: 'bankrupt', playerId: ben.id, creditorId: ana.id }), /bankrupt/);
});

test('bankruptcy validates the creditor', () => {
  const game = makeGame();
  const [ana] = game.players;
  assert.throws(() => act(game, { type: 'bankrupt', playerId: ana.id, creditorId: ana.id }), /owe themselves/);
  assert.throws(() => act(game, { type: 'bankrupt', playerId: ana.id, creditorId: 'nobody' }), /Player not found/);
});

test('the last player standing wins automatically', () => {
  const game = makeGame(['Ana', 'Ben']);
  const [ana, ben] = game.players;
  act(game, { type: 'bankrupt', playerId: ana.id, creditorId: ben.id });
  assert.equal(game.status, 'ended');
  assert.deepEqual(game.winnerIds, [ben.id]);
  assert.match(game.transactions[0].detail, /Ben wins/);
  assert.throws(() => act(game, { type: 'transfer', fromId: ben.id, toId: 'bank', amount: 1 }), /game has ended/);
});

test('undoing a bankruptcy brings the player back with their assets', () => {
  const game = makeGame(['Ana', 'Ben']);
  const [ana, ben] = game.players;
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'boardwalk' });
  act(game, { type: 'bankrupt', playerId: ana.id, creditorId: ben.id });
  act(game, { type: 'undo' });
  assert.equal(ana.bankrupt, false);
  assert.equal(ana.balance, 1100);
  assert.equal(game.deeds.boardwalk.ownerId, ana.id);
  assert.equal(game.status, 'active');
  assert.deepEqual(game.winnerIds, []);
});

// ------------------------------------------------- net worth & end game ----

test('net worth values deeds at list price, mortgaged deeds net of payoff, and buildings at resale', () => {
  const game = makeGame(['Ana', 'Ben']);
  const [ana] = game.players;
  act(game, { type: 'transfer', fromId: 'bank', toId: ana.id, amount: 2000 });
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'park-place' });
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'boardwalk' });
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'water-works' });
  act(game, { type: 'mortgage', playerId: ana.id, propertyId: 'water-works' });
  for (let i = 0; i < 5; i++) {
    act(game, { type: 'building', direction: 'buy', playerId: ana.id, propertyId: 'park-place' });
    act(game, { type: 'building', direction: 'buy', playerId: ana.id, propertyId: 'boardwalk' });
  }
  const worth = netWorth(game, ana);
  assert.equal(worth.deeds, 3);
  assert.equal(worth.property, 350 + 400 + (150 - Math.round(75 * 1.1)), 'Water Works counts net of the $83 payoff');
  assert.equal(worth.buildings, 10 * 100, 'two hotels at half of five houses each');
  assert.equal(worth.cash, ana.balance);
  assert.equal(worth.total, ana.balance + worth.property + worth.buildings);
  assert.equal(worth.raisable, 1000 + 175 + 200, 'sell every building, then mortgage the unmortgaged deeds');
  assert.equal(calculateRent(game, 'boardwalk'), 2000);
});

test('reversible moves leave net worth unchanged and real costs show up immediately', () => {
  const game = makeGame(['Ana', 'Ben']);
  const [ana] = game.players;
  const total = () => netWorth(game, ana).total;
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'park-place' });
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'boardwalk' });
  assert.equal(total(), 1500, 'buying at list price keeps worth');
  act(game, { type: 'building', direction: 'buy', playerId: ana.id, propertyId: 'boardwalk' });
  assert.equal(total(), 1400, 'a $200 house only resells for $100');
  act(game, { type: 'building', direction: 'sell', playerId: ana.id, propertyId: 'boardwalk' });
  assert.equal(total(), 1400, 'selling it back changes nothing');
  act(game, { type: 'mortgage', playerId: ana.id, propertyId: 'boardwalk' });
  assert.equal(total(), 1380, 'the $20 interest owed counts as soon as you mortgage');
  act(game, { type: 'unmortgage', playerId: ana.id, propertyId: 'boardwalk' });
  assert.equal(total(), 1380, 'paying the mortgage off changes nothing');
});

test('net worth respects the mortgage interest house rule', () => {
  const game = makeGame(['Ana', 'Ben'], { rules: { mortgageInterestPercent: 0 } });
  const [ana] = game.players;
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'boardwalk' });
  act(game, { type: 'mortgage', playerId: ana.id, propertyId: 'boardwalk' });
  assert.equal(netWorth(game, ana).total, 1500);
});

test('standings rank by net worth, share ties, and list bankrupt players last', () => {
  const game = makeGame(['Ana', 'Ben', 'Cy', 'Di']);
  const [ana, ben, cy, di] = game.players;
  act(game, { type: 'transfer', fromId: 'bank', toId: cy.id, amount: 500 });
  act(game, { type: 'bankrupt', playerId: di.id });
  const table = standings(game);
  assert.deepEqual(table.map((row) => [row.name, row.rank]), [['Cy', 1], ['Ana', 2], ['Ben', 2], ['Di', 4]]);
  assert.equal(table.at(-1).bankrupt, true);
  assert.equal(publicGame(game).standings.length, 4);
  assert.ok(ana && ben);
});

test('ending the game declares the highest net worth the winner and freezes play', () => {
  const game = makeGame();
  const [ana, ben] = game.players;
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'boardwalk' });
  act(game, { type: 'transfer', fromId: ben.id, toId: 'bank', amount: 100 });
  act(game, { type: 'end-game' });
  assert.equal(game.status, 'ended');
  assert.ok(game.endedAt);
  assert.match(game.transactions[0].label, /Game over: Ana & Cy tie/);
  assert.match(game.transactions[0].detail, /Net worth · Ana \$1,500/);
  assert.equal(game.winnerIds.length, 2);
  assert.throws(() => act(game, { type: 'end-game' }), /game has ended/);
  assert.throws(() => act(game, { type: 'rent', payerId: ben.id, propertyId: 'boardwalk' }), /game has ended/);
});

test('the table can finish the game at any time and pick the winner', () => {
  const game = makeGame();
  const [ana, ben, cy] = game.players;
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'boardwalk' });
  act(game, { type: 'transfer', fromId: ben.id, toId: 'bank', amount: 100 });
  act(game, { type: 'end-game', winnerId: ben.id });
  assert.equal(game.status, 'ended');
  assert.deepEqual(game.winnerIds, [ben.id], 'the chosen player wins even without the highest net worth');
  assert.equal(game.transactions[0].label, 'Game over: Ben wins');
  assert.match(game.transactions[0].detail, /^Winner chosen by the table · Net worth · /);
  act(game, { type: 'undo' });
  assert.equal(game.status, 'active');
  assert.deepEqual(game.winnerIds, []);
  act(game, { type: 'end-game', winnerId: '' });
  assert.deepEqual(game.winnerIds.sort(), [ana.id, cy.id].sort(), 'an empty choice falls back to net worth');
  act(game, { type: 'undo' });
  act(game, { type: 'end-game', winnerId: null });
  assert.equal(game.winnerIds.length, 2);
});

test('the chosen winner must be a player still in the game', () => {
  const game = makeGame();
  const [ana, ben] = game.players;
  act(game, { type: 'bankrupt', playerId: ana.id, creditorId: ben.id });
  const revision = game.revision;
  assert.throws(() => act(game, { type: 'end-game', winnerId: ana.id }), /Ana is bankrupt and out of the game/);
  assert.throws(() => act(game, { type: 'end-game', winnerId: 'nobody' }), /Player not found/);
  assert.equal(game.status, 'active', 'a rejected finish leaves the game running');
  assert.equal(game.revision, revision);
});

test('a single winner is named, and undo reopens an ended game', () => {
  const game = makeGame(['Ana', 'Ben']);
  const [ana, ben] = game.players;
  act(game, { type: 'transfer', fromId: 'bank', toId: ben.id, amount: 1 });
  act(game, { type: 'end-game' });
  assert.equal(game.transactions[0].label, 'Game over: Ben wins');
  act(game, { type: 'undo' });
  assert.equal(game.status, 'active');
  assert.equal(game.endedAt, null);
  act(game, { type: 'transfer', fromId: ana.id, toId: ben.id, amount: 5 });
  assert.equal(ben.balance, 1506);
});

// ----------------------------------------------------------- play time ----

test('play time runs from the first move to the last move before Finish game', () => {
  const game = makeGame();
  const [ana, ben] = game.players;
  assert.equal(game.startedAt, null, 'opening the bank is not a move');
  assert.equal(playTime(game), null, 'no play time while the game is running');
  act(game, { type: 'transfer', fromId: ana.id, toId: ben.id, amount: 10 });
  assert.equal(game.startedAt, game.transactions[0].at, 'the first move starts the clock');
  act(game, { type: 'transfer', fromId: ben.id, toId: ana.id, amount: 5 });
  // Pretend the table played from 7:00 to 8:35 and only pressed Finish much later.
  game.startedAt = '2026-01-01T19:00:00.000Z';
  game.transactions[0].at = '2026-01-01T20:35:00.000Z';
  act(game, { type: 'end-game' });
  assert.deepEqual(playTime(game), { startedAt: '2026-01-01T19:00:00.000Z', endedAt: '2026-01-01T20:35:00.000Z', minutes: 95 });
  assert.notEqual(game.endedAt, game.playedUntil, 'the Finish press itself is not counted');
  assert.equal(game.startedAt, '2026-01-01T19:00:00.000Z', 'game over does not move the start');
  assert.deepEqual(publicGame(game).playTime, playTime(game));
  assert.deepEqual(spectatorView(game).playTime, playTime(game));
});

test('undoing game over clears the end of play, and reopening is not counted as play', () => {
  const game = makeGame(['Ana', 'Ben']);
  const [ana, ben] = game.players;
  act(game, { type: 'transfer', fromId: ana.id, toId: ben.id, amount: 10 });
  const lastMove = game.transactions[0].at;
  act(game, { type: 'end-game' });
  assert.equal(game.playedUntil, lastMove);
  act(game, { type: 'undo' });
  assert.equal(game.playedUntil, null, 'undo restores the end of play');
  assert.equal(playTime(game), null);
  act(game, { type: 'end-game' });
  assert.equal(game.playedUntil, lastMove, 'the undo entry and the earlier game over are not moves');
});

test('finishing before any move reports no play time', () => {
  const game = makeGame(['Ana', 'Ben']);
  act(game, { type: 'end-game' });
  assert.equal(game.startedAt, null, 'game over does not start the clock');
  assert.deepEqual(playTime(game), { startedAt: null, endedAt: null, minutes: 0 });
});

test('games saved before play time existed fall back to the oldest move in the ledger', () => {
  const game = makeGame(['Ana', 'Ben']);
  const [ana, ben] = game.players;
  act(game, { type: 'transfer', fromId: ana.id, toId: ben.id, amount: 10 });
  act(game, { type: 'transfer', fromId: ben.id, toId: ana.id, amount: 10 });
  game.transactions[1].at = '2026-01-01T19:00:00.000Z';
  game.transactions[0].at = '2026-01-01T19:20:00.000Z';
  delete game.startedAt;
  delete game.playedUntil;
  act(game, { type: 'end-game' });
  assert.equal(game.startedAt, '2026-01-01T19:00:00.000Z');
  assert.equal(playTime(game).minutes, 20);
});
