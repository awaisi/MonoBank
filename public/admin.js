// MonoBank admin page: usage statistics behind a secret token.
// The token lives only in sessionStorage (this tab) and is sent as a Bearer header, never in a URL.
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const TOKEN_KEY = 'monobank:admin';
const number = new Intl.NumberFormat();
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const storedToken = () => { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const storeToken = (value) => { try { if (value) sessionStorage.setItem(TOKEN_KEY, value); else sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ } };
const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');
const minutesText = (value) => (value == null ? '—' : value < 60 ? `${value} min` : `${Math.floor(value / 60)} h ${value % 60} min`);
const bytesText = (value) => (value < 1024 * 1024 ? `${Math.round(value / 1024)} KB` : `${(value / 1048576).toFixed(1)} MB`);
const plural = (count, one, many) => `${number.format(count)} ${count === 1 ? one : many}`;
const ERROR_LABELS = { 'insufficient-funds': 'Not enough cash', conflict: 'Two phones at once (409)', 'rate-limited': 'Rate limited (429)', 'not-found': 'Game not found (404)', 'server-error': 'Server errors (5xx)' };

// The CSP blocks style attributes in HTML strings; per-element values are applied through the CSSOM instead.
function applyStyleVars(root) {
  $$('[data-vars]', root).forEach((element) => {
    element.dataset.vars.split(';').filter(Boolean).forEach((pair) => {
      const [name, value] = pair.split('=');
      element.style.setProperty(name, value);
    });
  });
}

function toast(message) {
  const item = document.createElement('div');
  item.className = 'toast error';
  item.textContent = message;
  $('#toast-region').append(item);
  setTimeout(() => item.remove(), 4000);
}

function showSignIn(message = '') {
  $('#admin-signin').hidden = false;
  $('#admin-actions').hidden = true;
  $('#admin-content').innerHTML = '';
  $('#admin-error').textContent = message;
  $('#admin-token').value = '';
  $('#admin-token').focus();
}

async function load() {
  const token = storedToken();
  if (!token) return showSignIn();
  $('#admin-refresh').disabled = true;
  try {
    const response = await fetch('/api/admin/stats', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) { storeToken(''); return showSignIn(data.error || 'That admin token is not right.'); }
    if (!response.ok) {
      if ($('#admin-content').innerHTML) return toast(data.error || 'Could not load usage.');
      return showSignIn(data.error || 'Could not load usage.');
    }
    $('#admin-signin').hidden = true;
    $('#admin-actions').hidden = false;
    render(data);
  } catch {
    toast('Couldn’t reach MonoBank. Check your connection and try again.');
  } finally {
    $('#admin-refresh').disabled = false;
  }
}

// ---- Chart pieces (single series, one hue, hover/focus tooltips, a table for every chart) ----

function columns(items, { label, max = Math.max(1, ...items.map((item) => item.value)), every = 1 }) {
  const cols = items.map((item, index) => `<div class="admin-col" tabindex="0" data-vars="--h=${Math.round((item.value / max) * 100)}%" aria-label="${escapeHtml(`${item.label}: ${item.value}`)}"><span class="admin-col-bar"></span><span class="admin-tip">${escapeHtml(item.label)} · <b>${number.format(item.value)}</b></span>${index % every === 0 ? `<span class="admin-col-label">${escapeHtml(item.short ?? item.label)}</span>` : ''}</div>`).join('');
  return `<div class="admin-cols" role="group" aria-label="${escapeHtml(label)}">${cols}</div>${table(items, label)}`;
}

function bars(rows, { label, total = Math.max(1, ...rows.map((row) => row.value)), share = false }) {
  if (!rows.length) return '<p class="muted">Nothing yet.</p>';
  const items = rows.map((row) => `<div class="admin-bar-row"><span class="admin-bar-label">${escapeHtml(row.label)}</span><span class="admin-bar-track"><span class="admin-bar" data-vars="--w=${Math.max(row.value ? 2 : 0, Math.round((row.value / total) * 100))}%"></span></span><span class="admin-bar-value">${number.format(row.value)}${share ? ` <small>${pct(row.value, total)}</small>` : ''}</span></div>`).join('');
  return `<div class="admin-bars" role="group" aria-label="${escapeHtml(label)}">${items}</div>`;
}

const table = (items, label) => `<details class="admin-table"><summary>Show as table</summary><table><caption class="sr-only">${escapeHtml(label)}</caption><tbody>${items.map((item) => `<tr><th scope="row">${escapeHtml(item.label)}</th><td>${number.format(item.value)}</td></tr>`).join('')}</tbody></table></details>`;
const kpi = (label, value, note = '') => `<div class="admin-kpi"><small>${label}</small><strong>${value}</strong>${note ? `<span>${note}</span>` : ''}</div>`;
const card = (title, body, wide = false) => `<section class="admin-card ${wide ? 'wide' : ''}"><h2>${title}</h2>${body}</section>`;

// Plain-language pointers to what might need attention.
function insights({ usage, runtime }) {
  const notes = [];
  const { funnel } = usage;
  if (funnel.created >= 5 && funnel.started / funnel.created < 0.7) notes.push(`${pct(funnel.created - funnel.started, funnel.created)} of games never get a first move. Setup or the first screen may be confusing.`);
  if (funnel.started >= 5 && funnel.finished / funnel.started < 0.2) notes.push(`Only ${pct(funnel.finished, funnel.started)} of started games are finished in the app. Players may not know about Finish game (⋯ menu), or games just get abandoned.`);
  if (usage.undoPer100Moves >= 5) notes.push(`Players undo ${usage.undoPer100Moves} times per 100 moves. Something may be easy to mis-tap.`);
  const funds = runtime.errors['insufficient-funds'];
  if (funds) notes.push(`${plural(funds, 'payment was', 'payments were')} refused for lack of cash since the last restart. Check that Raise cash is helping.`);
  if (runtime.errors.conflict) notes.push(`${plural(runtime.errors.conflict, 'move', 'moves')} collided with another phone (409) since the last restart.`);
  if (runtime.errors['server-error']) notes.push(`${plural(runtime.errors['server-error'], 'server error', 'server errors')} since the last restart. Check the logs.`);
  if (runtime.streams.rejected) notes.push(`${plural(runtime.streams.rejected, 'live connection was', 'live connections were')} refused (cap reached); those phones fell back to polling.`);
  if (runtime.saves.p95Ms != null && runtime.saves.p95Ms > 500) notes.push(`Saving is slow (95th percentile ${runtime.saves.p95Ms} ms). See backlog item “Lighter saves”.`);
  return notes.length ? `<ul class="admin-insights">${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>` : '<p class="muted">Nothing stands out right now.</p>';
}

function render(data) {
  const { usage, runtime, storage } = data;
  const { totals, funnel } = usage;
  const offset = Math.round(-new Date().getTimezoneOffset() / 60);
  const hours = Array.from({ length: 24 }, (_, hour) => ({ label: `${hour}:00`, short: String(hour), value: usage.startHourUtc[(hour - offset + 48) % 24] }));
  const days = usage.createdByDay.map(({ date, count }) => ({ label: new Date(`${date}T12:00:00Z`).toLocaleDateString([], { month: 'short', day: 'numeric' }), short: date.slice(8), value: count }));
  const playerRows = Object.entries(usage.players).sort((a, b) => a[0] - b[0]).map(([count, games]) => ({ label: `${count} players`, value: games }));
  const ruleRows = [
    ['Free Parking jackpot', usage.rules.freeParkingJackpot], ['$400 for landing on GO', usage.rules.doubleGoOnLanding], ['No rent in jail', usage.rules.noRentInJail],
    ['Auctions turned off', usage.rules.auctionsOff], ['Even building turned off', usage.rules.evenBuildingOff], ['Mortgage interest changed', usage.rules.mortgageInterestChanged]
  ].map(([label, value]) => ({ label, value }));
  const actionNames = { transfer: 'Payments', tax: 'Taxes', fee: 'Fees', rent: 'Rent', purchase: 'Deed purchases', auction: 'Auction wins', mortgage: 'Mortgages', unmortgage: 'Unmortgages', building: 'Building', trade: 'Trades', parking: 'Free Parking payouts', jail: 'Jail', bankrupt: 'Bankruptcies', undo: 'Undos', end: 'Finish game' };
  const actionRows = Object.entries(usage.actions).filter(([, value]) => value).sort((a, b) => b[1] - a[1]).map(([type, value]) => ({ label: actionNames[type] || type, value }));
  const finishRows = [['Highest net worth', usage.finish.netWorth], ['Winner picked by the table', usage.finish.table], ['Last player standing', usage.finish.lastStanding]].map(([label, value]) => ({ label, value }));
  const balanceRows = Object.entries(usage.startingBalances).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([amount, value]) => ({ label: money.format(Number(amount)), value }));
  const errorRows = Object.entries(runtime.errors).sort((a, b) => b[1] - a[1]).map(([code, value]) => ({ label: ERROR_LABELS[code] || code, value }));
  const updated = new Date(usage.generatedAt).toLocaleString();

  $('#admin-content').innerHTML = `
    <div class="admin-head"><div><p class="kicker">ADMIN</p><h1>How MonoBank is used</h1><p class="muted">Updated ${escapeHtml(updated)} · ${number.format(totals.games)} stored games (kept ${storage.retentionDays} days, ${storage.finishedRetentionDays} once finished). No game links or player names are shown.</p></div></div>
    <div class="admin-kpis">
      ${kpi('Games stored', number.format(totals.games))}
      ${kpi('New this week', number.format(totals.created7d), `${number.format(totals.created24h)} today`)}
      ${kpi('Playing now', number.format(totals.active15m), `${number.format(runtime.liveStreams)} live connections`)}
      ${kpi('Active today', number.format(totals.active24h))}
      ${kpi('Finished', number.format(totals.finished), pct(totals.finished, totals.games))}
      ${kpi('Median game', minutesText(usage.playMinutes.median), `${number.format(usage.moves.median ?? 0)} moves`)}
    </div>
    <div class="admin-grid">
      ${card('What to look at', insights(data), true)}
      ${card('From new game to finished', bars([
        { label: 'Created', value: funnel.created }, { label: 'First move made', value: funnel.started },
        { label: '10+ moves', value: funnel.played }, { label: 'Finished in the app', value: funnel.finished }
      ], { label: 'Game funnel', total: Math.max(1, funnel.created), share: true }))}
      ${card('Game length', `<dl class="admin-facts"><div><dt>Median moves</dt><dd>${number.format(usage.moves.median ?? 0)}</dd></div><div><dt>Long games (90th pct)</dt><dd>${number.format(usage.moves.p90 ?? 0)} moves</dd></div><div><dt>Median play time</dt><dd>${minutesText(usage.playMinutes.median)}</dd></div><div><dt>Long play (90th pct)</dt><dd>${minutesText(usage.playMinutes.p90)}</dd></div><div><dt>Undos per 100 moves</dt><dd>${usage.undoPer100Moves}</dd></div><div><dt>Players gone bankrupt</dt><dd>${number.format(usage.bankruptPlayers)}</dd></div></dl>`)}
      ${card('New games per day (last 30 days)', columns(days, { label: 'New games per day', every: 5 }), true)}
      ${card(`When games start (your time, UTC${offset >= 0 ? '+' : ''}${offset})`, columns(hours, { label: 'Games started by hour', every: 3 }), true)}
      ${card('Table size', bars(playerRows, { label: 'Players per game', total: Math.max(1, totals.games), share: true }))}
      ${card('How games end', bars(finishRows, { label: 'How games end', total: Math.max(1, totals.finished), share: true }))}
      ${card('House rules people turn on', bars(ruleRows, { label: 'House rules adoption', total: Math.max(1, totals.games), share: true }))}
      ${card('What people do', bars(actionRows, { label: 'Moves by type' }))}
      ${card('Most-used payment notes', bars(usage.topNotes.map(({ note, count }) => ({ label: note, value: count })), { label: 'Most-used payment notes' }) + '<p class="admin-note">Notes on Bank payments (presets and quick actions); only notes typed 3+ times appear.</p>')}
      ${card('Starting cash', bars(balanceRows, { label: 'Starting cash', total: Math.max(1, totals.games), share: true }))}
      ${card('Server since last restart', `<dl class="admin-facts"><div><dt>Up for</dt><dd>${minutesText(runtime.uptimeMinutes)}</dd></div><div><dt>Requests</dt><dd>${number.format(runtime.requests.total)}</dd></div><div><dt>Server errors (5xx)</dt><dd>${number.format(runtime.requests['5xx'])}</dd></div><div><dt>Saves p50 / p95</dt><dd>${runtime.saves.p50Ms ?? '—'} / ${runtime.saves.p95Ms ?? '—'} ms</dd></div><div><dt>Live connections opened</dt><dd>${number.format(runtime.streams.opened)}</dd></div><div><dt>Memory</dt><dd>${runtime.memoryMb} MB · ${number.format(storage.gamesInMemory)} games loaded</dd></div><div><dt>Storage</dt><dd>${storage.kind === 'file' ? `${bytesText(storage.bytes)} on disk` : 'Memory only'}</dd></div></dl>${errorRows.length ? `<h3 class="admin-sub">Errors players hit</h3>${bars(errorRows, { label: 'Errors since restart' })}` : ''}`, true)}
    </div>`;
  applyStyleVars($('#admin-content'));
}

$('#admin-form').addEventListener('submit', (event) => {
  event.preventDefault();
  storeToken($('#admin-token').value.trim());
  load();
});
$('#admin-refresh').addEventListener('click', load);
$('#admin-signout').addEventListener('click', () => { storeToken(''); showSignIn(); });
load();
