// Verifies host controls mid-game: transfer host, auto-reassign on host drop,
// and disband closing the room for everyone.
import { io, type Socket } from 'socket.io-client';
import { EV, type GameView } from '@slave/engine';

const URL = process.env.URL ?? 'http://localhost:3015';
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
}

async function main() {
  const host = await connect();
  const p1 = await connect();
  const p2 = await connect();
  const views = new Map<Socket, GameView>();
  let p1Closed = '';
  host.on(EV.state, (v: GameView) => views.set(host, v));
  p1.on(EV.state, (v: GameView) => views.set(p1, v));
  p2.on(EV.state, (v: GameView) => views.set(p2, v));
  p1.on(EV.closed, (e: { message: string }) => (p1Closed = e.message));

  const c = await ack<Cred>(host, EV.create, { name: 'Host', totalRounds: 3 });
  const code = c.roomCode!;
  const hostId = c.playerId!;
  const j1 = await ack<Cred>(p1, EV.join, { roomCode: code, name: 'P1' });
  const j2 = await ack<Cred>(p2, EV.join, { roomCode: code, name: 'P2' });
  host.emit(EV.start);
  await sleep(300);

  console.log('initial host is Host:', views.get(host)!.hostId === hostId);

  // 1) Transfer host -> P1
  host.emit(EV.transferHost, { toPlayerId: j1.playerId! });
  await sleep(300);
  const afterTransfer = views.get(p2)!.hostId === j1.playerId;
  console.log('host transferred to P1:', afterTransfer);

  // 2) New host (P1) leaves -> auto-reassign to another connected player
  p1.emit(EV.leave);
  await sleep(300);
  const hv = views.get(host)!;
  const reassigned = hv.hostId === hostId || hv.hostId === j2.playerId!;
  console.log('host auto-reassigned after P1 drop:', reassigned, '->', hv.hostId);

  // 3) Whoever is host now disbands -> P? receives closed. Make current host disband.
  const currentHostId = views.get(host)!.hostId;
  const disbander = currentHostId === hostId ? host : p2;
  const watcher = disbander === host ? p2 : host;
  let watcherClosed = '';
  watcher.on(EV.closed, (e: { message: string }) => (watcherClosed = e.message));
  disbander.emit(EV.disband);
  await sleep(400);
  console.log('disband closed message:', JSON.stringify(watcherClosed || p1Closed));

  [host, p1, p2].forEach((s) => s.close());
  const ok = afterTransfer && reassigned && (watcherClosed.length > 0 || p1Closed.length > 0);
  console.log(ok ? '\nHOST TEST PASSED ✅' : '\nHOST TEST FAILED ❌');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('HOST TEST ERROR:', e);
  process.exit(1);
});
