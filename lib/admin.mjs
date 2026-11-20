// Admin usage statistics: pure helpers (no I/O) used by the server's admin API.
// Privacy: summaries never include game IDs, spectator tokens or player names.
import { createHash, timingSafeEqual } from 'node:crypto';

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
// Ledger entries that are not moves (same rule as the game's play time and activity stats).
const NOT_PLAY = new Set(['system', 'end', 'undo']);
export const ACTION_TYPES = ['transfer', 'tax', 'fee', 'rent', 'purchase', 'auction', 'mortgage', 'unmortgage', 'building', 'trade', 'parking', 'jail', 'bankrupt', 'undo', 'end'];
export const MIN_ADMIN_TOKEN_LENGTH = 24;

/** True when `provided` matches the configured admin token (constant-time; tokens shorter than the minimum never match). */
export function adminTokenMatches(expected, provided) {
  if (typeof expected !== 'string' || expected.length < MIN_ADMIN_TOKEN_LENGTH || typeof provided !== 'string' || !provided) return false;
  const digest = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(expected), digest(provided));
}

/** The token from an `Authorization: Bearer <token>` header, or ''. */
export function bearerToken(header) {
  const match = /^Bearer\s+(.+)$/i.exec(String(header || '').trim());
  return match ? match[1].trim() : '';
}

/** How a finished game was decided: by net worth, by the table's pick, or by the last player standing. */
function finishMethod(game) {
  if (game.status !== 'ended') return null;
  const end = (game.transactions || []).find((entry) => entry.type === 'end' && !entry.undone);
  if (!end) return 'lastStanding';
  return /^Winner chosen by the table/.test(end.detail || '') ? 'table' : 'netWorth';
}

/** A compact, anonymous summary of one stored game. */
export function summarizeGame(game) {
  const entries = game.transactions || [];
  const actions = {};
  const notes = {};
  let moves = 0;
  for (const entry of entries) {
    if (entry.undone) continue;
    actions[entry.type] = (actions[entry.type] || 0) + 1;
    if (NOT_PLAY.has(entry.type)) continue;
    moves += 1;
    // Notes on Bank payments show which presets and quick actions people use ("Passed GO", "Income Tax", ...).
    const note = ['transfer', 'tax', 'fee'].includes(entry.type) && entry.detail ? entry.detail.trim().toLowerCase().slice(0, 40) : '';
    if (note) notes[note] = (notes[note] || 0) + 1;
  }
  const playMinutes = game.status === 'ended' && game.startedAt && game.playedUntil
    ? Math.max(0, Math.round((Date.parse(game.playedUntil) - Date.parse(game.startedAt)) / MINUTE))
    : null;
  return {
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
    startedAt: game.startedAt || null,
    status: game.status,
    players: (game.players || []).length,
    bankrupt: (game.players || []).filter((player) => player.bankrupt).length,
    startingBalance: game.startingBalance,
    rules: { ...(game.rules || {}) },
    moves: moves + (game.transactionsDropped || 0),
    actions,
    notes,
    finish: finishMethod(game),
    playMinutes
  };
}

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Aggregate game summaries into the admin dashboard's numbers. */
export function aggregateUsage(summaries, { now = Date.now(), days = 30 } = {}) {
  const totals = { games: summaries.length, created24h: 0, created7d: 0, created30d: 0, active15m: 0, active24h: 0, finished: 0 };
  const funnel = { created: summaries.length, started: 0, played: 0, finished: 0 };
  const players = {};
  const startingBalances = {};
  const actions = Object.fromEntries(ACTION_TYPES.map((type) => [type, 0]));
  const rules = { freeParkingJackpot: 0, doubleGoOnLanding: 0, noRentInJail: 0, auctionsOff: 0, evenBuildingOff: 0, mortgageInterestChanged: 0 };
  const finish = { netWorth: 0, table: 0, lastStanding: 0 };
  const notes = {};
  const hours = Array(24).fill(0);
  const byDay = new Map();
  for (let i = days - 1; i >= 0; i -= 1) byDay.set(dayKey(now - i * DAY), 0);
  const moveCounts = [];
  const playMinutes = [];
  let undos = 0;
  let moveTotal = 0;
  let bankruptPlayers = 0;
  for (const game of summaries) {
    const created = Date.parse(game.createdAt);
    const updated = Date.parse(game.updatedAt);
    if (now - created <= DAY) totals.created24h += 1;
    if (now - created <= 7 * DAY) totals.created7d += 1;
    if (now - created <= 30 * DAY) totals.created30d += 1;
    if (now - updated <= 15 * MINUTE) totals.active15m += 1;
    if (now - updated <= DAY) totals.active24h += 1;
    if (byDay.has(dayKey(created))) byDay.set(dayKey(created), byDay.get(dayKey(created)) + 1);
    if (game.moves >= 1) funnel.started += 1;
    if (game.moves >= 10) funnel.played += 1;
    if (game.status === 'ended') { totals.finished += 1; funnel.finished += 1; }
    if (game.finish) finish[game.finish] += 1;
    players[game.players] = (players[game.players] || 0) + 1;
    startingBalances[game.startingBalance] = (startingBalances[game.startingBalance] || 0) + 1;
    if (game.moves >= 1) {
      moveCounts.push(game.moves);
      hours[new Date(game.startedAt || game.createdAt).getUTCHours()] += 1;
    }
    if (game.playMinutes != null) playMinutes.push(game.playMinutes);
    moveTotal += game.moves;
    bankruptPlayers += game.bankrupt;
    for (const [type, count] of Object.entries(game.actions)) if (type in actions) actions[type] += count;
    undos += game.actions.undo || 0;
    for (const [note, count] of Object.entries(game.notes)) notes[note] = (notes[note] || 0) + count;
    const r = game.rules;
    if (r.freeParkingJackpot) rules.freeParkingJackpot += 1;
    if (r.doubleGoOnLanding) rules.doubleGoOnLanding += 1;
    if (r.noRentInJail) rules.noRentInJail += 1;
    if (r.auctions === false) rules.auctionsOff += 1;
    if (r.evenBuilding === false) rules.evenBuildingOff += 1;
    if (r.mortgageInterestPercent != null && r.mortgageInterestPercent !== 10) rules.mortgageInterestChanged += 1;
  }
  return {
    generatedAt: new Date(now).toISOString(),
    totals,
    funnel,
    players,
    startingBalances,
    moves: { total: moveTotal, median: percentile(moveCounts, 0.5), p90: percentile(moveCounts, 0.9) },
    playMinutes: { count: playMinutes.length, median: percentile(playMinutes, 0.5), p90: percentile(playMinutes, 0.9) },
    createdByDay: [...byDay].map(([date, count]) => ({ date, count })),
    startHourUtc: hours,
    rules,
    actions,
    undoPer100Moves: moveTotal ? Math.round((undos / moveTotal) * 1000) / 10 : 0,
    bankruptPlayers,
    finish,
    // Only notes several games' worth of people typed, so one-off personal text never shows up.
    topNotes: Object.entries(notes).filter(([, count]) => count >= 3).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([note, count]) => ({ note, count }))
  };
}

/** Counters since the server started: request outcomes, errors players hit, live connections, save speed. */
export class RuntimeMetrics {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.startedAt = now();
    this.requests = { total: 0, api: 0, '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
    this.errors = {};
    this.actions = {};
    this.streams = { opened: 0, rejected: 0 };
    this.saveMs = [];
  }

  request(path, status) {
    this.requests.total += 1;
    if (path.startsWith('/api/')) this.requests.api += 1;
    const bucket = `${Math.floor(status / 100)}xx`;
    if (bucket in this.requests) this.requests[bucket] += 1;
  }

  /** Errors worth watching: 409 conflicts (two phones at once), insufficient funds, rate limits, not found. */
  error(status, code) {
    const key = code || { 404: 'not-found', 409: 'conflict', 429: 'rate-limited' }[status] || (status >= 500 ? 'server-error' : `http-${status}`);
    this.errors[key] = (this.errors[key] || 0) + 1;
  }

  action(type) {
    this.actions[type] = (this.actions[type] || 0) + 1;
  }

  save(ms) {
    this.saveMs.push(ms);
    if (this.saveMs.length > 500) this.saveMs.shift();
  }

  snapshot(extra = {}) {
    const round = (value) => (value == null ? null : Math.round(value * 10) / 10);
    return {
      startedAt: new Date(this.startedAt).toISOString(),
      uptimeMinutes: Math.floor((this.now() - this.startedAt) / MINUTE),
      requests: { ...this.requests },
      errors: { ...this.errors },
      actions: { ...this.actions },
      streams: { ...this.streams },
      saves: { count: this.saveMs.length, p50Ms: round(percentile(this.saveMs, 0.5)), p95Ms: round(percentile(this.saveMs, 0.95)), maxMs: round(this.saveMs.length ? Math.max(...this.saveMs) : null) },
      ...extra
    };
  }
}
