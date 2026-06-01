// Verifies a mid-match kick (and by extension leave) no longer stalls the game:
// the kicked player leaves the rotation immediately, remaining bots keep playing
// to match_over, and the quitter is excluded from the final ranking.
import { io, type Socket } from 'socket.io-client';
import { EV, type GameView, cardId, sortHand, detectCombo, beats, isSlap, playableCardIds } from '@slave/engine';

const URL = process.env.URL ?? 'http://localhost:3070';
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
  if (v.turnSeat !== me.seat || me.finished || me.left) return null;
  const top = v.trick.top?.combo ?? null;
  const playable = playableCardIds(v.yourHand, top);
  if (playable.size > 0) {
    const byRank = new Map<string, string[]>();
    for (const c of sortHand(v.yourHand))
      if (playable.has(cardId(c))) byRank.set(c.rank, [...(byRank.get(c.rank) ?? []), cardId(c)]);
    for (const ids of byRank.values())
      for (const cnt of top ? [top.count] : [1]) {
        if (ids.length >= cnt) {
          const sel = ids.slice(0, cnt);
          const cb = detectCombo(sel.map((id) => v.yourHand.find((c) => cardId(c) === id)!));
          if (cb && (!top || beats(cb, top) || isSlap(cb, top))) return { cardIds: sel };
        }
      }
  }
  return top ? 'pass' : null;
}

async function main() {
  const socks: Socket[] = [];
  for (let i = 0; i < 4; i++) socks.push(await connect());
  let done = false;
  let plays = 0;
  let kicked = false;
  let kickedId = '';
  let lastProgress = Date.now();
  const views = new Map<number, GameView>();

  socks.forEach((s, i) =>
    s.on(EV.state, (v: GameView) => {
      views.set(i, v);
      if (v.phase === 'match_over') {
        done = true;
        return;
      }
      if (v.phase === 'round_over' && v.hostId === v.yourId) return void s.emit(EV.next);
      const mine = v.exchange?.choices.find((c) => c.yourTurn);
      if (v.phase === 'exchange' && mine)
        return void s.emit(EV.exchange, { cardIds: sortHand(v.yourHand).slice(0, mine.count).map(cardId) });
      if (v.phase !== 'playing') return;
      const mv = move(v);
      if (mv === null) return;
      lastProgress = Date.now();
      plays++;
      // small delay so a round doesn't finish before the kick lands mid-play
      void sleep(90).then(() => {
        if (mv === 'pass') s.emit(EV.pass);
        else s.emit(EV.play, mv);
      });
    }),
  );

  const c = await ack<{ roomCode: string; playerId: string }>(socks[0], EV.create, { name: 'P0', totalRounds: 2 });
  const ids: string[] = [c.playerId];
  for (let i = 1; i < 4; i++) {
    const j = await ack<{ playerId: string }>(socks[i], EV.join, { roomCode: c.roomCode, name: `P${i}` });
    ids.push(j.playerId);
  }
  socks[0].emit(EV.start);

  // Once a few cards are down, host (P0) kicks P2.
  const t0 = Date.now();
  let stalled = false;
  while (!done && Date.now() - t0 < 30000) {
    await sleep(150);
    if (!kicked && plays >= 2) {
      kicked = true;
      kickedId = ids[2];
      socks[0].emit(EV.kick, { playerId: kickedId });
      console.log('  host kicked P2 mid-game');
    }
    if (kicked && Date.now() - lastProgress > 3000) {
      stalled = true;
      break;
    }
  }

  const v = views.get(0);
  const kickedView = v?.players.find((p) => p.id === kickedId);
  socks.forEach((s) => s.close());

  console.log(`reached match_over: ${done} · stalled: ${stalled}`);
  console.log(`kicked player marked left: ${kickedView?.left}`);
  if (done && v?.lastRoundResult) {
    const ranked = v.lastRoundResult.map((r) => r.name);
    console.log(`final ranking: ${ranked.join(', ')} (P2 excluded: ${!ranked.includes('P2')})`);
  }
  const ok = done && !stalled && kickedView?.left === true;
  console.log(ok ? '\nMID-GAME KICK OK ✅ (no stall, quitter out)' : '\nFAILED ❌');
  process.exit(ok ? 0 : 1);
}
main().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
