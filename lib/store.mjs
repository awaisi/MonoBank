import * as fsPromises from 'node:fs/promises';
import { join } from 'node:path';
import { createGame, GameError } from './game.mjs';

const DAY = 24 * 60 * 60 * 1000;
const GAME_ID = /^[a-f0-9]{16}$/;
const notFound = () => new GameError('Game not found or expired.', 404);

/**
 * Holds games in memory and, when `dataDir` is set, persists each game as
 * `<dataDir>/<id>.json` so games survive restarts and redeploys.
 *
 * - Memory is the working copy; disk is written through after every change.
 * - Writes are atomic (temp file + rename) and serialized per game, so the
 *   newest state always wins even if saves overlap.
 * - Games not in memory (e.g. after a restart) are loaded on first access;
 *   concurrent loads of the same game share one read.
 * - Persistence failures are logged and never break gameplay.
 */
export class GameStore {
  constructor({ ttlMs = DAY, dataDir = null, maxGames = 5000, now = () => Date.now(), logger = console, fs = fsPromises } = {}) {
    this.fs = fs;
    this.ttlMs = ttlMs;
    this.dataDir = dataDir;
    this.maxGames = maxGames;
    this.now = now;
    this.logger = logger;
    this.games = new Map();
    this.loading = new Map();
    this.writes = new Map();
    this.fileCount = 0;
    this.sequence = 0;
  }

  /** `file` when games are persisted to disk, otherwise `memory`. */
  get kind() {
    return this.dataDir ? 'file' : 'memory';
  }

  /** Number of live games counted against `maxGames`. */
  get size() {
    return this.dataDir ? Math.max(this.fileCount, this.games.size) : this.games.size;
  }

  /** Prepare the data directory. Throws if it cannot be created or read. */
  async init() {
    if (!this.dataDir) return this;
    await this.fs.mkdir(this.dataDir, { recursive: true });
    this.fileCount = (await this.#gameFiles()).length;
    return this;
  }

  isExpired(game) {
    return this.now() - Date.parse(game.updatedAt) > this.ttlMs;
  }

  async create(input) {
    if (this.size >= this.maxGames) await this.sweep();
    if (this.size >= this.maxGames) throw new GameError('MonoBank is at capacity right now. Please try again later.', 503);
    const game = createGame(input);
    this.games.set(game.id, game);
    if (this.dataDir) this.fileCount += 1;
    await this.save(game);
    return game;
  }

  async get(id) {
    if (!GAME_ID.test(String(id))) throw notFound();
    const game = this.games.get(id) ?? (this.dataDir ? await this.#load(id) : null);
    if (!game) throw notFound();
    if (this.isExpired(game)) {
      await this.delete(id);
      throw notFound();
    }
    return game;
  }

  /** Persist the game's current state. Resolves even if the write fails. */
  save(game) {
    if (!this.dataDir) return Promise.resolve();
    const previous = this.writes.get(game.id) ?? Promise.resolve();
    const next = previous.then(() => this.#write(game));
    this.writes.set(game.id, next);
    next.then(() => { if (this.writes.get(game.id) === next) this.writes.delete(game.id); });
    return next;
  }

  async delete(id) {
    this.games.delete(id);
    if (!this.dataDir) return;
    await this.writes.get(id);
    try {
      await this.fs.unlink(this.#path(id));
      this.fileCount = Math.max(0, this.fileCount - 1);
    } catch (error) {
      if (error.code !== 'ENOENT') this.logger.error(`Could not delete game ${id}`, error);
    }
  }

  /** Remove expired games from memory and disk. */
  async sweep() {
    for (const [id, game] of this.games) if (this.isExpired(game)) await this.delete(id);
    if (!this.dataDir) return;
    let remaining = 0;
    for (const file of await this.#gameFiles()) {
      const id = file.slice(0, -5);
      try {
        const { mtimeMs } = await this.fs.stat(this.#path(id));
        if (!this.games.has(id) && this.now() - mtimeMs > this.ttlMs) await this.delete(id);
        else remaining += 1;
      } catch (error) {
        if (error.code !== 'ENOENT') this.logger.error(`Could not inspect game ${id}`, error);
      }
    }
    this.fileCount = remaining;
  }

  /** Wait for queued writes (used by tests and graceful shutdown). */
  async flush() {
    await Promise.all([...this.writes.values()]);
  }

  #path(id) {
    return join(this.dataDir, `${id}.json`);
  }

  async #gameFiles() {
    const files = await this.fs.readdir(this.dataDir);
    return files.filter((file) => GAME_ID.test(file.slice(0, -5)) && file.endsWith('.json'));
  }

  #load(id) {
    if (!this.loading.has(id)) {
      const pending = (async () => {
        try {
          const game = JSON.parse(await this.fs.readFile(this.#path(id), 'utf8'));
          if (game?.id !== id) throw new Error('Stored game ID does not match its file name.');
          game.history ??= [];
          this.games.set(id, game);
          return game;
        } catch (error) {
          if (error.code !== 'ENOENT') this.logger.error(`Could not load game ${id}`, error);
          return null;
        } finally {
          this.loading.delete(id);
        }
      })();
      this.loading.set(id, pending);
    }
    return this.loading.get(id);
  }

  async #write(game) {
    const target = this.#path(game.id);
    const temporary = `${target}.${process.pid}.${(this.sequence += 1)}.tmp`;
    try {
      await this.fs.writeFile(temporary, JSON.stringify(game));
      await this.fs.rename(temporary, target);
    } catch (error) {
      this.logger.error(`Could not save game ${game.id}`, error);
      await this.fs.unlink(temporary).catch(() => {});
    }
  }
}
