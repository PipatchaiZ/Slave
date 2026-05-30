// Seeds a live N-player game and stays alive so a browser can join one seat
// and screenshot the table. Writes all players' credentials to scripts/.creds.json.
import { writeFileSync } from 'node:fs';
import { io, type Socket } from 'socket.io-client';
import { EV } from '@slave/engine';

const URL = process.env.URL ?? 'http://localhost:3001';
const N = Number(process.env.SEED_PLAYERS ?? 3);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function ack<T>(s: Socket, ev: string, p: unknown): Promise<T> {
  return new Promise((res) => s.emit(ev, p, res));
}
function connect(): Promise<Socket> {
  const s = io(URL, { forceNew: true, transports: ['websocket'], reconnection: false });
  return new Promise((r) => s.on('connect', () => r(s)));
}
interface Cred {
  ok: boolean;
  roomCode?: string;
  playerId?: string;
  token?: string;
}

const NAMES = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Heidi'];

async function main() {
  const sockets: Socket[] = [];
  for (let i = 0; i < N; i++) sockets.push(await connect());

  const players: { name: string; playerId: string; token: string }[] = [];
  const c = await ack<Cred>(sockets[0], EV.create, { name: NAMES[0], totalRounds: 5 });
  const code = c.roomCode!;
  players.push({ name: NAMES[0], playerId: c.playerId!, token: c.token! });
  for (let i = 1; i < N; i++) {
    const j = await ack<Cred>(sockets[i], EV.join, { roomCode: code, name: NAMES[i] });
    players.push({ name: NAMES[i], playerId: j.playerId!, token: j.token! });
  }
  sockets[0].emit(EV.start);
  await sleep(300);

  writeFileSync('scripts/.creds.json', JSON.stringify({ roomCode: code, players }, null, 2));
  console.log('SEEDED', code, 'players:', N);

  setInterval(() => void 0, 1 << 30);
}

main().catch((e) => {
  console.error('SEED ERROR:', e);
  process.exit(1);
});
