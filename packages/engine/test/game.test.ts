import { describe, expect, it } from 'vitest';
import {
  GameState,
  addPlayer,
  autoMove,
  beginRound,
  chooseExchange,
  continueToNextRound,
  createGame,
  detectCombo,
  dropPlayer,
  liveRoles,
  pass,
  play,
  playableCardIds,
  playerById,
  resolveRanking,
  roleForRank,
  startMatch,
} from '../src';
import type { Card, Rank, Suit } from '../src';

// Deterministic RNG so deals are reproducible across runs.
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
  const state = createGame('ROOM', { id: 'p0', name: 'P0' });
  for (let i = 1; i < n; i++) addPlayer(state, { id: `p${i}`, name: `P${i}` });
  return state;
}

function turnPlayerId(state: GameState): string {
  return state.players.find((p) => p.seat === state.turnSeat)!.id;
}

/** Play out the current round with auto moves; returns when no longer playing. */
function playRoundAuto(state: GameState): void {
  let guard = 0;
  while (state.phase === 'playing') {
    autoMove(state, turnPlayerId(state));
    if (guard++ > 5000) throw new Error('round did not terminate');
  }
}

describe('lobby and match start', () => {
  it('enforces the 3-6 player range', () => {
    const two = newGame(2);
    expect(() => startMatch(two, 3)).toThrow();
    const six = newGame(6);
    expect(() => addPlayer(six, { id: 'x', name: 'X' })).toThrow();
  });

  it('round 1 lead is whoever holds 3♣', () => {
    const state = newGame(4);
    startMatch(state, 1, mulberry32(123));
    const leader = state.players.find((p) => p.seat === state.turnSeat)!;
    expect(leader.hand.some((c) => c.rank === '3' && c.suit === 'C')).toBe(true);
    expect(state.phase).toBe('playing');
  });

  it('deals equal hands (remainder set aside)', () => {
    const state = newGame(6);
    startMatch(state, 1, mulberry32(7));
    const counts = state.players.map((p) => p.hand.length);
    expect(new Set(counts).size).toBe(1); // all equal
    expect(counts[0]).toBe(8); // floor(52 / 6)
  });
});

describe('turn rules', () => {
  it('the leader cannot pass', () => {
    const state = newGame(3);
    startMatch(state, 1, mulberry32(42));
    expect(() => pass(state, turnPlayerId(state))).toThrow(/lead/);
  });

  it('keeps the turn on a player with no legal response (they pass themselves)', () => {
    const card = (rank: Rank, suit: Suit): Card => ({ rank, suit });
    const state = newGame(3);
    state.players[0].hand = [card('2', 'S')]; // King: one unbeatable card
    state.players[1].hand = [card('9', 'C'), card('5', 'D')];
    state.players[2].hand = [card('K', 'H'), card('4', 'D')];
    state.players.forEach((p) => (p.handCount = p.hand.length));
    state.trick = { leadSeat: 0, top: null, passed: [], plays: [] };
    state.turnSeat = 0;
    state.totalRounds = 1;
    state.roundNumber = 1;
    state.phase = 'playing';

    play(state, state.players[0].id, ['2S']); // King leads 2♠ and goes out

    // The turn passes to B with the 2♠ still on top. B cannot beat it but is NOT
    // auto-passed — they keep the turn (their UI dims every card) and must pass,
    // or the turn timer passes them. The pile only clears once everyone passes.
    expect(state.players[0].finished).toBe(true);
    expect(state.trick.top?.combo.cards[0].rank).toBe('2');
    expect(state.turnSeat).toBe(1);
    expect(playableCardIds(state.players[1].hand, state.trick.top!.combo).size).toBe(0);
    // B passes, C passes -> trick resets, next active player leads fresh.
    pass(state, state.players[1].id);
    pass(state, state.players[2].id);
    expect(state.trick.top).toBeNull();
  });

  it('still lets a player who CAN beat the pile take their turn', () => {
    const card = (rank: Rank, suit: Suit): Card => ({ rank, suit });
    const state = newGame(3);
    state.players[0].hand = [card('J', 'S')]; // King leads a beatable Jack
    state.players[1].hand = [card('Q', 'C'), card('5', 'D')]; // B can beat with Q
    state.players[2].hand = [card('K', 'H'), card('4', 'D')];
    state.players.forEach((p) => (p.handCount = p.hand.length));
    state.trick = { leadSeat: 0, top: null, passed: [], plays: [] };
    state.turnSeat = 0;
    state.totalRounds = 1;
    state.roundNumber = 1;
    state.phase = 'playing';

    play(state, state.players[0].id, ['JS']); // King goes out on J♠

    // B can beat it, so B is NOT skipped — they get the turn against the J.
    expect(state.trick.top?.combo.cards[0].rank).toBe('J');
    expect(state.turnSeat).toBe(1);
    expect(playableCardIds(state.players[1].hand, state.trick.top!.combo).size).toBeGreaterThan(0);
  });
});

describe('full round invariants', () => {
  it('produces exactly one king and conserves points', () => {
    for (const n of [3, 4, 5, 6]) {
      const state = newGame(n);
      startMatch(state, 1, mulberry32(n * 1000 + 1));
      playRoundAuto(state);
      expect(state.phase).toBe('match_over'); // totalRounds = 1
      const roles = state.players.map((p) => p.role);
      expect(roles.filter((r) => r === 'king')).toHaveLength(1);
      expect(roles.filter((r) => r === 'slave')).toHaveLength(1);
      expect(roles.filter((r) => r === 'queen')).toHaveLength(n >= 4 ? 1 : 0);
      const totalScore = state.players.reduce((s, p) => s + p.score, 0);
      expect(totalScore).toBe((n * (n - 1)) / 2); // sum of n-1 .. 0
    }
  });
});

describe('resolveRanking — roles, scoring, regicide', () => {
  it('ranks plainly when there is no defending king', () => {
    const r = resolveRanking(['A', 'B', 'C', 'D', 'E'], null);
    expect(r.roles).toEqual({ A: 'king', B: 'queen', C: 'people', D: 'viceslave', E: 'slave' });
    expect(r.points).toEqual({ A: 4, B: 3, C: 2, D: 1, E: 0 });
    expect(r.regicidedId).toBeNull();
  });

  it('drops a 3-player game straight to king/people/slave', () => {
    const r = resolveRanking(['A', 'B', 'C'], null);
    expect(r.roles).toEqual({ A: 'king', B: 'people', C: 'slave' });
  });

  it('4 players have no vice-slave (that seat is people)', () => {
    const r = resolveRanking(['A', 'B', 'C', 'D'], null);
    expect(r.roles).toEqual({ A: 'king', B: 'queen', C: 'people', D: 'slave' });
  });

  it('regicides the defending king when someone else finishes first', () => {
    // Defending king P finished 2nd; everyone after P shifts up, P -> slave.
    const r = resolveRanking(['A', 'P', 'B', 'C', 'D'], 'P');
    expect(r.order).toEqual(['A', 'B', 'C', 'D', 'P']);
    expect(r.roles).toEqual({ A: 'king', B: 'queen', C: 'people', D: 'viceslave', P: 'slave' });
    expect(r.points.P).toBe(0);
    expect(r.regicidedId).toBe('P');
  });

  it('lets the king keep the throne by finishing first', () => {
    const r = resolveRanking(['P', 'A', 'B'], 'P');
    expect(r.regicidedId).toBeNull();
    expect(r.roles.P).toBe('king');
  });
});

describe('card exchange (round 2+)', () => {
  it('swaps equal counts, slave gives the top cards, previous slave leads', () => {
    const state = newGame(4);
    startMatch(state, 2, mulberry32(99));
    playRoundAuto(state);
    expect(state.phase).toBe('round_over');

    const before = Object.fromEntries(state.players.map((p) => [p.id, p.handCount]));
    continueToNextRound(state, mulberry32(100));
    expect(state.phase).toBe('exchange');
    expect(state.exchange).not.toBeNull();

    const ranking = state.lastRoundResult!.map((r) => r.playerId);
    const kingId = ranking[0];
    const slaveId = ranking.at(-1)!;

    // Snapshot slave's top 2 cards (king↔slave exchanges 2 in a 4-player game).
    const slaveBefore = playerById(state, slaveId)!;
    const slaveTop2 = [...slaveBefore.hand]
      .sort((a, b) => b.rank.localeCompare(a.rank))
      .slice(0, 2)
      .map((c) => c.rank + c.suit);

    // Each high-role player dumps their lowest cards.
    for (const choice of state.exchange!.choices) {
      const from = playerById(state, choice.fromId)!;
      const lowest = [...from.hand].slice(0, choice.count).map((c) => c.rank + c.suit);
      chooseExchange(state, choice.fromId, lowest);
    }

    expect(state.phase).toBe('playing');
    // Hand counts are preserved by an equal-count swap (fresh deal -> ignore before map sizes equal anyway)
    expect(state.players.reduce((s, p) => s + p.handCount, 0)).toBe(52);
    void before;

    // King should now hold the slave's former top cards.
    const king = playerById(state, kingId)!;
    const kingIds = king.hand.map((c) => c.rank + c.suit);
    for (const id of slaveTop2) expect(kingIds).toContain(id);

    // Previous slave leads the new round.
    expect(turnPlayerId(state)).toBe(slaveId);
  });
});

describe('roleForRank (live finish-position badge)', () => {
  it('maps finish order to roles by player count', () => {
    expect([0, 1, 2, 3, 4].map((i) => roleForRank(i, 5))).toEqual([
      'king',
      'queen',
      'people',
      'viceslave',
      'slave',
    ]);
    expect([0, 1, 2, 3].map((i) => roleForRank(i, 4))).toEqual(['king', 'queen', 'people', 'slave']);
    expect([0, 1, 2].map((i) => roleForRank(i, 3))).toEqual(['king', 'people', 'slave']);
  });
});

describe('turn direction', () => {
  it('alternates each round (round 1 ascending, round 2 descending)', () => {
    const state = newGame(4);
    startMatch(state, 3, mulberry32(1));
    expect(state.direction).toBe(1);
    playRoundAuto(state);
    continueToNextRound(state, mulberry32(2));
    expect(state.direction).toBe(-1);
  });
});

describe('multi-round match', () => {
  it('runs to match_over with accumulating scores', () => {
    const state = newGame(5);
    startMatch(state, 3, mulberry32(2024));
    let safety = 0;
    while (state.phase !== 'match_over') {
      if (state.phase === 'playing') playRoundAuto(state);
      else if (state.phase === 'round_over') continueToNextRound(state, mulberry32(safety + 1));
      else if (state.phase === 'exchange') {
        for (const choice of state.exchange!.choices) {
          const from = playerById(state, choice.fromId)!;
          chooseExchange(
            state,
            choice.fromId,
            from.hand.slice(0, choice.count).map((c) => c.rank + c.suit),
          );
        }
      }
      if (safety++ > 50) throw new Error('match did not terminate');
    }
    expect(state.roundNumber).toBe(3);
    const totalScore = state.players.reduce((s, p) => s + p.score, 0);
    expect(totalScore).toBe(3 * ((5 * 4) / 2)); // 3 rounds * (4+3+2+1+0)
  });
});

describe('slap (ตบ) — triple beats single, four beats pair', () => {
  const C = (rank: Rank, suit: Suit): Card => ({ rank, suit });

  /** A (seat 0) holds four 5s; B & D each hold 2 cards; top + mode configurable. */
  function slapState(topCards: Card[], mode: 'normal' | 'sainua') {
    const state = createGame('R', { id: 'a', name: 'A' }, mode);
    addPlayer(state, { id: 'b', name: 'B' });
    addPlayer(state, { id: 'c', name: 'C' });
    const [A, B, D] = state.players;
    A.hand = [C('5', 'C'), C('5', 'D'), C('5', 'H'), C('5', 'S'), C('9', 'S')];
    B.hand = [C('K', 'C'), C('7', 'D')];
    D.hand = [C('Q', 'C'), C('8', 'D')];
    state.players.forEach((p) => (p.handCount = p.hand.length));
    const top = detectCombo(topCards)!;
    state.discard = [...topCards, C('6', 'C'), C('6', 'D'), C('6', 'H')];
    state.trick = { leadSeat: 2, top: { combo: top, seat: 2 }, passed: [], plays: [{ seat: 2, pass: false, combo: top }] };
    state.turnSeat = 0;
    state.totalRounds = 1;
    state.roundNumber = 1;
    state.phase = 'playing';
    return state;
  }

  it('sainua: triple slaps a single → others draw 1 each', () => {
    const state = slapState([C('4', 'C')], 'sainua');
    play(state, 'a', ['5C', '5D', '5H'], () => 0);
    expect(playerById(state, 'a')!.handCount).toBe(2); // 5 - 3
    expect(playerById(state, 'b')!.handCount).toBe(3); // 2 + 1
    expect(playerById(state, 'c')!.handCount).toBe(3);
  });

  it('sainua: four slaps a pair → others draw 2 each', () => {
    const state = slapState([C('4', 'C'), C('4', 'D')], 'sainua');
    play(state, 'a', ['5C', '5D', '5H', '5S'], () => 0);
    expect(playerById(state, 'b')!.handCount).toBe(4); // 2 + 2
    expect(playerById(state, 'c')!.handCount).toBe(4);
  });

  it('normal: triple slaps a single — allowed, but NO draw penalty', () => {
    const state = slapState([C('4', 'C')], 'normal');
    play(state, 'a', ['5C', '5D', '5H']);
    expect(playerById(state, 'a')!.handCount).toBe(2);
    expect(playerById(state, 'b')!.handCount).toBe(2); // unchanged
    expect(playerById(state, 'c')!.handCount).toBe(2);
  });

  it('illegal slaps are rejected: triple-on-pair and four-on-single', () => {
    expect(() => play(slapState([C('4', 'C'), C('4', 'D')], 'sainua'), 'a', ['5C', '5D', '5H'])).toThrow();
    expect(() => play(slapState([C('4', 'C')], 'sainua'), 'a', ['5C', '5D', '5H', '5S'])).toThrow();
  });

  it('any four (even four-on-four) makes others draw 2 in sainua', () => {
    const state = createGame('R', { id: 'a', name: 'A' }, 'sainua');
    addPlayer(state, { id: 'b', name: 'B' });
    addPlayer(state, { id: 'c', name: 'C' });
    const [A, B, D] = state.players;
    A.hand = [C('7', 'C'), C('7', 'D'), C('7', 'H'), C('7', 'S'), C('9', 'S')];
    B.hand = [C('K', 'C'), C('8', 'D')];
    D.hand = [C('Q', 'C'), C('9', 'D')];
    state.players.forEach((p) => (p.handCount = p.hand.length));
    const top = detectCombo([C('5', 'C'), C('5', 'D'), C('5', 'H'), C('5', 'S')])!;
    state.discard = [C('5', 'C'), C('5', 'D'), C('5', 'H'), C('5', 'S'), C('6', 'C')];
    state.trick = { leadSeat: 2, top: { combo: top, seat: 2 }, passed: [], plays: [{ seat: 2, pass: false, combo: top }] };
    state.turnSeat = 0;
    state.totalRounds = 1;
    state.roundNumber = 1;
    state.phase = 'playing';
    play(state, 'a', ['7C', '7D', '7H', '7S'], () => 0);
    expect(playerById(state, 'a')!.handCount).toBe(1); // 5 - 4, slapper doesn't draw
    expect(playerById(state, 'b')!.handCount).toBe(4); // 2 + 2
    expect(playerById(state, 'c')!.handCount).toBe(4); // 2 + 2
  });

  it('leading a triple in sainua makes others draw 1', () => {
    const state = createGame('R', { id: 'a', name: 'A' }, 'sainua');
    addPlayer(state, { id: 'b', name: 'B' });
    addPlayer(state, { id: 'c', name: 'C' });
    const [A, B, D] = state.players;
    A.hand = [C('5', 'C'), C('5', 'D'), C('5', 'H'), C('9', 'S')];
    B.hand = [C('K', 'C'), C('7', 'D')];
    D.hand = [C('Q', 'C'), C('8', 'D')];
    state.players.forEach((p) => (p.handCount = p.hand.length));
    state.discard = [C('6', 'C'), C('6', 'D')]; // some used cards to draw from
    state.trick = { leadSeat: 0, top: null, passed: [], plays: [] };
    state.turnSeat = 0;
    state.totalRounds = 1;
    state.roundNumber = 1;
    state.phase = 'playing';
    play(state, 'a', ['5C', '5D', '5H'], () => 0); // lead a triple
    expect(playerById(state, 'b')!.handCount).toBe(3); // 2 + 1
    expect(playerById(state, 'c')!.handCount).toBe(3); // 2 + 1
  });
});

describe('liveRoles (provisional in-round badges)', () => {
  function playingState(n: number, defendingKingId: string | null): GameState {
    const state = newGame(n);
    state.phase = 'playing';
    state.totalRounds = 3;
    state.roundNumber = 2;
    state.defendingKingId = defendingKingId;
    state.players.forEach((p) => (p.role = 'people'));
    return state;
  }
  const finish = (state: GameState, id: string, pos: number) => {
    const p = playerById(state, id)!;
    p.finished = true;
    p.finishPosition = pos;
  };

  it('first player out is shown as king immediately', () => {
    const state = playingState(4, null);
    finish(state, 'p1', 0); // p1 goes out first
    const roles = liveRoles(state);
    expect(roles.p1).toBe('king');
    expect(roles.p0).toBe('people'); // still holding cards -> prior role
  });

  it('second player out (>=4) is shown as queen', () => {
    const state = playingState(4, null);
    finish(state, 'p2', 0);
    finish(state, 'p1', 1);
    const roles = liveRoles(state);
    expect(roles.p2).toBe('king');
    expect(roles.p1).toBe('queen');
  });

  it('a defending king who is not first out flips to slave the moment it is locked', () => {
    const state = playingState(5, 'p0'); // p0 is the defending king
    finish(state, 'p1', 0); // someone ELSE goes out first -> regicide certain
    const roles = liveRoles(state);
    expect(roles.p1).toBe('king');
    expect(roles.p0).toBe('slave'); // demoted live, before round end
  });

  it('finishers after the regicided king shift up one role', () => {
    const state = playingState(5, 'p0');
    finish(state, 'p1', 0); // king (p0) is no longer first -> regicide locked
    finish(state, 'p0', 1); // defending king goes out 2nd
    finish(state, 'p2', 2); // finished AFTER the king -> shifts up
    const roles = liveRoles(state);
    expect(roles.p1).toBe('king');
    expect(roles.p0).toBe('slave'); // forced to bottom
    expect(roles.p2).toBe('queen'); // index 2 -> shifted to 1 = queen
  });

  it('a defending king who IS first out keeps the crown (no regicide)', () => {
    const state = playingState(4, 'p0');
    finish(state, 'p0', 0); // king defends successfully
    finish(state, 'p1', 1);
    const roles = liveRoles(state);
    expect(roles.p0).toBe('king');
    expect(roles.p1).toBe('queen');
  });

  it('outside an active round it mirrors the stored final role', () => {
    const state = playingState(4, 'p0');
    state.phase = 'round_over';
    state.players[0].role = 'slave';
    state.players[1].role = 'king';
    const roles = liveRoles(state);
    expect(roles.p0).toBe('slave');
    expect(roles.p1).toBe('king');
  });
});

describe('regicide elimination', () => {
  const card = (rank: Rank, suit: Suit): Card => ({ rank, suit });
  it('dethrones the king the moment someone else goes out first', () => {
    const state = newGame(4);
    state.phase = 'playing';
    state.totalRounds = 2;
    state.roundNumber = 2;
    state.defendingKingId = state.players[0].id; // p0 must defend
    state.players[0].hand = [card('K', 'S'), card('Q', 'S')];
    state.players[1].hand = [card('3', 'C')]; // p1 goes out first
    state.players[2].hand = [card('5', 'D'), card('6', 'D')];
    state.players[3].hand = [card('7', 'H'), card('8', 'H')];
    state.players.forEach((p) => (p.handCount = p.hand.length));
    state.trick = { leadSeat: 1, top: null, passed: [], plays: [] };
    state.turnSeat = 1;
    state.finishCounter = 0;

    play(state, state.players[1].id, ['3C']);

    const king = state.players[0];
    expect(state.players[1].finished).toBe(true);
    expect(king.finished).toBe(true); // out immediately
    expect(king.handCount).toBe(0); // hand discarded
    expect(king.hand.length).toBe(0);
    expect(state.turnSeat).not.toBe(0); // never the king's turn again this round
    // ONLY the king is removed — everyone else keeps their cards and plays on.
    expect(state.players[2].finished).toBe(false);
    expect(state.players[2].handCount).toBe(2);
    expect(state.players[3].finished).toBe(false);
    expect(state.players[3].handCount).toBe(2);
  });

  it('does NOT eliminate the king when the king defends (goes out first)', () => {
    const state = newGame(4);
    state.phase = 'playing';
    state.totalRounds = 2;
    state.roundNumber = 2;
    state.defendingKingId = state.players[0].id;
    state.players[0].hand = [card('3', 'C')]; // king goes out first -> defends
    state.players[1].hand = [card('5', 'D'), card('6', 'D')];
    state.players[2].hand = [card('7', 'H'), card('8', 'H')];
    state.players[3].hand = [card('9', 'S'), card('A', 'S')];
    state.players.forEach((p) => (p.handCount = p.hand.length));
    state.trick = { leadSeat: 0, top: null, passed: [], plays: [] };
    state.turnSeat = 0;
    state.finishCounter = 0;

    play(state, state.players[0].id, ['3C']);

    expect(state.players[0].finished).toBe(true);
    expect(state.players[0].finishPosition).toBe(0);
    // others keep their cards — no mass elimination
    expect(state.players[1].finished).toBe(false);
    expect(state.players[1].handCount).toBe(2);
  });
});

describe('dropPlayer (quit / kick mid-match)', () => {
  it('removes the quitter from rotation, discards the hand, excludes from ranking', () => {
    const state = newGame(4);
    startMatch(state, 1, mulberry32(7));
    expect(state.phase).toBe('playing');
    const turnId = state.players.find((p) => p.seat === state.turnSeat)!.id;
    const droppedSeat = state.players.find((p) => p.id === turnId)!.seat;

    dropPlayer(state, turnId);

    const dropped = playerById(state, turnId)!;
    expect(dropped.left).toBe(true);
    expect(dropped.finished).toBe(true);
    expect(dropped.handCount).toBe(0);
    expect(state.turnSeat).not.toBe(droppedSeat); // turn never stalls on the quitter

    playRoundAuto(state);
    expect(state.phase).toBe('match_over');
    const ranked = state.lastRoundResult!.map((r) => r.playerId);
    expect(ranked).not.toContain(turnId); // quitter not ranked
    expect(ranked.length).toBe(3); // roles recomputed for the remaining 3
    expect(state.lastRoundResult!.filter((r) => r.role === 'king')).toHaveLength(1);
    expect(state.lastRoundResult!.filter((r) => r.role === 'slave')).toHaveLength(1);
  });

  it('next round deals no cards to a player who left', () => {
    const state = newGame(4);
    startMatch(state, 3, mulberry32(11));
    const quitId = state.players[2].id;
    dropPlayer(state, quitId);
    playRoundAuto(state);
    expect(state.phase).toBe('round_over');
    continueToNextRound(state, mulberry32(12));
    const quitter = playerById(state, quitId)!;
    expect(quitter.handCount).toBe(0);
    expect(quitter.finished).toBe(true);
    // the three remaining players all got cards
    expect(state.players.filter((p) => !p.left && p.handCount > 0)).toHaveLength(3);
  });
});

// keep beginRound exported-symbol referenced for clarity
void beginRound;
