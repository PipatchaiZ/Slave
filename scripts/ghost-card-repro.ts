// Confirms the reported scenario: when the King empties their hand by playing a
// card NO remaining player can beat, those players have NO legal move — every
// card is dimmed — so they can only pass (or time out) before the trick resets
// and the next player can finally lead.
import { createGame, addPlayer, play, playableCardIds, cardId } from '../packages/engine/src';
import type { Card, Rank, Suit } from '../packages/engine/src';

const C = (rank: Rank, suit: Suit): Card => ({ rank, suit });

const s = createGame('R', { id: 'king', name: 'King' });
addPlayer(s, { id: 'b', name: 'B' });
addPlayer(s, { id: 'c', name: 'C' });

// King leads and goes out on a lone 2♠ (the highest single in the game).
s.players[0].hand = [C('2', 'S')];
s.players[1].hand = [C('9', 'C'), C('5', 'D')];
s.players[2].hand = [C('K', 'H'), C('4', 'D')];
s.players.forEach((p) => (p.handCount = p.hand.length));
s.trick = { leadSeat: 0, top: null, passed: [], plays: [] };
s.turnSeat = 0;
s.totalRounds = 1;
s.roundNumber = 1;
s.phase = 'playing';

play(s, 'king', ['2S']); // King plays last card -> finished, holds the top

const king = s.players[0];
console.log(`King finished: ${king.finished} (pos ${king.finishPosition}), now turnSeat=${s.turnSeat}`);
const top = s.trick.top?.combo ?? null;
console.log(`top on the pile: ${top ? top.cards.map(cardId).join('') : 'none'} (played by a player who LEFT)`);

for (const seat of [s.turnSeat]) {
  const p = s.players.find((pl) => pl.seat === seat)!;
  const playable = playableCardIds(p.hand, top);
  console.log(
    `next player ${p.name}: hand=${p.hand.map(cardId).join(',')} · playable=${playable.size} card(s)` +
      ` -> ${playable.size === 0 ? 'ALL DIMMED, can only PASS or wait for timeout ❌' : 'has a move ✅'}`,
  );
}
