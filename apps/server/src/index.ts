import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import {
  CreatePayload,
  EV,
  ExchangePayload,
  GameError,
  JoinPayload,
  KickPayload,
  PlayPayload,
  ReconnectPayload,
  TransferHostPayload,
} from '@slave/engine';
import { RoomManager } from './rooms';
import { createStore } from './store';

const PORT = Number(process.env.PORT ?? 3001);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const rooms = new RoomManager(io);

// Optional Redis persistence (set REDIS_URL). Restores saved rooms on boot.
createStore()
  .then((store) => rooms.useStore(store))
  .catch((e) => console.error('[slave] store init failed:', e));

app.get('/health', (_req, res) => res.json({ ok: true }));

// Serve the built client in production (apps/web/dist), with SPA fallback.
const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, '../../web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : 'เกิดข้อผิดพลาด';
}
function codeOf(e: unknown): string | undefined {
  return e instanceof GameError ? e.code : undefined;
}

io.on('connection', (socket) => {
  socket.on(EV.create, (p: CreatePayload, cb?: (a: unknown) => void) => {
    try {
      const r = rooms.create(p.name, p.totalRounds, p.mode === 'sainua' ? 'sainua' : 'normal');
      rooms.attach(socket, r.roomCode, r.playerId, r.token);
      cb?.({ ok: true, ...r });
    } catch (e) {
      cb?.({ ok: false, error: msg(e) });
    }
  });

  socket.on(EV.join, (p: JoinPayload, cb?: (a: unknown) => void) => {
    try {
      const r = rooms.join(p.roomCode, p.name);
      rooms.attach(socket, p.roomCode, r.playerId, r.token);
      cb?.({ ok: true, playerId: r.playerId, token: r.token });
    } catch (e) {
      cb?.({ ok: false, error: msg(e) });
    }
  });

  socket.on(EV.reconnect, (p: ReconnectPayload, cb?: (a: unknown) => void) => {
    try {
      rooms.attach(socket, p.roomCode, p.playerId, p.token);
      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: msg(e) });
    }
  });

  const action = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      socket.emit(EV.error, { message: msg(e), code: codeOf(e) });
    }
  };

  socket.on(EV.start, () => action(() => rooms.start(socket.id)));
  socket.on(EV.play, (p: PlayPayload) => action(() => rooms.play(socket.id, p.cardIds)));
  socket.on(EV.pass, () => action(() => rooms.pass(socket.id)));
  socket.on(EV.exchange, (p: ExchangePayload) => action(() => rooms.exchange(socket.id, p.cardIds)));
  socket.on(EV.next, () => action(() => rooms.next(socket.id)));
  socket.on(EV.transferHost, (p: TransferHostPayload) =>
    action(() => rooms.transferHost(socket.id, p.toPlayerId)),
  );
  socket.on(EV.disband, () => action(() => rooms.disband(socket.id)));
  socket.on(EV.kick, (p: KickPayload) => action(() => rooms.kick(socket.id, p.playerId)));
  socket.on(EV.leave, () => action(() => rooms.leave(socket.id)));
  socket.on('disconnect', () => rooms.detach(socket.id));
});

server.listen(PORT, () => {
  console.log(`[slave] server listening on http://localhost:${PORT}`);
});
