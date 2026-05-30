// Verifies lobby leave behavior:
//  A) a non-host leaving the lobby is removed (no ghost seat)
//  B) the host leaving the lobby disbands the room for everyone
import { io, type Socket } from 'socket.io-client';
import { EV, type GameView } from '@slave/engine';

const URL = process.env.URL ?? 'http://localhost:3013';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function ack<T>(s: Socket, ev: string, p: unknown): Promise<T> {
  return new Promise((res) => s.emit(ev, p, res));
}
function connect(): Promise<Socket> {
  const s = io(URL, { forceNew: true, transports: ['websocket'] });
  return new Promise((r) => s.on('connect', () => r(s)));
}

async function main() {
  const host = await connect();
  const p1 = await connect();
  const p2 = await connect();

  const views = new Map<Socket, GameView>();
  let p1Closed = '';
  for (const [s, who] of [
    [host, 'host'],
    [p1, 'p1'],
    [p2, 'p2'],
  ] as const) {
    s.on(EV.state, (v: GameView) => views.set(s, v));
    if (who === 'p1') s.on(EV.closed, (e: { message: string }) => (p1Closed = e.message));
  }

  const c = await ack<{ ok: boolean; roomCode?: string }>(host, EV.create, {
    name: 'Host',
    totalRounds: 1,
  });
  const code = c.roomCode!;
  await ack(p1, EV.join, { roomCode: code, name: 'P1' });
  await ack(p2, EV.join, { roomCode: code, name: 'P2' });
  await sleep(200);

  const beforeCount = views.get(host)?.players.length;
  console.log('players before any leave:', beforeCount);

  // A) non-host P2 leaves (explicit)
  p2.emit(EV.leave);
  await sleep(300);
  const afterView = views.get(host)!;
  const names = afterView.players.map((p) => p.name);
  console.log('players after P2 left:', names.join(', '));
  const aOk = afterView.players.length === 2 && !names.includes('P2');

  // B) host leaves (explicit) -> room disbanded, P1 gets closed
  host.emit(EV.leave);
  await sleep(300);
  console.log('P1 closed message:', JSON.stringify(p1Closed));
  const bOk = p1Closed.length > 0;

  [p1, p2].forEach((s) => s.close());
  const ok = beforeCount === 3 && aOk && bOk;
  console.log(ok ? '\nLEAVE TEST PASSED ✅' : '\nLEAVE TEST FAILED ❌');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('LEAVE TEST ERROR:', e);
  process.exit(1);
});
