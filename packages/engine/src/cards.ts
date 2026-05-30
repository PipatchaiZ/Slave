// Card primitives, ordering, deck and dealing.
// Rank power: 3 is lowest (3) ... A (14), 2 is highest (15).
// Suit order (low -> high): ♣ < ♦ < ♥ < ♠

export type Suit = 'C' | 'D' | 'H' | 'S';
export const SUITS: readonly Suit[] = ['C', 'D', 'H', 'S'];
export const SUIT_ORDER: Record<Suit, number> = { C: 0, D: 1, H: 2, S: 3 };
export const SUIT_SYMBOL: Record<Suit, string> = { C: '♣', D: '♦', H: '♥', S: '♠' };

export type Rank =
  | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10'
  | 'J' | 'Q' | 'K' | 'A' | '2';
export const RANKS: readonly Rank[] = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
export const RANK_POWER: Record<Rank, number> = {
  '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  J: 11, Q: 12, K: 13, A: 14, '2': 15,
};

export interface Card {
  rank: Rank;
  suit: Suit;
}

/** Stable string id, e.g. "10H", "3C", "AS". */
export function cardId(c: Card): string {
  return `${c.rank}${c.suit}`;
}

export function parseCard(id: string): Card {
  const suit = id.slice(-1) as Suit;
  const rank = id.slice(0, -1) as Rank;
  if (!(suit in SUIT_ORDER) || !(rank in RANK_POWER)) {
    throw new Error(`Invalid card id: ${id}`);
  }
  return { rank, suit };
}

export function cardPower(c: Card): number {
  return RANK_POWER[c.rank];
}

/** Negative if a < b, positive if a > b. Orders by rank power, then suit. */
export function compareCards(a: Card, b: Card): number {
  const p = RANK_POWER[a.rank] - RANK_POWER[b.rank];
  return p !== 0 ? p : SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) deck.push({ rank, suit });
  }
  return deck;
}

export type Rng = () => number;

/** Fisher–Yates. Pure: returns a new array, does not mutate input. */
export function shuffle<T>(arr: readonly T[], rng: Rng = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Deal equal hands: each player gets floor(deck/numPlayers) cards and the
 * remainder is set aside (kept out of play) — fairer than uneven hands.
 * Returned sorted low -> high.
 */
export function deal(deck: readonly Card[], numPlayers: number): Card[][] {
  const per = Math.floor(deck.length / numPlayers);
  const hands: Card[][] = Array.from({ length: numPlayers }, () => []);
  for (let i = 0; i < per * numPlayers; i++) hands[i % numPlayers].push(deck[i]);
  for (const h of hands) h.sort(compareCards);
  return hands;
}

export function sortHand(hand: Card[]): Card[] {
  return hand.slice().sort(compareCards);
}
