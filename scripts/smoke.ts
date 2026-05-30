// End-to-end smoke test: drives the real Socket.IO server with 3 clients
// through a full 1-round match using the same auto-move policy as the engine.
import { io, type Socket } from 'socket.io-client';
import { EV, type GameView, cardId, sortHand } from '@slave/engine';

const URL = process.env.URL ?? 'http://localhost:3010';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function emitAck<T>(s: Socket, ev: string, p: unknown): Promise<T> {
  return new Promise((res) => s.emit(ev, p, res));
}

async function main() {
  const sockets: Socket[] = [];
  const views = new Map<Socket, GameView>();

  function wire(s: Socket) {
    s.on(EV.state, (v: GameView) => {
      views.set(s, v);
      const me = v.players.find((p) => p.isYou);
      if (!me) return;
      if (process.env.IDLE) return; // stay idle to exercise the server turn timer
      // Each server state change triggers exactly one broadcast, so reacting
      // once per state (only when it is our turn) cannot double-act.
      if (v.phase === 'playing' && v.turnSeat === me.seat && !me.finished) {
        if (v.trick.top) s.emit(EV.pass);
        else s.emit(EV.play, { cardIds: [cardId(sortHand(v.yourHand)[0])] });
      }
    });
    s.on(EV.error, (e: { message: string }) => console.log('  server error:', e.message));
  }

  for (let i = 0; i < 3; i++) {
    const s = io(URL, { forceNew: true, transports: ['websocket'] });
    wire(s);
    sockets.push(s);
    await new Promise<void>((r) => s.on('connect', () => r()));
  }

  const created = await emitAck<{ ok: boolean; roomCode?: string; error?: string }>(
    sockets[0],
    EV.create,
    { name: 'Alice', totalRounds: 1 },
  );
  if (!created.ok) throw new Error('create failed: ' + created.error);
  const code = created.roomCode!;
  console.log('room created:', code);

  for (let i = 1; i < 3; i++) {
    const j = await emitAck<{ ok: boolean; error?: string }>(sockets[i], EV.join, {
      roomCode: code,
      name: `P${i}`,
    });
    if (!j.ok) throw new Error('join failed: ' + j.error);
  }
  console.log('3 players joined');

  sockets[0].emit(EV.start);

  // Wait for the match to finish.
  const deadline = Date.now() + Number(process.env.DEADLINE_MS ?? 15000);
  while (Date.now() < deadline) {
    const v = views.get(sockets[0]);
    if (v && v.phase === 'match_over') break;
    await sleep(50);
  }

  const final = views.get(sockets[0]);
  if (!final) throw new Error('no state received');
  console.log('final phase:', final.phase);
  const ranking = (final.lastRoundResult ?? []).map((r) => `${r.name}=${r.role}(+${r.pointsAwarded})`);
  console.log('ranking:', ranking.join(', '));

  const kings = (final.lastRoundResult ?? []).filter((r) => r.role === 'king').length;
  const ok = final.phase === 'match_over' && kings === 1;
  sockets.forEach((s) => s.close());
  console.log(ok ? '\nSMOKE TEST PASSED ✅' : '\nSMOKE TEST FAILED ❌');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('SMOKE TEST ERROR:', e);
  process.exit(1);
});
