// Confirms the mechanism: if a player acts AFTER their turn timer has expired,
// the server has already auto-moved them, so their play is rejected. This is the
// red "Not your turn" the user sees when they take a beat to choose (e.g. while
// the "FINISHED" burst plays after the King goes out).
// Run server SHORT:  TURN_TIMEOUT_MS=800 AUTO_MOVE_GRACE_MS=800 PORT=3032 node dist/index.js
import { io, type Socket } from 'socket.io-client';
import { EV, type GameView, cardId, sortHand, detectCombo, beats, isSlap, playableCardIds } from '@slave/engine';

const URL = process.env.URL ?? 'http://localhost:3032';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function ack<T>(s: Socket, ev: string, p: unknown): Promise<T> {
  return new Promise((res) => s.emit(ev, p, res));
}
function connect(): Promise<Socket> {
  const s = io(URL, { forceNew: true, transports: ['websocket'], reconnection: false });
  return new Promise((r) => s.on('connect', () => r(s)));
}

function chooseMove(v: GameView): { cardIds: string[] } | 'pass' | null {
  const me = v.players.find((p) => p.isYou)!;
  if (v.turnSeat !== me.seat || me.finished) return null;
  const top = v.trick.top?.combo ?? null;
  const playable = playableCardIds(v.yourHand, top);
  if (playable.size > 0) {
    const byRank = new Map<string, string[]>();
    for (const c of sortHand(v.yourHand))
      if (playable.has(cardId(c))) byRank.set(c.rank, [...(byRank.get(c.rank) ?? []), cardId(c)]);
    for (const ids of byRank.values())
      for (const cnt of top ? [top.count, 3, 4] : [1]) {
        if (ids.length >= cnt) {
          const sel = ids.slice(0, cnt);
          const cb = detectCombo(sel.map((id) => v.yourHand.find((c) => cardId(c) === id)!));
          if (cb && (!top || beats(cb, top) || isSlap(cb, top))) return { cardIds: sel };
        }
      }
  }
  return top ? 'pass' : null;
}

const errors: string[] = [];

async function main() {
  const socks: Socket[] = [];
  for (let i = 0; i < 3; i++) socks.push(await connect());
  let done = false;

  socks.forEach((s, i) => {
    s.on(EV.error, (e: { message: string }) => {
      errors.push(e.message);
      console.log(`  bot${i} got red error on play: "${e.message}"`);
    });
    s.on(EV.state, async (v: GameView) => {
      if (v.phase === 'match_over') return void (done = true);
      if (v.phase === 'round_over' && v.hostId === v.yourId) return void s.emit(EV.next);
      const mine = v.exchange?.choices.find((c) => c.yourTurn);
      if (v.phase === 'exchange' && mine)
        return void s.emit(EV.exchange, { cardIds: sortHand(v.yourHand).slice(0, mine.count).map(cardId) });
      if (v.phase !== 'playing') return;
      const mv = chooseMove(v);
      if (mv === null) return;
      // bot0 is a SLOW human: deliberates ~1200ms (> the 800ms server timeout),
      // then submits the move it decided on — racing the auto-pass.
      const delay = i === 0 ? 1200 : 60;
      await sleep(delay);
      if (mv === 'pass') s.emit(EV.pass);
      else s.emit(EV.play, mv);
    });
  });

  const c = await ack<{ roomCode: string }>(socks[0], EV.create, { name: 'SlowHuman', totalRounds: 3 });
  for (let i = 1; i < 3; i++) await ack(socks[i], EV.join, { roomCode: c.roomCode, name: `Bot${i}` });
  socks[0].emit(EV.start);

  const t0 = Date.now();
  while (!done && Date.now() - t0 < 40000) await sleep(200);
  socks.forEach((s) => s.close());

  console.log(`\nred errors seen: ${errors.length}`);
  const turnErrs = errors.filter((e) => /your turn/i.test(e)).length;
  console.log(`"Not your turn" rejections: ${turnErrs}`);
  console.log(errors.length > 0 ? 'MECHANISM CONFIRMED ❌ (slow play -> auto-pass -> rejected)' : 'no errors');
  process.exit(0);
}
main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
