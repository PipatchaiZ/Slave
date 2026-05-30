// Verifies host kick: full removal in the lobby, and mid-game eviction that
// blocks rejoin while keeping the seat for auto-pass.
import { io, type Socket } from 'socket.io-client';
import { EV, type GameView } from '@slave/engine';

const URL = process.env.URL ?? 'http://localhost:3016';
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
  const p2 = await connect();
  const p3 = await connect();
  const views = new Map<Socket, GameView>();
  host.on(EV.state, (v: GameView) => views.set(host, v));
  let p3Closed = '';
  let p2Closed = '';
  p3.on(EV.closed, (e: { message: string }) => (p3Closed = e.message));
  p2.on(EV.closed, (e: { message: string }) => (p2Closed = e.message));

  const c = await ack<Cred>(host, EV.create, { name: 'Host', totalRounds: 1 });
  const code = c.roomCode!;
  await ack(p1, EV.join, { roomCode: code, name: 'P1' });
  const j2 = await ack<Cred>(p2, EV.join, { roomCode: code, name: 'P2' });
  const j3 = await ack<Cred>(p3, EV.join, { roomCode: code, name: 'P3' });
  await sleep(200);
  console.log('players in lobby:', views.get(host)!.players.length);

  // 1) Lobby kick: remove P3 entirely.
  host.emit(EV.kick, { playerId: j3.playerId! });
  await sleep(400);
  const afterKick = views.get(host)!;
  const names = afterKick.players.map((p) => p.name);
  const lobbyOk = afterKick.players.length === 3 && !names.includes('P3') && p3Closed.length > 0;
  console.log('after lobby kick:', names.join(', '), '| P3 closed:', JSON.stringify(p3Closed));

  // Start with the remaining 3.
  host.emit(EV.start);
  await sleep(300);
  console.log('phase:', views.get(host)!.phase);

  // 2) Mid-game kick: evict P2 (seat kept, marked disconnected).
  host.emit(EV.kick, { playerId: j2.playerId! });
  await sleep(400);
  const mid = views.get(host)!;
  const p2Seat = mid.players.find((p) => p.id === j2.playerId);
  const midOk = !!p2Seat && p2Seat.connected === false && p2Closed.length > 0;
  console.log('mid-game kick: P2 present =', !!p2Seat, 'connected =', p2Seat?.connected);

  // 3) Kicked P2 cannot rejoin (token invalidated).
  const p2b = await connect();
  const r = await ack<{ ok: boolean; error?: string }>(p2b, EV.reconnect, {
    roomCode: code,
    playerId: j2.playerId!,
    token: j2.token!,
  });
  console.log('P2 rejoin blocked:', !r.ok, '| reason:', r.error);

  [host, p1, p2, p3, p2b].forEach((s) => s.close());
  const ok = lobbyOk && midOk && !r.ok;
  console.log(ok ? '\nKICK TEST PASSED ✅' : '\nKICK TEST FAILED ❌');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('KICK TEST ERROR:', e);
  process.exit(1);
});
