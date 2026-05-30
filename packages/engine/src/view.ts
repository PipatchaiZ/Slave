// Server -> client projection. Hides every hand except the viewer's so that
// hidden information never leaves the authoritative server.

import { Card } from './cards';
import { liveRoles } from './game';
import { ExchangeChoice, GameState, Mode, Phase, Role, RoundResultRow, TrickState } from './types';

export interface PlayerView {
  id: string;
  name: string;
  seat: number;
  connected: boolean;
  handCount: number;
  finished: boolean;
  finishPosition: number | null;
  role: Role | null;
  /** Provisional role to display right now (live King/Queen/Slave, regicide). */
  liveRole: Role | null;
  score: number;
  isYou: boolean;
}

export interface ExchangeChoiceView {
  fromId: string;
  toId: string;
  count: number;
  submitted: boolean;
  /** Only present for the viewer's own pending choice. */
  yourTurn: boolean;
}

export interface GameView {
  roomCode: string;
  hostId: string;
  mode: Mode;
  phase: Phase;
  players: PlayerView[];
  totalRounds: number;
  roundNumber: number;
  turnSeat: number;
  /** Turn rotation: +1 ascending seats, -1 descending. */
  direction: number;
  /** Absolute server-clock ms when the current turn auto-resolves, or null. */
  turnEndsAt: number | null;
  /** Server clock at the moment this view was produced (for clock-offset sync). */
  serverNow: number;
  trick: TrickState;
  exchange: { choices: ExchangeChoiceView[] } | null;
  defendingKingId: string | null;
  lastRoundResult: RoundResultRow[] | null;
  /** The viewer's own hand, sorted. Empty if spectating/unknown. */
  yourHand: Card[];
  yourId: string;
}

export function viewFor(state: GameState, viewerId: string): GameView {
  const you = state.players.find((p) => p.id === viewerId);
  const live = liveRoles(state);
  return {
    roomCode: state.roomCode,
    hostId: state.hostId,
    mode: state.mode,
    phase: state.phase,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      connected: p.connected,
      handCount: p.handCount,
      finished: p.finished,
      finishPosition: p.finishPosition,
      role: p.role,
      liveRole: live[p.id] ?? p.role,
      score: p.score,
      isYou: p.id === viewerId,
    })),
    totalRounds: state.totalRounds,
    roundNumber: state.roundNumber,
    turnSeat: state.turnSeat,
    direction: state.direction,
    turnEndsAt: state.turnEndsAt,
    serverNow: Date.now(),
    trick: state.trick,
    exchange: state.exchange
      ? {
          choices: state.exchange.choices.map((c: ExchangeChoice) => ({
            fromId: c.fromId,
            toId: c.toId,
            count: c.count,
            submitted: c.chosen !== null,
            yourTurn: c.fromId === viewerId && c.chosen === null,
          })),
        }
      : null,
    defendingKingId: state.defendingKingId,
    lastRoundResult: state.lastRoundResult,
    yourHand: you ? you.hand : [],
    yourId: viewerId,
  };
}
