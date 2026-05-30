// Verifies that a page refresh (socket drop + quick reconnect within the grace
// window) does NOT lose the room — neither for a normal player nor the host.
import { io, type Socket } from 'socket.io-client';
import { EV, type GameView } from '@slave/engine';

const URL = process.env.URL ?? 'http://localhost:3017';
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
  p1.on(EV.state, (v: GameView) => views.set(p1, v)); // p1 stays connected throughout

  const hc = await ack<Cred>(host, EV.create, { name: 'Host', totalRounds: 1 });
  const code = hc.roomCode!;
  await ack(p1, EV.join, { roomCode: code, name: 'P1' });
  const j2 = await ack<Cred>(p2, EV.join, { roomCode: code, name: 'P2' });
  await sleep(200);
  console.log('lobby size:', views.get(p1)!.players.length);

  // --- Refresh a normal player (P2) ---
  p2.close();
  await sleep(300); // well within the grace window
  const during = views.get(p1)!;
  const p2DownButPresent =
    during.players.length === 3 && during.players.find((p) => p.id === j2.playerId)?.connected === false;
  p2 = await connect();
  const r2 = await ack<Cred>(p2, EV.reconnect, {
    roomCode: code,
    playerId: j2.playerId!,
    token: j2.token!,
  });
  await sleep(200);
  const after = views.get(p1)!;
  const p2Back =
    r2.ok && after.players.length === 3 && after.players.find((p) => p.id === j2.playerId)?.connected === true;
  console.log('player refresh — kept seat during gap:', p2DownButPresent, '| reconnected:', p2Back);

  // --- Refresh the HOST ---
  host.close();
  await sleep(300);
  const hostGap = views.get(p1)!;
  const roomAlive = hostGap.players.length === 3; // room NOT disbanded
  const hostB = await connect();
  const rh = await ack<Cred>(hostB, EV.reconnect, {
    roomCode: code,
    playerId: hc.playerId!,
    token: hc.token!,
  });
  await sleep(200);
  const afterHost = views.get(p1)!;
  const hostBack = rh.ok && afterHost.hostId === hc.playerId;
  console.log('host refresh — room stayed alive:', roomAlive, '| host reconnected & still host:', hostBack);

  [host, p1, p2, hostB].forEach((s) => s.close());
  const ok = p2DownButPresent && p2Back && roomAlive && hostBack;
  console.log(ok ? '\nREFRESH TEST PASSED ✅' : '\nREFRESH TEST FAILED ❌');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('REFRESH TEST ERROR:', e);
  process.exit(1);
});
