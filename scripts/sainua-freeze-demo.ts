// Seeds a sainua ("จั่วเพิ่ม") game and freezes mid-round so the in-game UI can be
// screenshotted (mode pill + the "เทิร์นของ" banner position). Writes creds.json.
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
  if (v.turnSeat !== me.seat || me.finished) return null;
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

  let plays = 0;
  socks.forEach((s) =>
    s.on(EV.state, (v: GameView) => {
      if (v.phase !== 'playing' || plays >= 4) return; // freeze after a few plays
      const mv = move(v);
      if (mv === 'pass') {
        plays++;
        s.emit(EV.pass);
      } else if (mv) {
        plays++;
        s.emit(EV.play, mv);
      }
    }),
  );

  const c = await ack<{ roomCode: string; playerId: string; token: string }>(socks[0], EV.create, {
    name: NAMES[0],
    totalRounds: 5,
    mode: 'sainua',
  });
  creds.push({ name: NAMES[0], playerId: c.playerId, token: c.token });
  for (let i = 1; i < NAMES.length; i++) {
    const j = await ack<{ playerId: string; token: string }>(socks[i], EV.join, {
      roomCode: c.roomCode,
      name: NAMES[i],
    });
    creds.push({ name: NAMES[i], playerId: j.playerId, token: j.token });
  }
  socks[0].emit(EV.start);

  await sleep(3000);
  writeFileSync('scripts/.creds.json', JSON.stringify({ code: c.roomCode, creds }, null, 2));
  console.log('seeded sainua room', c.roomCode);
  setInterval(() => void 0, 1 << 30);
}
main().catch((e) => { console.error('ERR', e); process.exit(1); });
