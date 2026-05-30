// Repro hunt: after a player empties their hand, does the turn ever get "stuck"
// — i.e. point at a finished player, or at someone who has no legal move and
// isn't the lead — so the round can only advance via the auto-timeout?
// Drives the pure engine through many random rounds and audits every step.
import {
  GameState,
  addPlayer,
  createGame,
  pass,
  play,
  startMatch,
  cardId,
  sortHand,
  continueToNextRound,
  detectCombo,
  beats,
  isSlap,
  playableCardIds,
} from '../packages/engine/src';

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function newGame(n: number): GameState {
  const s = createGame('R', { id: 'p0', name: 'P0' });
  for (let i = 1; i < n; i++) addPlayer(s, { id: `p${i}`, name: `P${i}` });
  return s;
}

/** Make the legal move the UI would allow for the player on turn. */
function smartMove(s: GameState, rng: () => number): { id: string; kind: string } {
  const me = s.players.find((p) => p.seat === s.turnSeat)!;
  const top = s.trick.top?.combo ?? null;
  const playableIds = playableCardIds(me.hand, top);

  // Audit: a player on turn must EITHER have a playable card OR be allowed to pass.
  const canPass = !!top;
  if (playableIds.size === 0 && !canPass) {
    throw new Error(
      `STUCK: seat ${me.seat} (${me.id}) is on turn to LEAD but has no playable card — ` +
        `finished=${me.finished} hand=${me.hand.map(cardId).join(',')}`,
    );
  }

  // Prefer to play sometimes; otherwise pass.
  if (playableIds.size > 0 && (rng() < 0.7 || !canPass)) {
    // pick a legal combo: group the playable ids by rank, play the smallest legal one
    const byRank = new Map<string, string[]>();
    for (const c of sortHand(me.hand)) {
      if (playableIds.has(cardId(c))) {
        const g = byRank.get(c.rank) ?? [];
        g.push(cardId(c));
        byRank.set(c.rank, g);
      }
    }
    for (const ids of byRank.values()) {
      // try counts that beat or slap the top
      const wantCounts = top ? [top.count, 3, 4] : [1, 2, 3, 4];
      for (const cnt of wantCounts) {
        if (ids.length >= cnt) {
          const sel = ids.slice(0, cnt);
          const cb = detectCombo(sel.map((id) => me.hand.find((c) => cardId(c) === id)!));
          if (cb && (!top || beats(cb, top) || isSlap(cb, top))) {
            play(s, me.id, sel, rng);
            return { id: me.id, kind: cb.kind };
          }
        }
      }
    }
  }
  pass(s, me.id);
  return { id: me.id, kind: 'pass' };
}

function auditTurn(s: GameState) {
  if (s.phase !== 'playing') return;
  const me = s.players.find((p) => p.seat === s.turnSeat);
  if (!me) throw new Error(`turnSeat ${s.turnSeat} has no player`);
  if (me.finished) {
    throw new Error(
      `STUCK: turnSeat points at FINISHED player seat ${me.seat} (${me.id}) — round ${s.roundNumber}`,
    );
  }
}

let rounds = 0;
for (let seed = 1; seed <= 400; seed++) {
  const n = 3 + (seed % 4); // 3..6 players
  const s = newGame(n);
  const rng = mulberry32(seed);
  startMatch(s, 3, rng);
  let guard = 0;
  while (s.phase !== 'match_over') {
    if (s.phase === 'playing') {
      auditTurn(s);
      smartMove(s, rng);
      auditTurn(s);
    } else if (s.phase === 'round_over') {
      rounds++;
      continueToNextRound(s, rng);
    } else if (s.phase === 'exchange') {
      // auto-pick exchange for anyone pending
      const ch = s.exchange!.choices.find((c) => c.chosen === null);
      if (ch) {
        const from = s.players.find((p) => p.id === ch.fromId)!;
        const ids = sortHand(from.hand).slice(0, ch.count).map(cardId);
        // chooseExchange imported lazily to keep top imports tidy
        const { chooseExchange } = await import('../packages/engine/src');
        chooseExchange(s, ch.fromId, ids);
      }
    }
    if (guard++ > 100000) throw new Error('did not terminate');
  }
}

console.log(`simulated ${rounds} rounds across 400 matches (3-6 players)`);
console.log('TURN-AFTER-FINISH AUDIT PASSED ✅ (no stuck turns at engine level)');
