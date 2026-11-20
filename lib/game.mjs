import { randomBytes, randomUUID } from 'node:crypto';
import { PROPERTIES, PROPERTY_BY_ID, STREET_GROUP_IDS } from './properties.mjs';

const COLORS = ['#d9574f', '#3c8fd1', '#d6a53c', '#45a477'];
const TOKENS = ['top-hat', 'roadster', 'terrier', 'thimble'];
const BANK = 'bank';
const PARKING = 'parking';

export const DEFAULT_RULES = Object.freeze({
  freeParkingJackpot: false,
  freeParkingSeed: 0,
  doubleGoOnLanding: false,
  noRentInJail: false,
  auctions: true,
  evenBuilding: true,
  mortgageInterestPercent: 10
});

export class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'GameError';
    this.status = status;
  }
}

const money = (value, field = 'Amount') => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isInteger(amount)) {
    throw new GameError(`${field} must be a non-negative whole number.`);
  }
  return amount;
};

const cleanNote = (value) => String(value ?? '').trim().slice(0, 120);

const flag = (value, field) => {
  if (typeof value !== 'boolean') throw new GameError(`${field} must be on or off.`);
  return value;
};

export function normalizeRules(input = {}) {
  if (input == null) input = {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new GameError('House rules must be an object.');
  const rules = { ...DEFAULT_RULES };
  if (input.freeParkingJackpot !== undefined) rules.freeParkingJackpot = flag(input.freeParkingJackpot, 'Free Parking jackpot');
  if (input.doubleGoOnLanding !== undefined) rules.doubleGoOnLanding = flag(input.doubleGoOnLanding, 'Double GO salary');
  if (input.noRentInJail !== undefined) rules.noRentInJail = flag(input.noRentInJail, 'No rent in jail');
  if (input.auctions !== undefined) rules.auctions = flag(input.auctions, 'Auctions');
  if (input.evenBuilding !== undefined) rules.evenBuilding = flag(input.evenBuilding, 'Even building');
  if (input.freeParkingSeed !== undefined) {
    rules.freeParkingSeed = money(input.freeParkingSeed, 'Free Parking seed');
    if (rules.freeParkingSeed > 100_000) throw new GameError('Free Parking seed must be $100,000 or less.');
  }
  if (input.mortgageInterestPercent !== undefined) {
    rules.mortgageInterestPercent = money(input.mortgageInterestPercent, 'Mortgage interest');
    if (rules.mortgageInterestPercent > 100) throw new GameError('Mortgage interest must be between 0% and 100%.');
  }
  if (!rules.freeParkingJackpot) rules.freeParkingSeed = 0;
  return rules;
}

export const unmortgageCost = (game, property) =>
  Math.round(property.mortgage * (1 + game.rules.mortgageInterestPercent / 100));

export function createGame({ players: inputPlayers, startingBalance = 1500, rules: inputRules }) {
  if (!Array.isArray(inputPlayers) || inputPlayers.length < 2 || inputPlayers.length > 4) {
    throw new GameError('Add between 2 and 4 players.');
  }
  const names = inputPlayers.map((entry) => String(typeof entry === 'string' ? entry : entry?.name ?? '').trim().slice(0, 24));
  if (names.some((name) => !name)) throw new GameError('Every player needs a name.');
  if (new Set(names.map((name) => name.toLocaleLowerCase())).size !== names.length) {
    throw new GameError('Player names must be unique.');
  }
  const openingBalance = money(startingBalance, 'Starting balance');
  if (openingBalance < 1 || openingBalance > 1_000_000) throw new GameError('Starting balance must be between $1 and $1,000,000.');
  const rules = normalizeRules(inputRules);

  const createdAt = new Date().toISOString();
  const game = {
    id: randomBytes(8).toString('hex'),
    name: 'Game Night',
    createdAt,
    updatedAt: createdAt,
    revision: 0,
    startingBalance: openingBalance,
    rules,
    freeParking: rules.freeParkingSeed,
    players: names.map((name, index) => ({
      id: randomUUID(), name, balance: openingBalance, color: COLORS[index], token: TOKENS[index], inJail: false
    })),
    deeds: Object.fromEntries(PROPERTIES.map((property) => [property.id, { ownerId: null, mortgaged: false, buildings: 0 }])),
    transactions: []
  };
  record(game, {
    type: 'system', label: 'Bank opened',
    detail: [`${names.length} players · $${openingBalance.toLocaleString()} each`, ...rulesSummary(rules)].join(' · '),
    amount: openingBalance
  });
  return game;
}

export function rulesSummary(rules) {
  const notes = [];
  if (rules.freeParkingJackpot) notes.push(rules.freeParkingSeed ? `Free Parking jackpot (seeded $${rules.freeParkingSeed.toLocaleString()})` : 'Free Parking jackpot');
  if (rules.doubleGoOnLanding) notes.push('$400 for landing on GO');
  if (rules.noRentInJail) notes.push('No rent while in jail');
  if (!rules.auctions) notes.push('No auctions');
  if (!rules.evenBuilding) notes.push('Uneven building allowed');
  if (rules.mortgageInterestPercent !== DEFAULT_RULES.mortgageInterestPercent) notes.push(`${rules.mortgageInterestPercent}% mortgage interest`);
  return notes;
}

const player = (game, id) => {
  const found = game.players.find((entry) => entry.id === id);
  if (!found) throw new GameError('Player not found.');
  return found;
};

const propertyAndDeed = (game, id) => {
  const property = PROPERTY_BY_ID[id];
  const deed = game.deeds[id];
  if (!property || !deed) throw new GameError('Property not found.');
  return { property, deed };
};

function record(game, entry) {
  game.transactions.unshift({
    id: randomUUID(), at: new Date().toISOString(), type: entry.type, label: entry.label,
    detail: entry.detail ?? '', amount: entry.amount ?? null,
    fromId: entry.fromId ?? null, toId: entry.toId ?? null, propertyId: entry.propertyId ?? null
  });
  game.transactions = game.transactions.slice(0, 300);
  game.revision += 1;
  game.updatedAt = new Date().toISOString();
}

const accountName = (game, id) => (id === BANK ? 'Bank' : id === PARKING ? 'Free Parking' : player(game, id).name);

function move(game, fromId, toId, amount, meta) {
  const value = money(amount);
  if (value < 1) throw new GameError('Amount must be at least $1.');
  if (fromId === toId) throw new GameError('Choose two different accounts.');
  if (fromId === PARKING) throw new GameError('Use "Collect Free Parking" to pay out the pot.');
  if (toId === PARKING && !game.rules.freeParkingJackpot) throw new GameError('The Free Parking jackpot is off for this game.');
  const from = fromId === BANK ? null : player(game, fromId);
  const to = toId === BANK || toId === PARKING ? null : player(game, toId);
  if (!from && !to && toId !== PARKING) throw new GameError('A transfer needs at least one player.');
  if (from) from.balance -= value;
  if (to) to.balance += value;
  if (toId === PARKING) game.freeParking += value;
  record(game, { ...meta, amount: value, fromId, toId });
}

export function calculateRent(game, propertyId, diceTotal) {
  const { property, deed } = propertyAndDeed(game, propertyId);
  if (!deed.ownerId) throw new GameError('This deed has no owner.');
  if (deed.mortgaged) return 0;
  if (property.kind === 'railroad') {
    const count = PROPERTIES.filter((item) => item.kind === 'railroad' && game.deeds[item.id].ownerId === deed.ownerId).length;
    return [25, 50, 100, 200][count - 1];
  }
  if (property.kind === 'utility') {
    const roll = money(diceTotal, 'Dice total');
    if (roll < 2 || roll > 12) throw new GameError('Enter a dice total from 2 to 12.');
    const count = PROPERTIES.filter((item) => item.kind === 'utility' && game.deeds[item.id].ownerId === deed.ownerId).length;
    return roll * (count === 2 ? 10 : 4);
  }
  if (deed.buildings > 0) return property.rent[deed.buildings];
  const ownsSet = STREET_GROUP_IDS[property.group].every((id) => game.deeds[id].ownerId === deed.ownerId);
  return property.rent[0] * (ownsSet ? 2 : 1);
}

const assertOwner = (game, propertyId, playerId) => {
  const result = propertyAndDeed(game, propertyId);
  if (result.deed.ownerId !== playerId) throw new GameError('That player does not own this deed.');
  return result;
};

function transferDeed(game, propertyId, fromId, toId) {
  const { property, deed } = assertOwner(game, propertyId, fromId);
  deed.ownerId = toId;
  return property;
}

function assertTradableDeed(game, propertyId, ownerId) {
  const { property } = assertOwner(game, propertyId, ownerId);
  if (property.kind === 'street' && STREET_GROUP_IDS[property.group].some((id) => game.deeds[id].buildings > 0)) {
    throw new GameError('Sell all buildings in the color set before trading a deed.');
  }
  return property;
}

export function performAction(game, action) {
  if (!action || typeof action !== 'object') throw new GameError('Action is required.');
  if (action.expectedRevision != null && Number(action.expectedRevision) !== game.revision) {
    throw new GameError('The game changed on another screen. Refresh and try again.', 409);
  }

  switch (action.type) {
    case 'transfer': {
      const fromName = accountName(game, action.fromId);
      const toName = accountName(game, action.toId);
      move(game, action.fromId, action.toId, action.amount, {
        type: action.category || 'transfer',
        label: action.label || `${fromName} paid ${toName}`,
        detail: cleanNote(action.note)
      });
      break;
    }
    case 'buy': {
      const buyer = player(game, action.playerId);
      const { property, deed } = propertyAndDeed(game, action.propertyId);
      if (deed.ownerId) throw new GameError('This deed is already owned.');
      if (action.auction && !game.rules.auctions) throw new GameError('Auctions are off for this game.');
      if (!game.rules.auctions && action.amount != null && money(action.amount) !== property.price) {
        throw new GameError(`Auctions are off, so ${property.name} sells for its list price of $${property.price.toLocaleString()}.`);
      }
      const price = action.amount == null ? property.price : money(action.amount);
      if (price < 1) throw new GameError('Purchase price must be at least $1.');
      buyer.balance -= price;
      deed.ownerId = buyer.id;
      record(game, { type: action.auction ? 'auction' : 'purchase', label: `${buyer.name} acquired ${property.name}`, detail: action.auction ? 'Auction purchase' : 'Purchased from Bank', amount: price, fromId: buyer.id, toId: BANK, propertyId: property.id });
      break;
    }
    case 'rent': {
      const { property, deed } = propertyAndDeed(game, action.propertyId);
      const tenant = player(game, action.payerId);
      if (!deed.ownerId) throw new GameError('This deed has no owner.');
      if (deed.ownerId === tenant.id) throw new GameError('The owner cannot pay themselves rent.');
      const owner = player(game, deed.ownerId);
      if (game.rules.noRentInJail && owner.inJail) throw new GameError(`No rent is collected while ${owner.name} is in jail.`);
      const amount = calculateRent(game, property.id, action.diceTotal);
      if (amount < 1) throw new GameError('No rent is due while this deed is mortgaged.');
      move(game, tenant.id, owner.id, amount, { type: 'rent', label: `${tenant.name} paid ${owner.name}`, detail: `Rent · ${property.name}`, propertyId: property.id });
      break;
    }
    case 'mortgage': {
      const owner = player(game, action.playerId);
      const { property, deed } = assertOwner(game, action.propertyId, owner.id);
      if (deed.mortgaged) throw new GameError('This deed is already mortgaged.');
      if (property.kind === 'street' && STREET_GROUP_IDS[property.group].some((id) => game.deeds[id].buildings > 0)) {
        throw new GameError('Sell all buildings in the color set before mortgaging.');
      }
      deed.mortgaged = true;
      owner.balance += property.mortgage;
      record(game, { type: 'mortgage', label: `${owner.name} mortgaged ${property.name}`, detail: 'Bank advanced mortgage value', amount: property.mortgage, fromId: BANK, toId: owner.id, propertyId: property.id });
      break;
    }
    case 'unmortgage': {
      const owner = player(game, action.playerId);
      const { property, deed } = assertOwner(game, action.propertyId, owner.id);
      if (!deed.mortgaged) throw new GameError('This deed is not mortgaged.');
      const amount = unmortgageCost(game, property);
      owner.balance -= amount;
      deed.mortgaged = false;
      record(game, { type: 'unmortgage', label: `${owner.name} unmortgaged ${property.name}`, detail: `Mortgage value + ${game.rules.mortgageInterestPercent}%`, amount, fromId: owner.id, toId: BANK, propertyId: property.id });
      break;
    }
    case 'building': {
      const owner = player(game, action.playerId);
      const { property, deed } = assertOwner(game, action.propertyId, owner.id);
      if (property.kind !== 'street') throw new GameError('Buildings can only be placed on streets.');
      if (deed.mortgaged) throw new GameError('Unmortgage this deed before building.');
      const groupIds = STREET_GROUP_IDS[property.group];
      if (!groupIds.every((id) => game.deeds[id].ownerId === owner.id && !game.deeds[id].mortgaged)) {
        throw new GameError('Own and unmortgage the complete color set before building.');
      }
      if (action.direction === 'buy') {
        if (deed.buildings >= 5) throw new GameError('This property already has a hotel.');
        const min = Math.min(...groupIds.map((id) => game.deeds[id].buildings));
        if (game.rules.evenBuilding && deed.buildings > min) throw new GameError('Build evenly across the color set.');
        deed.buildings += 1;
        owner.balance -= property.houseCost;
        record(game, { type: 'building', label: `${owner.name} added ${deed.buildings === 5 ? 'a hotel' : 'a house'}`, detail: property.name, amount: property.houseCost, fromId: owner.id, toId: BANK, propertyId: property.id });
      } else if (action.direction === 'sell') {
        if (deed.buildings < 1) throw new GameError('There are no buildings to sell.');
        const max = Math.max(...groupIds.map((id) => game.deeds[id].buildings));
        if (game.rules.evenBuilding && deed.buildings < max) throw new GameError('Sell evenly across the color set.');
        const amount = Math.floor(property.houseCost / 2);
        deed.buildings -= 1;
        owner.balance += amount;
        record(game, { type: 'building', label: `${owner.name} sold a building`, detail: property.name, amount, fromId: BANK, toId: owner.id, propertyId: property.id });
      } else throw new GameError('Choose whether to buy or sell a building.');
      break;
    }
    case 'trade': {
      const first = player(game, action.firstPlayerId);
      const second = player(game, action.secondPlayerId);
      if (first.id === second.id) throw new GameError('Choose two different players.');
      const give = [...new Set(action.firstPropertyIds || [])];
      const receive = [...new Set(action.secondPropertyIds || [])];
      if (give.some((id) => receive.includes(id))) throw new GameError('A deed cannot be on both sides of a trade.');
      const firstCash = money(action.firstCash || 0);
      const secondCash = money(action.secondCash || 0);
      if (!give.length && !receive.length && !firstCash && !secondCash) throw new GameError('Add cash or deeds to the trade.');
      give.forEach((id) => assertTradableDeed(game, id, first.id));
      receive.forEach((id) => assertTradableDeed(game, id, second.id));
      const giveNames = give.map((id) => transferDeed(game, id, first.id, second.id).name);
      const receiveNames = receive.map((id) => transferDeed(game, id, second.id, first.id).name);
      first.balance += secondCash - firstCash;
      second.balance += firstCash - secondCash;
      const details = [
        giveNames.length ? `${first.name}: ${giveNames.join(', ')}` : '',
        firstCash ? `${first.name}: $${firstCash.toLocaleString()}` : '',
        receiveNames.length ? `${second.name}: ${receiveNames.join(', ')}` : '',
        secondCash ? `${second.name}: $${secondCash.toLocaleString()}` : ''
      ].filter(Boolean).join(' · ');
      record(game, { type: 'trade', label: `${first.name} ↔ ${second.name}`, detail: details, amount: Math.max(firstCash, secondCash) || null, fromId: first.id, toId: second.id });
      break;
    }
    case 'collect-parking': {
      if (!game.rules.freeParkingJackpot) throw new GameError('The Free Parking jackpot is off for this game.');
      const winner = player(game, action.playerId);
      const pot = game.freeParking;
      if (pot < 1) throw new GameError('The Free Parking pot is empty.');
      const seed = game.rules.freeParkingSeed;
      winner.balance += pot;
      game.freeParking = seed;
      record(game, {
        type: 'parking', label: `${winner.name} collected Free Parking`,
        detail: seed ? `Bank reseeded the pot with $${seed.toLocaleString()}` : 'Pot emptied',
        amount: pot, fromId: PARKING, toId: winner.id
      });
      break;
    }
    case 'jail': {
      const prisoner = player(game, action.playerId);
      const inJail = flag(action.inJail, 'Jail status');
      if (prisoner.inJail === inJail) throw new GameError(`${prisoner.name} is ${inJail ? 'already' : 'not'} in jail.`);
      prisoner.inJail = inJail;
      record(game, { type: 'jail', label: inJail ? `${prisoner.name} went to jail` : `${prisoner.name} left jail`, detail: game.rules.noRentInJail && inJail ? 'No rent until released' : '', fromId: prisoner.id });
      break;
    }
    default:
      throw new GameError('Unknown action.');
  }
  return game;
}

export function publicGame(game) {
  return { ...game, properties: PROPERTIES };
}

export class GameStore {
  constructor({ ttlMs = 24 * 60 * 60 * 1000 } = {}) {
    this.games = new Map();
    this.ttlMs = ttlMs;
  }
  create(input) {
    const game = createGame(input);
    this.games.set(game.id, game);
    return game;
  }
  get(id) {
    const game = this.games.get(id);
    if (!game) throw new GameError('Game not found or expired.', 404);
    if (Date.now() - new Date(game.updatedAt).getTime() > this.ttlMs) {
      this.games.delete(id);
      throw new GameError('Game not found or expired.', 404);
    }
    return game;
  }
  sweep() {
    for (const [id, game] of this.games) {
      if (Date.now() - new Date(game.updatedAt).getTime() > this.ttlMs) this.games.delete(id);
    }
  }
}
