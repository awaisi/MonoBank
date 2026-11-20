import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, performAction, publicGame, spectatorView, activityStats, ledgerPage, ledgerCsv, TRANSACTION_LIMIT, LEDGER_WINDOW, LEDGER_PAGE } from '../lib/game.mjs';
import { createAppServer } from '../server.mjs';
import { GameStore } from '../lib/store.mjs';

const makeGame = (names = ['Ana', 'Ben', 'Cy'], options = {}) => createGame({ players: names, startingBalance: 1500, ...options });
const act = (game, action) => performAction(game, action);
const transfers = (game, count) => {
  const [ana, ben] = game.players;
  for (let i = 0; i < count; i += 1) act(game, { type: 'transfer', fromId: i % 2 ? ben.id : ana.id, toId: i % 2 ? ana.id : ben.id, amount: 1 });
};

// ------------------------------------------------------- balance stamps ----

test('every move records each seat balance and change, including both sides of a trade and undo', () => {
  const game = makeGame();
  const [ana, ben, cy] = game.players;
  assert.equal(game.transactions[0].balances, undefined, 'opening the bank has no stamp');
  act(game, { type: 'transfer', fromId: ana.id, toId: ben.id, amount: 100 });
  assert.deepEqual(game.transactions[0].balances, [1400, 1600, 1500]);
  assert.deepEqual(game.transactions[0].deltas, [-100, 100, 0]);
  act(game, { type: 'buy', playerId: cy.id, propertyId: 'boardwalk' });
  act(game, { type: 'trade', firstPlayerId: cy.id, secondPlayerId: ana.id, firstCash: 0, secondCash: 300, firstPropertyIds: ['boardwalk'], secondPropertyIds: [] });
  assert.deepEqual(game.transactions[0].deltas, [-300, 0, 300], 'a trade moves cash both ways in one entry');
  assert.deepEqual(game.transactions[0].balances, [1100, 1600, 1400]);
  act(game, { type: 'undo' });
  assert.equal(game.transactions[0].type, 'undo');
  assert.deepEqual(game.transactions[0].deltas, [300, 0, -300], 'undo records the reversal');
  assert.deepEqual(game.transactions[0].balances, [1400, 1600, 1100]);
});

// ------------------------------------------------- long-game ledger cap ----

test('the ledger keeps a long game and counts entries dropped past the limit', () => {
  const game = makeGame(['Ana', 'Ben']);
  const filler = Array.from({ length: TRANSACTION_LIMIT }, (_, index) => ({ ...game.transactions[0], id: `old-${index}` }));
  game.transactions = filler;
  transfers(game, 3);
  assert.equal(game.transactions.length, TRANSACTION_LIMIT);
  assert.equal(game.transactionsDropped, 3);
  transfers(game, 1);
  assert.equal(game.transactionsDropped, 4);
  assert.equal(activityStats(game).complete, false);
});

test('players get the newest ledger window plus the total count', () => {
  const game = makeGame(['Ana', 'Ben']);
  transfers(game, LEDGER_WINDOW + 20);
  const view = publicGame(game);
  assert.equal(view.transactions.length, LEDGER_WINDOW);
  assert.equal(view.transactions[0].id, game.transactions[0].id);
  assert.equal(view.transactionCount, LEDGER_WINDOW + 21);
  assert.equal(view.transactionsDropped, 0);
  assert.equal(spectatorView(game).transactions.length, LEDGER_WINDOW);
});

test('older ledger pages continue after a given entry', () => {
  const game = makeGame(['Ana', 'Ben']);
  transfers(game, 250);
  const total = game.transactions.length;
  const first = ledgerPage(game, game.transactions[LEDGER_WINDOW - 1].id);
  assert.equal(first.transactions.length, LEDGER_PAGE);
  assert.equal(first.transactions[0].id, game.transactions[LEDGER_WINDOW].id);
  assert.equal(first.hasMore, true);
  const last = ledgerPage(game, first.transactions.at(-1).id);
  assert.equal(last.transactions.length, total - LEDGER_WINDOW - LEDGER_PAGE);
  assert.equal(last.hasMore, false);
  assert.equal(last.transactions.at(-1).label, 'Bank opened');
  assert.equal(ledgerPage(game, game.transactions[0].id, 5).transactions.length, 5);
  assert.equal(ledgerPage(game, game.transactions[0].id, 'lots').transactions.length, LEDGER_PAGE, 'bad limits fall back to a page');
  assert.equal(ledgerPage(game, game.transactions[0].id, 0).transactions.length, LEDGER_PAGE);
  assert.equal(ledgerPage(game, game.transactions[0].id, 10000).transactions.length, total - 1, 'limits are capped');
  assert.throws(() => ledgerPage(game, 'gone'), /no longer available/);
});

// ---------------------------------------------------------- statistics ----

test('activity stats total the game and each player, skipping undone moves', () => {
  const game = makeGame(['Ana', 'Ben', 'Cy'], { rules: { freeParkingJackpot: true } });
  const [ana, ben, cy] = game.players;
  act(game, { type: 'transfer', fromId: 'bank', toId: ana.id, amount: 200, note: 'Passed GO' });
  act(game, { type: 'transfer', fromId: 'bank', toId: ana.id, amount: 400, note: 'Landed on GO' });
  act(game, { type: 'transfer', fromId: 'bank', toId: ben.id, amount: 50, note: 'Bank error in your favor' });
  act(game, { type: 'buy', playerId: ana.id, propertyId: 'boardwalk' });
  act(game, { type: 'rent', payerId: ben.id, propertyId: 'boardwalk' });
  act(game, { type: 'transfer', fromId: cy.id, toId: 'parking', amount: 200, note: 'Income Tax', category: 'tax' });
  act(game, { type: 'transfer', fromId: cy.id, toId: 'parking', amount: 50, note: 'Jail fee', category: 'fee' });
  act(game, { type: 'collect-parking', playerId: ben.id });
  act(game, { type: 'trade', firstPlayerId: ana.id, secondPlayerId: cy.id, firstCash: 10, secondCash: 0, firstPropertyIds: [], secondPropertyIds: [] });
  act(game, { type: 'transfer', fromId: ana.id, toId: ben.id, amount: 999 });
  act(game, { type: 'undo' });
  const stats = activityStats(game);
  assert.equal(stats.moves, 9, 'opening, the undone move and the undo are not moves');
  assert.equal(stats.trades, 1);
  assert.equal(stats.parkingPaidOut, 250);
  assert.equal(stats.moneyMoved, 200 + 400 + 50 + 400 + 50 + 200 + 50 + 250 + 10);
  assert.deepEqual(stats.players[ana.id], { moneyIn: 650, moneyOut: 410, rentCollected: 50, rentPaid: 0, taxesPaid: 0, goPasses: 2, moves: 5 });
  assert.deepEqual(stats.players[ben.id], { moneyIn: 300, moneyOut: 50, rentCollected: 0, rentPaid: 50, taxesPaid: 0, goPasses: 0, moves: 3 });
  assert.deepEqual(stats.players[cy.id], { moneyIn: 10, moneyOut: 250, rentCollected: 0, rentPaid: 0, taxesPaid: 250, goPasses: 0, moves: 3 });
  assert.equal(stats.complete, true);
  assert.deepEqual(publicGame(game).activity, stats);
});

test('stats fall back to payer and payee for entries saved before balance stamps', () => {
  const game = makeGame(['Ana', 'Ben']);
  const [ana, ben] = game.players;
  act(game, { type: 'transfer', fromId: ana.id, toId: ben.id, amount: 70 });
  act(game, { type: 'transfer', fromId: 'bank', toId: ben.id, amount: 5 });
  game.transactions.forEach((entry) => { delete entry.deltas; delete entry.balances; });
  const stats = activityStats(game);
  assert.equal(stats.players[ana.id].moneyOut, 70);
  assert.equal(stats.players[ben.id].moneyIn, 75);
  assert.equal(stats.players[ana.id].moves, 1);
  // A stamp from an older seat list (missing a seat) counts as no change.
  game.transactions[0].deltas = [];
  assert.equal(activityStats(game).players[ben.id].moneyIn, 70);
});

// ----------------------------------------------------------------- CSV ----

test('the CSV export lists every stored move oldest first with balances, safely quoted', () => {
  const game = makeGame(['=Ana', 'Ben "B"', 'Cy']);
  const [ana, ben, cy] = game.players;
  act(game, { type: 'transfer', fromId: ana.id, toId: ben.id, amount: 100, note: '+1 card, "lucky"' });
  act(game, { type: 'transfer', fromId: cy.id, toId: 'bank', amount: 25 });
  act(game, { type: 'transfer', fromId: 'bank', toId: cy.id, amount: 5 });
  act(game, { type: 'undo' });
  act(game, { type: 'bankrupt', playerId: cy.id });
  const lines = ledgerCsv(game).trimEnd().split('\r\n');
  assert.equal(lines[0], `"Time","Type","What happened","Detail","Amount","From","To","Undone","'=Ana balance","Ben ""B"" balance","Cy balance"`);
  assert.equal(lines.length, 1 + game.transactions.length);
  assert.match(lines[1], /"system","Bank opened",/);
  assert.match(lines[1], /,"","",""$/, 'no balances before stamps existed');
  assert.match(lines[2], /"transfer","'=Ana paid Ben ""B""","'\+1 card, ""lucky""","100","'=Ana","Ben ""B""","","1400","1600","1500"$/);
  assert.match(lines[3], /,"25","Cy","Bank","",/);
  assert.match(lines[4], /,"Bank","Cy","yes",/, 'undone moves are marked');
  assert.match(lines.at(-1), /"bankrupt","Cy went bankrupt",.*,"Cy","Bank","",/, 'bankrupt players keep their names');
  assert.ok(ledgerCsv(game).endsWith('\r\n'));
  const parking = makeGame(['Ana', 'Ben'], { rules: { freeParkingJackpot: true } });
  act(parking, { type: 'transfer', fromId: parking.players[0].id, toId: 'parking', amount: 10 });
  act(parking, { type: 'collect-parking', playerId: parking.players[1].id });
  assert.match(ledgerCsv(parking), /"Free Parking","Ben",/);
  const ghost = makeGame(['Ana', 'Ben']);
  act(ghost, { type: 'transfer', fromId: ghost.players[0].id, toId: 'bank', amount: 1 });
  ghost.transactions[0].fromId = 'someone-removed';
  assert.match(ledgerCsv(ghost), /,"1","","Bank",/);
});

// ----------------------------------------------------------------- API ----

async function startServer(t) {
  const store = new GameStore();
  const server = createAppServer({ store });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return { store, base: `http://127.0.0.1:${server.address().port}` };
}

test('API pages through older activity for players and spectators', async (t) => {
  const { store, base } = await startServer(t);
  const game = await store.create({ players: ['Ana', 'Ben'] });
  transfers(game, LEDGER_WINDOW + 30);
  await store.save(game);
  const view = await (await fetch(`${base}/api/games/${game.id}`)).json();
  assert.equal(view.transactions.length, LEDGER_WINDOW);
  const before = view.transactions.at(-1).id;
  const page = await (await fetch(`${base}/api/games/${game.id}/transactions?before=${before}`)).json();
  assert.equal(page.transactions.length, 31);
  assert.equal(page.hasMore, false);
  const watched = await fetch(`${base}/api/watch/${game.viewToken}/transactions?before=${before}&limit=10`);
  const watchedPage = await watched.json();
  assert.equal(watchedPage.transactions.length, 10);
  assert.equal(watchedPage.hasMore, true);
  assert.ok(!JSON.stringify(watchedPage).includes(game.id), 'spectator pages never reveal the game ID');
  const missing = await fetch(`${base}/api/games/${game.id}/transactions?before=nope`);
  assert.equal(missing.status, 404);
  assert.match((await missing.json()).error, /no longer available/);
  assert.equal((await fetch(`${base}/api/watch/${game.viewToken}/transactions`, { method: 'POST' })).status, 404, 'no write route for spectators');
});

test('API downloads the activity as CSV for players and spectators', async (t) => {
  const { store, base } = await startServer(t);
  const game = await store.create({ players: ['Ana', 'Ben'] });
  transfers(game, 2);
  await store.save(game);
  const response = await fetch(`${base}/api/games/${game.id}/activity.csv`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.match(response.headers.get('content-disposition'), /^attachment; filename="monobank-activity-\d{4}-\d{2}-\d{2}\.csv"$/);
  assert.equal(response.headers.get('x-robots-tag'), 'noindex');
  const text = await response.text();
  assert.equal(text.trimEnd().split('\r\n').length, 4);
  const watched = await fetch(`${base}/api/watch/${game.viewToken}/activity.csv`);
  assert.equal(watched.status, 200);
  const watchedText = await watched.text();
  assert.equal(watchedText, text);
  assert.ok(!watchedText.includes(game.id), 'the export never contains the game ID');
});
