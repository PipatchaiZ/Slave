// Authoritative game state machine for Slave.
// All functions mutate the passed GameState and throw GameError on illegal moves.

import {
  Card,
  Rng,
  cardId,
  compareCards,
  createDeck,
  deal,
  shuffle,
  sortHand,
} from './cards';
import { Combo, beats, detectCombo, isSlap } from './combos';
import {
  ExchangeChoice,
  GameError,
  GameState,
  Mode,
  Player,
  Role,
  RoundResultRow,
  TrickState,
} from './types';

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;

function emptyTrick(leadSeat: number): TrickState {
  return { leadSeat, top: null, passed: [], plays: [] };
}

export function createGame(
  roomCode: string,
  host: { id: string; name: string },
  mode: Mode = 'normal',
): GameState {
  const state: GameState = {
    roomCode,
    hostId: host.id,
    mode,
    phase: 'lobby',
    players: [],
    discard: [],
    totalRounds: 0,
    roundNumber: 0,
    turnSeat: 0,
    direction: 1,
    turnEndsAt: null,
    trick: emptyTrick(0),
    exchange: null,
    finishCounter: 0,
    defendingKingId: null,
    lastRoundResult: null,
    seed: 0,
  };
  addPlayer(state, host);
  return state;
}

export function playerById(state: GameState, id: string): Player | undefined {
  return state.players.find((p) => p.id === id);
}
function playerBySeat(state: GameState, seat: number): Player {
  const p = state.players.find((pl) => pl.seat === seat);
  if (!p) throw new GameError('no_seat', `No player at seat ${seat}`);
  return p;
}

export function addPlayer(state: GameState, who: { id: string; name: string }): Player {
  if (state.phase !== 'lobby') throw new GameError('not_lobby', 'Game already started');
  if (state.players.length >= MAX_PLAYERS) throw new GameError('full', 'Room is full');
  if (playerById(state, who.id)) throw new GameError('dup_player', 'Player already in room');
  const player: Player = {
    id: who.id,
    name: who.name,
    seat: state.players.length,
    connected: true,
    hand: [],
    handCount: 0,
    finished: false,
    finishPosition: null,
    role: null,
    score: 0,
  };
  state.players.push(player);
  return player;
}

export function removePlayer(state: GameState, id: string): void {
  if (state.phase !== 'lobby') throw new GameError('not_lobby', 'Cannot remove mid-match');
  state.players = state.players.filter((p) => p.id !== id);
  state.players.forEach((p, i) => (p.seat = i));
  if (state.hostId === id && state.players.length > 0) state.hostId = state.players[0].id;
}

/** Round-1 leader: holder of 3♣ if it was dealt, otherwise the lowest card. */
function firstLeadSeat(state: GameState): number {
  let minSeat = state.players[0].seat;
  let minCard: Card | null = null;
  for (const p of state.players) {
    for (const c of p.hand) {
      if (c.rank === '3' && c.suit === 'C') return p.seat;
      if (minCard === null || compareCards(c, minCard) < 0) {
        minCard = c;
        minSeat = p.seat;
      }
    }
  }
  return minSeat;
}

function dealToPlayers(state: GameState, rng: Rng): void {
  const deck = shuffle(createDeck(), rng);
  const hands = deal(deck, state.players.length);
  state.players.forEach((p, i) => {
    p.hand = hands[i];
    p.handCount = p.hand.length;
    p.finished = false;
    p.finishPosition = null;
  });
  state.finishCounter = 0;
  state.discard = [];
}

export function startMatch(state: GameState, totalRounds: number, rng: Rng = Math.random): void {
  if (state.phase !== 'lobby') throw new GameError('not_lobby', 'Game already started');
  const n = state.players.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) {
    throw new GameError('bad_count', `Need ${MIN_PLAYERS}-${MAX_PLAYERS} players`);
  }
  if (!Number.isInteger(totalRounds) || totalRounds < 1) {
    throw new GameError('bad_rounds', 'totalRounds must be >= 1');
  }
  state.totalRounds = totalRounds;
  state.roundNumber = 0;
  state.defendingKingId = null;
  state.lastRoundResult = null;
  state.players.forEach((p) => {
    p.score = 0;
    p.role = 'people'; // round 1: everyone starts equal as People
  });
  beginRound(state, rng);
}

export function beginRound(state: GameState, rng: Rng = Math.random): void {
  state.roundNumber += 1;
  // Alternate the rotation each round (round 1 ascending, round 2 descending…).
  state.direction = state.roundNumber % 2 === 1 ? 1 : -1;
  dealToPlayers(state, rng);

  if (state.roundNumber === 1) {
    state.defendingKingId = null;
    state.exchange = null;
    const lead = firstLeadSeat(state);
    state.trick = emptyTrick(lead);
    state.turnSeat = lead;
    state.phase = 'playing';
  } else {
    state.trick = emptyTrick(0); // clear last round's pile/statuses for the exchange
    setupExchange(state);
    state.phase = 'exchange';
  }
}

// ---- Card exchange (round 2+) ------------------------------------------------

function setupExchange(state: GameState): void {
  const ranking = (state.lastRoundResult ?? []).map((r) => r.playerId);
  const n = ranking.length;

  // King <-> Slave swap 2 cards. Queen <-> the 2nd-to-last finisher swap 1
  // (>= 4 players) — that partner is a People with 4 players, Vice-Slave with >= 5.
  const choices: ExchangeChoice[] = [
    { fromId: ranking[0], toId: ranking[n - 1], count: 2, chosen: null },
  ];
  if (n >= 4) {
    choices.push({ fromId: ranking[1], toId: ranking[n - 2], count: 1, chosen: null });
  }
  state.exchange = { choices };
}

export function chooseExchange(state: GameState, playerId: string, cardIds: string[]): void {
  if (state.phase !== 'exchange' || !state.exchange) {
    throw new GameError('not_exchange', 'Not in exchange phase');
  }
  const choice = state.exchange.choices.find((c) => c.fromId === playerId && c.chosen === null);
  if (!choice) throw new GameError('no_choice', 'No pending exchange for this player');
  if (cardIds.length !== choice.count) {
    throw new GameError('bad_count', `Must choose exactly ${choice.count} card(s)`);
  }
  const player = playerById(state, playerId)!;
  // Validate ownership without committing yet.
  takeCards(player, cardIds);
  choice.chosen = cardIds.slice();

  if (state.exchange.choices.every((c) => c.chosen !== null)) resolveExchange(state);
}

function resolveExchange(state: GameState): void {
  const ex = state.exchange!;
  // Snapshot the low player's top cards BEFORE any transfer mutates hands.
  const snapshots = ex.choices.map((choice) => {
    const low = playerById(state, choice.toId)!;
    const gift = sortHand(low.hand).slice(-choice.count);
    return { choice, gift: gift.map(cardId) };
  });

  for (const { choice, gift } of snapshots) {
    const high = playerById(state, choice.fromId)!;
    const low = playerById(state, choice.toId)!;
    const fromHigh = takeCards(high, choice.chosen!);
    high.hand = fromHigh.remaining;
    const fromLow = takeCards(low, gift);
    low.hand = fromLow.remaining;
    // swap
    high.hand.push(...fromLow.taken);
    low.hand.push(...fromHigh.taken);
  }

  state.players.forEach((p) => {
    p.hand = sortHand(p.hand);
    p.handCount = p.hand.length;
  });
  state.exchange = null;

  // Previous slave leads the new round.
  const slaveId = state.lastRoundResult!.at(-1)!.playerId;
  const lead = playerById(state, slaveId)!.seat;
  state.trick = emptyTrick(lead);
  state.turnSeat = lead;
  state.phase = 'playing';
}

// ---- Playing -----------------------------------------------------------------

function takeCards(player: Player, ids: string[]): { taken: Card[]; remaining: Card[] } {
  const set = new Set(ids);
  if (set.size !== ids.length) throw new GameError('dup_cards', 'Duplicate cards in selection');
  const taken: Card[] = [];
  const remaining: Card[] = [];
  for (const c of player.hand) {
    if (set.has(cardId(c))) taken.push(c);
    else remaining.push(c);
  }
  if (taken.length !== ids.length) throw new GameError('not_in_hand', 'Card not in hand');
  return { taken, remaining };
}

function requireTurn(state: GameState, playerId: string): Player {
  if (state.phase !== 'playing') throw new GameError('not_playing', 'Not in playing phase');
  const player = playerById(state, playerId);
  if (!player) throw new GameError('no_player', 'Unknown player');
  if (player.finished) throw new GameError('finished', 'You have no cards left');
  if (player.seat !== state.turnSeat) throw new GameError('not_turn', 'Not your turn');
  return player;
}

/** Each still-in player (except the slapper) draws n random cards from the discard. */
function applySlapPenalty(state: GameState, slapperSeat: number, n: number, rng: Rng): void {
  for (const p of state.players) {
    if (p.finished || p.seat === slapperSeat) continue;
    for (let k = 0; k < n; k++) {
      if (state.discard.length === 0) break;
      const idx = Math.floor(rng() * state.discard.length);
      const [card] = state.discard.splice(idx, 1);
      p.hand.push(card);
    }
    p.hand = sortHand(p.hand);
    p.handCount = p.hand.length;
  }
}

export function play(
  state: GameState,
  playerId: string,
  cardIds: string[],
  rng: Rng = Math.random,
): Combo {
  const player = requireTurn(state, playerId);
  const { taken, remaining } = takeCards(player, cardIds);
  const combo = detectCombo(taken);
  if (!combo) throw new GameError('invalid_combo', 'Not a legal combo');

  const top = state.trick.top?.combo ?? null;
  const slap = top != null && isSlap(combo, top); // ตบ is legal in both modes
  if (top && !beats(combo, top) && !slap) {
    throw new GameError('too_weak', 'Does not beat the current play');
  }

  player.hand = remaining;
  player.handCount = remaining.length;
  state.discard.push(...combo.cards);
  state.trick.top = { combo, seat: player.seat };
  state.trick.plays.push({ seat: player.seat, pass: false, combo });

  if (player.hand.length === 0) {
    player.finished = true;
    player.finishPosition = state.finishCounter++;
  }

  // sainua: playing a triple/four makes everyone else draw from the used pile
  // (triple -> 1, four -> 2), whether it's a lead, a same-shape beat, or a slap.
  if (state.mode === 'sainua' && (combo.kind === 'triple' || combo.kind === 'four')) {
    applySlapPenalty(state, player.seat, combo.kind === 'four' ? 2 : 1, rng);
  }

  advance(state, player.seat);
  return combo;
}

export function pass(state: GameState, playerId: string): void {
  const player = requireTurn(state, playerId);
  if (!state.trick.top) throw new GameError('must_lead', 'You lead the trick and must play');
  state.trick.passed.push(player.seat);
  state.trick.plays.push({ seat: player.seat, pass: true, combo: null });
  advance(state, player.seat);
}

/** Auto-action for disconnected/timed-out players: pass, or lead the lowest single. */
export function autoMove(state: GameState, playerId: string): void {
  const player = requireTurn(state, playerId);
  if (state.trick.top) {
    pass(state, playerId);
  } else {
    const lowest = sortHand(player.hand)[0];
    play(state, playerId, [cardId(lowest)]);
  }
}

function activeNotFinished(state: GameState): Player[] {
  return state.players.filter((p) => !p.finished);
}

function nextSeatIn(state: GameState, fromSeat: number, eligible: Set<number>): number {
  const n = state.players.length;
  const dir = state.direction || 1;
  for (let step = 1; step <= n; step++) {
    const seat = (((fromSeat + dir * step) % n) + n) % n;
    if (eligible.has(seat)) return seat;
  }
  return fromSeat;
}

function advance(state: GameState, lastSeat: number): void {
  // Round end: only one (or zero) player still holds cards.
  if (activeNotFinished(state).length <= 1) {
    endRound(state);
    return;
  }

  const top = state.trick.top!; // top is always set after the first play; pass requires it
  const passed = new Set(state.trick.passed);
  const eligible = new Set<number>();
  for (const p of state.players) {
    if (!p.finished && !passed.has(p.seat) && p.seat !== top.seat) eligible.add(p.seat);
  }

  if (eligible.size === 0) {
    endTrick(state, top.seat);
  } else {
    state.turnSeat = nextSeatIn(state, lastSeat, eligible);
  }
}

function endTrick(state: GameState, winnerSeat: number): void {
  const winner = playerBySeat(state, winnerSeat);
  let leadSeat = winnerSeat;
  if (winner.finished) {
    const eligible = new Set(activeNotFinished(state).map((p) => p.seat));
    leadSeat = nextSeatIn(state, winnerSeat, eligible);
  }
  state.trick = emptyTrick(leadSeat);
  state.turnSeat = leadSeat;
}

export interface RankingResolution {
  /** Effective ranking, best -> worst, after regicide. */
  order: string[];
  regicidedId: string | null;
  roles: Record<string, Role>;
  points: Record<string, number>;
}

/**
 * Role for a finishing rank (0 = first out). Queen exists with >= 4 players,
 * Vice-Slave with >= 5. Used both for end-of-round scoring and for the live
 * badge shown the moment a player goes out.
 */
export function roleForRank(index: number, playerCount: number): Role {
  if (index === 0) return 'king';
  if (index === playerCount - 1) return 'slave';
  if (playerCount >= 4 && index === 1) return 'queen';
  if (playerCount >= 5 && index === playerCount - 2) return 'viceslave';
  return 'people';
}

/**
 * Provisional roles to show DURING a round, before final scoring locks in.
 * - The first player out is already King, the second (n>=4) Queen, the live
 *   slave slot fills from the bottom as players go out.
 * - The moment a defending king's regicide is certain (someone else finished
 *   first), that king is shown as Slave immediately, and every player who
 *   finished AFTER him shifts up one role to fill the gap he leaves.
 * - Players still holding cards keep their previous-round role as a hint, since
 *   their final standing isn't determined yet.
 * Outside an active round this just mirrors the stored (final) role.
 */
export function liveRoles(state: GameState): Record<string, Role | null> {
  const n = state.players.length;
  const out: Record<string, Role | null> = {};
  if (state.phase !== 'playing') {
    for (const p of state.players) out[p.id] = p.role;
    return out;
  }

  const kingId = state.defendingKingId;
  const firstOut = state.players.find((p) => p.finishPosition === 0) ?? null;
  const kingPlayer = kingId ? (state.players.find((p) => p.id === kingId) ?? null) : null;
  // Regicide is certain once someone OTHER than the defending king is first out.
  const regicideLocked = !!kingId && !!firstOut && firstOut.id !== kingId;
  const kingFinishPos = kingPlayer?.finishPosition ?? null;

  for (const p of state.players) {
    if (regicideLocked && p.id === kingId) {
      out[p.id] = 'slave'; // demoted to the very bottom
    } else if (p.finished && p.finishPosition != null) {
      // Removing the regicided king shifts later finishers up one place.
      const shift = regicideLocked && kingFinishPos != null && p.finishPosition > kingFinishPos ? 1 : 0;
      out[p.id] = roleForRank(p.finishPosition - shift, n);
    } else {
      out[p.id] = p.role;
    }
  }
  return out;
}

/**
 * Pure roles + scoring resolver. `rawIds` is the finish order (first out first).
 * If a defending king exists and did NOT finish first, they are removed and
 * forced to the bottom; everyone else compacts up by finish order.
 */
export function resolveRanking(rawIds: string[], defendingKingId: string | null): RankingResolution {
  let order = rawIds.slice();
  const regicidedId =
    defendingKingId && rawIds[0] !== defendingKingId ? defendingKingId : null;
  if (regicidedId) {
    order = order.filter((id) => id !== regicidedId);
    order.push(regicidedId);
  }

  const n = order.length;
  const roles: Record<string, Role> = {};
  const points: Record<string, number> = {};
  order.forEach((id, index) => {
    roles[id] = roleForRank(index, n);
    points[id] = n - 1 - index; // king = n-1 ... slave = 0
  });
  return { order, regicidedId, roles, points };
}

function endRound(state: GameState): void {
  // The remaining player (if any) becomes the last to "finish".
  const remaining = activeNotFinished(state);
  if (remaining.length === 1) {
    remaining[0].finished = true;
    remaining[0].finishPosition = state.finishCounter++;
  }

  const rawIds = [...state.players]
    .sort((a, b) => (a.finishPosition ?? 0) - (b.finishPosition ?? 0))
    .map((p) => p.id);

  const { order, regicidedId, roles, points } = resolveRanking(rawIds, state.defendingKingId);

  const result: RoundResultRow[] = order.map((id) => {
    const p = playerById(state, id)!;
    p.role = roles[id];
    p.score += points[id];
    return {
      playerId: id,
      name: p.name,
      role: roles[id],
      finishPosition: p.finishPosition ?? 0,
      regicided: id === regicidedId,
      pointsAwarded: points[id],
    };
  });

  state.lastRoundResult = result;
  state.defendingKingId = order[0];
  state.phase = state.roundNumber >= state.totalRounds ? 'match_over' : 'round_over';
}

/** Begin the next round after a round_over pause. */
export function continueToNextRound(state: GameState, rng: Rng = Math.random): void {
  if (state.phase !== 'round_over') throw new GameError('not_round_over', 'Round is not over');
  beginRound(state, rng);
}
