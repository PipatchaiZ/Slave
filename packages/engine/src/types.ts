import { Card } from './cards';
import { Combo } from './combos';

export type Role = 'king' | 'queen' | 'people' | 'viceslave' | 'slave';
export type Phase = 'lobby' | 'exchange' | 'playing' | 'round_over' | 'match_over';
export type Mode = 'normal' | 'sainua';

export interface Player {
  id: string;
  name: string;
  seat: number;
  connected: boolean;
  hand: Card[]; // server-only; never sent to other players
  handCount: number; // public
  finished: boolean; // emptied hand this round
  finishPosition: number | null; // 0-based order this player went out this round
  role: Role | null; // role from the most recently completed round
  score: number;
}

export interface PlayLogEntry {
  seat: number;
  pass: boolean;
  combo: Combo | null;
}

export interface TrickState {
  leadSeat: number;
  top: { combo: Combo; seat: number } | null;
  passed: number[]; // seats that have passed this trick
  plays: PlayLogEntry[];
}

/** One high-role player's pending obligation to choose cards to pass down. */
export interface ExchangeChoice {
  fromId: string; // high-role player who must choose
  toId: string; // low-role player who receives
  count: number;
  chosen: string[] | null; // chosen card ids, null until submitted
}

export interface ExchangeState {
  choices: ExchangeChoice[];
}

export interface RoundResultRow {
  playerId: string;
  name: string;
  role: Role;
  finishPosition: number; // raw finish order this round (before regicide)
  regicided: boolean;
  pointsAwarded: number;
}

export interface GameState {
  roomCode: string;
  hostId: string;
  mode: Mode;
  phase: Phase;
  players: Player[];
  /** Cards already played this round — the "used pile" sainua penalties draw from. */
  discard: Card[];
  totalRounds: number;
  roundNumber: number; // 1-based; 0 before match starts
  turnSeat: number;
  /** Turn rotation: +1 = ascending seats, -1 = descending. Flips each round. */
  direction: number;
  /** Wall-clock ms after which the current turn auto-resolves. Stamped by the server. */
  turnEndsAt: number | null;
  trick: TrickState;
  exchange: ExchangeState | null;
  finishCounter: number; // how many players have gone out this round
  defendingKingId: string | null; // king to beat going into the current round
  lastRoundResult: RoundResultRow[] | null;
  seed: number; // bookkeeping; the actual shuffle uses the injected rng
}

export class GameError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'GameError';
  }
}
