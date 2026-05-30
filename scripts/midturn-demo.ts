// Creates a 4-player game, has the leader play ONE mid-rank single, then stops
// so the next player faces a top card — to screenshot the dimmed (unplayable) cards.
import { writeFileSync } from 'node:fs';
import { io, type Socket } from 'socket.io-client';
import { EV, type GameView, cardId, sortHand } from '@slave/engine';

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
  const views = new Map<Socket, GameView>();
  const creds: { name: string; playerId: string; token: string }[] = [];
  let didLead = false;

  for (let i = 0; i < NAMES.length; i++) {
    const s = await connect();
    socks.push(s);
    s.on(EV.state, (v: GameView) => {
      views.set(s, v);
      const me = v.players.find((p) => p.isYou);
      if (!me) return;
      if (
        v.phase === 'playing' &&
        v.roundNumber === 1 &&
        v.turnSeat === me.seat &&
        !me.finished &&
        !v.trick.top &&
        !didLead
      ) {
        didLead = true;
        const sorted = sortHand(me.handCount ? v.yourHand : []);
        const mid = sorted[Math.floor(sorted.length / 2)]; // a mid-rank single
        s.emit(EV.play, { cardIds: [cardId(mid)] });
      }
    });
  }

  const c = await ack<{ roomCode: string; playerId: string; token: string }>(socks[0], EV.create, {
    name: NAMES[0],
    totalRounds: 5,
    mode: 'normal',
  });
  const code = c.roomCode;
  creds.push({ name: NAMES[0], playerId: c.playerId, token: c.token });
  for (let i = 1; i < NAMES.length; i++) {
    const j = await ack<{ playerId: string; token: string }>(socks[i], EV.join, {
      roomCode: code,
      name: NAMES[i],
    });
    creds.push({ name: NAMES[i], playerId: j.playerId, token: j.token });
  }
  socks[0].emit(EV.start);

  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    const v = views.get(socks[0]);
    if (v && v.phase === 'playing' && v.trick.top) break;
    await sleep(50);
  }
  const v = views.get(socks[0])!;
  const turnPlayer = v.players.find((p) => p.seat === v.turnSeat);
  writeFileSync(
    'scripts/.creds.json',
    JSON.stringify(
      { code, turnSeat: v.turnSeat, turnPlayer: turnPlayer?.name, top: v.trick.top?.combo, creds },
      null,
      2,
    ),
  );
  console.log('top played; now turn of', turnPlayer?.name, '| top:', v.trick.top?.combo?.cards);

  setInterval(() => void 0, 1 << 30);
}

main().catch((e) => {
  console.error('MIDTURN ERROR:', e);
  process.exit(1);
});
