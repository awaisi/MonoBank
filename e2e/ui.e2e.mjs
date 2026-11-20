// Browser end-to-end test for the MonoBank client.
// Run with `npm run e2e`. Requires Playwright with Chromium to be available
// (preinstalled in Claude Code cloud sessions; elsewhere `npx playwright install chromium`
// in a scratch directory and set NODE_PATH). It is not part of `npm test` and the
// repository takes no dependency on Playwright.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createAppServer } from '../server.mjs';
import { GameStore } from '../lib/store.mjs';

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

  await t.test('home header shows only the brand', async () => {
    await page.goto(base);
    assert.equal(await page.isVisible('.topbar .brand'), true);
    assert.equal(await page.isVisible('#game-actions'), false);
  });

  await t.test('says what MonoBank is and shows the trademark disclaimer', async () => {
    assert.equal(await page.title(), 'MonoBank: Unofficial Monopoly Banker App – No Paper Money');
    assert.equal(await page.textContent('.brand-tagline'), 'Unofficial Monopoly® banker');
    assert.match(await page.textContent('#setup-screen h1'), /Ditch the paper money/);
    assert.match(await page.textContent('.site-footer .trademark'), /not affiliated with, sponsored or endorsed by Hasbro, Inc\. MONOPOLY® is a registered trademark of Hasbro, Inc\./);
    assert.equal(await page.isVisible('.site-footer'), true);
  });

  await t.test('serves fresh assets: no-cache with ETag revalidation', async () => {
    const response = await page.request.get(`${base}/styles.css`);
    assert.equal(response.headers()['cache-control'], 'no-cache');
    const etag = response.headers().etag;
    assert.ok(etag);
    const revalidated = await page.request.get(`${base}/styles.css`, { headers: { 'If-None-Match': etag } });
    assert.equal(revalidated.status(), 304);
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

  await t.test('asks who this phone is for, offering every player and the banker', async () => {
    await page.waitForSelector('#identity-dialog[open]');
    const options = await page.$$eval('#identity-options [data-identity]', (buttons) => buttons.map((button) => (button.dataset.identity === 'banker' ? 'banker' : button.querySelector('strong').textContent)));
    assert.deepEqual(options, ['Ana', 'Ben', 'Cy', 'banker']);
    await page.click('#identity-options [data-identity="banker"]');
    await toast('This phone is the banker.');
    assert.match(await page.textContent('#me-text'), /Banker view/);
    assert.equal(await page.isVisible('.you-badge'), false);
  });

  await t.test('game pages keep the disclaimer and get their own title', async () => {
    assert.match(await page.title(), /^Game [0-9A-F]{4} · MonoBank$/);
    assert.match(await page.textContent('.site-footer .trademark'), /Hasbro, Inc\./);
  });

  await t.test('game header shows the game code, Invite, and a menu', async () => {
    assert.equal(await page.isVisible('#game-actions'), true);
    const code = page.url().split('/').pop().slice(0, 4).toUpperCase();
    assert.equal(await page.textContent('#session-code'), code);
    assert.equal(await page.isVisible('#show-qr'), true);
    assert.equal(await page.isVisible('#game-menu'), false);
    await page.click('#menu-button');
    assert.equal(await page.getAttribute('#menu-button', 'aria-expanded'), 'true');
    for (const id of ['#share-game', '#sound-toggle', '#end-game']) assert.equal(await page.isVisible(id), true, id);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'share-game', 'focus moves into the menu');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'copy-watch');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'end-game', 'arrow keys wrap around');
    await page.keyboard.press('Escape');
    assert.equal(await page.isVisible('#game-menu'), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'menu-button');
    await page.click('#menu-button');
    await page.click('#game-screen h1');
    assert.equal(await page.isVisible('#game-menu'), false, 'clicking outside closes the menu');
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

  await t.test('"this phone is me" personalises the view and is remembered', async () => {
    await page.click('#menu-button');
    await page.click('#switch-player');
    await page.click('#identity-options .identity-option:has-text("Ana")');
    await toast('This phone is Ana.');
    assert.match(await page.textContent('#me-text'), /Playing as Ana · \$1,100 · net worth \$1,500/);
    assert.equal(await page.textContent('.player-card.is-me strong'), 'Ana');
    assert.equal(await page.textContent('.player-card.is-me .you-badge'), 'You');
    assert.equal(await page.$eval('#payment-from', (select) => select.selectedOptions[0].textContent), 'Ana');
    await page.click('[data-view=deeds]');
    await page.selectOption('#deed-filter', 'mine');
    assert.deepEqual(await page.$$eval('#deed-grid .deed-card strong', (cards) => cards.map((card) => card.textContent)), ['Boardwalk']);
    await page.selectOption('#deed-filter', 'all');
    await page.reload();
    await page.waitForSelector('#game-screen:not([hidden])');
    assert.equal(await page.isVisible('#identity-dialog[open]'), false, 'choice remembered on this device');
    assert.match(await page.textContent('#me-text'), /Playing as Ana/);
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

  await t.test('bankruptcy card is styled, not raw browser controls', async () => {
    const styles = await page.$eval('.bankruptcy', (card) => {
      const css = getComputedStyle(card);
      const button = getComputedStyle(card.querySelector('.danger-button'));
      return { radius: css.borderTopLeftRadius, background: css.backgroundColor, button: button.backgroundColor };
    });
    assert.equal(styles.radius, '14px');
    assert.equal(styles.background, 'rgb(253, 245, 243)');
    assert.equal(styles.button, 'rgb(178, 60, 53)');
  });

  await t.test('shows the bankrupt player on their own device', async () => {
    assert.match(await page.textContent('#me-text'), /Playing as Ana · bankrupt/);
  });

  const watchErrors = (other) => {
    other.on('pageerror', (error) => errors.push(error.message));
    other.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    other.on('dialog', (dialog) => dialog.accept());
  };
  const payBenToBank = async (amount) => {
    await page.click('[data-view=pay]');
    await page.selectOption('#payment-from', { label: 'Ben' });
    await page.selectOption('#payment-to', { label: 'The Bank' });
    await page.fill('#payment-amount', String(amount));
    await page.click('#payment-form button[type=submit]');
    await toast('Funds transferred.');
  };
  const balanceShown = (other, value) => other.waitForFunction((expected) => [...document.querySelectorAll('#player-cards .balance')].some((element) => element.textContent === expected), value, { timeout: 2500 });

  await t.test('updates other devices instantly over the live stream', async () => {
    const other = await browser.newPage();
    watchErrors(other);
    await other.goto(page.url());
    await other.waitForSelector('#identity-dialog[open]');
    await other.click('#identity-options [data-identity="banker"]');
    await other.waitForFunction(() => !document.querySelector('#session-badge').classList.contains('polling'));
    await payBenToBank(25);
    const started = Date.now();
    await balanceShown(other, '$1,475');
    assert.ok(Date.now() - started < 2500, 'arrived faster than polling would');
    await other.close();
  });

  await t.test('spectator link is view-only, hides the edit link, and updates live', async () => {
    const gameId = page.url().split('/').pop();
    await page.click('#show-qr');
    await page.click('.qr-modes label:has-text("Spectators")');
    const watchUrl = await page.textContent('#qr-url');
    assert.match(watchUrl, /\/watch\/[a-f0-9]{16}$/);
    assert.equal(watchUrl.includes(gameId), false);
    assert.match(await page.textContent('#qr-help'), /can’t change anything/);
    await page.waitForSelector('#qr-dialog svg');
    await page.click('#qr-dialog [data-close-dialog]');

    const viewer = await browser.newPage();
    watchErrors(viewer);
    await viewer.goto(watchUrl);
    await viewer.waitForSelector('#game-screen:not([hidden])');
    assert.equal(await viewer.isVisible('#identity-dialog[open]'), false, 'spectators are not asked who they are');
    assert.equal(await viewer.isVisible('#spectator-note'), true);
    assert.equal(await viewer.textContent('#session-code'), 'VIEW');
    assert.match(await viewer.title(), /Watching a game · MonoBank/);
    for (const selector of ['#pay-view', '#trade-view', '.view-tabs [data-view="pay"]', '.view-tabs [data-view="trade"]', '.activity-panel [data-undo]', '#end-game', '#switch-player', '#copy-watch', '#me-bar']) {
      assert.equal(await viewer.$eval(selector, (element) => getComputedStyle(element).display === 'none' || element.hidden), true, selector);
    }
    assert.equal(await viewer.evaluate((id) => document.documentElement.outerHTML.includes(id), gameId), false, 'edit ID never reaches the spectator page');
    await viewer.waitForFunction(() => !document.querySelector('#session-badge').classList.contains('polling'));
    await payBenToBank(25);
    await balanceShown(viewer, '$1,450');
    await viewer.click('.view-tabs [data-view="deeds"]');
    await viewer.click('[data-property-id=boardwalk]');
    assert.match(await viewer.textContent('#deed-dialog'), /View only/);
    assert.equal(await viewer.$('#rent-form'), null);
    await viewer.close();
  });

  await t.test('ends the game and shows results, then undoes game over', async () => {
    await page.click('#menu-button');
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
    assert.equal(await page.textContent('#qr-url'), page.url(), 'Invite reopens on the player link');
    assert.equal(await page.isChecked('input[name="qr-mode"][value="play"]'), true);
    await page.click('#qr-dialog [data-close-dialog]');
  });

  await t.test('toggles and remembers the sound preference', async () => {
    assert.equal(await page.getAttribute('#sound-toggle', 'aria-checked'), 'true');
    await page.click('#menu-button');
    await page.click('#sound-toggle');
    assert.equal(await page.getAttribute('#sound-toggle', 'aria-checked'), 'false');
    assert.match(await page.textContent('#sound-toggle'), /Off$/);
    await page.reload();
    await page.waitForSelector('#game-screen:not([hidden])');
    assert.equal(await page.getAttribute('#sound-toggle', 'aria-checked'), 'false');
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
