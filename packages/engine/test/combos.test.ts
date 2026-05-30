import { describe, expect, it } from 'vitest';
import { Card, Rank, Suit } from '../src/cards';
import { Combo, beats, detectCombo, isSlap, playableCardIds } from '../src/combos';

const c = (rank: Rank, suit: Suit): Card => ({ rank, suit });
const combo = (cards: Card[]): Combo => {
  const r = detectCombo(cards);
  if (!r) throw new Error('expected a valid combo');
  return r;
};

describe('detectCombo', () => {
  it('detects same-rank shapes', () => {
    expect(detectCombo([c('9', 'C')])?.kind).toBe('single');
    expect(detectCombo([c('7', 'C'), c('7', 'H')])?.kind).toBe('pair');
    expect(detectCombo([c('5', 'C'), c('5', 'H'), c('5', 'S')])?.kind).toBe('triple');
    expect(detectCombo([c('5', 'C'), c('5', 'H'), c('5', 'S'), c('5', 'D')])?.kind).toBe('four');
  });

  it('rejects mixed ranks, straights and oversize sets', () => {
    expect(detectCombo([])).toBeNull();
    expect(detectCombo([c('3', 'C'), c('4', 'H')])).toBeNull(); // two different ranks
    expect(detectCombo([c('4', 'C'), c('5', 'H'), c('6', 'S')])).toBeNull(); // a straight (not allowed)
    expect(detectCombo([c('3', 'C'), c('3', 'H'), c('3', 'S'), c('3', 'D'), c('3', 'C')])).toBeNull();
  });
});

describe('beats — same count, higher rank only', () => {
  it('higher rank wins within the same shape', () => {
    expect(beats(combo([c('9', 'C')]), combo([c('8', 'S')]))).toBe(true);
    expect(beats(combo([c('K', 'C'), c('K', 'D')]), combo([c('Q', 'H'), c('Q', 'S')]))).toBe(true);
    expect(beats(combo([c('5', 'C'), c('5', 'H'), c('5', 'S')]), combo([c('4', 'C'), c('4', 'H'), c('4', 'S')]))).toBe(true);
    // higher four beats lower four (same count -> higher rank)
    const four7 = combo([c('7', 'C'), c('7', 'D'), c('7', 'H'), c('7', 'S')]);
    const four5 = combo([c('5', 'C'), c('5', 'D'), c('5', 'H'), c('5', 'S')]);
    expect(beats(four7, four5)).toBe(true);
    expect(beats(four5, four7)).toBe(false);
  });

  it('2 is the highest rank', () => {
    expect(beats(combo([c('2', 'C')]), combo([c('A', 'S')]))).toBe(true);
    expect(beats(combo([c('A', 'S')]), combo([c('2', 'C')]))).toBe(false);
  });

  it('different shapes never beat each other', () => {
    const single = combo([c('K', 'S')]);
    const pair = combo([c('3', 'C'), c('3', 'D')]);
    const triple = combo([c('5', 'C'), c('5', 'D'), c('5', 'H')]);
    const four = combo([c('6', 'C'), c('6', 'D'), c('6', 'H'), c('6', 'S')]);
    expect(beats(pair, single)).toBe(false);
    expect(beats(four, triple)).toBe(false);
    expect(beats(four, single)).toBe(false);
    expect(beats(triple, pair)).toBe(false);
  });
});

describe('isSlap — triple beats single, four beats pair', () => {
  it('allows triple-on-single and four-on-pair', () => {
    expect(isSlap(combo([c('3', 'C'), c('3', 'D'), c('3', 'H')]), combo([c('A', 'S')]))).toBe(true);
    expect(
      isSlap(combo([c('3', 'C'), c('3', 'D'), c('3', 'H'), c('3', 'S')]), combo([c('A', 'C'), c('A', 'H')])),
    ).toBe(true);
  });
  it('rejects other cross-shape combinations', () => {
    expect(isSlap(combo([c('3', 'C'), c('3', 'D'), c('3', 'H')]), combo([c('A', 'C'), c('A', 'H')]))).toBe(false); // triple on pair
    expect(
      isSlap(combo([c('3', 'C'), c('3', 'D'), c('3', 'H'), c('3', 'S')]), combo([c('A', 'S')])),
    ).toBe(false); // four on single
    expect(isSlap(combo([c('K', 'C'), c('K', 'D')]), combo([c('A', 'S')]))).toBe(false); // pair on single
  });
});

describe('playableCardIds', () => {
  it('leading makes every card playable', () => {
    expect(playableCardIds([c('3', 'C'), c('9', 'H')], null).size).toBe(2);
  });

  it('vs a single: higher singles and any triple (slap) are playable', () => {
    const hand = [
      c('7', 'C'),
      c('J', 'H'),
      c('10', 'C'),
      c('3', 'C'),
      c('3', 'D'),
      c('3', 'H'),
      c('5', 'S'),
    ];
    const ids = playableCardIds(hand, detectCombo([c('9', 'S')])!);
    expect(ids.has('JH')).toBe(true); // J > 9
    expect(ids.has('10C')).toBe(true); // 10 > 9
    expect(ids.has('3C')).toBe(true); // triple of 3s slaps a single
    expect(ids.has('7C')).toBe(false); // 7 < 9
    expect(ids.has('5S')).toBe(false); // lone low card
  });

  it('vs a pair: higher pairs and any four (slap) are playable', () => {
    const hand = [
      c('9', 'C'),
      c('9', 'D'),
      c('K', 'S'),
      c('3', 'C'),
      c('3', 'D'),
      c('3', 'H'),
      c('3', 'S'),
    ];
    const ids = playableCardIds(hand, detectCombo([c('7', 'C'), c('7', 'D')])!);
    expect(ids.has('9C')).toBe(true); // pair of 9s > pair of 7s
    expect(ids.has('KS')).toBe(false); // lone K can't make a pair
    expect(ids.has('3C')).toBe(true); // four of 3s slaps a pair
  });
});

describe('beats — suit tie-breaks', () => {
  it('suit breaks ties for singles', () => {
    expect(beats(combo([c('9', 'S')]), combo([c('9', 'C')]))).toBe(true);
    expect(beats(combo([c('9', 'C')]), combo([c('9', 'S')]))).toBe(false);
  });

  it('suit of the highest card breaks ties for pairs', () => {
    const high = combo([c('7', 'H'), c('7', 'S')]); // top ♠
    const low = combo([c('7', 'C'), c('7', 'D')]); // top ♦
    expect(beats(high, low)).toBe(true);
    expect(beats(low, high)).toBe(false);
  });
});
