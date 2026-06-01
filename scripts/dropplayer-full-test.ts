// Full end-to-end scenario for quit / kick MID-MATCH. Drives real bots through a
// server and reports every observable behaviour:
//   1) kick a non-host mid-round  -> left flag, hand emptied (to pile), evicted
//   2) kicked player can't rejoin (token invalidated)
//   3) the turn never lands on the departed seat (no stall)
//   4) game runs to match_over; quitter excluded from ranking; roles recomputed
//   5) a player who LEAVES (explicit) mid-round behaves the same
//   6) when the HOST leaves mid-match, host is reassigned
// Run server:  TURN_TIMEOUT_MS=4000 AUTO_MOVE_GRACE_MS=4000 PORT=3080 node apps/server/dist/index.js
import { io, type Socket } from 'socket.io-client';
import { EV, type GameView, cardId, sortHand, detectCombo, beats, isSlap, playableCardIds } from '@slave/engine';

const URL = process.env.URL ?? 'http://localhost:3080';
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

const log = (s: string) => console.log(s);
let fails = 0;
const check = (name: string, ok: boolean) => {
  log(`  ${ok ? '✅' : '❌'} ${name}`);
  if (!ok) fails++;
};

// ---- scenario A: kick + leave mid-match ----
async function scenarioA() {
  log('\n=== A) kick a non-host, then a player leaves, mid-match ===');
  const NAMES = ['P0(host)', 'P1', 'P2', 'P3'];
  const socks: Socket[] = [];
  const ids: string[] = [];
  const tokens: string[] = [];
  const closed = new Set<number>();
  const views = new Map<number, GameView>();
  const turnSeatsAfterKick: number[] = [];
  let kicked = false;
  let left = false;
  let plays = 0;
  let lastProgress = Date.now();
  let done = false;

  for (let i = 0; i < 4; i++) socks.push(await connect());
  socks.forEach((s, i) => {
    s.on(EV.closed, () => closed.add(i));
    s.on(EV.state, (v: GameView) => {
      views.set(i, v);
      if (v.phase === 'match_over') done = true;
      if (kicked && v.players.find((p) => p.isYou)?.seat === v.turnSeat) turnSeatsAfterKick.push(v.turnSeat);
      if (v.phase === 'round_over' && v.hostId === v.yourId) return void s.emit(EV.next);
      const mine = v.exchange?.choices.find((c) => c.yourTurn);
      if (v.phase === 'exchange' && mine)
        return void s.emit(EV.exchange, { cardIds: sortHand(v.yourHand).slice(0, mine.count).map(cardId) });
      if (v.phase !== 'playing') return;
      const mv = move(v);
      if (mv === null) return;
      lastProgress = Date.now();
      plays++;
      void sleep(70).then(() => (mv === 'pass' ? s.emit(EV.pass) : s.emit(EV.play, mv)));
    });
  });

  const c = await ack<{ roomCode: string; playerId: string; token: string }>(socks[0], EV.create, { name: NAMES[0], totalRounds: 2 });
  ids[0] = c.playerId; tokens[0] = c.token;
  for (let i = 1; i < 4; i++) {
    const j = await ack<{ playerId: string; token: string }>(socks[i], EV.join, { roomCode: c.roomCode, name: NAMES[i] });
    ids[i] = j.playerId; tokens[i] = j.token;
  }
  socks[0].emit(EV.start);
  await sleep(400);
  const seatOfP2 = views.get(0)?.players.find((p) => p.id === ids[2])?.seat ?? -1;

  // wait for a few plays, then host kicks P2
  while (!kicked && plays < 3) await sleep(60);
  socks[0].emit(EV.kick, { playerId: ids[2] });
  kicked = true;
  log('  → host kicked P2 mid-round');
  await sleep(600);

  const vAfterKick = [...views.values()].find((v) => v.players.some((p) => p.isYou));
  const p2 = vAfterKick?.players.find((p) => p.id === ids[2]);
  check('P2 marked left', p2?.left === true);
  check('P2 finished/out of play', p2?.finished === true);
  check('P2 hand emptied (cards to pile)', p2?.handCount === 0);
  check('P2 socket evicted (room:closed)', closed.has(2));

  // P2 tries to rejoin -> must fail (token invalidated)
  const reSock = await connect();
  const re = await ack<{ ok: boolean; error?: string }>(reSock, EV.reconnect, { roomCode: c.roomCode, playerId: ids[2], token: tokens[2] });
  check('P2 cannot rejoin (token invalidated)', re.ok === false);
  reSock.close();

  // now P3 LEAVES explicitly
  await sleep(300);
  socks[3].emit(EV.leave);
  left = true;
  log('  → P3 left (explicit) mid-round');
  await sleep(600);
  const vAfterLeave = [...views.values()].find((v) => v.players.some((p) => p.isYou && !p.left));
  const p3 = vAfterLeave?.players.find((p) => p.id === ids[3]);
  check('P3 marked left after leave', p3?.left === true);
  check('P3 hand emptied', p3?.handCount === 0);

  // let it run to completion
  const t0 = Date.now();
  let stalled = false;
  while (!done && Date.now() - t0 < 25000) {
    await sleep(150);
    if (Date.now() - lastProgress > 4000 && !done) { stalled = true; break; }
  }
  check('game reached match_over (no stall)', done && !stalled);
  check('turn never landed on the kicked seat', !turnSeatsAfterKick.includes(seatOfP2));

  const finalV = [...views.values()].find((v) => v.phase === 'match_over') ?? views.get(0);
  const ranked = finalV?.lastRoundResult?.map((r) => r.name) ?? [];
  log(`  final ranking: [${ranked.join(', ')}]`);
  check('quitters excluded from ranking', !ranked.includes('P2') && !ranked.includes('P3'));
  check('remaining players ranked (2 left)', ranked.length === 2);

  socks.forEach((s) => s.close());
}

// ---- scenario B: host leaves mid-match -> host reassigned ----
async function scenarioB() {
  log('\n=== B) host leaves mid-match -> host is reassigned ===');
  const socks: Socket[] = [];
  const ids: string[] = [];
  const views = new Map<number, GameView>();
  for (let i = 0; i < 3; i++) socks.push(await connect());
  socks.forEach((s) =>
    s.on(EV.state, (v: GameView) => {
      views.set(v.players.find((p) => p.isYou)!.seat, v);
      if (v.phase === 'round_over' && v.hostId === v.yourId) s.emit(EV.next);
      const mine = v.exchange?.choices.find((c) => c.yourTurn);
      if (v.phase === 'exchange' && mine)
        return void s.emit(EV.exchange, { cardIds: sortHand(v.yourHand).slice(0, mine.count).map(cardId) });
      if (v.phase !== 'playing') return;
      const mv = move(v);
      if (mv !== null) void sleep(70).then(() => (mv === 'pass' ? s.emit(EV.pass) : s.emit(EV.play, mv)));
    }),
  );
  const c = await ack<{ roomCode: string; playerId: string }>(socks[0], EV.create, { name: 'Host', totalRounds: 2 });
  ids[0] = c.playerId;
  for (let i = 1; i < 3; i++) {
    const j = await ack<{ playerId: string }>(socks[i], EV.join, { roomCode: c.roomCode, name: `P${i}` });
    ids[i] = j.playerId;
  }
  socks[0].emit(EV.start);
  await sleep(500);
  socks[0].emit(EV.leave); // host leaves mid-game
  log('  → host left mid-round');
  await sleep(700);
  const remView = views.get(1); // P1 — a remaining player whose view is fresh
  check('host reassigned away from the leaver', !!remView && remView.hostId !== ids[0]);
  const hostP = remView?.players.find((p) => p.id === remView.hostId);
  check('new host is an active (non-left) player', !!hostP && !hostP.left);
  socks.forEach((s) => s.close());
}

async function main() {
  await scenarioA();
  await scenarioB();
  log(`\n${fails === 0 ? 'ALL CHECKS PASSED ✅' : fails + ' CHECK(S) FAILED ❌'}`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error('ERR', e); process.exit(1); });
