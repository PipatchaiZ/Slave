import { type Card as CardT, cardId } from '@slave/engine';
import { PixelSprite, SUIT_SPRITE } from './pixel';

interface Props {
  card: CardT;
  selected?: boolean;
  small?: boolean;
  big?: boolean;
  marked?: boolean;
  dim?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export function CardFace({ card, selected, small, big, marked, dim, disabled, onClick }: Props) {
  const red = card.suit === 'H' || card.suit === 'D';
  const cls = ['card'];
  if (red) cls.push('red');
  if (selected) cls.push('selected');
  if (small) cls.push('sm');
  if (big) cls.push('lg');
  if (marked) cls.push('marked');
  if (dim) cls.push('dim');
  if (disabled) cls.push('disabled');
  // Pixel pip size tracks the card size (sm / default / lg).
  const unit = big ? 4 : small ? 2 : 3;
  return (
    <div className={cls.join(' ')} onClick={disabled ? undefined : onClick} data-id={cardId(card)}>
      <span className="card-rank">{card.rank}</span>
      <PixelSprite className="card-suit" name={SUIT_SPRITE[card.suit]} unit={unit} />
      <span className="card-rank bottom">{card.rank}</span>
    </div>
  );
}

export function CardBack({ small }: { small?: boolean }) {
  return (
    <div className={`card back pixelback ${small ? 'sm' : ''}`}>
      <PixelSprite className="card-suit" name="emblem" unit={small ? 2 : 3} outline="var(--card-black)" />
    </div>
  );
}
