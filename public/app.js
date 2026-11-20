import { encodeQr, qrToSvg } from './qr.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const GROUP_COLORS = { brown:'#8b5a3c',lightblue:'#9ad8e8',pink:'#d65aa3',orange:'#ef8b35',red:'#d94345',yellow:'#f0ca3e',green:'#31966f',darkblue:'#3158a6',railroad:'#34414a',utility:'#87939a' };
const TOKEN_LABELS = ['M','R','T','♟'];
let game = null;
let activeView = 'pay';
let pollTimer;
let shownResultsFor = null;

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
const playerById = (id) => game?.players.find((player) => player.id === id);
const activePlayers = () => game.players.filter((player) => !player.bankrupt);
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
  if (container.children.length >= 4) return;
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
    $('.token', field).style.background = ['#d9574f','#3c8fd1','#d6a53c','#45a477'][index];
    const input = $('input', field);
    input.id = `player-${index}`;
    input.placeholder = `Player ${index + 1}`;
    $('label', field).htmlFor = input.id;
    $('.remove-player', field).ariaLabel = `Remove player ${index + 1}`;
  });
  $('#add-player').hidden = $('#player-inputs').children.length >= 4;
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
  if (!id) return showSetup();
  try {
    const latest = await api(`/api/games/${id}`);
    if (!game || latest.revision !== game.revision) {
      const remoteChange = game && latest.revision > game.revision;
      game = latest;
      showGame();
      if (remoteChange) feedback.play('remote');
    }
  } catch (error) {
    if (!silent) {
      showSetup();
      $('#setup-error').textContent = error.message;
      history.replaceState({}, '', '/');
    }
  }
}

function showSetup() {
  game = null;
  $('#setup-screen').hidden = false;
  $('#game-screen').hidden = true;
  $('#session-badge').hidden = true;
  $('#mobile-nav').hidden = true;
  clearInterval(pollTimer);
}

function showGame() {
  $('#setup-screen').hidden = true;
  $('#game-screen').hidden = false;
  $('#session-badge').hidden = false;
  $('#mobile-nav').hidden = false;
  renderGame();
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (!document.hidden) loadGame(true); }, 3500);
}

function renderGame() {
  renderRules();
  renderStatus();
  renderPlayers();
  renderSelects();
  renderDeeds();
  renderTrade();
  renderLedger();
  renderUndo();
  switchView(activeView);
  const ended = game.status === 'ended';
  $$('#game-screen .console-panel button[type="submit"]').forEach((button) => { button.disabled = ended; });
  if (ended) $$('#parking-form button, .jail-toggle').forEach((button) => { button.disabled = true; });
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

function renderPlayers() {
  $('#total-cash').textContent = `${game.players.length} at the table`;
  const jailRule = rules().noRentInJail;
  const cards = game.players.map((player, index) => {
    const deeds = Object.values(game.deeds).filter((deed) => deed.ownerId === player.id).length;
    const worth = standingFor(player.id)?.total ?? player.balance;
    const winner = game.status === 'ended' && game.winnerIds.includes(player.id);
    const status = player.bankrupt ? 'Bankrupt' : winner ? 'Winner' : player.inJail && jailRule ? 'In jail · no rent' : player.balance < 0 ? 'Needs attention' : 'Ready to play';
    const meta = player.bankrupt ? 'Out of the game' : `${deeds} deed${deeds === 1 ? '' : 's'} · Net worth ${money.format(worth)}`;
    if (player.bankrupt) {
      return `<article class="player-card bankrupt" data-vars="--player-color=${escapeHtml(player.color)}"><div class="player-card-head"><span class="mini-token">${TOKEN_LABELS[index]}</span><strong>${escapeHtml(player.name)}</strong></div><div class="balance">Bankrupt</div><div class="player-meta">${meta}</div></article>`;
    }
    const jailButton = jailRule && game.status !== 'ended' ? `<button type="button" class="jail-toggle" data-jail-player="${player.id}" aria-pressed="${player.inJail ? 'true' : 'false'}">${player.inJail ? 'Release from jail' : 'Send to jail'}</button>` : '';
    return `<article class="player-card ${player.inJail && jailRule ? 'in-jail' : ''} ${winner ? 'winner' : ''}" data-vars="--player-color=${escapeHtml(player.color)}"><div class="player-card-head"><span class="mini-token">${TOKEN_LABELS[index]}</span><strong>${escapeHtml(player.name)}</strong></div><div class="balance">${money.format(player.balance)}</div><div class="player-meta">${meta}</div><div class="player-status">${status}</div>${jailButton}</article>`;
  });
  if (rules().freeParkingJackpot) {
    cards.push(`<article class="player-card parking-card" data-vars="--player-color=#d6b661"><div class="player-card-head"><span class="mini-token">P</span><strong>Free Parking</strong></div><div class="balance">${money.format(game.freeParking || 0)}</div><form class="parking-form" id="parking-form"><label class="sr-only" for="parking-winner">Who landed on Free Parking?</label><select id="parking-winner">${optionList()}</select><button type="submit" ${game.freeParking ? '' : 'disabled'}>Collect</button></form></article>`);
  }
  $('#player-cards').innerHTML = cards.join('');
  applyStyleVars($('#player-cards'));
  $$('[data-jail-player]').forEach((button) => button.addEventListener('click', () => {
    const target = playerById(button.dataset.jailPlayer);
    submitAction({ type: 'jail', playerId: target.id, inJail: !target.inJail }, target.inJail ? `${target.name} is out of jail.` : `${target.name} went to jail.`);
  }));
  $('#parking-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const winner = playerById($('#parking-winner').value);
    submitAction({ type: 'collect-parking', playerId: winner.id }, `${winner.name} collected Free Parking.`);
  });
}

function optionList({ includeBank = false, includeParking = false, selected = '' } = {}) {
  const values = [
    ...(includeBank ? [{ id: 'bank', name: 'The Bank' }] : []),
    ...(includeParking && rules().freeParkingJackpot ? [{ id: 'parking', name: 'Free Parking pot' }] : []),
    ...activePlayers()
  ];
  return values.map((item) => `<option value="${item.id}" ${item.id === selected ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
}

function renderSelects() {
  const from = $('#payment-from').value || game.players[0]?.id;
  const to = $('#payment-to').value || game.players[1]?.id;
  $('#payment-from').innerHTML = optionList({ includeBank: true, selected: from });
  $('#payment-to').innerHTML = optionList({ includeBank: true, includeParking: true, selected: to });
  if ($('#payment-from').value === $('#payment-to').value && game.players[1]) $('#payment-to').value = game.players[1].id;

  const active = activePlayers();
  const debtor = active.some((player) => player.id === $('#bankrupt-player').value) ? $('#bankrupt-player').value : active[0]?.id;
  $('#bankrupt-player').innerHTML = optionList({ selected: debtor });
  renderCreditors();

  const first = $('#trade-first').value || game.players[0]?.id;
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
}

function renderDeeds() {
  const query = $('#deed-search').value.toLowerCase();
  const filter = $('#deed-filter').value;
  const filtered = game.properties.filter((property) => {
    const deed = game.deeds[property.id];
    const matchesQuery = property.name.toLowerCase().includes(query);
    const matchesFilter = filter === 'all' || (filter === 'available' && !deed.ownerId) || (filter === 'owned' && deed.ownerId) || (filter === 'mortgaged' && deed.mortgaged);
    return matchesQuery && matchesFilter;
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

function ledgerHtml(items) {
  if (!items.length) return '<div class="empty-state">No transactions yet.</div>';
  return items.map((item) => `<article class="ledger-item ${item.undone ? 'undone' : ''}"><span class="ledger-icon">${transactionIcon(item.type)}</span><span class="ledger-copy"><strong>${escapeHtml(item.label)}</strong><small>${item.undone ? 'Undone · ' : ''}${escapeHtml(item.detail || item.type)}</small></span><span class="ledger-amount">${item.amount != null ? money.format(item.amount) : '—'}<time datetime="${item.at}">${timeAgo(item.at)}</time></span></article>`).join('');
}

function renderLedger() {
  $('#mini-ledger').innerHTML = ledgerHtml(game.transactions.slice(0, 6));
  $('#full-ledger').innerHTML = ledgerHtml(game.transactions);
}

function switchView(view) {
  activeView = view;
  $$('.console-view').forEach((panel) => panel.hidden = panel.id !== `${view}-view`);
  $$('.view-tabs button').forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $$('#mobile-nav button').forEach((button) => button.classList.toggle('active', button.dataset.mobileView === view));
  if (innerWidth < 761) $('.console-panel')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

async function submitAction(action, successMessage) {
  try {
    game = await api(`/api/games/${game.id}/actions`, { method: 'POST', body: { ...action, expectedRevision: game.revision } });
    renderGame();
    toast(successMessage);
    feedback.play('success');
    return true;
  } catch (error) {
    if (error.status === 409) await loadGame(true);
    toast(error.message, 'error');
    feedback.play('error');
    return false;
  }
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
  if (await submitAction({ type: 'bankrupt', playerId: debtor.id, creditorId }, `${debtor.name} is out of the game.`)) $('.bankruptcy').open = false;
}

async function endGame() {
  if (!confirm('End the game now? The player with the highest net worth wins. You can undo this.')) return;
  await submitAction({ type: 'end-game' }, 'Game over.');
}

function openResults() {
  const rows = game.standings || [];
  const rentBy = {};
  game.transactions.filter((item) => item.type === 'rent' && !item.undone).forEach((item) => { rentBy[item.toId] = (rentBy[item.toId] || 0) + item.amount; });
  const minutes = Math.max(1, Math.round((new Date(game.endedAt || Date.now()) - new Date(game.createdAt)) / 60000));
  const table = rows.map((row) => `<tr class="${game.winnerIds.includes(row.playerId) ? 'winner-row' : ''}"><td>${row.bankrupt ? '—' : row.rank}</td><td>${escapeHtml(row.name)}${row.bankrupt ? ' <small>bankrupt</small>' : ''}</td><td>${money.format(row.cash)}</td><td>${money.format(row.property)}</td><td>${money.format(row.buildings)}</td><td><strong>${money.format(row.total)}</strong></td></tr>`).join('');
  const rentLeader = Object.entries(rentBy).sort((a, b) => b[1] - a[1])[0];
  $('#results-content').innerHTML = `<div class="dialog-color results-band"></div><div class="dialog-inner"><div class="dialog-head"><div><p class="kicker">FINAL STANDINGS</p><h2 id="results-title">${escapeHtml(winnerText())}</h2><p class="muted">${minutes} minute${minutes === 1 ? '' : 's'} · ${game.transactions.length} transactions${rentLeader ? ` · Top rent collector: ${escapeHtml(playerById(rentLeader[0])?.name || '')} (${money.format(rentLeader[1])})` : ''}</p></div><button class="dialog-close" type="button" data-close-dialog aria-label="Close">×</button></div><div class="table-scroll"><table class="results-table"><thead><tr><th>#</th><th>Player</th><th>Cash</th><th>Deeds</th><th>Buildings</th><th>Net worth</th></tr></thead><tbody>${table}</tbody></table></div><p class="fine-print">Net worth = cash + deeds at list price (mortgaged deeds at mortgage value) + buildings at cost.</p>${game.undo ? '<button type="button" class="secondary-button full" data-undo-results>↶ Undo game over and keep playing</button>' : ''}</div>`;
  $('[data-undo-results]', $('#results-content'))?.addEventListener('click', async () => {
    if (await submitAction({ type: 'undo' }, 'Back in play.')) $('#results-dialog').close();
  });
  if (!$('#results-dialog').open) $('#results-dialog').showModal();
}

function showQr() {
  const url = location.href;
  try {
    $('#qr-code').innerHTML = qrToSvg(encodeQr(url, { ecl: 'M' }), { label: `QR code for ${url}` });
  } catch {
    $('#qr-code').textContent = 'This link is too long for a QR code.';
  }
  $('#qr-url').textContent = url;
  $('#qr-dialog').showModal();
}

function renderSoundToggle() {
  const button = $('#sound-toggle');
  button.setAttribute('aria-pressed', String(feedback.enabled));
  button.innerHTML = `${feedback.enabled ? '🔊' : '🔇'} <span>${feedback.enabled ? 'Sound on' : 'Sound off'}</span>`;
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
    controls = `<form class="dialog-form" id="buy-deed-form"><label class="field"><span>Buyer</span><select id="deed-buyer">${optionList()}</select></label>${priceField}<button type="submit">ACQUIRE DEED</button></form>`;
  } else {
    const payers = game.players.filter((player) => player.id !== owner.id).map((player) => `<option value="${player.id}">${escapeHtml(player.name)}</option>`).join('');
    const jailed = rules().noRentInJail && owner.inJail;
    const rentControl = deed.mortgaged ? '' : jailed ? `<p class="rule-note">No rent while ${escapeHtml(owner.name)} is in jail.</p>` : `<form class="dialog-form" id="rent-form"><label class="field"><span>Collect rent from</span><select id="rent-payer">${payers}</select></label>${property.kind === 'utility' ? '<label class="field"><span>Dice total</span><input id="rent-dice" type="number" min="2" max="12" value="7" required></label>' : ''}<button type="submit">COLLECT RENT</button></form>`;
    const mortgageButton = deed.mortgaged ? `<button class="secondary" data-deed-action="unmortgage">Unmortgage ${money.format(unmortgageCost(property))}</button>` : `<button class="secondary" data-deed-action="mortgage">Mortgage +${money.format(property.mortgage)}</button>`;
    const buildingButtons = property.kind === 'street' && !deed.mortgaged ? `<button class="secondary" data-deed-action="buy-building">＋ ${deed.buildings === 4 ? 'Hotel' : 'House'} ${money.format(property.houseCost)}</button>${deed.buildings ? `<button class="danger" data-deed-action="sell-building">− Sell building ${money.format(Math.floor(property.houseCost / 2))}</button>` : ''}` : '';
    controls = `${rentControl}<div class="dialog-actions">${mortgageButton}${buildingButtons}</div>`;
  }
  $('#deed-dialog-content').innerHTML = `<div class="dialog-color" data-vars="--deed-color=${GROUP_COLORS[property.group]}"></div><div class="dialog-inner"><div class="dialog-head"><div><p class="kicker">TITLE DEED</p><h2>${escapeHtml(property.name)}</h2><p class="muted">${status}${property.kind === 'street' && owner ? ` · ${buildingText}` : ''}</p></div><button class="dialog-close" aria-label="Close">×</button></div><div class="dialog-facts"><div><small>Price</small><strong>${money.format(property.price)}</strong></div><div><small>Mortgage</small><strong>${money.format(property.mortgage)}</strong></div><div><small>${property.kind === 'street' ? 'House cost' : 'Type'}</small><strong>${property.kind === 'street' ? money.format(property.houseCost) : property.kind}</strong></div></div>${rentRows(property)}${controls}</div>`;
  applyStyleVars($('#deed-dialog-content'));
  $('.dialog-close').addEventListener('click', () => $('#deed-dialog').close());
  $('#buy-deed-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (await submitAction({ type:'buy', playerId:$('#deed-buyer').value, propertyId, amount:Number($('#deed-price').value), auction:$('#deed-auction')?.checked || false }, 'Deed acquired.')) $('#deed-dialog').close();
  });
  $('#rent-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (await submitAction({ type:'rent', payerId:$('#rent-payer').value, propertyId, diceTotal:$('#rent-dice') ? Number($('#rent-dice').value) : undefined }, 'Rent collected.')) $('#deed-dialog').close();
  });
  $$('[data-deed-action]').forEach((button) => button.addEventListener('click', async () => {
    const types = { mortgage:{type:'mortgage'}, unmortgage:{type:'unmortgage'}, 'buy-building':{type:'building',direction:'buy'}, 'sell-building':{type:'building',direction:'sell'} };
    const action = types[button.dataset.deedAction];
    if (await submitAction({ ...action, playerId:owner.id, propertyId }, 'Deed updated.')) $('#deed-dialog').close();
  }));
  $('#deed-dialog').showModal();
}

async function shareGame() {
  const url = location.href;
  try {
    await navigator.clipboard.writeText(url);
    toast('Game link copied.');
  } catch {
    prompt('Copy this game link:', url);
  }
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
  $('#show-qr').addEventListener('click', showQr);
  $('#qr-copy').addEventListener('click', shareGame);
  $('#sound-toggle').addEventListener('click', () => {
    feedback.set(!feedback.enabled);
    renderSoundToggle();
    feedback.play('success');
  });
  renderSoundToggle();
  $('#end-game').addEventListener('click', endGame);
  $('#view-results').addEventListener('click', openResults);
  $$('[data-undo]').forEach((button) => button.addEventListener('click', undoLast));
  $('#bankrupt-form').addEventListener('submit', declareBankruptcy);
  $('#bankrupt-player').addEventListener('change', renderCreditors);
  ['#qr-dialog', '#results-dialog'].forEach((selector) => $(selector).addEventListener('click', (event) => {
    if (event.target === $(selector) || event.target.closest('[data-close-dialog]')) $(selector).close();
  }));
  $('#deed-dialog').addEventListener('click', (event) => { if (event.target === $('#deed-dialog')) $('#deed-dialog').close(); });
  addEventListener('popstate', () => loadGame());
}

bindEvents();
loadGame();
