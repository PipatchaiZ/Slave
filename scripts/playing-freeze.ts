// Connects 4 bots, starts, and leaves them IDLE so the game sits frozen in
// round-1 playing (on the lead's turn) — for screenshotting the active-seat
// highlight and the direction hint.
import { writeFileSync } from 'node:fs';
import { io, type Socket } from 'socket.io-client';
import { EV } from '@slave/engine';

const URL = process.env.URL ?? 'http://localhost:3001';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function ack<T>(s: Socket, ev: string, p: unknown): Promise<T> {
  return new Promise((res) => s.emit(ev, p, res));
}
function connect(): Promise<Socket> {
  const s = io(URL, { forceNew: true, transports: ['websocket'], reconnection: false });
  return new Promise((r) => s.on('connect', () => r(s)));
}

async function main() {
  const NAMES = ['Alice', 'Bob', 'Carol', 'Dave'];
  const socks: Socket[] = [];
  const creds: { name: string; playerId: string; token: string }[] = [];
  for (let i = 0; i < NAMES.length; i++) socks.push(await connect());
  const c = await ack<{ roomCode: string; playerId: string; token: string }>(socks[0], EV.create, {
    name: NAMES[0],
    totalRounds: 3,
  });
  creds.push({ name: NAMES[0], playerId: c.playerId, token: c.token });
  for (let i = 1; i < NAMES.length; i++) {
    const j = await ack<{ playerId: string; token: string }>(socks[i], EV.join, {
      roomCode: c.roomCode,
      name: NAMES[i],
    });
    creds.push({ name: NAMES[i], playerId: j.playerId, token: j.token });
  }
  writeFileSync('scripts/.creds.json', JSON.stringify({ code: c.roomCode, creds }, null, 2));
  socks[0].emit(EV.start);
  await sleep(800);
  console.log('seeded (idle, frozen in playing) room', c.roomCode);
  setInterval(() => void 0, 1 << 30);
}
main().catch((e) => { console.error('ERR', e); process.exit(1); });
