// Rectangular 8-bit play table: players sit around the perimeter, the played
// cards (pile) sit in the centre, and a dashed arrow runs along the edge from
// the current player to the next one to show turn direction.
import { type Card as CardT, type GameView, SUIT_SYMBOL, cardId } from '@slave/engine';
import { CardFace } from './Card';
import { ROLE_ICON, ROLE_LABEL, RoleBadge } from './shared';

const COMBO_LABEL: Record<string, string> = {
  single: 'เดี่ยว',
  pair: 'คู่',
  triple: 'ตอง',
  four: 'สี่ใบ',
};

function fmtCards(cards: CardT[]): string {
  return cards.map((c) => `${c.rank}${SUIT_SYMBOL[c.suit]}`).join(' ');
}

// Seat ring + arrow geometry, all in 0..100 percent space (matches the SVG
// viewBox "0 0 100 100" with preserveAspectRatio="none", so coordinates line
// up with the seats' CSS left/top percentages on any aspect ratio).
const L = 12;
const R = 88;
const T = 13;
const B = 87;
const CX = (L + R) / 2;
const WHALF = CX - L;
const HSIDE = B - T;
const WTOP = R - L;
const PERIM = WHALF * 2 + HSIDE * 2 + WTOP;

/** Point on the seat-ring perimeter; t=0 is bottom-centre, increasing clockwise. */
function perimeterPoint(t: number): [number, number] {
  let d = (((t % 1) + 1) % 1) * PERIM;
  if (d <= WHALF) return [CX - d, B]; // bottom-centre -> bottom-left
  d -= WHALF;
  if (d <= HSIDE) return [L, B - d]; // up the left edge
  d -= HSIDE;
  if (d <= WTOP) return [L + d, T]; // across the top
  d -= WTOP;
  if (d <= HSIDE) return [R, T + d]; // down the right edge
  d -= HSIDE;
  return [R - d, B]; // bottom-right -> bottom-centre
}

export interface Reaction {
  key: number;
  seat: number;
  emoji: string;
}

export interface BigReaction {
  key: number;
  emoji: string;
  title: string;
  label: string;
  name: string;
}

export function CircleTable({
  view,
  nextSeat,
  secs,
  reactions,
  bigReaction,
  direction,
}: {
  view: GameView;
  nextSeat: number | null;
  secs: number | null;
  reactions: Reaction[];
  bigReaction: BigReaction | null;
  direction: number;
}) {
  const you = view.players.find((p) => p.isYou)!;
  const n = view.players.length;
  const dispIndex = (seat: number) => (seat - you.seat + n) % n;
  const playing = view.phase === 'playing';
  const top = view.trick.top?.combo ?? null;

  const lastBySeat = new Map<number, { pass: boolean; cards: CardT[] }>();
  for (const pl of view.trick.plays) {
    lastBySeat.set(pl.seat, { pass: pl.pass, cards: pl.combo?.cards ?? [] });
  }

  // Direction arrow: a polyline tracing the perimeter from current -> next.
  let arcPath = '';
  if (playing && nextSeat != null && nextSeat !== view.turnSeat) {
    const dir = direction || 1;
    const t0 = dispIndex(view.turnSeat) / n;
    const t1 = dispIndex(nextSeat) / n;
    // Magnitude of the step along the perimeter, going the play direction.
    let mag = dir > 0 ? (t1 - t0 + 1) % 1 : (t0 - t1 + 1) % 1;
    if (mag === 0) mag = 1 / n;
    const K = 18;
    const pts: string[] = [];
    for (let k = 0; k <= K; k++) {
      const [x, y] = perimeterPoint(t0 + dir * mag * (k / K));
      pts.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    arcPath = 'M ' + pts.join(' L ');
  }

  return (
    <div className="table-rect">
      <div className="rect-felt" />

      <svg className="dir-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <marker
            id="dir-arrowhead"
            markerWidth="6"
            markerHeight="6"
            refX="3"
            refY="3"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path className="dir-head" d="M0,0 L6,3 L0,6 Z" />
          </marker>
        </defs>
        {arcPath && <path className="dir-path" d={arcPath} markerEnd="url(#dir-arrowhead)" />}
      </svg>

      <div className="rect-pile">
        {view.phase === 'exchange' && view.exchange ? (
          <div className="exchange-box">
            <div className="exchange-title">🔄 เฟสแลกไพ่</div>
            {view.exchange.choices.map((ch, i) => {
              const from = view.players.find((p) => p.id === ch.fromId);
              const to = view.players.find((p) => p.id === ch.toId);
              return (
                <div key={i} className="exchange-row">
                  {from?.role ? `${ROLE_ICON[from.role]} ${ROLE_LABEL[from.role]}` : '?'} →{' '}
                  {to?.role ? `${ROLE_ICON[to.role]} ${ROLE_LABEL[to.role]}` : '?'} · {ch.count} ใบ{' '}
                  {ch.submitted ? '✓' : '⏳'}
                </div>
              );
            })}
          </div>
        ) : top ? (
          <>
            <div className="row" style={{ justifyContent: 'center' }}>
              {top.cards.map((c) => (
                <CardFace key={cardId(c)} card={c} disabled big />
              ))}
            </div>
            <div className="small muted">
              {view.players.find((p) => p.seat === view.trick.top!.seat)?.name} ลง ·{' '}
              {COMBO_LABEL[top.kind]}
            </div>
          </>
        ) : (
          <div className="pile-empty">
            {playing
              ? '— กองว่าง รอผู้นำลงไพ่ —'
              : view.phase === 'round_over'
                ? 'จบรอบ'
                : ''}
          </div>
        )}
      </div>

      {view.players.map((p) => {
        const [x, y] = perimeterPoint(dispIndex(p.seat) / n);
        const isActive = playing && view.turnSeat === p.seat;
        const cls = ['seat'];
        if (isActive) cls.push('active');
        else if (playing && nextSeat === p.seat) cls.push('next');
        if (p.isYou) cls.push('you');
        if (!p.connected) cls.push('offline');
        if (p.finished) cls.push('finished');
        const act = lastBySeat.get(p.seat);
        // Live role from the server: finishers show their standing immediately,
        // and a regicided defending king flips to Slave the moment it's locked.
        const liveRole = p.liveRole;
        return (
          <div key={p.id} className="tbl-seat" style={{ left: `${x}%`, top: `${y}%` }}>
            <div className={cls.join(' ')}>
              {isActive && secs != null && (
                <div className={`timer ${secs > 5 ? 'calm' : ''}`}>{secs}</div>
              )}
              <div className="seat-name">
                {p.name}
                {p.isYou ? ' (คุณ)' : ''}
              </div>
              <div className="seat-badges">
                <RoleBadge role={liveRole} />
              </div>
              <div className="seat-meta">🃏 {p.handCount} · ⭐ {p.score}</div>
              <div className="seat-meta">
                {!p.connected && <span className="offline-tag">⚠ หลุด </span>}
                {p.finished && '✓ หมดมือ '}
                {view.defendingKingId === p.id && '🛡 ป้องกัน '}
                {view.hostId === p.id && <span className="host-text">host</span>}
              </div>
              <div className={`seat-status ${act ? (act.pass ? 'passed' : 'played') : 'muted'}`}>
                {act ? (act.pass ? 'ผ่าน' : `ลง ${fmtCards(act.cards)}`) : '—'}
              </div>
            </div>
          </div>
        );
      })}

      {reactions.map((r) => {
        const [x, y] = perimeterPoint(dispIndex(r.seat) / n);
        return (
          <div key={r.key} className="reaction" style={{ left: `${x}%`, top: `${y}%` }}>
            {r.emoji}
          </div>
        );
      })}

      {bigReaction && (
        <div key={bigReaction.key} className="big-reaction">
          <div className="big-emoji">{bigReaction.emoji}</div>
          <div className="big-title">{bigReaction.title}</div>
          <div className="big-label">
            {bigReaction.name} · {bigReaction.label}
          </div>
        </div>
      )}
    </div>
  );
}
