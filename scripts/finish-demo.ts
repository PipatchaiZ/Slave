// Auto-plays a 4-player round until the FIRST player empties their hand (becomes
// King) while others still hold cards, then freezes — to screenshot the live King badge.
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

  for (let i = 0; i < NAMES.length; i++) {
    const s = await connect();
    socks.push(s);
    s.on(EV.state, (v: GameView) => {
      views.set(s, v);
      const me = v.players.find((p) => p.isYou);
      if (!me) return;
      const someoneFinished = v.players.some((p) => p.finished);
      // Stop auto-play once the first player has gone out (keep the round frozen).
      if (someoneFinished) return;
      if (v.phase === 'playing' && v.turnSeat === me.seat && !me.finished) {
        if (v.trick.top) s.emit(EV.pass);
        else s.emit(EV.play, { cardIds: [cardId(sortHand(v.yourHand)[0])] });
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
  while (Date.now() - t0 < 25000) {
    const v = views.get(socks[0]);
    if (v && v.phase === 'playing' && v.players.some((p) => p.finished)) break;
    await sleep(50);
  }
  const v = views.get(socks[0])!;
  const finished = v.players.filter((p) => p.finished).map((p) => `${p.name}(pos ${p.finishPosition})`);
  writeFileSync('scripts/.creds.json', JSON.stringify({ code, phase: v.phase, finished, creds }, null, 2));
  console.log('phase:', v.phase, '| finished:', finished.join(', '));

  setInterval(() => void 0, 1 << 30);
}

main().catch((e) => {
  console.error('FINISH DEMO ERROR:', e);
  process.exit(1);
});
