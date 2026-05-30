// Confirms the server applies the draw penalty in sainua ("จั่วเพิ่ม") mode:
// whenever a triple/four is played, every other in-play seat should gain cards.
// Bots play to completion; we watch handCount deltas around each triple/four.
import { io, type Socket } from 'socket.io-client';
import { EV, type GameView, cardId, sortHand, detectCombo, beats, isSlap, playableCardIds } from '@slave/engine';

const URL = process.env.URL ?? 'http://localhost:3060';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function ack<T>(s: Socket, ev: string, p: unknown): Promise<T> {
  return new Promise((res) => s.emit(ev, p, res));
}
function connect(): Promise<Socket> {
  const s = io(URL, { forceNew: true, transports: ['websocket'], reconnection: false });
  return new Promise((r) => s.on('connect', () => r(s)));
}

function move(v: GameView): { cardIds: string[] } | 'pass' | null {
  const me = v.players.find((p) => p.isYou)!;
  if (v.turnSeat !== me.seat || me.finished) return null;
  const top = v.trick.top?.combo ?? null;
  const playable = playableCardIds(v.yourHand, top);
  if (playable.size > 0) {
    const byRank = new Map<string, string[]>();
    for (const c of sortHand(v.yourHand))
      if (playable.has(cardId(c))) byRank.set(c.rank, [...(byRank.get(c.rank) ?? []), cardId(c)]);
    // Prefer the BIGGEST same-rank group so triples/fours actually get played.
    const groups = [...byRank.values()].sort((a, b) => b.length - a.length);
    for (const ids of groups)
      for (const cnt of top ? [top.count, 4, 3] : [ids.length, 3, 2, 1]) {
        if (ids.length >= cnt && cnt >= 1) {
          const sel = ids.slice(0, cnt);
          const cb = detectCombo(sel.map((id) => v.yourHand.find((c) => cardId(c) === id)!));
          if (cb && (!top || beats(cb, top) || isSlap(cb, top))) return { cardIds: sel };
        }
      }
  }
  return top ? 'pass' : null;
}

let triplesFours = 0;
let drawsObserved = 0;
let done = false;
const last = new Map<string, GameView>();

async function main() {
  const socks: Socket[] = [];
  for (let i = 0; i < 4; i++) socks.push(await connect());

  socks.forEach((s) =>
    s.on(EV.state, (v: GameView) => {
      if (v.phase === 'match_over') return void (done = true);
      // Detect a triple/four just played and compare handCounts to the prior view.
      const prev = last.get(v.players.find((p) => p.isYou)!.id);
      const lp = v.trick.plays.at(-1);
      if (prev && lp && !lp.pass && (lp.combo?.kind === 'triple' || lp.combo?.kind === 'four')) {
        const expect = lp.combo.kind === 'four' ? 2 : 1;
        let gained = 0;
        for (const p of v.players) {
          const pp = prev.players.find((x) => x.id === p.id);
          if (pp && p.seat !== lp.seat && !pp.finished) gained += Math.max(0, p.handCount - pp.handCount);
        }
        // Count once (only the actor's view does the logging to avoid dupes).
        if (v.players.find((p) => p.isYou)!.seat === lp.seat) {
          triplesFours++;
          if (gained > 0) drawsObserved++;
          console.log(`  ${lp.combo.kind} played -> others gained ${gained} card(s) (expect ~${expect}/seat)`);
        }
      }
      last.set(v.players.find((p) => p.isYou)!.id, v);
      if (v.phase === 'round_over' && v.hostId === v.yourId) return void s.emit(EV.next);
      const mine = v.exchange?.choices.find((c) => c.yourTurn);
      if (v.phase === 'exchange' && mine)
        return void s.emit(EV.exchange, { cardIds: sortHand(v.yourHand).slice(0, mine.count).map(cardId) });
      if (v.phase !== 'playing') return;
      const mv = move(v);
      if (mv === 'pass') s.emit(EV.pass);
      else if (mv) s.emit(EV.play, mv);
    }),
  );

  const c = await ack<{ roomCode: string }>(socks[0], EV.create, { name: 'P0', totalRounds: 3, mode: 'sainua' });
  for (let i = 1; i < 4; i++) await ack(socks[i], EV.join, { roomCode: c.roomCode, name: `P${i}` });
  socks[0].emit(EV.start);

  const t0 = Date.now();
  while (!done && Date.now() - t0 < 40000) await sleep(200);
  socks.forEach((s) => s.close());
  console.log(`\ntriples/fours played: ${triplesFours} · of those, others drew: ${drawsObserved}`);
  console.log(triplesFours > 0 && drawsObserved === triplesFours ? 'SAINUA DRAW WORKS ✅' : triplesFours === 0 ? 'no triple/four occurred' : 'DRAW MISSING ❌');
  process.exit(0);
}
main().catch((e) => { console.error('ERR', e); process.exit(1); });
