// Verifies that a player who drops mid-game can rebind to their seat using the
// saved session (roomCode + playerId + token).
import { io, type Socket } from 'socket.io-client';
import { EV, type GameView } from '@slave/engine';

const URL = process.env.URL ?? 'http://localhost:3014';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function ack<T>(s: Socket, ev: string, p: unknown): Promise<T> {
  return new Promise((res) => s.emit(ev, p, res));
}
function connect(): Promise<Socket> {
  const s = io(URL, { forceNew: true, transports: ['websocket'] });
  return new Promise((r) => s.on('connect', () => r(s)));
}

interface Cred {
  ok: boolean;
  roomCode?: string;
  playerId?: string;
  token?: string;
}

async function main() {
  const host = await connect();
  const p1 = await connect();
  let p2 = await connect();

  const views = new Map<Socket, GameView>();
  host.on(EV.state, (v: GameView) => views.set(host, v));

  const c = await ack<Cred>(host, EV.create, { name: 'Host', totalRounds: 1 });
  const code = c.roomCode!;
  await ack(p1, EV.join, { roomCode: code, name: 'P1' });
  const j2 = await ack<Cred>(p2, EV.join, { roomCode: code, name: 'P2' });
  host.emit(EV.start);
  await sleep(300);

  const p2Id = j2.playerId!;
  const p2Token = j2.token!;
  const before = views.get(host)!;
  console.log('phase after start:', before.phase);
  console.log('P2 connected before drop:', before.players.find((p) => p.id === p2Id)?.connected);

  // Drop P2.
  p2.close();
  await sleep(500);
  const dropped = views.get(host)!;
  const p2Down = dropped.players.find((p) => p.id === p2Id)?.connected === false;
  console.log('P2 connected after drop:', dropped.players.find((p) => p.id === p2Id)?.connected);

  // Reconnect P2 from a fresh socket using the saved credentials.
  p2 = await connect();
  let p2GotState = false;
  p2.on(EV.state, () => (p2GotState = true));
  const r = await ack<{ ok: boolean }>(p2, EV.reconnect, {
    roomCode: code,
    playerId: p2Id,
    token: p2Token,
  });
  await sleep(400);
  const back = views.get(host)!;
  const p2Up = back.players.find((p) => p.id === p2Id)?.connected === true;
  console.log('reconnect ack ok:', r.ok, '| P2 reconnected:', p2Up, '| P2 got state:', p2GotState);

  [host, p1, p2].forEach((s) => s.close());
  const ok = before.phase === 'playing' && p2Down && r.ok && p2Up && p2GotState;
  console.log(ok ? '\nRECONNECT TEST PASSED ✅' : '\nRECONNECT TEST FAILED ❌');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('RECONNECT TEST ERROR:', e);
  process.exit(1);
});
