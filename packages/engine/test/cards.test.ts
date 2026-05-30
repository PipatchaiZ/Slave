import { describe, expect, it } from 'vitest';
import { cardId, compareCards, createDeck, deal, parseCard } from '../src/cards';

describe('deck and ordering', () => {
  it('builds a full 52-card deck with unique ids', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map(cardId)).size).toBe(52);
  });

  it('orders 2 highest, 3 lowest, and ♠ over ♣', () => {
    expect(compareCards({ rank: '2', suit: 'C' }, { rank: 'A', suit: 'S' })).toBeGreaterThan(0);
    expect(compareCards({ rank: '3', suit: 'S' }, { rank: '4', suit: 'C' })).toBeLessThan(0);
    expect(compareCards({ rank: '9', suit: 'S' }, { rank: '9', suit: 'C' })).toBeGreaterThan(0);
  });

  it('parses card ids including 10', () => {
    expect(parseCard('10H')).toEqual({ rank: '10', suit: 'H' });
    expect(parseCard('AS')).toEqual({ rank: 'A', suit: 'S' });
    expect(() => parseCard('ZZ')).toThrow();
  });

  it('deals equal hands and sets the remainder aside', () => {
    const hands = deal(createDeck(), 5);
    expect(hands.flat()).toHaveLength(50); // 52 - 2 leftover
    expect(hands.map((h) => h.length)).toEqual([10, 10, 10, 10, 10]);
  });

  it('deals the whole deck when it divides evenly', () => {
    const hands = deal(createDeck(), 4);
    expect(hands.map((h) => h.length)).toEqual([13, 13, 13, 13]);
  });
});
