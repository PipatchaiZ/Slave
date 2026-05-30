import { type Card as CardT, SUIT_SYMBOL, cardId } from '@slave/engine';

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
  return (
    <div className={cls.join(' ')} onClick={disabled ? undefined : onClick} data-id={cardId(card)}>
      <span className="card-rank">{card.rank}</span>
      <span className="card-suit">{SUIT_SYMBOL[card.suit]}</span>
      <span className="card-rank bottom">{card.rank}</span>
    </div>
  );
}

export function CardBack({ small }: { small?: boolean }) {
  return <div className={`card back ${small ? 'sm' : ''}`} />;
}
