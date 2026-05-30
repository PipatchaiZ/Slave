// Combo detection and comparison — "normal mode".
//
// A play is a set of same-rank cards: 1 = single, 2 = pair, 3 = triple,
// 4 = four. To beat the current play you must match its COUNT and play a
// strictly higher rank (suit breaks ties where the rank can tie). There is no
// cross-shape beating — a pair only beats a pair, a triple only a triple, etc.

import { Card, RANK_POWER, SUIT_ORDER, cardId, compareCards } from './cards';

export type ComboKind = 'single' | 'pair' | 'triple' | 'four';

const COUNT_KIND: Record<number, ComboKind> = {
  1: 'single',
  2: 'pair',
  3: 'triple',
  4: 'four',
};

export interface Combo {
  kind: ComboKind;
  count: number;
  cards: Card[]; // sorted low -> high
  /** Comparison key, lexicographic, only meaningful between same-count combos. */
  key: number[];
}

function buildKey(kind: ComboKind, sorted: Card[]): number[] {
  const top = sorted[sorted.length - 1];
  // Triples and fours can never tie on rank (not enough cards in a deck), so
  // rank alone suffices. Singles and pairs can tie, broken by the top suit.
  if (kind === 'single' || kind === 'pair') {
    return [RANK_POWER[top.rank], SUIT_ORDER[top.suit]];
  }
  return [RANK_POWER[top.rank]];
}

/** Returns the Combo for a set of cards, or null if it isn't a legal play. */
export function detectCombo(cards: readonly Card[]): Combo | null {
  if (cards.length < 1 || cards.length > 4) return null;
  const sorted = cards.slice().sort(compareCards);
  const sameRank = sorted.every((c) => c.rank === sorted[0].rank);
  if (!sameRank) return null;
  const kind = COUNT_KIND[sorted.length];
  return { kind, count: sorted.length, cards: sorted, key: buildKey(kind, sorted) };
}

function compareKey(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Can `candidate` be played on top of `current`? Must be the same count
 * (same shape) and a strictly higher rank/suit.
 */
export function beats(candidate: Combo, current: Combo): boolean {
  if (candidate.count !== current.count) return false;
  return compareKey(candidate.key, current.key) > 0;
}

/**
 * Cross-shape "slap" (ตบ): a triple beats ANY single, a four beats ANY pair.
 * Legal in both modes (sainua adds a draw penalty on top — handled by the game).
 */
export function isSlap(candidate: Combo, current: Combo): boolean {
  return (
    (candidate.kind === 'triple' && current.kind === 'single') ||
    (candidate.kind === 'four' && current.kind === 'pair')
  );
}

/**
 * Which cards in `hand` could be part of SOME legal move against `top`.
 * When `top` is null (leading) every card is playable. Used by the UI to dim
 * unplayable cards.
 */
export function playableCardIds(hand: readonly Card[], top: Combo | null): Set<string> {
  const ids = new Set<string>();
  if (!top) {
    for (const c of hand) ids.add(cardId(c));
    return ids;
  }
  const groups = new Map<string, Card[]>();
  for (const c of hand) {
    const g = groups.get(c.rank);
    if (g) g.push(c);
    else groups.set(c.rank, [c]);
  }
  for (const cards of groups.values()) {
    if (top.count === 1) {
      // any single that beats the top single
      for (const c of cards) {
        const cb = detectCombo([c]);
        if (cb && beats(cb, top)) ids.add(cardId(c));
      }
    } else if (cards.length >= top.count) {
      // best same-count combo of this rank (highest suits)
      const chosen = [...cards].sort(compareCards).slice(-top.count);
      const cb = detectCombo(chosen);
      if (cb && beats(cb, top)) for (const c of cards) ids.add(cardId(c));
    }
    // slaps: triple beats any single, four beats any pair
    if ((top.kind === 'single' && cards.length >= 3) || (top.kind === 'pair' && cards.length >= 4)) {
      for (const c of cards) ids.add(cardId(c));
    }
  }
  return ids;
}
