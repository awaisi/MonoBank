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
import { performAction } from '../lib/game.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { /* reported below */ }

test('MonoBank UI flows', { skip: chromium ? false : 'Playwright is not installed' }, async (t) => {
  const store = new GameStore();
  const server = createAppServer({ store });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); server.close(); });

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // A refused payment is a deliberate HTTP 400, which browsers log as a failed resource; anything else fails the run.
  const expectedRejection = (text) => /Failed to load resource: the server responded with a status of 400/.test(text);
  page.on('console', (message) => { if (message.type() === 'error' && !expectedRejection(message.text())) errors.push(message.text()); });
  page.on('dialog', (dialog) => dialog.accept());
  const toast = (text) => page.waitForSelector(`.toast:has-text("${text}")`);
  // Balances as shown in the players bar (outside the Deeds tab, where it filters deeds instead).
  const balances = () => page.$$eval('#players-bar .player-tile:not(.plain) .tile-balance', (tiles) => tiles.map((tile) => tile.textContent));

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
    assert.equal(await page.$('#players-bar .player-tile.is-me'), null);
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
    const color = await page.$eval('#players-bar .player-tile', (chip) => getComputedStyle(chip).getPropertyValue('--player-color').trim());
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
    await page.click('[data-view=pay]');
    await page.click('#players-bar [data-player]:has-text("Ana")');
    await page.waitForSelector('#player-dialog[open]');
    assert.equal(await page.textContent('#player-title'), 'Ana');
    assert.match(await page.textContent('#player-dialog .dialog-facts'), /Cash\$1,100Net worth\$1,500Can raise\$200/);
    assert.match(await page.textContent('#player-dialog .sheet-deeds'), /Boardwalk/);
    await page.click('#player-dialog [data-close-dialog]');
  });

  await t.test('player sheet shortcuts: show deeds, pay from, Free Parking', async () => {
    await page.click('#players-bar [data-player]:has-text("Ana")');
    await page.click('#player-dialog [data-sheet="deeds"]');
    assert.equal(await page.isVisible('#deeds-view'), true);
    assert.equal(await page.getAttribute('#players-bar [data-owner].active', 'aria-pressed'), 'true');
    assert.deepEqual(await page.$$eval('#deed-grid .deed-card strong', (cards) => cards.map((card) => card.textContent)), ['Boardwalk']);
    await page.click('#players-bar [data-owner="all"]');
    await page.click('[data-view=pay]');
    await page.click('#players-bar [data-player]:has-text("Cy")');
    await page.click('#player-dialog [data-sheet="pay"]');
    assert.equal(await page.$eval('#payment-from', (select) => select.selectedOptions[0].textContent), 'Cy');
    await page.click('#players-bar [data-parking]');
    await page.waitForSelector('#player-dialog[open] #parking-form');
    assert.match(await page.textContent('#player-dialog .sheet-total'), /\$100/);
    await page.selectOption('#parking-winner', { label: 'Ben' });
    await page.click('#parking-form button[type=submit]');
    await toast('Ben collected Free Parking.');
    await page.waitForFunction(() => document.querySelector('#players-bar [data-player]:nth-child(2) b')?.textContent === '$1,600');
    assert.deepEqual(await balances(), ['$1,100', '$1,600', '$1,500', '$100'], 'the seeded pot refills after a collect');
    await page.click('.activity-panel [data-undo]');
    await page.waitForFunction(() => document.querySelector('#players-bar [data-player]:nth-child(2) b')?.textContent === '$1,500');
    await page.selectOption('#payment-from', { label: 'Ana' });
  });

  await t.test('player sheet quick actions pay and charge the Bank in one tap', async () => {
    const chip = (name) => `#players-bar [data-player]:has-text("${name}") b`;
    const cyIs = (value) => page.waitForFunction((want) => [...document.querySelectorAll('#players-bar [data-player]')].find((item) => item.textContent.includes('Cy'))?.querySelector('b').textContent === want, value);
    await page.click('#players-bar [data-player]:has-text("Cy")');
    await page.waitForSelector('#player-dialog[open] .quick-row');
    assert.deepEqual(await page.$$eval('#player-dialog [data-quick]', (buttons) => buttons.map((button) => button.textContent)),
      ['Passed GO +$200', 'Income Tax −$200', 'Luxury Tax −$100', 'Jail fee −$50'], 'no "Landed on GO" without that house rule');
    await page.click('#player-dialog [data-quick="go"]');
    await toast('Cy +$200 · Passed GO');
    await cyIs('$1,700');
    assert.equal(await page.textContent('#player-dialog .dialog-facts strong'), '$1,700', 'the sheet stays open and refreshes');
    await page.click('#player-dialog [data-quick="tax"]');
    await toast('Cy −$200 · Income Tax');
    await page.waitForFunction(() => /\$300$/.test(document.querySelector('#players-bar [data-parking] b').textContent));
    assert.equal(await page.textContent(chip('Cy')), '$1,500', 'taxes go to the Free Parking pot');
    await page.fill('#quick-amount', '75');
    await page.click('#quick-custom [data-direction="out"]');
    await toast('Cy −$75 · Paid the Bank');
    await cyIs('$1,425');
    assert.equal(await page.inputValue('#quick-amount'), '');
    await page.fill('#quick-amount', '75');
    await page.click('#quick-custom [data-direction="in"]');
    await cyIs('$1,500');
    await page.click('#quick-custom [data-direction="in"]');
    await toast('Enter an amount of at least $1.');
    await page.click('#player-dialog [data-close-dialog]');
    for (let i = 0; i < 4; i += 1) {
      const label = await page.textContent('.activity-panel .ledger-item:first-child strong');
      await page.click('.activity-panel [data-undo]');
      await page.waitForFunction((old) => document.querySelector('.activity-panel .ledger-item:first-child strong')?.textContent !== old, label);
    }
    await page.waitForFunction(() => /\$100$/.test(document.querySelector('#players-bar [data-parking] b').textContent));
    assert.deepEqual(await balances(), ['$1,100', '$1,500', '$1,500', '$100']);
  });

  await t.test('"this phone is me" personalises the view and is remembered', async () => {
    await page.click('#menu-button');
    await page.click('#switch-player');
    await page.click('#identity-options .identity-option:has-text("Ana")');
    await toast('This phone is Ana.');
    assert.match(await page.textContent('#me-text'), /Playing as Ana/);
    assert.equal(await page.textContent('#players-bar .player-tile.is-me .tile-name'), 'Ana');
    assert.equal(await page.textContent('#players-bar .player-tile.is-me .you-badge'), 'You');
    assert.match(await page.textContent('#players-bar .player-tile.is-me'), /Net worth \$1,500.*1 deed$/, 'tiles show net worth and deeds');
    assert.equal(await page.$eval('#payment-from', (select) => select.selectedOptions[0].textContent), 'Ana');
    await page.click('[data-view=deeds]');
    await page.click('#players-bar .player-tile.is-me');
    assert.deepEqual(await page.$$eval('#deed-grid .deed-card strong', (cards) => cards.map((card) => card.textContent)), ['Boardwalk']);
    await page.click('#players-bar [data-owner="all"]');
    await page.reload();
    await page.waitForSelector('#game-screen:not([hidden])');
    assert.equal(await page.isVisible('#identity-dialog[open]'), false, 'choice remembered on this device');
    assert.match(await page.textContent('#me-text'), /Playing as Ana/);
  });

  await t.test("lists this phone's player first everywhere", async () => {
    await page.click('#menu-button');
    await page.click('#switch-player');
    await page.click('#identity-options .identity-option:has-text("Cy")');
    await toast('This phone is Cy.');
    const firstCard = await page.$eval('#players-bar .player-tile .tile-name', (name) => name.textContent);
    const strip = await page.$$eval('#players-bar .player-tile .tile-name', (tiles) => tiles.map((tile) => tile.textContent));
    const fromOptions = await page.$$eval('#payment-from option', (options) => options.map((option) => option.textContent));
    assert.equal(firstCard, 'Cy');
    assert.deepEqual(strip.slice(0, 3), ['Cy', 'Ana', 'Ben']);
    assert.deepEqual(fromOptions.slice(0, 3), ['The Bank', 'Cy', 'Ana']);
    await page.click('#me-switch');
    await page.click('#identity-options .identity-option:has-text("Ana")');
    await toast('This phone is Ana.');
  });

  await t.test('shows player balances at the top of every tab', async () => {
    for (const view of ['pay', 'deeds', 'trade', 'ledger']) {
      await page.click(`.view-tabs [data-view="${view}"]`);
      assert.equal(await page.isVisible('#players-bar'), true, view);
      assert.match(await page.textContent('#players-bar'), /AnaYou\$1,100.*Ben\$1,500.*Cy\$1,500/, view);
    }
    const phone = await browser.newPage({ viewport: { width: 375, height: 740 } });
    await phone.goto(page.url());
    await phone.click('#identity-options [data-identity="banker"]');
    await phone.click('#mobile-nav [data-mobile-view="deeds"]');
    const tileTop = await phone.$eval('#players-bar', (row) => row.getBoundingClientRect().top);
    const headerBottom = await phone.$eval('.topbar', (bar) => bar.getBoundingClientRect().bottom);
    assert.ok(tileTop >= headerBottom, `player tiles start below the header (${tileTop} vs ${headerBottom})`);
    assert.equal(await phone.$eval('#players-bar', (row) => getComputedStyle(row).position), 'static', 'tiles scroll with the page; nothing pinned shows content through it');
    // The row is re-rendered on every update; it must keep its sideways scroll position.
    await phone.$eval('#players-bar', (row) => { row.scrollLeft = 120; });
    await phone.click('#players-bar [data-owner]:has-text("Ben")');
    assert.ok(await phone.$eval('#players-bar', (row) => row.scrollLeft) >= 100, 'tapping a tile does not snap the row back to the start');
    await phone.click('#players-bar [data-owner="all"]');
    await phone.close();
    await page.click('.view-tabs [data-view="pay"]');
  });

  await t.test('rent is paid by the tenant, worded as Pay', async () => {
    await page.click('.view-tabs [data-view="deeds"]');
    await page.click('[data-property-id=boardwalk]');
    assert.equal(await page.textContent('#rent-form .field span'), 'Who pays rent?');
    assert.equal(await page.textContent('#rent-form button[type=submit]'), 'PAY RENT TO ANA');
    const payers = await page.$$eval('#rent-payer option', (options) => options.map((option) => option.textContent));
    assert.deepEqual(payers, ['Ben', 'Cy'], 'the owner never pays themselves');
    await page.selectOption('#rent-payer', { label: 'Ben' });
    await page.click('#rent-form button[type=submit]');
    await toast('Rent paid to Ana.');
    assert.match(await page.textContent('#players-bar'), /AnaYou\$1,150.*Ben\$1,450/);
    await page.click('.activity-panel [data-undo]');
    await toast('Last action undone.');
  });

  await t.test('filters activity by player', async () => {
    await page.click('.view-tabs [data-view="ledger"]');
    const options = await page.$$eval('#ledger-filter option', (items) => items.map((item) => item.textContent));
    assert.deepEqual(options, ['Everyone', 'Ana (you)', 'Ben', 'Cy', 'The Bank']);
    const everyone = await page.$$eval('#full-ledger .ledger-item', (items) => items.length);
    await page.selectOption('#ledger-filter', { label: 'Cy' });
    // Cy's quick actions were all undone earlier; undone entries are hidden until asked for.
    assert.match(await page.textContent('#ledger-undone'), /^Show \d+ undone$/);
    await page.click('#ledger-undone');
    assert.equal(await page.getAttribute('#ledger-undone', 'aria-pressed'), 'true');
    const cyLabels = await page.$$eval('#full-ledger .ledger-item strong', (items) => items.map((item) => item.textContent));
    assert.ok(cyLabels.length > 0 && cyLabels.every((label) => label.includes('Cy')), cyLabels.join(' | '));
    assert.match(await page.textContent('#full-ledger'), /Passed GO/, 'quick actions show up as ordinary transfers');
    await page.click('#ledger-undone');
    assert.equal(await page.getAttribute('#ledger-undone', 'aria-pressed'), 'false', 'undone entries hide again');
    await page.selectOption('#ledger-filter', { label: 'Ana (you)' });
    const anaLabels = await page.$$eval('#full-ledger .ledger-item strong', (items) => items.map((item) => item.textContent));
    assert.ok(anaLabels.length > 0 && anaLabels.length < everyone);
    assert.ok(anaLabels.every((label) => label.includes('Ana')), anaLabels.join(' | '));
    await page.selectOption('#ledger-filter', 'all');
  });

  await t.test('filters deeds by owner with player pills', async () => {
    await page.click('.view-tabs [data-view="deeds"]');
    assert.equal(await page.getAttribute('#players-bar', 'aria-label'), 'Filter deeds by owner', 'the player tiles turn into the owner filter');
    const pills = await page.$$eval('#players-bar .player-tile', (items) => items.map((item) => `${item.querySelector('.tile-name').textContent} ${item.querySelector('.tile-balance').textContent}`));
    assert.deepEqual(pills, ['All deeds 28', 'Ana $1,100', 'Ben $1,500', 'Cy $1,500', 'Bank 27']);
    assert.equal(await page.getAttribute('#players-bar [data-owner="all"]', 'aria-pressed'), 'true');
    await page.click('#players-bar .player-tile.is-me');
    assert.deepEqual(await page.$$eval('#deed-grid .deed-card strong', (cards) => cards.map((card) => card.textContent)), ['Boardwalk']);
    assert.equal(await page.getAttribute('#players-bar .player-tile.is-me', 'aria-pressed'), 'true');
    await page.click('#players-bar [data-owner="bank"]');
    assert.equal(await page.$$eval('#deed-grid .deed-card', (cards) => cards.length), 27);
    await page.fill('#deed-search', 'avenue');
    const avenues = await page.$$eval('#deed-grid .deed-card strong', (cards) => cards.map((card) => card.textContent));
    assert.ok(avenues.length > 0 && avenues.every((name) => /Avenue/.test(name)), 'pills combine with search');
    await page.fill('#deed-search', '');
    await page.click('#players-bar [data-owner]:has-text("Ben")');
    assert.match(await page.textContent('#deed-grid'), /No deeds match this filter/);
    await page.click('#players-bar [data-owner="all"]');
    assert.equal(await page.$$eval('#deed-grid .deed-card', (cards) => cards.length), 28);
    await page.click('.view-tabs [data-view="pay"]');
  });

  await t.test('refuses to overdraw and helps raise cash first', async () => {
    await page.click('.view-tabs [data-view="pay"]');
    await page.selectOption('#payment-from', { label: 'Ana' });
    await page.selectOption('#payment-to', { label: 'The Bank' });
    await page.fill('#payment-amount', '1200');
    await page.click('#payment-form button[type=submit]');
    await page.waitForSelector('#raise-dialog[open]');
    assert.match(await page.textContent('.raise-status'), /Ana has \$1,100 and needs \$1,200: raise \$100 more/);
    assert.match(await page.textContent('.raise-list'), /Boardwalk.*Mortgage \+\$200/);
    assert.equal(await page.isVisible('[data-raise-bankrupt]'), true);
    assert.match(await page.textContent('#players-bar'), /AnaYou\$1,100/, 'no money moved');
    await page.click('[data-raise="mortgage"][data-property="boardwalk"]');
    await page.waitForSelector('.raise-status.ok');
    assert.match(await page.textContent('.raise-status'), /Ana now has \$1,300, enough for the \$1,200 payment/);
    await page.click('#raise-dialog .secondary-button[data-close-dialog]');
    await page.click('.activity-panel [data-undo]');
    await page.waitForFunction(() => /AnaYou\$1,100/.test(document.querySelector('#players-bar').textContent));
    await page.fill('#payment-amount', '');
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
    assert.equal(await page.isVisible('#players-bar .player-tile.bankrupt'), true);
    assert.deepEqual(await balances(), ['—', '$1,500', '$2,600', '$100']);
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
  const balanceShown = (other, value) => other.waitForFunction((expected) => [...document.querySelectorAll('#players-bar .tile-balance')].some((element) => element.textContent === expected), value, { timeout: 2500 });

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

  await t.test('finishes the game early with a winner the table picks', async () => {
    await page.click('#menu-button');
    assert.equal(await page.textContent('#end-game'), '★Finish game…');
    await page.click('#end-game');
    await page.waitForSelector('#end-dialog[open] #end-form');
    const choices = await page.$$eval('#end-form .winner-option strong', (items) => items.map((item) => item.textContent));
    assert.equal(choices[0], 'Highest net worth');
    assert.ok(!choices.includes('Ana'), 'bankrupt players cannot be picked');
    assert.match(await page.textContent('#end-submit-label'), /End game · Cy wins/);
    await page.click('#end-form .winner-option:has-text("Ben")');
    assert.equal(await page.textContent('#end-submit-label'), 'End game · Ben wins');
    await page.click('#end-form button[type=submit]');
    await page.waitForSelector('#results-dialog[open]');
    assert.equal(await page.isVisible('#end-dialog'), false);
    assert.match(await page.textContent('#results-title'), /Ben wins/);
    assert.match(await page.textContent('#results-content .muted'), /^Played (under a minute|\d+ minutes?) \(.+–.+\) · \d+ moves?/, 'play time runs from the first to the last move');
    assert.match(await page.textContent('#ended-text'), /Game over: Ben wins/);
    await page.click('[data-undo-results]');
    await page.waitForSelector('#ended-banner', { state: 'hidden' });
  });

  await t.test('ends the game and shows results, then undoes game over', async () => {
    await page.click('#menu-button');
    await page.click('#end-game');
    await page.waitForSelector('#end-dialog[open] #end-form');
    await page.click('#end-form button[type=submit]');
    await page.waitForSelector('#results-dialog[open]');
    assert.match(await page.textContent('#results-title'), /Cy wins/);
    assert.equal(await page.$$eval('.results-table tbody tr', (rows) => rows.length), 3);
    assert.equal(await page.isVisible('#ended-banner'), true);
    await page.click('[data-undo-results]');
    await page.waitForSelector('#ended-banner', { state: 'hidden' });
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

  await t.test('supports a full table of 8 players', async () => {
    const big = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    big.on('pageerror', (error) => errors.push(error.message));
    big.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await big.goto(base);
    assert.equal(await big.textContent('#player-count'), '2 of 8 players');
    for (let i = 0; i < 6; i++) await big.click('#add-player');
    assert.equal(await big.textContent('#player-count'), '8 of 8 players');
    assert.equal(await big.isVisible('#add-player'), false, 'cannot add a ninth player');
    await big.click('.player-field:last-child .remove-player');
    assert.equal(await big.isVisible('#add-player'), true);
    await big.click('#add-player');
    const names = ['Ana', 'Ben', 'Cy', 'Di', 'Eve', 'Fay', 'Gus', 'Hal'];
    for (const [index, name] of names.entries()) await big.fill(`#player-${index}`, name);
    const setupColors = await big.$$eval('.player-field .token', (tokens) => tokens.map((token) => getComputedStyle(token).backgroundColor));
    assert.equal(new Set(setupColors).size, 8, 'each seat has its own color');
    await big.click('#setup-form button[type=submit]');
    await big.waitForSelector('#identity-dialog[open]');
    assert.equal(await big.$$eval('#identity-options [data-identity]', (options) => options.length), 9);
    assert.equal(await big.$eval('#identity-options', (list) => list.classList.contains('many')), true, 'two-column picker');
    await big.click('#identity-options [data-identity="banker"]');
    assert.equal(await big.$$eval('#players-bar [data-player]', (chips) => chips.length), 8);
    const cardColors = await big.$$eval('#players-bar [data-player]', (chips) => chips.map((chip) => getComputedStyle(chip).getPropertyValue('--player-color').trim()));
    assert.equal(new Set(cardColors).size, 8);
    assert.equal(await big.$$eval('#payment-from option', (options) => options.length), 9, 'bank + 8 players');
    for (const width of [375, 320]) {
      const phone = await browser.newPage({ viewport: { width, height: 740 } });
      await phone.goto(big.url());
      await phone.waitForSelector('#identity-dialog[open]');
      const dialogFits = await phone.$eval('#identity-dialog', (dialog) => dialog.getBoundingClientRect().right <= innerWidth);
      assert.equal(dialogFits, true, `identity picker fits at ${width}px`);
      await phone.click('#identity-options [data-identity="banker"]');
      assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no horizontal scroll at ${width}px`);
      await phone.close();
    }
    await big.close();
  });

  await t.test('activity page handles a long game: timeline, filters, player view, paging, export', async () => {
    const long = await store.create({ players: ['Ana', 'Ben', 'Cy'], rules: { freeParkingJackpot: true } });
    const [ana, ben, cy] = long.players;
    const act = (action) => performAction(long, action);
    act({ type: 'buy', playerId: ana.id, propertyId: 'boardwalk' });
    act({ type: 'buy', playerId: ben.id, propertyId: 'park-place' });
    for (let i = 0; i < 180; i += 1) {
      const kind = i % 4;
      if (kind === 0) act({ type: 'transfer', fromId: 'bank', toId: [ana, ben, cy][i % 3].id, amount: 200, note: 'Passed GO' });
      if (kind === 1) act({ type: 'rent', payerId: cy.id, propertyId: i % 8 === 1 ? 'boardwalk' : 'park-place' });
      if (kind === 2) act({ type: 'transfer', fromId: [ana, ben, cy][i % 3].id, toId: 'parking', amount: 10, note: 'Luxury Tax', category: 'tax' });
      if (kind === 3) act({ type: 'transfer', fromId: 'bank', toId: cy.id, amount: 60, note: 'Card' });
    }
    act({ type: 'transfer', fromId: ana.id, toId: ben.id, amount: 1, note: 'Oops' });
    act({ type: 'undo' });
    await store.save(long);
    const total = long.transactions.length;
    const viewer = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const viewerErrors = [];
    viewer.on('console', (message) => { if (message.type() === 'error') viewerErrors.push(message.text()); });
    await viewer.goto(`${base}/game/${long.id}`);
    await viewer.click('#identity-options [data-identity="banker"]');
    await viewer.click('.view-tabs [data-view="ledger"]');
    // Desktop: the sidebar shows the summary instead of repeating the list.
    assert.equal(await viewer.isVisible('#side-summary'), true);
    assert.equal(await viewer.isVisible('#mini-ledger'), false);
    assert.equal(await viewer.isVisible('#ledger-summary'), false);
    assert.match(await viewer.textContent('#side-summary'), /Game so far.*Moves182.*Top rent earner/);
    await viewer.click('.view-tabs [data-view="pay"]');
    assert.equal(await viewer.isVisible('#mini-ledger'), true);
    await viewer.click('.view-tabs [data-view="ledger"]');
    // Timeline: 15-minute blocks, 50 rows at a time, undone entries hidden.
    assert.ok(await viewer.$$eval('.ledger-group-head', (heads) => heads.length) >= 1);
    assert.match(await viewer.textContent('.ledger-group-head small'), /^\d+ moves?$/);
    assert.equal(await viewer.$$eval('#full-ledger .ledger-item', (rows) => rows.length), 50);
    assert.equal(await viewer.$$eval('#full-ledger .ledger-item.undone, #full-ledger .is-undo', (rows) => rows.length), 0);
    assert.equal(await viewer.textContent('#ledger-undone'), 'Show 2 undone');
    assert.match(await viewer.textContent('#ledger-note'), /^Showing 50 of \d+\+ entries\.$/);
    while (await viewer.isVisible('#ledger-more')) await viewer.click('#ledger-more');
    assert.equal(await viewer.$$eval('#full-ledger .ledger-item', (rows) => rows.length), total - 2, 'paging reaches the start, beyond what the server sends up front');
    assert.match(await viewer.textContent('#full-ledger .ledger-item:last-child'), /Bank opened/);
    // Type chips and search combine.
    // Wide screens: the search box is always in the toolbar; the type filter is a picker.
    assert.equal(await viewer.isVisible('#ledger-search'), true);
    assert.equal(await viewer.isVisible('#ledger-search-toggle'), false);
    await viewer.selectOption('#ledger-type', 'rent');
    const rentRows = await viewer.$$eval('#full-ledger .ledger-item small', (rows) => rows.map((row) => row.textContent));
    assert.ok(rentRows.length === 45 && rentRows.every((row) => row.startsWith('Rent')), rentRows.length);
    await viewer.fill('#ledger-search', 'boardwalk');
    const boardwalkRows = await viewer.$$eval('#full-ledger .ledger-item small', (rows) => rows.map((row) => row.textContent));
    assert.ok(boardwalkRows.length > 0 && boardwalkRows.length < 45 && boardwalkRows.every((row) => row === 'Rent · Boardwalk'), boardwalkRows.join('|'));
    await viewer.fill('#ledger-search', 'no such deed');
    assert.equal(await viewer.textContent('#full-ledger .empty-state'), 'No moves match.');
    await viewer.fill('#ledger-search', '');
    await viewer.selectOption('#ledger-type', 'all');
    // Player view: signed amounts, balance after each move, and that player's totals.
    await viewer.selectOption('#ledger-filter', { label: 'Cy' });
    assert.match(await viewer.textContent('#side-summary'), /Cy’s game.*Money in\+\$[\d,]+.*Money out−\$[\d,]+.*Rent paid\$[\d,]+.*Passed GO15×/);
    const amounts = await viewer.$$eval('#full-ledger .ledger-amount b', (cells) => cells.map((cell) => `${cell.className}:${cell.textContent}`));
    assert.ok(amounts.slice(0, 10).every((cell) => /^(in:\+|out:−)\$/.test(cell)), amounts.slice(0, 10).join(' '));
    const cy0 = long.transactions.find((entry) => !entry.undone && entry.type !== 'undo' && entry.deltas?.[2]);
    assert.match(await viewer.textContent('#full-ledger .ledger-item small'), new RegExp(`balance \\$${cy0.balances[2].toLocaleString('en-US').replace(',', ',')}$`));
    await viewer.selectOption('#ledger-filter', { label: 'The Bank' });
    assert.match(await viewer.textContent('#full-ledger .ledger-amount b'), /^[+−]\$/);
    await viewer.selectOption('#ledger-filter', 'all');
    // Export: the menu and the CSV it links to.
    assert.equal(await viewer.getAttribute('#export-activity', 'href'), `/api/games/${long.id}/activity.csv`);
    const csv = await viewer.evaluate(async (href) => (await fetch(href)).text(), await viewer.getAttribute('#export-activity', 'href'));
    assert.equal(csv.trimEnd().split('\r\n').length, total + 1);
    assert.match(csv, /^"Time","Type","What happened"/);
    // Phone: the summary sits above the list (no sidebar) and nothing scrolls sideways.
    await viewer.setViewportSize({ width: 375, height: 740 });
    assert.equal(await viewer.isVisible('#ledger-summary'), true);
    // Phones: no title row, one toolbar row, search on demand, and the summary collapsed to one line.
    assert.equal(await viewer.isVisible('#ledger-view .view-heading'), false);
    assert.equal(await viewer.isVisible('.ledger-toolbar [data-undo]'), true, 'Undo moves into the toolbar');
    assert.equal(await viewer.isVisible('#ledger-search'), false);
    assert.match(await viewer.textContent('#ledger-summary summary'), /^Game so far182 moves · \$[\d,]+ moved$/);
    assert.equal(await viewer.isVisible('#ledger-summary .summary-facts'), false);
    const listTop = await viewer.$eval('#full-ledger', (list) => list.getBoundingClientRect().top - document.querySelector('#ledger-view').getBoundingClientRect().top);
    assert.ok(listTop < 160, `the list starts close to the top of the Activity tab (${listTop}px)`);
    await viewer.click('#ledger-summary summary');
    assert.equal(await viewer.isVisible('#ledger-summary .summary-facts'), true);
    await viewer.click('#ledger-search-toggle');
    assert.equal(await viewer.getAttribute('#ledger-search-toggle', 'aria-expanded'), 'true');
    assert.equal(await viewer.evaluate(() => document.activeElement.id), 'ledger-search');
    await viewer.fill('#ledger-search', 'boardwalk');
    assert.ok((await viewer.$$eval('#full-ledger .ledger-item', (rows) => rows.map((row) => row.textContent))).every((row) => row.includes('Boardwalk')));
    assert.equal(await viewer.isVisible('#ledger-summary .summary-facts'), true, 'the summary stays open while the list re-renders');
    await viewer.click('#ledger-search-toggle');
    assert.equal(await viewer.inputValue('#ledger-search'), '', 'closing search clears it');
    assert.equal(await viewer.isVisible('#ledger-search'), false);
    assert.equal(await viewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(viewerErrors, []);
    await viewer.close();
  });

  await t.test('deeds Sets view shows every color group, who holds it, buildings and mortgages', async () => {
    const sets = await store.create({ players: ['Ana', 'Ben', 'Cy'] });
    const [ana, ben, cy] = sets.players;
    const act = (action) => performAction(sets, action);
    for (const [player, propertyId] of [[ana, 'park-place'], [ana, 'boardwalk'], [ben, 'mediterranean'], [cy, 'kentucky'], [cy, 'illinois'], [ana, 'reading-railroad'], [ben, 'pennsylvania-railroad'], [ben, 'bo-railroad'], [ben, 'atlantic'], [cy, 'ventnor'], [cy, 'electric-company'], [cy, 'water-works']]) {
      act({ type: 'buy', playerId: player.id, propertyId });
    }
    act({ type: 'building', playerId: ana.id, propertyId: 'park-place', direction: 'buy' });
    act({ type: 'building', playerId: ana.id, propertyId: 'boardwalk', direction: 'buy' });
    act({ type: 'mortgage', playerId: cy.id, propertyId: 'kentucky' });
    await store.save(sets);
    const phone = await browser.newPage({ viewport: { width: 375, height: 760 } });
    const phoneErrors = [];
    phone.on('console', (message) => { if (message.type() === 'error') phoneErrors.push(message.text()); });
    await phone.goto(`${base}/game/${sets.id}`);
    await phone.click('#identity-options [data-identity="banker"]');
    await phone.click('#mobile-nav [data-mobile-view="deeds"]');
    assert.equal(await phone.getAttribute('[data-deed-mode="list"]', 'aria-pressed'), 'true', 'List is the default');
    await phone.click('[data-deed-mode="sets"]');
    assert.equal(await phone.getAttribute('[data-deed-mode="sets"]', 'aria-pressed'), 'true');
    assert.equal(await phone.isVisible('#deed-search'), false, 'search and status filters belong to the list');
    assert.equal(await phone.isVisible('#deed-grid'), false);
    assert.equal(await phone.$$eval('#deed-sets .set-row', (rows) => rows.length), 10);
    const status = (group) => phone.textContent(`.set-row[data-group="${group}"] .set-label small`);
    assert.equal(await status('darkblue'), '✓ Ana’s set');
    assert.equal(await status('brown'), 'Ben needs 1');
    assert.equal(await status('red'), 'Cy needs 1', 'a mortgaged deed still counts toward the set');
    assert.equal(await status('yellow'), 'Split');
    assert.equal(await status('green'), 'Unowned');
    assert.equal(await status('railroad'), 'Ben 2 · Ana 1');
    assert.equal(await status('utility'), '✓ Cy has both');
    assert.equal(await phone.$eval('.set-row[data-group="darkblue"]', (row) => row.classList.contains('complete')), true);
    assert.equal(await phone.$$eval('.set-row[data-group="darkblue"] .set-pips i', (pips) => pips.length), 2, 'one house on each dark blue');
    assert.deepEqual(await phone.$$eval('.set-row[data-group="darkblue"] .set-name', (names) => names.map((name) => name.textContent)), ['Park', 'Boardwalk']);
    const kentucky = '.set-tile[data-property-id="kentucky"]';
    assert.equal(await phone.$eval(kentucky, (tile) => tile.classList.contains('mortgaged')), true);
    assert.equal(await phone.textContent(`${kentucky} .set-tag`), 'Mortgaged');
    assert.equal(await phone.getAttribute(kentucky, 'aria-label'), 'Kentucky Avenue: Cy, mortgaged');
    assert.equal(await phone.textContent('.set-tile[data-property-id="indiana"] .set-owner'), 'Bank');
    // Four railroads wrap to two per row on a phone.
    const railTops = await phone.$$eval('.set-row[data-group="railroad"] .set-tile', (tiles) => tiles.map((tile) => Math.round(tile.getBoundingClientRect().top)));
    assert.equal(new Set(railTops).size, 2);
    // The player tiles above still filter by owner: other deeds are dimmed, not hidden.
    await phone.click('#players-bar [data-owner]:has-text("Ana")');
    const dimmed = await phone.$$eval('.set-tile', (tiles) => tiles.filter((tile) => tile.classList.contains('dim')).length);
    assert.equal(dimmed, 25, "everything but Ana's three deeds is dimmed");
    assert.equal(await phone.$eval('.set-tile[data-property-id="boardwalk"]', (tile) => tile.classList.contains('dim')), false);
    await phone.click('#players-bar [data-owner="all"]');
    await phone.click('.set-tile[data-property-id="boardwalk"]');
    await phone.waitForSelector('#deed-dialog[open]');
    assert.match(await phone.textContent('#deed-dialog'), /Boardwalk/);
    await phone.click('#deed-dialog .dialog-close');
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal scroll at 375 px');
    // The choice is remembered on this device.
    await phone.reload();
    await phone.click('#mobile-nav [data-mobile-view="deeds"]');
    assert.equal(await phone.isVisible('#deed-sets'), true);
    await phone.click('[data-deed-mode="list"]');
    assert.equal(await phone.isVisible('#deed-grid'), true);
    assert.deepEqual(phoneErrors, []);
    await phone.close();
  });

  await t.test('logs no console or CSP errors', () => {
    assert.deepEqual(errors, []);
  });
});
