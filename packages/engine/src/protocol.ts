// Wire protocol shared by server and client.
import { GameView } from './view';

export const EV = {
  create: 'room:create',
  join: 'room:join',
  reconnect: 'room:reconnect',
  start: 'room:start',
  play: 'game:play',
  pass: 'game:pass',
  exchange: 'game:exchange',
  next: 'game:next',
  leave: 'room:leave',
  transferHost: 'room:transferHost',
  disband: 'room:disband',
  kick: 'room:kick',
  // server -> client
  state: 'state',
  error: 'errorMsg',
  closed: 'room:closed',
} as const;

export interface CreatePayload {
  name: string;
  totalRounds: number;
  mode?: 'normal' | 'sainua';
}
export interface CreateAck {
  ok: boolean;
  roomCode?: string;
  playerId?: string;
  token?: string;
  error?: string;
}
export interface JoinPayload {
  roomCode: string;
  name: string;
}
export interface ReconnectPayload {
  roomCode: string;
  playerId: string;
  token: string;
}
export interface JoinAck {
  ok: boolean;
  playerId?: string;
  token?: string;
  error?: string;
}
export interface Ack {
  ok: boolean;
  error?: string;
}
export interface ErrorPayload {
  message: string;
  /** GameError code, when available — lets the client quietly drop transient
   * "your move didn't apply" races (the board already re-rendered). */
  code?: string;
}
export interface PlayPayload {
  cardIds: string[];
}
export interface ExchangePayload {
  cardIds: string[];
}
export interface TransferHostPayload {
  toPlayerId: string;
}
export interface KickPayload {
  playerId: string;
}

export type { GameView };
