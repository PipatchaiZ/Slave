import type { Server, Socket } from 'socket.io';
import { customAlphabet, nanoid } from 'nanoid';
import {
  EV,
  GameState,
  addPlayer,
  autoMove,
  chooseExchange,
  continueToNextRound,
  createGame,
  dropPlayer,
  pass,
  play,
  playerById,
  removePlayer,
  startMatch,
  viewFor,
} from '@slave/engine';
import type { PersistedRoom, RoomStore } from './store';

const roomCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 5);

const TURN_TIMEOUT_MS = Number(process.env.TURN_TIMEOUT_MS ?? 15000); // connected: auto-resolve
const AUTO_MOVE_GRACE_MS = 3000; // disconnected players: shorter grace
// The countdown shown to a connected player ends at turnEndsAt, but the server
// waits this much longer before actually auto-passing — so a click that lands
// right as the timer hits 0 (plus network latency) still counts instead of being
// rejected with a confusing "Not your turn" / "Card not in hand" red error.
const LATE_CLICK_GRACE_MS = Number(process.env.LATE_CLICK_GRACE_MS ?? 2500);
const NEXT_ROUND_AUTO_MS = Number(process.env.NEXT_ROUND_AUTO_MS ?? 12000);
// Grace before a dropped socket is treated as "left" — lets a page refresh /
// brief network blip reclaim the seat instead of nuking it.
const DISCONNECT_GRACE_MS = Number(process.env.DISCONNECT_GRACE_MS ?? 45000);
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;

interface Room {
  state: GameState;
  pendingRounds: number;
  tokens: Map<string, string>; // playerId -> secret token
  sockets: Map<string, string>; // playerId -> socketId
  autoTimer: ReturnType<typeof setTimeout> | null;
  armedTurnToken: string | null; // which turn-instance the autoTimer is armed for
  nextTimer: ReturnType<typeof setTimeout> | null;
  graceTimers: Map<string, ReturnType<typeof setTimeout>>; // playerId -> removal timer
  emptySince: number | null;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private socketIndex = new Map<string, { roomCode: string; playerId: string }>();
  private store: RoomStore | null = null;

  constructor(private io: Server) {
    setInterval(() => this.sweepEmptyRooms(), 60_000).unref?.();
  }

  /**
   * Attach a persistence store and reload any rooms it holds. Restored rooms come
   * back with every player marked disconnected and no live timers; the seats wait
   * (token still valid) for players to reconnect, and are swept if nobody does.
   */
  async useStore(store: RoomStore): Promise<void> {
    this.store = store;
    if (!store.enabled) return;
    const saved = await store.loadAll();
    const now = Date.now();
    let restored = 0;
    for (const pr of saved) {
      const code = pr.state.roomCode;
      if (!code || this.rooms.has(code)) continue;
      pr.state.players.forEach((p) => (p.connected = false));
      pr.state.turnEndsAt = null;
      this.rooms.set(code, {
        state: pr.state,
        pendingRounds: pr.pendingRounds,
        tokens: new Map(pr.tokens),
        sockets: new Map(),
        autoTimer: null,
        armedTurnToken: null,
        nextTimer: null,
        graceTimers: new Map(),
        emptySince: now,
      });
      restored++;
    }
    if (restored) console.log(`[slave] restored ${restored} room(s) from persistence`);
  }

  private persist(room: Room): void {
    if (!this.store?.enabled) return;
    const data: PersistedRoom = {
      state: room.state,
      pendingRounds: room.pendingRounds,
      tokens: [...room.tokens],
    };
    this.store.save(room.state.roomCode, data);
  }

  // ---- lifecycle ------------------------------------------------------------

  create(
    name: string,
    totalRounds: number,
    mode: 'normal' | 'sainua' = 'normal',
  ): { roomCode: string; playerId: string; token: string } {
    let code = roomCode();
    while (this.rooms.has(code)) code = roomCode();
    const playerId = nanoid(10);
    const token = nanoid(16);
    const state = createGame(code, { id: playerId, name: cleanName(name) }, mode);
    const room: Room = {
      state,
      pendingRounds: clampRounds(totalRounds),
      tokens: new Map([[playerId, token]]),
      sockets: new Map(),
      autoTimer: null,
      armedTurnToken: null,
      nextTimer: null,
      graceTimers: new Map(),
      emptySince: Date.now(),
    };
    this.rooms.set(code, room);
    this.persist(room);
    return { roomCode: code, playerId, token };
  }

  join(code: string, name: string): { playerId: string; token: string } {
    const room = this.getRoom(code);
    if (room.state.phase !== 'lobby') throw new Error('เกมเริ่มไปแล้ว เข้าไม่ได้');
    const playerId = nanoid(10);
    const token = nanoid(16);
    addPlayer(room.state, { id: playerId, name: cleanName(name) });
    room.tokens.set(playerId, token);
    this.persist(room);
    return { playerId, token };
  }

  attach(socket: Socket, code: string, playerId: string, token: string): void {
    const room = this.getRoom(code);
    if (room.tokens.get(playerId) !== token) throw new Error('โทเคนไม่ถูกต้อง');
    const player = playerById(room.state, playerId);
    if (!player) throw new Error('ไม่พบผู้เล่นในห้องนี้');

    // Bind the new socket first, then bump any previous one — so the previous
    // socket's disconnect handler sees it's been superseded and no-ops.
    const prev = room.sockets.get(playerId);
    room.sockets.set(playerId, socket.id);
    this.socketIndex.set(socket.id, { roomCode: code, playerId });
    if (prev && prev !== socket.id) {
      this.socketIndex.delete(prev);
      this.io.sockets.sockets.get(prev)?.disconnect(true);
    }

    player.connected = true;
    room.emptySince = null;
    // Reconnected in time -> cancel the pending removal/disband.
    const grace = room.graceTimers.get(playerId);
    if (grace) {
      clearTimeout(grace);
      room.graceTimers.delete(playerId);
    }
    socket.join(code);
    this.tick(room);
    this.broadcast(room);
  }

  /** Unexpected socket drop (refresh / network). Grace-delayed, reversible. */
  detach(socketId: string): void {
    const ref = this.socketIndex.get(socketId);
    this.socketIndex.delete(socketId);
    if (!ref) return;
    const room = this.rooms.get(ref.roomCode);
    if (!room) return;
    // Ignore if this socket was already replaced by a newer one for the player.
    if (room.sockets.get(ref.playerId) !== socketId) return;

    room.sockets.delete(ref.playerId);
    const player = playerById(room.state, ref.playerId);
    if (player) player.connected = false;

    // Don't remove/disband/reassign yet — give the player time to reconnect.
    // In the lobby every drop is graced; mid-game only the host needs a grace
    // (others keep their seat indefinitely and auto-pass until they return).
    if (room.state.phase === 'lobby' || room.state.hostId === ref.playerId) {
      const t = setTimeout(() => this.finalizeGrace(ref.roomCode, ref.playerId), DISCONNECT_GRACE_MS);
      room.graceTimers.set(ref.playerId, t);
    }

    if (room.sockets.size === 0) room.emptySince = Date.now();
    this.tick(room);
    this.broadcast(room);
  }

  /** Grace expired without a reconnect -> finalize the departure. */
  private finalizeGrace(code: string, playerId: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    room.graceTimers.delete(playerId);
    const player = playerById(room.state, playerId);
    if (!player || player.connected) return; // reconnected in time

    // A drop/refresh is NOT an explicit leave — never disband the room here.
    if (room.state.phase === 'lobby') {
      if (room.state.hostId === playerId) {
        // Hand host to someone connected and drop the absent host; if nobody
        // else is here, keep the room so the host can reconnect (token still valid).
        const heir = room.state.players.find((p) => p.connected && p.id !== playerId);
        if (heir) {
          room.state.hostId = heir.id;
          try {
            removePlayer(room.state, playerId);
          } catch {
            /* ignore */
          }
        }
      } else {
        try {
          removePlayer(room.state, playerId);
        } catch {
          /* ignore */
        }
      }
    } else if (room.state.hostId === playerId) {
      const heir = room.state.players.find((p) => p.connected && p.id !== playerId);
      if (heir) room.state.hostId = heir.id;
    }
    if (room.sockets.size === 0) room.emptySince = Date.now();
    this.broadcast(room);
  }

  /** Explicit "leave" button — immediate, no grace. */
  leave(socketId: string): void {
    const ref = this.socketIndex.get(socketId);
    this.socketIndex.delete(socketId);
    if (!ref) return;
    const room = this.rooms.get(ref.roomCode);
    if (!room) return;
    if (room.sockets.get(ref.playerId) === socketId) room.sockets.delete(ref.playerId);
    const player = playerById(room.state, ref.playerId);
    if (player) player.connected = false;

    const grace = room.graceTimers.get(ref.playerId);
    if (grace) {
      clearTimeout(grace);
      room.graceTimers.delete(ref.playerId);
    }

    if (room.state.phase === 'lobby') {
      if (room.state.hostId === ref.playerId) {
        this.closeRoom(ref.roomCode, 'host ออกจากห้อง • ห้องถูกปิด');
        return;
      }
      try {
        removePlayer(room.state, ref.playerId);
      } catch {
        /* ignore */
      }
    } else {
      // Mid-match: drop them from the round (hand to the pile, out of rotation,
      // excluded from ranking) and block rejoin.
      room.tokens.delete(ref.playerId);
      try {
        dropPlayer(room.state, ref.playerId);
      } catch {
        /* ignore */
      }
    }

    if (room.sockets.size === 0) room.emptySince = Date.now();
    this.tick(room);
    this.broadcast(room);
  }

  private closeRoom(code: string, message: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    if (room.autoTimer) clearTimeout(room.autoTimer);
    if (room.nextTimer) clearTimeout(room.nextTimer);
    for (const t of room.graceTimers.values()) clearTimeout(t);
    room.graceTimers.clear();
    for (const [, socketId] of room.sockets) {
      const sock = this.io.sockets.sockets.get(socketId);
      if (sock) sock.emit(EV.closed, { message });
      this.socketIndex.delete(socketId);
    }
    this.rooms.delete(code);
    this.store?.remove(code);
  }

  // ---- actions --------------------------------------------------------------

  start(socketId: string): void {
    const { room, playerId } = this.resolve(socketId);
    if (room.state.hostId !== playerId) throw new Error('เฉพาะ host เท่านั้นที่เริ่มเกมได้');
    startMatch(room.state, room.pendingRounds);
    this.afterAction(room);
  }

  play(socketId: string, cardIds: string[]): void {
    const { room, playerId } = this.resolve(socketId);
    play(room.state, playerId, cardIds);
    this.afterAction(room);
  }

  pass(socketId: string): void {
    const { room, playerId } = this.resolve(socketId);
    pass(room.state, playerId);
    this.afterAction(room);
  }

  exchange(socketId: string, cardIds: string[]): void {
    const { room, playerId } = this.resolve(socketId);
    chooseExchange(room.state, playerId, cardIds);
    this.afterAction(room);
  }

  next(socketId: string): void {
    const { room, playerId } = this.resolve(socketId);
    if (room.state.hostId !== playerId) throw new Error('เฉพาะ host เท่านั้น');
    continueToNextRound(room.state);
    this.afterAction(room);
  }

  transferHost(socketId: string, toPlayerId: string): void {
    const { room, playerId } = this.resolve(socketId);
    if (room.state.hostId !== playerId) throw new Error('เฉพาะ host เท่านั้น');
    const target = playerById(room.state, toPlayerId);
    if (!target) throw new Error('ไม่พบผู้เล่นที่จะโอนสิทธิ์ให้');
    room.state.hostId = toPlayerId;
    this.afterAction(room);
  }

  disband(socketId: string): void {
    const { room, playerId } = this.resolve(socketId);
    if (room.state.hostId !== playerId) throw new Error('เฉพาะ host เท่านั้น');
    this.closeRoom(room.state.roomCode, 'host ยุบห้อง • ห้องถูกปิด');
  }

  kick(socketId: string, targetId: string): void {
    const { room, playerId } = this.resolve(socketId);
    if (room.state.hostId !== playerId) throw new Error('เฉพาะ host เท่านั้น');
    if (targetId === playerId) throw new Error('เตะตัวเองไม่ได้');
    const target = playerById(room.state, targetId);
    if (!target) throw new Error('ไม่พบผู้เล่นที่จะเตะ');

    // Block any rejoin, evict the socket, send the kicked player home.
    room.tokens.delete(targetId);
    const sockId = room.sockets.get(targetId);
    if (sockId) {
      room.sockets.delete(targetId);
      this.socketIndex.delete(sockId);
      const sock = this.io.sockets.sockets.get(sockId);
      if (sock) {
        sock.emit(EV.closed, { message: 'คุณถูกเตะออกจากห้อง' });
        setTimeout(() => sock.disconnect(true), 100);
      }
    }

    if (room.state.phase === 'lobby') {
      // Remove entirely before the game starts.
      try {
        removePlayer(room.state, targetId);
      } catch {
        /* ignore */
      }
    } else {
      // Mid-match: drop from the round — hand to the pile, out of rotation,
      // excluded from ranking (roles recompute for the remaining head-count).
      try {
        dropPlayer(room.state, targetId);
      } catch {
        /* ignore */
      }
    }

    if (room.sockets.size === 0) room.emptySince = Date.now();
    this.afterAction(room);
  }

  // ---- internals ------------------------------------------------------------

  private afterAction(room: Room): void {
    this.tick(room);
    this.broadcast(room);
  }

  /** Keep the game moving: auto-act for disconnected players, schedule next round. */
  private tick(room: Room): void {
    const s = room.state;
    if (room.nextTimer) {
      clearTimeout(room.nextTimer);
      room.nextTimer = null;
    }

    if (s.phase === 'playing') {
      const turnPlayer = s.players.find((p) => p.seat === s.turnSeat);
      const token = turnPlayer ? `${s.roundNumber}:${s.turnSeat}:${s.trick.plays.length}` : null;
      // Same turn already armed -> keep the existing deadline so reconnects /
      // broadcasts don't restart the countdown (keeps every client in sync).
      if (token && token === room.armedTurnToken && room.autoTimer) return;

      if (room.autoTimer) {
        clearTimeout(room.autoTimer);
        room.autoTimer = null;
      }
      if (!turnPlayer) {
        s.turnEndsAt = null;
        room.armedTurnToken = null;
        return;
      }
      const grace = turnPlayer.connected ? TURN_TIMEOUT_MS : AUTO_MOVE_GRACE_MS;
      s.turnEndsAt = Date.now() + grace;
      room.armedTurnToken = token;
      // Connected players get a hidden buffer past the visible deadline so a
      // last-second click isn't raced by the auto-pass; the disconnected don't.
      const fireIn = grace + (turnPlayer.connected ? LATE_CLICK_GRACE_MS : 0);
      room.autoTimer = setTimeout(() => {
        room.autoTimer = null;
        room.armedTurnToken = null;
        try {
          autoMove(s, turnPlayer.id);
        } catch {
          /* state moved on already */
        }
        this.tick(room);
        this.broadcast(room);
      }, fireIn);
      return;
    }

    // Non-playing phases: tear down the turn timer.
    if (room.autoTimer) {
      clearTimeout(room.autoTimer);
      room.autoTimer = null;
    }
    room.armedTurnToken = null;
    s.turnEndsAt = null;

    if (s.phase === 'exchange' && s.exchange) {
      // Auto-resolve choices for disconnected high-role players immediately.
      let changed = false;
      for (const choice of s.exchange.choices) {
        if (choice.chosen) continue;
        const from = playerById(s, choice.fromId);
        if (from && !from.connected) {
          try {
            chooseExchange(s, choice.fromId, from.hand.slice(0, choice.count).map(idOf));
            changed = true;
          } catch {
            /* ignore */
          }
        }
      }
      if (changed) {
        this.tick(room);
        return;
      }
    } else if (s.phase === 'round_over') {
      room.nextTimer = setTimeout(() => {
        room.nextTimer = null;
        try {
          continueToNextRound(s);
        } catch {
          /* ignore */
        }
        this.tick(room);
        this.broadcast(room);
      }, NEXT_ROUND_AUTO_MS);
    }
  }

  private broadcast(room: Room): void {
    this.persist(room); // every state change is also a save point
    for (const [playerId, socketId] of room.sockets) {
      const sock = this.io.sockets.sockets.get(socketId);
      if (sock) sock.emit(EV.state, viewFor(room.state, playerId));
    }
  }

  private getRoom(code: string): Room {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) throw new Error('ไม่พบห้องนี้');
    return room;
  }

  private resolve(socketId: string): { room: Room; playerId: string } {
    const ref = this.socketIndex.get(socketId);
    if (!ref) throw new Error('ยังไม่ได้เข้าห้อง');
    const room = this.rooms.get(ref.roomCode);
    if (!room) throw new Error('ห้องถูกปิดไปแล้ว');
    return { room, playerId: ref.playerId };
  }

  private sweepEmptyRooms(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.emptySince && now - room.emptySince > EMPTY_ROOM_TTL_MS) {
        if (room.autoTimer) clearTimeout(room.autoTimer);
        if (room.nextTimer) clearTimeout(room.nextTimer);
        for (const t of room.graceTimers.values()) clearTimeout(t);
        this.rooms.delete(code);
        this.store?.remove(code);
      }
    }
  }
}

function idOf(c: { rank: string; suit: string }): string {
  return `${c.rank}${c.suit}`;
}
function cleanName(name: string): string {
  const n = (name ?? '').trim().slice(0, 16);
  return n.length ? n : 'Player';
}
function clampRounds(r: number): number {
  if (!Number.isFinite(r)) return 3;
  return Math.min(20, Math.max(1, Math.floor(r)));
}
