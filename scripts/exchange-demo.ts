// Drives a 4-player game through round 1, then into the exchange phase, and
// stays there so a browser can screenshot the exchange UI.
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
      // Auto-play round 1 only (so we stop cleanly in round 2's playing phase).
      if (v.phase === 'playing' && v.roundNumber === 1 && v.turnSeat === me.seat && !me.finished) {
        if (v.trick.top) s.emit(EV.pass);
        else s.emit(EV.play, { cardIds: [cardId(sortHand(v.yourHand)[0])] });
      }
      // Auto-resolve the exchange so we land in round 2 playing.
      if (v.phase === 'exchange') {
        const mine = v.exchange?.choices.find((ch) => ch.yourTurn);
        if (mine) {
          s.emit(EV.exchange, {
            cardIds: sortHand(v.yourHand)
              .slice(0, mine.count)
              .map(cardId),
          });
        }
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

  // Round 1 plays out -> round_over; advance into round 2 (exchange auto-resolves
  // in the handler) -> round 2 playing.
  let advanced = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const v = views.get(socks[0]);
    if (v && v.phase === 'round_over' && !advanced) {
      advanced = true;
      socks[0].emit(EV.next);
    }
    if (v && v.roundNumber === 2 && v.phase === 'playing') break;
    await sleep(50);
  }

  const v = views.get(socks[0])!;
  const roles = (v.lastRoundResult ?? []).map((r) => `${r.name}=${r.role}`);
  writeFileSync(
    'scripts/.creds.json',
    JSON.stringify(
      { code, phase: v.phase, round: v.roundNumber, direction: v.direction, roles, creds },
      null,
      2,
    ),
  );
  console.log('round:', v.roundNumber, '| phase:', v.phase, '| direction:', v.direction);

  setInterval(() => void 0, 1 << 30);
}

main().catch((e) => {
  console.error('EXCHANGE DEMO ERROR:', e);
  process.exit(1);
});
