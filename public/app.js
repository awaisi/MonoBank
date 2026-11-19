const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const GROUP_COLORS = { brown:'#8b5a3c',lightblue:'#9ad8e8',pink:'#d65aa3',orange:'#ef8b35',red:'#d94345',yellow:'#f0ca3e',green:'#31966f',darkblue:'#3158a6',railroad:'#34414a',utility:'#87939a' };
const TOKEN_LABELS = ['M','R','T','♟'];
let game = null;
let activeView = 'pay';
let pollTimer;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[character]);
const gameIdFromPath = () => location.pathname.match(/^\/game\/([a-f0-9]{16})\/?$/)?.[1];
const playerById = (id) => game?.players.find((player) => player.id === id);
const propertyById = (id) => game?.properties.find((property) => property.id === id);
const deedOwner = (propertyId) => playerById(game?.deeds[propertyId]?.ownerId);

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
  field.innerHTML = `<span class="token" style="background:${['#d9574f','#3c8fd1','#d6a53c','#45a477'][index]}">${TOKEN_LABELS[index]}</span><label class="sr-only" for="player-${index}">Player ${index + 1} name</label><input id="player-${index}" maxlength="24" autocomplete="off" placeholder="Player ${index + 1}" value="${escapeHtml(name)}" required><button class="remove-player" type="button" aria-label="Remove player ${index + 1}">×</button>`;
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
    const created = await api('/api/games', { method: 'POST', body: { players, startingBalance: Number($('#starting-balance').value) } });
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
      game = latest;
      showGame();
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
  renderPlayers();
  renderSelects();
  renderDeeds();
  renderTrade();
  renderLedger();
  switchView(activeView);
}

function renderPlayers() {
  $('#total-cash').textContent = `${game.players.length} at the table`;
  $('#player-cards').innerHTML = game.players.map((player, index) => {
    const deeds = Object.values(game.deeds).filter((deed) => deed.ownerId === player.id).length;
    return `<article class="player-card" style="--player-color:${player.color}"><div class="player-card-head"><span class="mini-token">${TOKEN_LABELS[index]}</span><strong>${escapeHtml(player.name)}</strong></div><div class="balance">${money.format(player.balance)}</div><div class="player-meta">${deeds} deed${deeds === 1 ? '' : 's'} · ${player.balance < 0 ? 'Needs attention' : 'Ready to play'}</div></article>`;
  }).join('');
}

function optionList({ includeBank = false, selected = '' } = {}) {
  const values = includeBank ? [{ id: 'bank', name: 'The Bank' }, ...game.players] : game.players;
  return values.map((item) => `<option value="${item.id}" ${item.id === selected ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
}

function renderSelects() {
  const from = $('#payment-from').value || game.players[0]?.id;
  const to = $('#payment-to').value || game.players[1]?.id;
  $('#payment-from').innerHTML = optionList({ includeBank: true, selected: from });
  $('#payment-to').innerHTML = optionList({ includeBank: true, selected: to });
  if ($('#payment-from').value === $('#payment-to').value && game.players[1]) $('#payment-to').value = game.players[1].id;

  const first = $('#trade-first').value || game.players[0]?.id;
  const second = $('#trade-second').value || game.players[1]?.id;
  $('#trade-first').innerHTML = optionList({ selected: first });
  $('#trade-second').innerHTML = optionList({ selected: second });
  if ($('#trade-first').value === $('#trade-second').value && game.players[1]) $('#trade-second').value = game.players[1].id;
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
    return `<button class="deed-card ${deed.mortgaged ? 'mortgaged' : ''}" data-property-id="${property.id}" style="--deed-color:${GROUP_COLORS[property.group]};--owner-color:${owner?.color || '#64716b'}"><span class="deed-color"></span><span class="deed-body"><strong>${escapeHtml(property.name)}</strong><small>${property.kind === 'street' ? escapeHtml(property.group.replace('lightblue','Light blue').replace('darkblue','Dark blue')) : property.kind}${buildings ? ` · ${buildings}` : ''}${deed.mortgaged ? ' · Mortgaged' : ''}</small><span class="deed-status"><b>${money.format(property.price)}</b><small class="owner-chip">${owner ? escapeHtml(owner.name) : 'BANK'}</small></span></span></button>`;
  }).join('') || '<div class="empty-state">No deeds match this filter.</div>';
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
  return ({ system:'M', transfer:'↔', rent:'R', purchase:'⌂', auction:'⌂', mortgage:'$', unmortgage:'$', building:'▰', trade:'⇄', tax:'$' })[type] || '$';
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
  return items.map((item) => `<article class="ledger-item"><span class="ledger-icon">${transactionIcon(item.type)}</span><span class="ledger-copy"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail || item.type)}</small></span><span class="ledger-amount">${item.amount != null ? money.format(item.amount) : '—'}<time datetime="${item.at}">${timeAgo(item.at)}</time></span></article>`).join('');
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
    return true;
  } catch (error) {
    if (error.status === 409) await loadGame(true);
    toast(error.message, 'error');
    return false;
  }
}

async function pay(event) {
  event.preventDefault();
  const fromId = $('#payment-from').value;
  const toId = $('#payment-to').value;
  const note = $('#payment-note').value.trim();
  const ok = await submitAction({ type:'transfer', fromId, toId, amount:Number($('#payment-amount').value), note, category: /tax/i.test(note) ? 'tax' : 'transfer' }, 'Funds transferred.');
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
    controls = `<form class="dialog-form" id="buy-deed-form"><label class="field"><span>Buyer</span><select id="deed-buyer">${optionList()}</select></label><label class="field"><span>Price / winning bid</span><input id="deed-price" type="number" min="1" step="1" value="${property.price}" required></label><label><input id="deed-auction" type="checkbox"> Bought at auction</label><button type="submit">ACQUIRE DEED</button></form>`;
  } else {
    const payers = game.players.filter((player) => player.id !== owner.id).map((player) => `<option value="${player.id}">${escapeHtml(player.name)}</option>`).join('');
    const rentControl = deed.mortgaged ? '' : `<form class="dialog-form" id="rent-form"><label class="field"><span>Collect rent from</span><select id="rent-payer">${payers}</select></label>${property.kind === 'utility' ? '<label class="field"><span>Dice total</span><input id="rent-dice" type="number" min="2" max="12" value="7" required></label>' : ''}<button type="submit">COLLECT RENT</button></form>`;
    const mortgageButton = deed.mortgaged ? `<button class="secondary" data-deed-action="unmortgage">Unmortgage ${money.format(Math.round(property.mortgage * 1.1))}</button>` : `<button class="secondary" data-deed-action="mortgage">Mortgage +${money.format(property.mortgage)}</button>`;
    const buildingButtons = property.kind === 'street' && !deed.mortgaged ? `<button class="secondary" data-deed-action="buy-building">＋ ${deed.buildings === 4 ? 'Hotel' : 'House'} ${money.format(property.houseCost)}</button>${deed.buildings ? `<button class="danger" data-deed-action="sell-building">− Sell building ${money.format(Math.floor(property.houseCost / 2))}</button>` : ''}` : '';
    controls = `${rentControl}<div class="dialog-actions">${mortgageButton}${buildingButtons}</div>`;
  }
  $('#deed-dialog-content').innerHTML = `<div class="dialog-color" style="--deed-color:${GROUP_COLORS[property.group]}"></div><div class="dialog-inner"><div class="dialog-head"><div><p class="kicker">TITLE DEED</p><h2>${escapeHtml(property.name)}</h2><p class="muted">${status}${property.kind === 'street' && owner ? ` · ${buildingText}` : ''}</p></div><button class="dialog-close" aria-label="Close">×</button></div><div class="dialog-facts"><div><small>Price</small><strong>${money.format(property.price)}</strong></div><div><small>Mortgage</small><strong>${money.format(property.mortgage)}</strong></div><div><small>${property.kind === 'street' ? 'House cost' : 'Type'}</small><strong>${property.kind === 'street' ? money.format(property.houseCost) : property.kind}</strong></div></div>${rentRows(property)}${controls}</div>`;
  $('.dialog-close').addEventListener('click', () => $('#deed-dialog').close());
  $('#buy-deed-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (await submitAction({ type:'buy', playerId:$('#deed-buyer').value, propertyId, amount:Number($('#deed-price').value), auction:$('#deed-auction').checked }, 'Deed acquired.')) $('#deed-dialog').close();
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
    if (button.dataset.note === 'Passed GO') {
      $('#payment-from').value = 'bank';
      if ($('#payment-to').value === 'bank') $('#payment-to').value = game.players[0].id;
    } else {
      if ($('#payment-from').value === 'bank') $('#payment-from').value = game.players[0].id;
      $('#payment-to').value = 'bank';
    }
  }));
  $$('.view-tabs button').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  $$('#mobile-nav button').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.mobileView)));
  $$('[data-open-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.openView)));
  $('#deed-search').addEventListener('input', renderDeeds);
  $('#deed-filter').addEventListener('change', renderDeeds);
  $('#trade-first').addEventListener('change', renderTrade);
  $('#trade-second').addEventListener('change', renderTrade);
  $('#share-game').addEventListener('click', shareGame);
  $('#deed-dialog').addEventListener('click', (event) => { if (event.target === $('#deed-dialog')) $('#deed-dialog').close(); });
  addEventListener('popstate', () => loadGame());
}

bindEvents();
loadGame();
