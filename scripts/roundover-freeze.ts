// Plays round 1 to round_over and FREEZES there (host never clicks next) so the
// round-summary screen can be screenshotted. Writes creds.json.
import { writeFileSync } from 'node:fs';
import { io, type Socket } from 'socket.io-client';
import { EV, type GameView, cardId, sortHand, detectCombo, beats, isSlap, playableCardIds } from '@slave/engine';

const URL = process.env.URL ?? 'http://localhost:3001';
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
  const NAMES = ['Alice', 'Bob', 'Carol', 'Dave'];
  const socks: Socket[] = [];
  const creds: { name: string; playerId: string; token: string }[] = [];
  for (let i = 0; i < NAMES.length; i++) socks.push(await connect());

  socks.forEach((s) =>
    s.on(EV.state, (v: GameView) => {
      const mine = v.exchange?.choices.find((c) => c.yourTurn);
      if (v.phase === 'exchange' && mine)
        return void s.emit(EV.exchange, { cardIds: sortHand(v.yourHand).slice(0, mine.count).map(cardId) });
      if (v.phase !== 'playing') return; // freeze at round_over (don't click next)
      const mv = move(v);
      if (mv === 'pass') s.emit(EV.pass);
      else if (mv) s.emit(EV.play, mv);
    }),
  );

  const c = await ack<{ roomCode: string; playerId: string; token: string }>(socks[0], EV.create, {
    name: NAMES[0],
    totalRounds: 2,
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
  await sleep(2500);
  console.log('seeded room', c.roomCode);
  setInterval(() => void 0, 1 << 30);
}
main().catch((e) => { console.error('ERR', e); process.exit(1); });
