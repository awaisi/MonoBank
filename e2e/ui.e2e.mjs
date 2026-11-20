// Browser end-to-end test for the MonoBank client.
// Run with `npm run e2e`. Requires Playwright with Chromium to be available
// (preinstalled in Claude Code cloud sessions; elsewhere `npx playwright install chromium`
// in a scratch directory and set NODE_PATH). It is not part of `npm test` and the
// repository takes no dependency on Playwright.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createAppServer } from '../server.mjs';
import { GameStore } from '../lib/game.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { /* reported below */ }

test('MonoBank UI flows', { skip: chromium ? false : 'Playwright is not installed' }, async (t) => {
  const server = createAppServer({ store: new GameStore() });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); server.close(); });

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('dialog', (dialog) => dialog.accept());
  const toast = (text) => page.waitForSelector(`.toast:has-text("${text}")`);
  const balances = () => page.$$eval('#player-cards .player-card .balance', (cards) => cards.map((card) => card.textContent));

  await t.test('home header offers "Start a game" and hides game actions', async () => {
    await page.goto(base);
    assert.equal(await page.isVisible('#home-actions'), true);
    assert.equal(await page.isVisible('#game-actions'), false);
    await page.click('#start-cta');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'player-0');
  });

  await t.test('creates a game with house rules', async () => {
    await page.goto(base);
    await page.click('#add-player');
    await page.fill('#player-0', 'Ana');
    await page.fill('#player-1', 'Ben');
    await page.fill('#player-2', 'Cy');
    await page.click('.house-rules summary');
    await page.check('#rule-free-parking');
    await page.fill('#rule-free-parking-seed', '100');
    assert.equal(await page.textContent('#setup-rules-summary'), '1 house rule');
    await page.click('#setup-form button[type=submit]');
    await page.waitForSelector('#game-screen:not([hidden])');
    assert.match(await page.textContent('#rules-line'), /Free Parking jackpot \(seeded \$100\)/);
    assert.deepEqual(await balances(), ['$1,500', '$1,500', '$1,500', '$100']);
  });

  await t.test('game header shows the live badge, game code and actions', async () => {
    assert.equal(await page.isVisible('#home-actions'), false);
    assert.equal(await page.isVisible('#game-actions'), true);
    const code = page.url().split('/').pop().slice(0, 4).toUpperCase();
    assert.equal(await page.textContent('#session-code'), code);
    for (const id of ['#share-game', '#show-qr', '#sound-toggle', '#end-game']) assert.equal(await page.isVisible(id), true, id);
  });

  await t.test('player colors render through the CSP-safe path', async () => {
    const color = await page.$eval('.player-card', (card) => getComputedStyle(card).getPropertyValue('--player-color').trim());
    assert.equal(color, '#d9574f');
  });

  await t.test('pays, then undoes the payment', async () => {
    await page.fill('#payment-amount', '300');
    await page.click('#payment-form button[type=submit]');
    await toast('Funds transferred.');
    assert.equal((await balances())[0], '$1,200');
    assert.equal(await page.isVisible('.activity-panel [data-undo]'), true);
    await page.click('.activity-panel [data-undo]');
    await toast('Last action undone.');
    assert.equal((await balances())[0], '$1,500');
    assert.equal(await page.isVisible('.activity-panel .ledger-item.undone'), true);
  });

  await t.test('shows net worth after buying a deed', async () => {
    await page.click('[data-view=deeds]');
    await page.click('[data-property-id=boardwalk]');
    await page.click('#buy-deed-form button[type=submit]');
    await toast('Deed acquired.');
    assert.match(await page.textContent('.player-card .player-meta'), /1 deed · Net worth \$1,500/);
  });

  await t.test('declares a bankruptcy to another player', async () => {
    await page.click('[data-view=pay]');
    await page.click('.bankruptcy summary');
    await page.selectOption('#bankrupt-player', { label: 'Ana' });
    assert.match(await page.textContent('#bankrupt-steps'), /1 deed return to the Bank/);
    await page.selectOption('#bankrupt-creditor', { label: 'Cy' });
    const steps = await page.$$eval('#bankrupt-steps li', (items) => items.map((item) => item.textContent));
    assert.deepEqual(steps, ['$1,100 cash and 1 deed go to Cy.', 'Ana leaves the game.']);
    assert.equal(await page.textContent('#bankrupt-submit-label'), 'Declare Ana bankrupt');
    const stepLayout = await page.$eval('#bankrupt-steps li', (item) => item.children.length);
    assert.equal(stepLayout, 1, 'each step is one text block beside its number');
    await page.click('#bankrupt-form button[type=submit]');
    await toast('Ana is out of the game.');
    assert.equal(await page.isVisible('.player-card.bankrupt'), true);
    assert.deepEqual(await balances(), ['Bankrupt', '$1,500', '$2,600', '$100']);
    const fromOptions = await page.$$eval('#payment-from option', (options) => options.map((option) => option.textContent));
    assert.equal(fromOptions.includes('Ana'), false);
  });

  await t.test('ends the game and shows results, then undoes game over', async () => {
    await page.click('#end-game');
    await page.waitForSelector('#results-dialog[open]');
    assert.match(await page.textContent('#results-title'), /Cy wins/);
    assert.equal(await page.$$eval('.results-table tbody tr', (rows) => rows.length), 3);
    assert.equal(await page.isVisible('#ended-banner'), true);
    await page.click('[data-undo-results]');
    await toast('Back in play.');
    assert.equal(await page.isVisible('#ended-banner'), false);
    assert.equal(await page.isEnabled('#payment-form button[type=submit]'), true);
  });

  await t.test('renders a QR code for the game link', async () => {
    await page.click('#show-qr');
    await page.waitForSelector('#qr-dialog[open] svg');
    assert.equal(await page.textContent('#qr-url'), page.url());
    await page.click('#qr-dialog [data-close-dialog]');
  });

  await t.test('toggles and remembers the sound preference', async () => {
    assert.equal(await page.getAttribute('#sound-toggle', 'aria-pressed'), 'true');
    await page.click('#sound-toggle');
    assert.equal(await page.getAttribute('#sound-toggle', 'aria-pressed'), 'false');
    await page.reload();
    await page.waitForSelector('#game-screen:not([hidden])');
    assert.equal(await page.getAttribute('#sound-toggle', 'aria-pressed'), 'false');
  });

  await t.test('fits a 375 px phone without horizontal scrolling', async () => {
    const phone = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await phone.goto(page.url());
    await phone.waitForSelector('#game-screen:not([hidden])');
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await phone.close();
  });

  await t.test('logs no console or CSP errors', () => {
    assert.deepEqual(errors, []);
  });
});
