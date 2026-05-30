// Verifies: when the HOST drops (network/refresh, not an explicit leave) in the
// lobby, the room is NOT disbanded — host is handed to a connected player.
import { io, type Socket } from 'socket.io-client';
import { EV, type GameView } from '@slave/engine';

const URL = process.env.URL ?? 'http://localhost:3020';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function ack<T>(s: Socket, ev: string, p: unknown): Promise<T> {
  return new Promise((res) => s.emit(ev, p, res));
}
function connect(): Promise<Socket> {
  const s = io(URL, { forceNew: true, transports: ['websocket'], reconnection: false });
  return new Promise((r) => s.on('connect', () => r(s)));
}

async function main() {
  const host = await connect();
  const p1 = await connect();
  let p1Closed = false;
  let p1View: GameView | null = null;
  p1.on(EV.state, (v: GameView) => (p1View = v));
  p1.on(EV.closed, () => (p1Closed = true));

  const c = await ack<{ ok: boolean; roomCode?: string; playerId?: string }>(host, EV.create, {
    name: 'Host',
    totalRounds: 3,
  });
  const code = c.roomCode!;
  const j = await ack<{ ok: boolean; playerId?: string }>(p1, EV.join, { roomCode: code, name: 'P1' });
  await sleep(150);

  // Host DROPS (close socket, no reconnect) — simulates a refresh/network loss.
  host.close();
  await sleep(900); // > grace (run server with DISCONNECT_GRACE_MS=400)

  const v = p1View!;
  const roomAlive = !p1Closed && !!v;
  const hostReassigned = v?.hostId === j.playerId;
  console.log('room NOT disbanded:', roomAlive, '| host handed to P1:', hostReassigned, '| players:', v?.players.length);

  [host, p1].forEach((s) => s.close());
  const ok = roomAlive && hostReassigned;
  console.log(ok ? '\nHOST-DROP TEST PASSED ✅' : '\nHOST-DROP TEST FAILED ❌');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('HOST-DROP TEST ERROR:', e);
  process.exit(1);
});
