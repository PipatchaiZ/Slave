// Verifies the turn deadline is STABLE across a reconnect, so the countdown
// stays in sync (does not jump/restart) after a refresh.
import { io, type Socket } from 'socket.io-client';
import { EV, type GameView } from '@slave/engine';

const URL = process.env.URL ?? 'http://localhost:3023';
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

  const d1 = views.get(host)!.turnEndsAt;
  console.log('deadline after start:', d1);

  // P2 drops and reconnects (simulated refresh).
  p2.close();
  await sleep(400);
  p2 = await connect();
  await ack(p2, EV.reconnect, { roomCode: code, playerId: j2.playerId!, token: j2.token! });
  await sleep(300);

  const d2 = views.get(host)!.turnEndsAt;
  console.log('deadline after reconnect:', d2);

  [host, p1, p2].forEach((s) => s.close());
  const ok = typeof d1 === 'number' && d1 === d2;
  console.log(ok ? '\nDEADLINE TEST PASSED ✅ (stable across reconnect)' : '\nDEADLINE TEST FAILED ❌');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('DEADLINE TEST ERROR:', e);
  process.exit(1);
});
