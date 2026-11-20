import { encodeQr, qrToSvg } from './qr.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const GROUP_COLORS = { brown:'#8b5a3c',lightblue:'#9ad8e8',pink:'#d65aa3',orange:'#ef8b35',red:'#d94345',yellow:'#f0ca3e',green:'#31966f',darkblue:'#3158a6',railroad:'#34414a',utility:'#87939a' };
const TOKEN_LABELS = ['M','R','T','♟','★','◆','♣','♥'];
// Mirrors lib/game.mjs (MAX_PLAYERS and seat colors) for the setup form.
const MAX_PLAYERS = 8;
const PLAYER_COLORS = ['#d9574f', '#3c8fd1', '#d6a53c', '#45a477', '#8a5cc7', '#e07b39', '#2a9d9b', '#d1588e'];
let game = null;
let activeView = 'pay';
let pollTimer;
let shownResultsFor = null;
let spectatorToken = null; // set on /watch/<token> pages
// Activity page: every ledger entry this device has seen (newest first), plus paging and filter state.
const LEDGER_STEP = 50;
const LEDGER_TYPES = { all: null, payments: ['transfer', 'tax', 'fee', 'parking'], rent: ['rent'], deeds: ['purchase', 'auction', 'mortgage', 'unmortgage'], building: ['building'], trades: ['trade'] };
let ledgerCache = [];
let ledgerExhausted = false;
let ledgerHasMore = false;
let ledgerLoading = false;
let ledgerLimit = LEDGER_STEP;
let ledgerType = 'all';
let ledgerShowUndone = false;
let ledgerMatches = 0;
let ledgerSearchOpen = false;
let summaryOpen = false;
let stream = null;         // EventSource for live updates
let streamLive = false;
let acting = false;        // an action from this device is in flight
let me = null;             // this device's player ID, 'banker', or null (not chosen)
let deedOwnerFilter = 'all'; // Deeds tab owner filter: 'all', a player ID, or 'bank'
let sheet = null;          // open player sheet: { kind: 'player', id } or { kind: 'parking' }

// Payment feedback: a short chime and, where supported, a vibration.
// Preference is per device (localStorage, best effort).
const feedback = {
  enabled: (() => { try { return localStorage.getItem('monobank:sound') !== 'off'; } catch { return true; } })(),
  context: null,
  set(on) {
    this.enabled = on;
    try { localStorage.setItem('monobank:sound', on ? 'on' : 'off'); } catch { /* storage unavailable */ }
  },
  play(kind = 'success') {
    if (!this.enabled) return;
    try { navigator.vibrate?.(kind === 'error' ? [70, 50, 70] : kind === 'remote' ? 20 : 40); } catch { /* unsupported */ }
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context ||= new AudioContext();
      if (this.context.state === 'suspended') this.context.resume();
      const notes = kind === 'error' ? [220, 165] : kind === 'remote' ? [880] : [660, 990];
      notes.forEach((frequency, index) => {
        const start = this.context.currentTime + index * 0.09;
        const oscillator = this.context.createOscillator();
        const gain = this.context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.18, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
        oscillator.connect(gain).connect(this.context.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.18);
      });
    } catch { /* audio unavailable */ }
  }
};

// The CSP (style-src 'self') blocks style="" attributes parsed from innerHTML,
// so markup carries data-vars="--name=value;--other=value" and this helper
// applies them through the CSSOM, which the CSP allows.
function applyStyleVars(root = document) {
  $$('[data-vars]', root).forEach((element) => {
    element.dataset.vars.split(';').forEach((pair) => {
      const [name, value] = pair.split('=');
      if (name?.startsWith('--') && value) element.style.setProperty(name.trim(), value.trim());
    });
    delete element.dataset.vars;
  });
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[character]);
const gameIdFromPath = () => location.pathname.match(/^\/game\/([a-f0-9]{16})\/?$/)?.[1];
const watchTokenFromPath = () => location.pathname.match(/^\/watch\/([a-f0-9]{16})\/?$/)?.[1];
const isSpectator = () => Boolean(spectatorToken);
const playerById = (id) => game?.players.find((player) => player.id === id);
const activePlayers = () => game.players.filter((player) => !player.bankrupt);
// "This phone is me": a per-device choice, remembered per game (best effort).
const identityKey = () => `monobank:me:${game.id}`;
const mePlayer = () => (me && me !== 'banker' ? playerById(me) : null);
// This device's player first, then everyone else in seat order.
const orderedPlayers = (list = game.players) => {
  const mine = mePlayer();
  return mine && list.includes(mine) ? [mine, ...list.filter((player) => player !== mine)] : list;
};
const seatOf = (player) => game.players.indexOf(player);
function loadIdentity() {
  try { return localStorage.getItem(identityKey()); } catch { return null; }
}
function saveIdentity(value) {
  me = value;
  try { localStorage.setItem(identityKey(), value); } catch { /* storage unavailable */ }
}
const standingFor = (id) => game.standings?.find((row) => row.playerId === id);
const propertyById = (id) => game?.properties.find((property) => property.id === id);
const deedOwner = (propertyId) => playerById(game?.deeds[propertyId]?.ownerId);
const rules = () => game?.rules || {};
const unmortgageCost = (property) => Math.round(property.mortgage * (1 + (rules().mortgageInterestPercent ?? 10) / 100));

// Mirrors rulesSummary() in lib/game.mjs for display only; the server enforces every rule.
function rulesSummary(value) {
  const notes = [];
  if (value.freeParkingJackpot) notes.push(value.freeParkingSeed ? `Free Parking jackpot (seeded ${money.format(value.freeParkingSeed)})` : 'Free Parking jackpot');
  if (value.doubleGoOnLanding) notes.push('$400 for landing on GO');
  if (value.noRentInJail) notes.push('No rent while in jail');
  if (value.auctions === false) notes.push('No auctions');
  if (value.evenBuilding === false) notes.push('Uneven building allowed');
  if (value.mortgageInterestPercent != null && value.mortgageInterestPercent !== 10) notes.push(`${value.mortgageInterestPercent}% mortgage interest`);
  return notes;
}

function setupRules() {
  const jackpot = $('#rule-free-parking').checked;
  return {
    freeParkingJackpot: jackpot,
    freeParkingSeed: jackpot ? Number($('#rule-free-parking-seed').value || 0) : 0,
    doubleGoOnLanding: $('#rule-double-go').checked,
    noRentInJail: $('#rule-no-rent-jail').checked,
    auctions: $('#rule-auctions').checked,
    evenBuilding: $('#rule-even-building').checked,
    mortgageInterestPercent: Number($('#rule-mortgage-interest').value || 0)
  };
}

function updateSetupRules() {
  $('#rule-seed-field').hidden = !$('#rule-free-parking').checked;
  const notes = rulesSummary(setupRules());
  $('#setup-rules-summary').textContent = notes.length ? `${notes.length} house rule${notes.length === 1 ? '' : 's'}` : 'Classic rules';
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed.');
    error.status = response.status;
    error.code = data.code;
    error.details = data.details;
    throw error;
  }
  return data;
}

function toast(message, type = '') {
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  $('#toast-region').append(item);
  setTimeout(() => item.remove(), 3200);
}

function setBusy(form, busy) {
  const button = $('button[type="submit"]', form);
  if (button) button.disabled = busy;
}

function addPlayerInput(name = '') {
  const container = $('#player-inputs');
  if (container.children.length >= MAX_PLAYERS) return;
  const index = container.children.length;
  const field = document.createElement('div');
  field.className = 'player-field';
  field.innerHTML = `<span class="token">${TOKEN_LABELS[index]}</span><label class="sr-only" for="player-${index}">Player ${index + 1} name</label><input id="player-${index}" maxlength="24" autocomplete="off" placeholder="Player ${index + 1}" value="${escapeHtml(name)}" required><button class="remove-player" type="button" aria-label="Remove player ${index + 1}">×</button>`;
  $('.remove-player', field).addEventListener('click', () => {
    if (container.children.length <= 2) return toast('A game needs at least two players.', 'error');
    field.remove();
    normalizePlayerInputs();
  });
  container.append(field);
  normalizePlayerInputs();
}

function normalizePlayerInputs() {
  $$('.player-field', $('#player-inputs')).forEach((field, index) => {
    $('.token', field).textContent = TOKEN_LABELS[index];
    $('.token', field).style.background = PLAYER_COLORS[index];
    const input = $('input', field);
    input.id = `player-${index}`;
    input.placeholder = `Player ${index + 1}`;
    $('label', field).htmlFor = input.id;
    $('.remove-player', field).ariaLabel = `Remove player ${index + 1}`;
  });
  const count = $('#player-inputs').children.length;
  $('#add-player').hidden = count >= MAX_PLAYERS;
  $('#player-count').textContent = `${count} of ${MAX_PLAYERS} players`;
}

async function createGame(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const players = $$('#player-inputs input').map((input) => input.value.trim());
  $('#setup-error').textContent = '';
  setBusy(form, true);
  try {
    const created = await api('/api/games', { method: 'POST', body: { players, startingBalance: Number($('#starting-balance').value), rules: setupRules() } });
    history.pushState({}, '', `/game/${created.id}`);
    game = created;
    showGame();
    toast('The bank is open.');
  } catch (error) {
    $('#setup-error').textContent = error.message;
  } finally { setBusy(form, false); }
}

async function loadGame(silent = false) {
  const id = gameIdFromPath();
  const token = watchTokenFromPath();
  if (!id && !token) return showSetup();
  spectatorToken = token || null;
  try {
    applyLatest(await api(token ? `/api/watch/${token}` : `/api/games/${id}`));
  } catch (error) {
    if (!silent) {
      showSetup();
      $('#setup-error').textContent = error.message;
      history.replaceState({}, '', '/');
    }
  }
}

// Apply a newer game state from polling or the live stream.
function applyLatest(latest) {
  const sameGame = game && (isSpectator() ? game.viewToken === latest.viewToken : game.id === latest.id);
  if (!sameGame) {
    game = latest;
    return showGame();
  }
  if (latest.revision <= game.revision) return;
  game = latest;
  renderGame();
  if (!acting) feedback.play('remote');
}

function connectStream() {
  closeStream();
  if (!('EventSource' in window)) return;
  stream = new EventSource(isSpectator() ? `/api/watch/${spectatorToken}/events` : `/api/games/${game.id}/events`);
  stream.addEventListener('game', (event) => {
    try { applyLatest(JSON.parse(event.data)); } catch { /* ignore malformed events */ }
  });
  stream.addEventListener('open', () => setLive(true));
  stream.addEventListener('error', () => setLive(false));
}

function closeStream() {
  stream?.close();
  stream = null;
  setLive(false);
}

function setLive(live) {
  streamLive = live;
  const badge = $('#session-badge');
  badge.classList.toggle('polling', !live);
  badge.title = live ? 'Live: updates appear instantly' : 'Reconnecting: checking for updates every few seconds';
  schedulePoll();
}

// Polling is the fallback; while the live stream is connected it is only a slow safety net.
function schedulePoll() {
  clearInterval(pollTimer);
  if (!game) return;
  pollTimer = setInterval(() => { if (!document.hidden) loadGame(true); }, streamLive ? 30_000 : 3500);
}

function showSetup() {
  game = null;
  spectatorToken = null;
  me = null;
  closeStream();
  document.body.classList.remove('spectator');
  $('#setup-screen').hidden = false;
  $('#game-screen').hidden = true;
  $('#game-actions').hidden = true;
  document.body.classList.remove('in-game');
  document.title = 'MonoBank: Unofficial Monopoly Banker App – No Paper Money';
  setMenu(false);
  $('#mobile-nav').hidden = true;
  clearInterval(pollTimer);
}

function resetLedger() {
  ledgerCache = [];
  ledgerExhausted = false;
  ledgerLimit = LEDGER_STEP;
  ledgerType = 'all';
  ledgerShowUndone = false;
  ledgerSearchOpen = false;
  $('#ledger-search').value = '';
  $('#ledger-type').value = 'all';
}

const apiBase = () => (isSpectator() ? `/api/watch/${spectatorToken}` : `/api/games/${game.id}`);

function showGame() {
  resetLedger();
  $('#export-activity').href = `${apiBase()}/activity.csv`;
  $('#setup-screen').hidden = true;
  $('#game-screen').hidden = false;
  $('#game-actions').hidden = false;
  document.body.classList.add('in-game');
  document.body.classList.toggle('spectator', isSpectator());
  const code = isSpectator() ? 'VIEW' : game.id.slice(0, 4).toUpperCase();
  document.title = isSpectator() ? 'Watching a game · MonoBank' : `Game ${code} · MonoBank`;
  $('#session-code').textContent = code;
  $('#spectator-note').hidden = !isSpectator();
  $('#mobile-nav').hidden = false;
  if (isSpectator()) {
    me = null;
    if (['pay', 'trade'].includes(activeView)) activeView = 'ledger';
  } else {
    me = loadIdentity();
  }
  renderGame();
  connectStream();
  if (!isSpectator() && !me) openIdentity();
}

function renderGame() {
  renderRules();
  renderStatus();
  renderMe();
  renderSelects();
  renderDeeds();
  renderTrade();
  renderLedger();
  renderUndo();
  switchView(activeView, { scroll: false });
  refreshSheet();
  const ended = game.status === 'ended';
  $$('#game-screen .console-panel button[type="submit"]').forEach((button) => { button.disabled = ended; });
  if (ended && shownResultsFor !== game.endedAt) {
    shownResultsFor = game.endedAt;
    openResults();
  }
}

function winnerText() {
  const names = game.winnerIds.map((id) => playerById(id)?.name).filter(Boolean);
  return names.length > 1 ? `${names.join(' & ')} tie` : `${names[0]} wins`;
}

function renderStatus() {
  const ended = game.status === 'ended';
  $('#ended-banner').hidden = !ended;
  $('#end-game').hidden = ended;
  if (ended) $('#ended-text').textContent = `Game over: ${winnerText()}`;
}

function renderMe() {
  const player = mePlayer();
  $('#me-bar').hidden = isSpectator() || !me;
  if (me && me !== 'banker' && !player) {
    $('#me-text').innerHTML = 'Your player has left the game';
  } else if (player) {
    $('#me-text').innerHTML = `Playing as <strong>${escapeHtml(player.name)}</strong>${player.bankrupt ? ' · bankrupt' : ''}`;
  } else {
    $('#me-text').innerHTML = '<strong>Banker view</strong>';
  }
}

// The one player list: a sticky bar under the header on every tab. Tapping a
// player opens their sheet; on the Deeds tab the same bar filters deeds by owner.
function renderPlayersBar() {
  const filtering = activeView === 'deeds';
  const deedCount = (ownerId) => game.properties.filter((property) => (game.deeds[property.id].ownerId || 'bank') === ownerId).length;
  const players = filtering ? orderedPlayers(activePlayers()) : orderedPlayers();
  if (deedOwnerFilter !== 'all' && deedOwnerFilter !== 'bank' && !activePlayers().some((player) => player.id === deedOwnerFilter)) deedOwnerFilter = 'all';
  const jailRule = rules().noRentInJail;
  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  // Same tile on every tab, so the row keeps its height; on Deeds the tiles toggle the owner filter instead of opening a sheet.
  const tile = (player) => {
    const isMe = player.id === mePlayer()?.id;
    const winner = game.status === 'ended' && game.winnerIds.includes(player.id);
    const worth = standingFor(player.id)?.total ?? player.balance;
    const status = player.bankrupt ? 'Bankrupt' : winner ? '★ Winner' : jailRule && player.inJail ? '🔒 In jail' : '';
    const classes = ['player-tile', isMe && 'is-me', player.bankrupt && 'bankrupt', winner && 'winner', filtering && deedOwnerFilter === player.id && 'active'].filter(Boolean).join(' ');
    const attrs = filtering ? `data-owner="${player.id}" aria-pressed="${deedOwnerFilter === player.id}"` : `data-player="${player.id}" aria-haspopup="dialog"`;
    return `<button type="button" class="${classes}" ${attrs} data-vars="--player-color=${escapeHtml(player.color)}"><span class="tile-head"><span class="mini-token" aria-hidden="true">${TOKEN_LABELS[seatOf(player)]}</span><span class="tile-name">${escapeHtml(player.name)}</span>${isMe ? '<span class="you-badge">You</span>' : ''}</span><b class="tile-balance">${player.bankrupt ? '—' : money.format(player.balance)}</b>${player.bankrupt ? '<small class="tile-meta">Out of the game</small>' : `<small class="tile-meta">Net worth ${money.format(worth)}</small><small class="tile-meta">${plural(deedCount(player.id), 'deed')}</small>`}${status ? `<span class="tile-status">${status}</span>` : ''}</button>`;
  };
  const tiles = players.map(tile);
  if (filtering) {
    tiles.unshift(`<button type="button" class="player-tile plain ${deedOwnerFilter === 'all' ? 'active' : ''}" data-owner="all" aria-pressed="${deedOwnerFilter === 'all'}"><span class="tile-head"><span class="tile-name">All deeds</span></span><b class="tile-balance">${game.properties.length}</b><small class="tile-meta">On the board</small></button>`);
    tiles.push(`<button type="button" class="player-tile plain ${deedOwnerFilter === 'bank' ? 'active' : ''}" data-owner="bank" aria-pressed="${deedOwnerFilter === 'bank'}"><span class="tile-head"><span class="tile-name">Bank</span></span><b class="tile-balance">${deedCount('bank')}</b><small class="tile-meta">Unowned deeds</small></button>`);
  } else if (rules().freeParkingJackpot) {
    tiles.push(`<button type="button" class="player-tile parking" data-parking aria-haspopup="dialog" data-vars="--player-color=#d6b661"><span class="tile-head"><span class="mini-token" aria-hidden="true">P</span><span class="tile-name">Free Parking</span></span><b class="tile-balance">${money.format(game.freeParking || 0)}</b><small class="tile-meta">Jackpot · tap to pay out</small></button>`);
  }
  const bar = $('#players-bar');
  const scrollLeft = bar.scrollLeft;
  bar.classList.toggle('filtering', filtering);
  bar.classList.toggle('crowded', tiles.length > 5);
  bar.setAttribute('aria-label', filtering ? 'Filter deeds by owner' : 'Players');
  bar.innerHTML = tiles.join('');
  // Re-rendering replaces the tiles; keep the row where the user scrolled it (live updates arrive often).
  bar.scrollLeft = scrollLeft;
  applyStyleVars(bar);
  $$('[data-player]', bar).forEach((button) => button.addEventListener('click', () => openSheet({ kind: 'player', id: button.dataset.player })));
  $$('[data-owner]', bar).forEach((button) => button.addEventListener('click', () => {
    deedOwnerFilter = button.dataset.owner;
    renderDeeds();
    renderPlayersBar();
  }));
  $('[data-parking]', bar)?.addEventListener('click', () => openSheet({ kind: 'parking' }));
}

// Player sheet: details and quick actions for one player (or the Free Parking pot).
function openSheet(next) {
  sheet = next;
  refreshSheet();
  if (sheet && !$('#player-dialog').open) $('#player-dialog').showModal();
}

function refreshSheet() {
  if (!sheet || !game) return;
  const ended = game.status === 'ended';
  const canAct = !isSpectator() && !ended;
  if (sheet.kind === 'parking') {
    $('#player-content').innerHTML = `<div class="dialog-color" data-vars="--deed-color=#d6b661"></div><div class="dialog-inner"><div class="dialog-head"><div><p class="kicker">HOUSE RULE</p><h2 id="player-title">Free Parking</h2><p class="muted">Taxes and fees collect here. Whoever lands on Free Parking takes the pot.</p></div><button class="dialog-close" type="button" data-close-dialog aria-label="Close">×</button></div><div class="sheet-total"><small>In the pot</small><strong>${money.format(game.freeParking || 0)}</strong></div>${canAct ? `<form class="dialog-form" id="parking-form"><label class="field"><span>Who landed on Free Parking?</span><select id="parking-winner">${optionList({ selected: mePlayer()?.id })}</select></label><button type="submit" ${game.freeParking ? '' : 'disabled'}>COLLECT ${money.format(game.freeParking || 0)}</button></form>` : ''}</div>`;
    applyStyleVars($('#player-content'));
    $('#parking-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const winner = playerById($('#parking-winner').value);
      if (await submitAction({ type: 'collect-parking', playerId: winner.id }, `${winner.name} collected Free Parking.`)) $('#player-dialog').close();
    });
    return;
  }
  const player = playerById(sheet.id);
  if (!player) return $('#player-dialog').close();
  const row = standingFor(player.id) || { cash: player.balance, property: 0, buildings: 0, raisable: 0, total: player.balance };
  const isMe = player.id === mePlayer()?.id;
  const jailRule = rules().noRentInJail;
  const winner = ended && game.winnerIds.includes(player.id);
  const status = player.bankrupt ? 'Bankrupt · out of the game' : winner ? 'Winner' : jailRule && player.inJail ? 'In jail · no rent until released' : player.balance < 0 ? 'Needs attention' : 'Ready to play';
  const deeds = game.properties.filter((property) => game.deeds[property.id].ownerId === player.id);
  const deedRows = deeds.map((property) => {
    const deed = game.deeds[property.id];
    const tags = [deed.buildings === 5 ? 'Hotel' : deed.buildings ? `${deed.buildings} house${deed.buildings === 1 ? '' : 's'}` : '', deed.mortgaged ? 'Mortgaged' : ''].filter(Boolean).join(' · ');
    return `<li data-vars="--deed-color=${GROUP_COLORS[property.group]}"><span>${escapeHtml(property.name)}</span><small>${tags}</small></li>`;
  }).join('');
  // Quick actions: the common Bank payments for this player, sent as ordinary transfers.
  const quick = canAct && !player.bankrupt ? `<div class="sheet-quick"><h3 class="sheet-heading">Quick actions</h3><div class="quick-row" role="group" aria-label="Quick actions for ${escapeHtml(player.name)}">${quickActions().map((item) => `<button type="button" class="${item.in ? 'in' : 'out'}" data-quick="${item.key}">${item.label}</button>`).join('')}</div><form class="quick-custom" id="quick-custom"><label class="sr-only" for="quick-amount">Other amount</label><span aria-hidden="true">$</span><input id="quick-amount" type="number" min="1" step="1" inputmode="numeric" placeholder="Other amount"><button type="submit" class="in" data-direction="in">+ From Bank</button><button type="submit" class="out" data-direction="out">− To Bank</button></form></div>` : '';
  const actions = [
    deeds.length ? '<button type="button" class="secondary" data-sheet="deeds">Show deeds</button>' : '',
    canAct && !player.bankrupt ? `<button type="button" class="secondary" data-sheet="pay">Pay from ${escapeHtml(player.name)}</button>` : '',
    !isSpectator() && !isMe && !player.bankrupt ? '<button type="button" class="secondary" data-sheet="me">This is me</button>' : '',
    canAct && jailRule && !player.bankrupt ? `<button type="button" class="secondary" data-sheet="jail" aria-pressed="${player.inJail}">${player.inJail ? 'Release from jail' : 'Send to jail'}</button>` : ''
  ].filter(Boolean).join('');
  $('#player-content').innerHTML = `<div class="dialog-color" data-vars="--deed-color=${escapeHtml(player.color)}"></div><div class="dialog-inner"><div class="dialog-head"><div><p class="kicker">${isMe ? 'YOU' : 'PLAYER'}</p><h2 id="player-title">${escapeHtml(player.name)}</h2><p class="muted">${status}</p></div><button class="dialog-close" type="button" data-close-dialog aria-label="Close">×</button></div><div class="dialog-facts"><div><small>Cash</small><strong>${player.bankrupt ? '—' : money.format(player.balance)}</strong></div><div><small>Net worth</small><strong>${money.format(row.total)}</strong></div><div><small>Can raise</small><strong>${money.format(row.raisable)}</strong></div></div><p class="fine-print sheet-breakdown">Net worth = ${money.format(row.cash)} cash + ${money.format(row.property)} deeds + ${money.format(row.buildings)} buildings (resale).</p>${deeds.length ? `<h3 class="sheet-heading">${deeds.length} deed${deeds.length === 1 ? '' : 's'}</h3><ul class="sheet-deeds">${deedRows}</ul>` : '<p class="muted">No deeds.</p>'}${quick}${actions ? `<div class="dialog-actions sheet-actions">${actions}</div>` : ''}</div>`;
  applyStyleVars($('#player-content'));
  $$('[data-quick]', $('#player-content')).forEach((button) => button.addEventListener('click', () => {
    const item = quickActions().find((entry) => entry.key === button.dataset.quick);
    quickPay(player, item.in ? item.amount : -item.amount, item.note, item.category);
  }));
  $('#quick-custom')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const amount = Number($('#quick-amount').value);
    if (!(amount >= 1)) return toast('Enter an amount of at least $1.', 'error');
    const incoming = (event.submitter?.dataset.direction || 'in') === 'in';
    quickPay(player, incoming ? amount : -amount, incoming ? 'From the Bank' : 'Paid the Bank', 'transfer');
  });
  $$('[data-sheet]', $('#player-content')).forEach((button) => button.addEventListener('click', async () => {
    const action = button.dataset.sheet;
    if (action === 'deeds') {
      $('#player-dialog').close();
      deedOwnerFilter = player.id;
      switchView('deeds');
      renderDeeds();
    } else if (action === 'pay') {
      $('#player-dialog').close();
      switchView('pay');
      $('#payment-from').value = player.id;
      $('#payment-amount').focus();
    } else if (action === 'me') {
      $('#player-dialog').close();
      chooseIdentity(player.id);
    } else if (action === 'jail') {
      await submitAction({ type: 'jail', playerId: player.id, inJail: !player.inJail }, player.inJail ? `${player.name} is out of jail.` : `${player.name} went to jail.`);
    }
  }));
}

function quickActions() {
  // Taxes and fees feed the Free Parking pot when that house rule is on (same as the Quick pay presets).
  return [
    { key: 'go', label: 'Passed GO +$200', amount: 200, in: true, note: 'Passed GO', category: 'transfer' },
    ...(rules().doubleGoOnLanding ? [{ key: 'land-go', label: 'Landed on GO +$400', amount: 400, in: true, note: 'Landed on GO', category: 'transfer' }] : []),
    { key: 'tax', label: 'Income Tax −$200', amount: 200, note: 'Income Tax', category: 'tax' },
    { key: 'luxury', label: 'Luxury Tax −$100', amount: 100, note: 'Luxury Tax', category: 'tax' },
    { key: 'jail-fee', label: 'Jail fee −$50', amount: 50, note: 'Jail fee', category: 'fee' }
  ];
}

// Positive amounts: the Bank pays the player. Negative: the player pays the Bank (or the Free Parking pot for taxes and fees).
async function quickPay(player, amount, note, category) {
  const incoming = amount > 0;
  const value = Math.abs(amount);
  const toPot = !incoming && category !== 'transfer' && rules().freeParkingJackpot;
  const action = incoming
    ? { type: 'transfer', fromId: 'bank', toId: player.id, amount: value, note, category }
    : { type: 'transfer', fromId: player.id, toId: toPot ? 'parking' : 'bank', amount: value, note, category };
  const ok = await submitAction(action, `${player.name} ${incoming ? '+' : '−'}${money.format(value)} · ${note}`);
  if (ok && $('#quick-amount')) $('#quick-amount').value = '';
}

function openIdentity() {
  const options = activePlayers().map((player) => {
    const index = game.players.indexOf(player);
    return `<button type="button" class="identity-option ${player.id === me ? 'current' : ''}" data-identity="${player.id}" data-vars="--player-color=${escapeHtml(player.color)}"><span class="mini-token">${TOKEN_LABELS[index]}</span><span><strong>${escapeHtml(player.name)}</strong><small>${money.format(player.balance)}</small></span></button>`;
  });
  options.push(`<button type="button" class="identity-option banker ${me === 'banker' ? 'current' : ''}" data-identity="banker"><span class="mini-token">$</span><span><strong>I’m the banker</strong><small>Not playing · see everyone equally</small></span></button>`);
  $('#identity-options').innerHTML = options.join('');
  $('#identity-options').classList.toggle('many', options.length > 5);
  applyStyleVars($('#identity-options'));
  $$('[data-identity]', $('#identity-options')).forEach((button) => button.addEventListener('click', () => chooseIdentity(button.dataset.identity)));
  if (!$('#identity-dialog').open) $('#identity-dialog').showModal();
}

function chooseIdentity(value) {
  saveIdentity(value);
  $('#identity-dialog').close();
  const player = mePlayer();
  if (player) {
    $('#payment-from').value = player.id;
    $('#trade-first').value = player.id;
  }
  renderGame();
  toast(player ? `This phone is ${player.name}.` : 'This phone is the banker.');
}

function renderUndo() {
  $$('[data-undo]').forEach((button) => {
    button.hidden = !game.undo;
    button.title = game.undo ? `Undo: ${game.undo.label}` : '';
  });
}

function renderRules() {
  const notes = rulesSummary(rules());
  $('#rules-line').textContent = notes.length ? `House rules: ${notes.join(' · ')}` : 'Classic rules';
  $('#preset-land-go').hidden = !rules().doubleGoOnLanding;
}


function optionList({ includeBank = false, includeParking = false, selected = '' } = {}) {
  const values = [
    ...(includeBank ? [{ id: 'bank', name: 'The Bank' }] : []),
    ...(includeParking && rules().freeParkingJackpot ? [{ id: 'parking', name: 'Free Parking pot' }] : []),
    ...orderedPlayers(activePlayers())
  ];
  return values.map((item) => `<option value="${item.id}" ${item.id === selected ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
}

function renderSelects() {
  const from = $('#payment-from').value || mePlayer()?.id || game.players[0]?.id;
  const to = $('#payment-to').value || game.players[1]?.id;
  $('#payment-from').innerHTML = optionList({ includeBank: true, selected: from });
  $('#payment-to').innerHTML = optionList({ includeBank: true, includeParking: true, selected: to });
  if ($('#payment-from').value === $('#payment-to').value && game.players[1]) $('#payment-to').value = game.players[1].id;

  const active = activePlayers();
  const debtor = active.some((player) => player.id === $('#bankrupt-player').value) ? $('#bankrupt-player').value : active[0]?.id;
  $('#bankrupt-player').innerHTML = optionList({ selected: debtor });
  renderCreditors();

  const first = $('#trade-first').value || mePlayer()?.id || game.players[0]?.id;
  const second = $('#trade-second').value || game.players[1]?.id;
  $('#trade-first').innerHTML = optionList({ selected: first });
  $('#trade-second').innerHTML = optionList({ selected: second });
  if ($('#trade-first').value === $('#trade-second').value && game.players[1]) $('#trade-second').value = game.players[1].id;
}

function renderCreditors() {
  const debtor = $('#bankrupt-player').value;
  const current = $('#bankrupt-creditor').value || 'bank';
  const options = [{ id: 'bank', name: 'The Bank' }, ...activePlayers().filter((player) => player.id !== debtor)];
  $('#bankrupt-creditor').innerHTML = options.map((item) => `<option value="${item.id}" ${item.id === current ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
  renderBankruptcyPreview();
}

// Mirrors the server's bankruptcy settlement for the preview only.
function renderBankruptcyPreview() {
  const debtor = playerById($('#bankrupt-player').value);
  if (!debtor) return;
  const creditorId = $('#bankrupt-creditor').value || 'bank';
  const creditorName = creditorId === 'bank' ? 'the Bank' : playerById(creditorId)?.name || 'the creditor';
  const owned = game.properties.filter((property) => game.deeds[property.id].ownerId === debtor.id);
  const proceeds = owned.reduce((sum, property) => sum + (property.kind === 'street' ? game.deeds[property.id].buildings * Math.floor(property.houseCost / 2) : 0), 0);
  const cash = Math.max(debtor.balance + proceeds, 0);
  const debt = Math.min(debtor.balance + proceeds, 0);
  const mortgaged = owned.filter((property) => game.deeds[property.id].mortgaged).length;
  const deedText = `${owned.length} deed${owned.length === 1 ? '' : 's'}`;
  const steps = [];
  if (proceeds) steps.push(`Houses and hotels are sold to the Bank for <b>${money.format(proceeds)}</b>.`);
  if (creditorId === 'bank') {
    steps.push(owned.length ? `${deedText} return to the Bank${mortgaged ? ', unmortgaged' : ''}.` : 'No deeds to return.');
    steps.push(cash ? `<b>${money.format(cash)}</b> cash goes back to the Bank.` : 'No cash to hand over.');
  } else {
    steps.push(`<b>${money.format(cash)}</b> cash and ${deedText}${mortgaged ? ` (${mortgaged} mortgaged)` : ''} go to <b>${escapeHtml(creditorName)}</b>.`);
  }
  if (debt) steps.push(`The remaining <b>${money.format(-debt)}</b> debt is written off.`);
  const remaining = activePlayers().filter((player) => player.id !== debtor.id);
  steps.push(remaining.length === 1 ? `${escapeHtml(debtor.name)} leaves the game, and <b>${escapeHtml(remaining[0].name)} wins</b>.` : `${escapeHtml(debtor.name)} leaves the game.`);
  $('#bankrupt-steps').innerHTML = steps.map((step) => `<li><span>${step}</span></li>`).join('');
  $('#bankrupt-submit-label').textContent = `Declare ${debtor.name} bankrupt`;
}


function renderDeeds() {
  const query = $('#deed-search').value.toLowerCase();
  const filter = $('#deed-filter').value;
  const filtered = game.properties.filter((property) => {
    const deed = game.deeds[property.id];
    const matchesQuery = property.name.toLowerCase().includes(query);
    const matchesFilter = filter === 'all' || (filter === 'available' && !deed.ownerId) || (filter === 'owned' && deed.ownerId) || (filter === 'mortgaged' && deed.mortgaged);
    const matchesOwner = deedOwnerFilter === 'all' || (deed.ownerId || 'bank') === deedOwnerFilter;
    return matchesQuery && matchesFilter && matchesOwner;
  });
  $('#deed-grid').innerHTML = filtered.map((property) => {
    const deed = game.deeds[property.id];
    const owner = deedOwner(property.id);
    const buildings = deed.buildings === 5 ? 'Hotel' : deed.buildings ? `${deed.buildings} house${deed.buildings > 1 ? 's' : ''}` : '';
    return `<button class="deed-card ${deed.mortgaged ? 'mortgaged' : ''}" data-property-id="${property.id}" data-vars="--deed-color=${GROUP_COLORS[property.group]};--owner-color=${escapeHtml(owner?.color || '#64716b')}"><span class="deed-color"></span><span class="deed-body"><strong>${escapeHtml(property.name)}</strong><small>${property.kind === 'street' ? escapeHtml(property.group.replace('lightblue','Light blue').replace('darkblue','Dark blue')) : property.kind}${buildings ? ` · ${buildings}` : ''}${deed.mortgaged ? ' · Mortgaged' : ''}</small><span class="deed-status"><b>${money.format(property.price)}</b><small class="owner-chip">${owner ? escapeHtml(owner.name) : 'BANK'}</small></span></span></button>`;
  }).join('') || '<div class="empty-state">No deeds match this filter.</div>';
  applyStyleVars($('#deed-grid'));
  $$('.deed-card', $('#deed-grid')).forEach((button) => button.addEventListener('click', () => openDeed(button.dataset.propertyId)));
}

function renderTrade() {
  const first = playerById($('#trade-first').value) || game.players[0];
  const second = playerById($('#trade-second').value) || game.players[1];
  if (!first || !second) return;
  $('#first-offer-label').textContent = `${first.name} offers`;
  $('#second-offer-label').textContent = `${second.name} offers`;
  $('#trade-first-deeds').innerHTML = ownedDeedChecks(first.id, 'first');
  $('#trade-second-deeds').innerHTML = ownedDeedChecks(second.id, 'second');
}

function ownedDeedChecks(playerId, side) {
  const entries = game.properties.filter((property) => game.deeds[property.id].ownerId === playerId && !game.deeds[property.id].buildings);
  if (!entries.length) return '<span class="muted">No tradable deeds</span>';
  return entries.map((property) => `<label><input type="checkbox" name="${side}-deed" value="${property.id}"><span>${escapeHtml(property.name)}${game.deeds[property.id].mortgaged ? ' · mortgaged' : ''}</span></label>`).join('');
}

function transactionIcon(type) {
  return ({ system:'M', transfer:'↔', rent:'R', purchase:'⌂', auction:'⌂', mortgage:'$', unmortgage:'$', building:'▰', trade:'⇄', tax:'$', parking:'P', jail:'#', undo:'↶', bankrupt:'✕', end:'★' })[type] || '$';
}

function timeAgo(iso) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

const clockTime = (date) => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const isToday = (date) => date.toDateString() === new Date().toDateString();

// Recent rows say "now" or "5m"; after ten minutes a clock time is more useful in a long game.
function rowTime(iso) {
  const date = new Date(iso);
  if (Date.now() - date < 10 * 60000) return timeAgo(iso);
  return isToday(date) ? clockTime(date) : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${clockTime(date)}`;
}

// Rows are grouped into 15-minute blocks so a long game reads like a timeline.
function timeBlock(iso) {
  const date = new Date(iso);
  date.setMinutes(Math.floor(date.getMinutes() / 15) * 15, 0, 0);
  return date;
}

const blockLabel = (date) => (isToday(date) ? clockTime(date) : `${date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · ${clockTime(date)}`);
const seatIndex = (playerId) => game.players.findIndex((player) => player.id === playerId);

// Cash change for one player: from the server's balance stamps, or the payer/payee on older entries.
function cashChange(item, playerId) {
  if (item.deltas) return item.deltas[seatIndex(playerId)] ?? 0;
  return (item.toId === playerId ? item.amount || 0 : 0) - (item.fromId === playerId ? item.amount || 0 : 0);
}

const involves = (item, filter) => filter === 'all' || item.fromId === filter || item.toId === filter || (filter !== 'bank' && Boolean(item.deltas?.[seatIndex(filter)]));

function matchesSearch(item, query) {
  if (!query) return true;
  const property = item.propertyId ? game.properties.find((entry) => entry.id === item.propertyId)?.name || '' : '';
  return `${item.label} ${item.detail} ${property}`.toLowerCase().includes(query);
}

// One ledger row. With a player (or the Bank) selected, amounts are signed from their side and show the balance after.
function ledgerRow(item, viewer = null) {
  let amount = item.amount != null ? money.format(item.amount) : '—';
  let tone = '';
  let after = '';
  if (viewer === 'bank' && item.amount) {
    if (item.fromId === 'bank') { amount = `−${money.format(item.amount)}`; tone = 'out'; }
    if (item.toId === 'bank') { amount = `+${money.format(item.amount)}`; tone = 'in'; }
  } else if (viewer) {
    const change = cashChange(item, viewer);
    if (change) { amount = `${change > 0 ? '+' : '−'}${money.format(Math.abs(change))}`; tone = change > 0 ? 'in' : 'out'; }
    const balance = item.balances?.[seatIndex(viewer)];
    if (balance != null) after = ` · balance ${money.format(balance)}`;
  }
  return `<article class="ledger-item ${item.undone ? 'undone' : ''} ${item.type === 'undo' ? 'is-undo' : ''}"><span class="ledger-icon">${transactionIcon(item.type)}</span><span class="ledger-copy"><strong>${escapeHtml(item.label)}</strong><small>${item.undone ? 'Undone · ' : ''}${escapeHtml(item.detail || item.type)}${after}</small></span><span class="ledger-amount"><b class="${tone}">${amount}</b><time datetime="${item.at}">${rowTime(item.at)}</time></span></article>`;
}

function ledgerHtml(items) {
  if (!items.length) return '<div class="empty-state">No transactions yet.</div>';
  return items.map((item) => ledgerRow(item)).join('');
}

// Phones get the newest entries with every update; keep older ones this device already loaded or saw.
function mergeLedger() {
  const fresh = game.transactions;
  const ids = new Set(fresh.map((item) => item.id));
  ledgerCache = [...fresh, ...ledgerCache.filter((item) => !ids.has(item.id))];
  ledgerHasMore = !ledgerExhausted && ledgerCache.length < (game.transactionCount ?? fresh.length);
}

function renderLedger() {
  mergeLedger();
  $('#mini-ledger').innerHTML = ledgerHtml(ledgerCache.slice(0, 6));
  const select = $('#ledger-filter');
  const current = select.value || 'all';
  const options = [{ id: 'all', name: 'Everyone' }, ...orderedPlayers().map((player) => ({ id: player.id, name: player.id === mePlayer()?.id ? `${player.name} (you)` : player.name })), { id: 'bank', name: 'The Bank' }];
  select.innerHTML = options.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
  select.value = options.some((item) => item.id === current) ? current : 'all';
  const filter = select.value;
  const query = $('#ledger-search').value.trim().toLowerCase();
  const types = LEDGER_TYPES[ledgerType];
  $('#ledger-type').value = ledgerType;
  // On phones the search box opens on demand (and stays open while it holds a search); wide screens always show it.
  const searching = ledgerSearchOpen || Boolean(query);
  $('.ledger-toolbar').classList.toggle('searching', searching);
  $('#ledger-search-toggle').setAttribute('aria-expanded', String(searching));
  const matches = ledgerCache.filter((item) => (!types || types.includes(item.type)) && involves(item, filter) && matchesSearch(item, query));
  const items = ledgerShowUndone ? matches : matches.filter((item) => !item.undone && item.type !== 'undo');
  const hiddenUndone = matches.length - items.length;
  ledgerMatches = items.length;
  const shown = items.slice(0, ledgerLimit);
  const viewer = filter === 'all' ? null : filter;
  const blocks = [];
  shown.forEach((item) => {
    const key = timeBlock(item.at).getTime();
    if (blocks.at(-1)?.key !== key) blocks.push({ key, items: [] });
    blocks.at(-1).items.push(item);
  });
  const name = filter === 'bank' ? 'the Bank' : playerById(filter)?.name;
  const narrowed = query || types;
  const empty = narrowed ? `No moves match${ledgerHasMore ? ' yet. Older moves aren’t loaded: tap Show earlier.' : '.'}` : filter === 'all' ? 'No transactions yet.' : `No activity for ${escapeHtml(name)} yet.`;
  $('#full-ledger').innerHTML = blocks.length ? blocks.map((block) => `<section class="ledger-group"><h3 class="ledger-group-head"><span>${blockLabel(new Date(block.key))}</span><small>${block.items.length} ${block.items.length === 1 ? 'move' : 'moves'}</small></h3>${block.items.map((item) => ledgerRow(item, viewer)).join('')}</section>`).join('') : `<div class="empty-state">${empty}</div>`;
  const more = $('#ledger-more');
  more.hidden = !(items.length > ledgerLimit || ledgerHasMore);
  more.disabled = ledgerLoading;
  more.textContent = ledgerLoading ? 'Loading…' : 'Show earlier';
  const undone = $('#ledger-undone');
  undone.hidden = !hiddenUndone && !ledgerShowUndone;
  undone.textContent = ledgerShowUndone ? 'Hide undone' : `Show ${hiddenUndone} undone`;
  undone.setAttribute('aria-pressed', String(ledgerShowUndone));
  const trimmed = game.transactionsDropped && !ledgerHasMore ? ` The first ${game.transactionsDropped.toLocaleString()} entries of this long game are no longer stored.` : '';
  $('#ledger-note').textContent = shown.length ? `Showing ${shown.length} of ${items.length}${ledgerHasMore ? '+' : ''} ${items.length === 1 ? 'entry' : 'entries'}.${trimmed}` : trimmed.trim();
  renderActivitySummary(filter);
}

async function loadEarlier() {
  if (ledgerMatches > ledgerLimit) {
    ledgerLimit += LEDGER_STEP;
    return renderLedger();
  }
  if (!ledgerHasMore || ledgerLoading) return;
  ledgerLoading = true;
  renderLedger();
  try {
    const page = await api(`${apiBase()}/transactions?before=${encodeURIComponent(ledgerCache.at(-1).id)}`);
    const ids = new Set(ledgerCache.map((item) => item.id));
    ledgerCache.push(...page.transactions.filter((item) => !ids.has(item.id)));
    ledgerExhausted = !page.hasMore;
    ledgerLimit += LEDGER_STEP;
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    ledgerLoading = false;
    renderLedger();
  }
}

// "Game so far" for everyone (or the Bank); one player's money in and out when a player is selected.
function renderActivitySummary(filter) {
  const stats = game.activity;
  if (!stats) return;
  const signed = (value) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${money.format(Math.abs(value))}`;
  let title;
  let facts;
  const row = stats.players[filter];
  if (row) {
    const net = row.moneyIn - row.moneyOut;
    title = `${escapeHtml(playerById(filter)?.name || '')}’s game`;
    facts = [
      ['Money in', signed(row.moneyIn), 'in'], ['Money out', signed(-row.moneyOut), 'out'], ['Net', signed(net), net > 0 ? 'in' : net < 0 ? 'out' : ''],
      ['Rent collected', money.format(row.rentCollected)], ['Rent paid', money.format(row.rentPaid)], ['Taxes & fees', money.format(row.taxesPaid)],
      ['Passed GO', `${row.goPasses}×`], ['Moves', row.moves]
    ];
  } else {
    const [topId, topRent] = Object.entries(stats.players).map(([id, entry]) => [id, entry.rentCollected]).sort((a, b) => b[1] - a[1])[0] || [];
    title = 'Game so far';
    facts = [
      ['Moves', stats.moves], ['Money moved', money.format(stats.moneyMoved)], ['Trades', stats.trades],
      ['Top rent earner', topRent ? `${escapeHtml(playerById(topId)?.name || '')} · ${money.format(topRent)}` : '—'],
      ...(rules().freeParkingJackpot ? [['Parking paid out', money.format(stats.parkingPaidOut)]] : [])
    ];
  }
  const note = stats.complete ? '' : '<p class="fine-print">Totals cover the moves still stored; the start of this very long game was trimmed.</p>';
  const body = `<dl class="summary-facts">${facts.map(([label, value, tone = '']) => `<div><dt>${label}</dt><dd class="${tone}">${value}</dd></div>`).join('')}</dl>${note}`;
  // The page copy collapses to one line (title + the key numbers); tap to see every total. The sidebar copy is always open.
  const teaser = row
    ? `Net ${signed(row.moneyIn - row.moneyOut)} · rent +${money.format(row.rentCollected)}`
    : `${stats.moves} ${stats.moves === 1 ? 'move' : 'moves'} · ${money.format(stats.moneyMoved)} moved`;
  $('#ledger-summary').innerHTML = `<details class="summary-details" ${summaryOpen ? 'open' : ''}><summary><span class="summary-title">${title}</span><span class="summary-teaser">${teaser}</span></summary>${body}</details>`;
  $('#ledger-summary details').addEventListener('toggle', (event) => { summaryOpen = event.target.open; });
  $('#side-summary').innerHTML = `<h3 class="summary-title">${title}</h3>${body}`;
}

function switchView(view, { scroll = true } = {}) {
  if (isSpectator() && ['pay', 'trade'].includes(view)) view = 'ledger';
  const changed = view !== activeView;
  // On wide screens the sidebar shows the activity summary instead of repeating the list on the Activity tab.
  $('.desktop-grid')?.classList.toggle('ledger-open', view === 'ledger');
  activeView = view;
  if (game) renderPlayersBar();
  $$('.console-view').forEach((panel) => panel.hidden = panel.id !== `${view}-view`);
  $$('.view-tabs button').forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $$('#mobile-nav button').forEach((button) => button.classList.toggle('active', button.dataset.mobileView === view));
  // Phones: start each tab at the top (the players bar stays pinned).
  if (scroll && changed && innerWidth < 761) scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

async function submitAction(action, successMessage) {
  if (isSpectator()) return false;
  acting = true;
  try {
    game = await api(`/api/games/${game.id}/actions`, { method: 'POST', body: { ...action, expectedRevision: game.revision } });
    renderGame();
    toast(successMessage);
    feedback.play('success');
    return true;
  } catch (error) {
    if (error.status === 409) await loadGame(true);
    feedback.play('error');
    if (error.code === 'insufficient-funds') {
      openRaiseCash({ ...error.details, message: error.message });
      return false;
    }
    toast(error.message, 'error');
    return false;
  } finally {
    acting = false;
  }
}

// "Not enough cash": help the player raise money before retrying a payment.
let raiseRequest = null;
const streetGroup = (property) => game.properties.filter((item) => item.kind === 'street' && item.group === property.group);

function raiseCashOptions(player) {
  const owned = game.properties.filter((property) => game.deeds[property.id].ownerId === player.id);
  const sells = owned.filter((property) => {
    const deed = game.deeds[property.id];
    if (property.kind !== 'street' || !deed.buildings) return false;
    const highest = Math.max(...streetGroup(property).map((item) => game.deeds[item.id].buildings));
    return rules().evenBuilding === false || deed.buildings === highest;
  });
  const mortgages = owned.filter((property) => !game.deeds[property.id].mortgaged
    && (property.kind !== 'street' || streetGroup(property).every((item) => !game.deeds[item.id].buildings)));
  return { sells, mortgages };
}

function openRaiseCash(details = raiseRequest) {
  raiseRequest = details;
  const player = playerById(details.playerId);
  if (!player) return;
  const missing = Math.max(0, details.needed - player.balance);
  const { sells, mortgages } = raiseCashOptions(player);
  const row = (property, action, label, amount) => `<li><span><strong>${escapeHtml(property.name)}</strong><small>${label}</small></span><button type="button" class="raise-button" data-raise="${action}" data-property="${property.id}">${action === 'sell' ? 'Sell' : 'Mortgage'} +${money.format(amount)}</button></li>`;
  const sellRows = sells.map((property) => {
    const count = game.deeds[property.id].buildings;
    return row(property, 'sell', count === 5 ? 'Hotel' : `${count} house${count === 1 ? '' : 's'}`, Math.floor(property.houseCost / 2));
  }).join('');
  const mortgageRows = mortgages.map((property) => row(property, 'mortgage', 'Unmortgaged deed', property.mortgage)).join('');
  const done = missing === 0;
  const status = done
    ? `<p class="raise-status ok">${escapeHtml(player.name)} now has ${money.format(player.balance)}, enough for the ${money.format(details.needed)} payment. Try it again.</p>`
    : `<p class="raise-status">${escapeHtml(player.name)} has <strong>${money.format(Math.max(player.balance, 0))}</strong> and needs <strong>${money.format(details.needed)}</strong>: raise <strong>${money.format(missing)}</strong> more.</p>`;
  const nothingLeft = !sells.length && !mortgages.length;
  $('#raise-content').innerHTML = `<div class="dialog-color raise-band"></div><div class="dialog-inner"><div class="dialog-head"><div><p class="kicker">NOT ENOUGH CASH</p><h2 id="raise-title">Raise cash first</h2></div><button class="dialog-close" type="button" data-close-dialog aria-label="Close">×</button></div>${status}${done ? '' : `${sellRows ? `<h3 class="raise-heading">Sell buildings back to the Bank (half price)</h3><ul class="raise-list">${sellRows}</ul>` : ''}${mortgageRows ? `<h3 class="raise-heading">Mortgage deeds</h3><ul class="raise-list">${mortgageRows}</ul>` : ''}${nothingLeft ? '<p class="muted">Nothing left to sell or mortgage.</p>' : ''}<div class="raise-footer"><p class="muted">Can’t raise enough? Declaring bankruptcy hands everything to whoever is owed.</p><button type="button" class="danger-button full" data-raise-bankrupt><span>Declare ${escapeHtml(player.name)} bankrupt…</span><span aria-hidden="true">→</span></button></div>`}${done ? '<button type="button" class="secondary-button full" data-close-dialog>Done</button>' : ''}</div>`;
  $$('[data-raise]', $('#raise-content')).forEach((button) => button.addEventListener('click', async () => {
    const action = button.dataset.raise === 'sell'
      ? { type: 'building', direction: 'sell', playerId: player.id, propertyId: button.dataset.property }
      : { type: 'mortgage', playerId: player.id, propertyId: button.dataset.property };
    if (await submitAction(action, button.dataset.raise === 'sell' ? 'Building sold.' : 'Deed mortgaged.')) openRaiseCash();
  }));
  $('[data-raise-bankrupt]', $('#raise-content'))?.addEventListener('click', () => {
    $('#raise-dialog').close();
    $$('dialog[open]').forEach((dialog) => dialog.close());
    switchView('pay');
    $('#bankrupt-player').value = player.id;
    renderCreditors();
    $('#bankruptcy').open = true;
    $('#bankruptcy').scrollIntoView({ block: 'center' });
  });
  if (!$('#raise-dialog').open) $('#raise-dialog').showModal();
}

async function undoLast() {
  if (!game.undo) return;
  if (!confirm(`Undo “${game.undo.label}”?`)) return;
  await submitAction({ type: 'undo' }, 'Last action undone.');
}

async function declareBankruptcy(event) {
  event.preventDefault();
  const debtor = playerById($('#bankrupt-player').value);
  const creditorId = $('#bankrupt-creditor').value;
  const creditorName = creditorId === 'bank' ? 'the Bank' : playerById(creditorId)?.name;
  if (!debtor || !confirm(`Declare ${debtor.name} bankrupt to ${creditorName}? Their cash and deeds will be handed over. You can undo this.`)) return;
  if (await submitAction({ type: 'bankrupt', playerId: debtor.id, creditorId }, `${debtor.name} is out of the game.`)) $('#bankruptcy').open = false;
}

// End the game at any time: the highest net worth wins by default, or the table picks a winner from the players still in.
function endGame() {
  const rows = activePlayers().map((player) => ({ player, worth: standingFor(player.id)?.total ?? player.balance }));
  const best = Math.max(...rows.map((row) => row.worth));
  const leaders = rows.filter((row) => row.worth === best).map((row) => row.player.name);
  const leaderText = leaders.length > 2 ? `${leaders.length}-way tie` : leaders.length > 1 ? `${leaders.join(' & ')} tie` : `${leaders[0]} wins`;
  const options = [
    `<label class="winner-option"><input type="radio" name="winner" value="" checked><span class="mini-token" aria-hidden="true">★</span><span><strong>Highest net worth</strong><small>${escapeHtml(leaderText)} · ${money.format(best)}</small></span></label>`,
    ...orderedPlayers().filter((player) => !player.bankrupt).map((player) => {
      const worth = standingFor(player.id)?.total ?? player.balance;
      return `<label class="winner-option" data-vars="--player-color=${escapeHtml(player.color)}"><input type="radio" name="winner" value="${player.id}"><span class="mini-token" aria-hidden="true">${TOKEN_LABELS[seatOf(player)]}</span><span><strong>${escapeHtml(player.name)}</strong><small>Net worth ${money.format(worth)}</small></span></label>`;
    })
  ].join('');
  $('#end-content').innerHTML = `<div class="dialog-color results-band"></div><div class="dialog-inner"><div class="dialog-head"><div><p class="kicker">FINISH THE GAME</p><h2 id="end-title">Who wins?</h2><p class="muted">End the game now, at any point. Pick the winner from the players still in, or let net worth decide.</p></div><button class="dialog-close" type="button" data-close-dialog aria-label="Close">×</button></div><form id="end-form" class="dialog-form"><fieldset class="winner-options"><legend class="sr-only">Winner</legend>${options}</fieldset><p class="fine-print">Play stops for everyone and the final standings open. Undo reopens the game.</p><button class="danger-button full" type="submit"><span id="end-submit-label"></span><span aria-hidden="true">→</span></button></form></div>`;
  applyStyleVars($('#end-content'));
  const label = () => {
    const id = $('input[name="winner"]:checked', $('#end-form'))?.value;
    $('#end-submit-label').textContent = id ? `End game · ${playerById(id).name} wins` : `End game · ${leaderText}`;
  };
  label();
  $('#end-form').addEventListener('change', label);
  $('#end-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const winnerId = $('input[name="winner"]:checked', $('#end-form'))?.value || undefined;
    if (await submitAction({ type: 'end-game', ...(winnerId ? { winnerId } : {}) }, 'Game over.')) $('#end-dialog').close();
  });
  if (!$('#end-dialog').open) $('#end-dialog').showModal();
}

// Play time comes from the server: first move to the last move before Finish game (not when the game was created or closed).
function playTimeText(time) {
  if (!time?.startedAt) return 'No moves played';
  const { minutes } = time;
  const length = minutes < 1 ? 'Under a minute' : minutes < 60 ? `${minutes} minute${minutes === 1 ? '' : 's'}` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
  const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `Played ${length.replace(/^Under/, 'under')} (${clock(time.startedAt)}–${clock(time.endedAt)})`;
}

function openResults() {
  const rows = game.standings || [];
  // Totals come from the server over the whole stored ledger, not just the entries this device holds.
  const rentBy = Object.fromEntries(Object.entries(game.activity?.players || {}).filter(([, entry]) => entry.rentCollected > 0).map(([id, entry]) => [id, entry.rentCollected]));
  const moves = game.activity?.moves ?? 0;
  const played = playTimeText(game.playTime);
  const table = rows.map((row) => `<tr class="${game.winnerIds.includes(row.playerId) ? 'winner-row' : ''}"><td>${row.bankrupt ? '—' : row.rank}</td><td>${escapeHtml(row.name)}${row.bankrupt ? ' <small>bankrupt</small>' : ''}</td><td>${money.format(row.cash)}</td><td>${money.format(row.property)}</td><td>${money.format(row.buildings)}</td><td><strong>${money.format(row.total)}</strong></td></tr>`).join('');
  const rentLeader = Object.entries(rentBy).sort((a, b) => b[1] - a[1])[0];
  $('#results-content').innerHTML = `<div class="dialog-color results-band"></div><div class="dialog-inner"><div class="dialog-head"><div><p class="kicker">FINAL STANDINGS</p><h2 id="results-title">${escapeHtml(winnerText())}</h2><p class="muted">${played} · ${moves} ${moves === 1 ? 'move' : 'moves'}${rentLeader ? ` · Top rent collector: ${escapeHtml(playerById(rentLeader[0])?.name || '')} (${money.format(rentLeader[1])})` : ''}</p></div><button class="dialog-close" type="button" data-close-dialog aria-label="Close">×</button></div><div class="table-scroll"><table class="results-table"><thead><tr><th>#</th><th>Player</th><th>Cash</th><th>Deeds</th><th>Buildings</th><th>Net worth</th></tr></thead><tbody>${table}</tbody></table></div><p class="fine-print">Net worth = cash + deeds at list price (mortgaged deeds minus what it costs to unmortgage them) + houses and hotels at what the Bank pays back (half price).</p><a class="secondary-button full results-export" href="${apiBase()}/activity.csv" download>⇩ Download activity (CSV)</a>${game.undo ? '<button type="button" class="secondary-button full" data-undo-results>↶ Undo game over and keep playing</button>' : ''}</div>`;
  $('[data-undo-results]', $('#results-content'))?.addEventListener('click', async () => {
    if (await submitAction({ type: 'undo' }, 'Back in play.')) $('#results-dialog').close();
  });
  if (!$('#results-dialog').open) $('#results-dialog').showModal();
}

const playerLink = () => `${location.origin}/game/${game.id}`;
const spectatorLink = () => `${location.origin}/watch/${isSpectator() ? spectatorToken : game.viewToken}`;

function showQr(mode = isSpectator() ? 'watch' : $('input[name="qr-mode"]:checked').value) {
  const watch = mode === 'watch';
  const url = watch ? spectatorLink() : playerLink();
  $('#qr-modes').hidden = isSpectator();
  $(`input[name="qr-mode"][value="${watch ? 'watch' : 'play'}"]`).checked = true;
  try {
    $('#qr-code').innerHTML = qrToSvg(encodeQr(url, { ecl: 'M' }), { label: `QR code for ${url}` });
  } catch {
    $('#qr-code').textContent = 'This link is too long for a QR code.';
  }
  $('#qr-help').textContent = watch
    ? 'Spectators see balances, deeds and activity live, but can’t change anything.'
    : 'Anyone with this link can make payments and manage deeds for every player.';
  $('#qr-url').textContent = url;
  if (!$('#qr-dialog').open) $('#qr-dialog').showModal();
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    prompt('Copy this link:', text);
  }
}

function renderSoundToggle() {
  const button = $('#sound-toggle');
  button.setAttribute('aria-checked', String(feedback.enabled));
  button.innerHTML = `<span aria-hidden="true">${feedback.enabled ? '🔊' : '🔇'}</span>Sound &amp; vibration<small>${feedback.enabled ? 'On' : 'Off'}</small>`;
}

// Header overflow menu (Copy link, Sound, Finish game).
function setMenu(open, { focus = false } = {}) {
  const menu = $('#game-menu');
  menu.hidden = !open;
  $('#menu-button').setAttribute('aria-expanded', String(open));
  if (open && focus) $('[role^="menuitem"]:not([hidden])', menu)?.focus();
}

function bindMenu() {
  const button = $('#menu-button');
  const menu = $('#game-menu');
  button.addEventListener('click', () => setMenu(menu.hidden, { focus: true }));
  menu.addEventListener('click', (event) => { if (event.target.closest('[role^="menuitem"]')) setMenu(false); });
  menu.addEventListener('keydown', (event) => {
    const items = $$('[role^="menuitem"]:not([hidden])', menu);
    const index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) { setMenu(false); button.focus(); }
  });
  document.addEventListener('click', (event) => {
    if (!menu.hidden && !event.target.closest('.menu')) setMenu(false);
  });
}

async function pay(event) {
  event.preventDefault();
  const fromId = $('#payment-from').value;
  const toId = $('#payment-to').value;
  const note = $('#payment-note').value.trim();
  const category = /tax/i.test(note) ? 'tax' : toId === 'parking' ? 'fee' : 'transfer';
  const ok = await submitAction({ type:'transfer', fromId, toId, amount:Number($('#payment-amount').value), note, category }, 'Funds transferred.');
  if (ok) { $('#payment-amount').value = ''; $('#payment-note').value = ''; }
}

async function trade(event) {
  event.preventDefault();
  const ok = await submitAction({
    type:'trade', firstPlayerId:$('#trade-first').value, secondPlayerId:$('#trade-second').value,
    firstCash:Number($('#trade-first-cash').value || 0), secondCash:Number($('#trade-second-cash').value || 0),
    firstPropertyIds:$$('input[name="first-deed"]:checked').map((input) => input.value),
    secondPropertyIds:$$('input[name="second-deed"]:checked').map((input) => input.value)
  }, 'Trade completed.');
  if (ok) { $('#trade-first-cash').value = 0; $('#trade-second-cash').value = 0; }
}

function rentRows(property) {
  if (property.kind !== 'street') return '';
  const labels = ['Site only','With 1 house','With 2 houses','With 3 houses','With 4 houses','With hotel'];
  return `<table class="rent-table"><tbody>${property.rent.map((rent, index) => `<tr><td>${labels[index]}</td><td>${money.format(rent)}</td></tr>`).join('')}</tbody></table>`;
}

function openDeed(propertyId) {
  const property = propertyById(propertyId);
  const deed = game.deeds[propertyId];
  const owner = deedOwner(propertyId);
  const status = deed.mortgaged ? 'Mortgaged' : owner ? `Owned by ${escapeHtml(owner.name)}` : 'Available from Bank';
  const buildingText = deed.buildings === 5 ? 'Hotel' : `${deed.buildings} house${deed.buildings === 1 ? '' : 's'}`;
  let controls = '';
  if (!owner) {
    const auctions = rules().auctions !== false;
    const priceField = auctions
      ? `<label class="field"><span>Price / winning bid</span><input id="deed-price" type="number" min="1" step="1" value="${property.price}" required></label><label><input id="deed-auction" type="checkbox"> Bought at auction</label>`
      : `<label class="field"><span>List price <small>auctions are off</small></span><input id="deed-price" type="number" value="${property.price}" readonly></label>`;
    controls = `<form class="dialog-form" id="buy-deed-form"><label class="field"><span>Buyer</span><select id="deed-buyer">${optionList({ selected: mePlayer()?.id })}</select></label>${priceField}<button type="submit">ACQUIRE DEED</button></form>`;
  } else {
    const payers = orderedPlayers(activePlayers()).filter((player) => player.id !== owner.id).map((player) => `<option value="${player.id}" ${player.id === mePlayer()?.id ? 'selected' : ''}>${escapeHtml(player.name)}</option>`).join('');
    const jailed = rules().noRentInJail && owner.inJail;
    const rentControl = deed.mortgaged ? '' : jailed ? `<p class="rule-note">No rent while ${escapeHtml(owner.name)} is in jail.</p>` : `<form class="dialog-form" id="rent-form"><label class="field"><span>Who pays rent?</span><select id="rent-payer">${payers}</select></label>${property.kind === 'utility' ? '<label class="field"><span>Dice total</span><input id="rent-dice" type="number" min="2" max="12" value="7" required></label>' : ''}<button type="submit">PAY RENT TO ${escapeHtml(owner.name.toUpperCase())}</button></form>`;
    const mortgageButton = deed.mortgaged ? `<button class="secondary" data-deed-action="unmortgage">Unmortgage ${money.format(unmortgageCost(property))}</button>` : `<button class="secondary" data-deed-action="mortgage">Mortgage +${money.format(property.mortgage)}</button>`;
    const buildingButtons = property.kind === 'street' && !deed.mortgaged ? `<button class="secondary" data-deed-action="buy-building">＋ ${deed.buildings === 4 ? 'Hotel' : 'House'} ${money.format(property.houseCost)}</button>${deed.buildings ? `<button class="danger" data-deed-action="sell-building">− Sell building ${money.format(Math.floor(property.houseCost / 2))}</button>` : ''}` : '';
    controls = `${rentControl}<div class="dialog-actions">${mortgageButton}${buildingButtons}</div>`;
  }
  if (isSpectator()) controls = '<p class="rule-note">View only: spectators can’t change deeds.</p>';
  $('#deed-dialog-content').innerHTML = `<div class="dialog-color" data-vars="--deed-color=${GROUP_COLORS[property.group]}"></div><div class="dialog-inner"><div class="dialog-head"><div><p class="kicker">TITLE DEED</p><h2>${escapeHtml(property.name)}</h2><p class="muted">${status}${property.kind === 'street' && owner ? ` · ${buildingText}` : ''}</p></div><button class="dialog-close" aria-label="Close">×</button></div><div class="dialog-facts"><div><small>Price</small><strong>${money.format(property.price)}</strong></div><div><small>Mortgage</small><strong>${money.format(property.mortgage)}</strong></div><div><small>${property.kind === 'street' ? 'House cost' : 'Type'}</small><strong>${property.kind === 'street' ? money.format(property.houseCost) : property.kind}</strong></div></div>${rentRows(property)}${controls}</div>`;
  applyStyleVars($('#deed-dialog-content'));
  $('.dialog-close').addEventListener('click', () => $('#deed-dialog').close());
  $('#buy-deed-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (await submitAction({ type:'buy', playerId:$('#deed-buyer').value, propertyId, amount:Number($('#deed-price').value), auction:$('#deed-auction')?.checked || false }, 'Deed acquired.')) $('#deed-dialog').close();
  });
  $('#rent-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (await submitAction({ type:'rent', payerId:$('#rent-payer').value, propertyId, diceTotal:$('#rent-dice') ? Number($('#rent-dice').value) : undefined }, `Rent paid to ${owner.name}.`)) $('#deed-dialog').close();
  });
  $$('[data-deed-action]').forEach((button) => button.addEventListener('click', async () => {
    const types = { mortgage:{type:'mortgage'}, unmortgage:{type:'unmortgage'}, 'buy-building':{type:'building',direction:'buy'}, 'sell-building':{type:'building',direction:'sell'} };
    const action = types[button.dataset.deedAction];
    if (await submitAction({ ...action, playerId:owner.id, propertyId }, 'Deed updated.')) $('#deed-dialog').close();
  }));
  $('#deed-dialog').showModal();
}

function shareGame() {
  return isSpectator() ? copyText(spectatorLink(), 'Spectator link copied.') : copyText(playerLink(), 'Game link copied.');
}

function bindEvents() {
  addPlayerInput(); addPlayerInput();
  $('#add-player').addEventListener('click', () => addPlayerInput());
  $('#setup-form').addEventListener('submit', createGame);
  $('#payment-form').addEventListener('submit', pay);
  $('#trade-form').addEventListener('submit', trade);
  $('#swap-payment').addEventListener('click', () => {
    const from = $('#payment-from').value;
    $('#payment-from').value = $('#payment-to').value;
    $('#payment-to').value = from;
  });
  $$('.preset-row button').forEach((button) => button.addEventListener('click', () => {
    $('#payment-amount').value = button.dataset.preset;
    $('#payment-note').value = button.dataset.note;
    if (/GO$/.test(button.dataset.note)) {
      $('#payment-from').value = 'bank';
      if (['bank', 'parking'].includes($('#payment-to').value)) $('#payment-to').value = game.players[0].id;
    } else {
      if ($('#payment-from').value === 'bank') $('#payment-from').value = game.players[0].id;
      // Taxes and fees feed the Free Parking pot when that house rule is on.
      $('#payment-to').value = rules().freeParkingJackpot ? 'parking' : 'bank';
    }
  }));
  $$('.house-rules input').forEach((input) => input.addEventListener('input', updateSetupRules));
  $$('.view-tabs button').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  $$('#mobile-nav button').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.mobileView)));
  $$('[data-open-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.openView)));
  $('#deed-search').addEventListener('input', renderDeeds);
  $('#deed-filter').addEventListener('change', renderDeeds);
  $('#trade-first').addEventListener('change', renderTrade);
  $('#trade-second').addEventListener('change', renderTrade);
  $('#share-game').addEventListener('click', shareGame);
  // Invite always opens on the player link; spectators only ever get the spectator link.
  $('#show-qr').addEventListener('click', () => showQr(isSpectator() ? 'watch' : 'play'));
  $$('input[name="qr-mode"]').forEach((input) => input.addEventListener('change', () => showQr(input.value)));
  $('#qr-copy').addEventListener('click', () => copyText($('#qr-url').textContent, 'Link copied.'));
  $('#copy-watch').addEventListener('click', () => copyText(spectatorLink(), 'Spectator link copied.'));
  $('#switch-player').addEventListener('click', openIdentity);
  $('#me-switch').addEventListener('click', openIdentity);
  // Closing the picker without choosing means "banker" so it doesn't reappear every visit.
  $('#identity-dialog').addEventListener('close', () => {
    if (!me && game && !isSpectator()) {
      saveIdentity('banker');
      renderGame();
    }
  });
  $('#sound-toggle').addEventListener('click', () => {
    feedback.set(!feedback.enabled);
    renderSoundToggle();
    feedback.play('success');
  });
  renderSoundToggle();
  $('#end-game').addEventListener('click', endGame);
  $('#bankrupt-creditor').addEventListener('change', renderBankruptcyPreview);
  bindMenu();
  $('#view-results').addEventListener('click', openResults);
  $$('[data-undo]').forEach((button) => button.addEventListener('click', undoLast));
  $('#bankrupt-form').addEventListener('submit', declareBankruptcy);
  $('#bankrupt-player').addEventListener('change', renderCreditors);
  const refilter = () => { ledgerLimit = LEDGER_STEP; renderLedger(); };
  $('#ledger-filter').addEventListener('change', refilter);
  $('#ledger-search').addEventListener('input', refilter);
  $('#ledger-type').addEventListener('change', () => { ledgerType = $('#ledger-type').value; refilter(); });
  $('#ledger-search-toggle').addEventListener('click', () => {
    const open = !(ledgerSearchOpen || $('#ledger-search').value);
    ledgerSearchOpen = open;
    if (!open) $('#ledger-search').value = '';
    refilter();
    if (open) $('#ledger-search').focus();
  });
  $('#ledger-more').addEventListener('click', loadEarlier);
  $('#ledger-undone').addEventListener('click', () => { ledgerShowUndone = !ledgerShowUndone; renderLedger(); });
  $('#player-dialog').addEventListener('close', () => { sheet = null; });
  ['#qr-dialog', '#results-dialog', '#end-dialog', '#identity-dialog', '#raise-dialog', '#player-dialog'].forEach((selector) => $(selector).addEventListener('click', (event) => {
    if (event.target === $(selector) || event.target.closest('[data-close-dialog]')) $(selector).close();
  }));
  $('#deed-dialog').addEventListener('click', (event) => { if (event.target === $('#deed-dialog')) $('#deed-dialog').close(); });
  addEventListener('popstate', () => loadGame());
}

bindEvents();
loadGame();
