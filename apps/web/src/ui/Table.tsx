import { useEffect, useRef, useState } from 'react';
import { EV, type GameView, beats, cardId, detectCombo, isSlap, playableCardIds } from '@slave/engine';
import { socket } from '../net';
import { sfx } from '../audio';
import { CardFace } from './Card';
import { MuteButton, Screen } from './shared';
import { CircleTable } from './CircleTable';
import { MatchOver, RoundOver } from './Results';

const COMBO_LABEL: Record<string, string> = {
  single: 'เดี่ยว',
  pair: 'คู่',
  triple: 'ตอง',
  four: 'สี่ใบ',
};

// Emoji reactions: by combo played, and by role revealed at round end.
const COMBO_EMOJI: Record<string, string> = {
  single: '🙂',
  pair: '😉',
  triple: '😤',
  four: '💣',
};
const ROLE_EMOJI: Record<string, string> = {
  king: '😎',
  queen: '😌',
  people: '🙂',
  viceslave: '😟',
  slave: '😭',
};

export function Table({ view, onLeave }: { view: GameView; onLeave: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hostMenu, setHostMenu] = useState(false);
  const you = view.players.find((p) => p.isYou)!;
  const isHost = view.hostId === view.yourId;
  const turnPlayer = view.players.find((p) => p.seat === view.turnSeat);

  const pendingChoice = view.exchange?.choices.find((c) => c.yourTurn) ?? null;
  const exchangeMode = view.phase === 'exchange' && !!pendingChoice;
  const yourTurn = view.phase === 'playing' && view.turnSeat === you.seat && !you.finished;

  // Next seat that can still act this trick (turn direction / who's up next).
  const passedSet = new Set(view.trick.passed);
  const nextSeat = (() => {
    if (view.phase !== 'playing') return null;
    const n = view.players.length;
    const dir = view.direction || 1;
    for (let step = 1; step <= n; step++) {
      const seat = (((view.turnSeat + dir * step) % n) + n) % n;
      const p = view.players.find((pl) => pl.seat === seat)!;
      if (!p.finished && !passedSet.has(seat)) return seat;
    }
    return null;
  })();

  const top = view.trick.top?.combo ?? null;
  const selectedCards = view.yourHand.filter((c) => selected.has(cardId(c)));
  const combo = detectCombo(selectedCards);
  const canPlay = yourTurn && !!combo && (!top || beats(combo, top) || isSlap(combo, top));
  const canPass = yourTurn && !!top;
  // Cards that can be part of some legal move this turn (others are dimmed).
  const playable = yourTurn ? playableCardIds(view.yourHand, top) : null;

  // Countdown derived from the server's absolute deadline + a clock offset, so
  // it stays in sync across clients and survives a refresh (no local restart).
  const offsetRef = useRef(0);
  useEffect(() => {
    offsetRef.current = view.serverNow - Date.now();
  }, [view.serverNow]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const secs =
    view.turnEndsAt != null
      ? Math.max(0, Math.ceil((view.turnEndsAt - (nowMs + offsetRef.current)) / 1000))
      : null;

  // Reactions: small bubbles over seats + a big centre burst for the headline
  // events (went out / triple / four). All last 2s.
  const [reactions, setReactions] = useState<{ key: number; seat: number; emoji: string }[]>([]);
  const [bigReaction, setBigReaction] = useState<{
    key: number;
    emoji: string;
    title: string;
    label: string;
    name: string;
  } | null>(null);
  const prevViewRef = useRef<GameView | null>(null);
  const playSigRef = useRef('');
  const reactKeyRef = useRef(0);
  useEffect(() => {
    const prev = prevViewRef.current;
    prevViewRef.current = view;
    if (!prev) return;
    const small: { seat: number; emoji: string }[] = [];
    let big: { emoji: string; title: string; label: string; name: string; seat: number } | null =
      null;

    // Going out is the headline event.
    const activeCount = view.players.filter((p) => !p.left).length;
    let royalFinish = false; // someone went out as King/Queen
    let downToOne = false; // someone is now on their last card
    for (const p of view.players) {
      const pp = prev.players.find((x) => x.id === p.id);
      if (!pp) continue;
      // A player who quit/was kicked is also marked finished — don't treat that
      // as "went out" (no FINISHED burst / victory sound for them).
      if (p.finished && !pp.finished && !p.left) {
        big = { emoji: '🎉', title: 'FINISHED', label: 'หมดมือ!', name: p.name, seat: p.seat };
        const fp = p.finishPosition ?? 99;
        if (fp === 0 || (fp === 1 && activeCount >= 4)) royalFinish = true; // King / Queen
      }
      if (!p.left && p.handCount === 1 && pp.handCount > 1) downToOne = true;
    }
    if (royalFinish) sfx.royalFinish();
    else if (downToOne) sfx.lastCard();

    const lp = view.trick.plays.at(-1);
    const sig =
      view.phase === 'playing' && lp
        ? `${view.roundNumber}:${view.trick.plays.length}:${lp.seat}:${lp.pass}`
        : '';
    if (sig && sig !== playSigRef.current) {
      playSigRef.current = sig;
      const name = view.players.find((p) => p.seat === lp!.seat)?.name ?? '';
      const sainua = view.mode === 'sainua';
      // Slap sounds fire on any triple/four played (independent of the visuals).
      if (!lp!.pass && lp!.combo?.kind === 'triple') sfx.slapTriple();
      else if (!lp!.pass && lp!.combo?.kind === 'four') sfx.slapFour();
      if (!(big && big.seat === lp!.seat)) {
        if (lp!.pass) small.push({ seat: lp!.seat, emoji: '😔' });
        else if (lp!.combo?.kind === 'triple')
          big = {
            emoji: '🔥',
            title: 'TRIPLE',
            label: sainua ? 'ตอง! ทุกคนจั่ว +1' : 'ตอง!',
            name,
            seat: lp!.seat,
          };
        else if (lp!.combo?.kind === 'four')
          big = {
            emoji: '💣',
            title: 'QUADRUPLE',
            label: sainua ? 'สี่ใบ! ทุกคนจั่ว +2' : 'สี่ใบ!',
            name,
            seat: lp!.seat,
          };
        else small.push({ seat: lp!.seat, emoji: COMBO_EMOJI[lp!.combo?.kind ?? ''] ?? '🙂' });
      }
      // จั่วเพิ่ม mode: show "🃏+N" over every seat that actually drew cards, so
      // it's obvious the triple/four made the others draw.
      if (sainua && (lp!.combo?.kind === 'triple' || lp!.combo?.kind === 'four')) {
        for (const p of view.players) {
          const pp = prev.players.find((x) => x.id === p.id);
          if (!pp || p.seat === lp!.seat) continue;
          const drew = p.handCount - pp.handCount;
          if (drew > 0) small.push({ seat: p.seat, emoji: `🃏+${drew}` });
        }
      }
    }

    if (view.phase === 'round_over' && prev.phase !== 'round_over') {
      for (const r of view.lastRoundResult ?? []) {
        const p = view.players.find((x) => x.id === r.playerId);
        if (p) small.push({ seat: p.seat, emoji: ROLE_EMOJI[r.role] ?? '🙂' });
      }
    }

    if (big) {
      const key = reactKeyRef.current++;
      setBigReaction({ key, emoji: big.emoji, title: big.title, label: big.label, name: big.name });
      setTimeout(() => setBigReaction((cur) => (cur && cur.key === key ? null : cur)), 2000);
    }
    if (small.length) {
      const items = small.map((o) => ({ ...o, key: reactKeyRef.current++ }));
      setReactions((rs) => [...rs, ...items]);
      items.forEach((it) =>
        setTimeout(() => setReactions((rs) => rs.filter((x) => x.key !== it.key)), 2000),
      );
    }
  }, [view]);

  // Reset selection whenever it stops being our moment to act.
  useEffect(() => {
    setSelected(new Set());
  }, [view.turnSeat, view.phase, view.roundNumber]);

  // Sound cues.
  const wasYourTurn = useRef(false);
  useEffect(() => {
    if (yourTurn && !wasYourTurn.current) sfx.turn();
    wasYourTurn.current = yourTurn;
  }, [yourTurn]);
  useEffect(() => {
    if (view.phase === 'round_over' || view.phase === 'match_over') {
      if (you.role === 'king') sfx.win();
      else if (you.role === 'slave') sfx.lose();
    }
  }, [view.phase, view.roundNumber]);

  function toggle(id: string) {
    if (!exchangeMode && !yourTurn) return;
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      if (exchangeMode && next.size >= (pendingChoice?.count ?? 0)) return;
      next.add(id);
      sfx.select();
    }
    setSelected(next);
  }

  function doPlay() {
    if (!canPlay) return;
    sfx.play();
    socket.emit(EV.play, { cardIds: [...selected] });
  }
  function doPass() {
    if (!canPass) return;
    sfx.pass();
    socket.emit(EV.pass);
  }
  function doExchange() {
    if (!pendingChoice || selected.size !== pendingChoice.count) return;
    sfx.play();
    socket.emit(EV.exchange, { cardIds: [...selected] });
  }

  // Are you the low-role receiver whose top cards get auto-given?
  const youReceiving = view.exchange?.choices.find((ch) => ch.toId === view.yourId) ?? null;
  const givingIds = new Set<string>();
  if (youReceiving) {
    view.yourHand.slice(-youReceiving.count).forEach((c) => givingIds.add(cardId(c)));
  }

  const banner = (() => {
    if (view.phase === 'exchange') {
      if (pendingChoice) {
        const to = view.players.find((p) => p.id === pendingChoice.toId);
        return `เลือก ${pendingChoice.count} ใบให้ ${to?.name ?? ''}`;
      }
      if (youReceiving) {
        const from = view.players.find((p) => p.id === youReceiving.fromId);
        return `ส่งไพ่สูงสุด ${youReceiving.count} ใบให้ ${from?.name ?? ''} อัตโนมัติ • รอ…`;
      }
      return 'กำลังแลกไพ่ รอผู้เล่นเลือก…';
    }
    if (view.phase === 'playing') {
      return yourTurn ? '★ เทิร์นของคุณ! ★' : `เทิร์นของ ${turnPlayer?.name ?? ''}`;
    }
    return '';
  })();

  return (
    <Screen>
      <div className="topbar">
        <span className="pill">ห้อง {view.roomCode}</span>
        <span className="pill">
          รอบ {view.roundNumber}/{view.totalRounds}
        </span>
        {view.mode === 'sainua' && <span className="pill">🌶️ จั่วเพิ่ม</span>}
        <div className="spacer" />
        <MuteButton />
        {isHost ? (
          <button className="pill" onClick={() => setHostMenu(true)}>
            ⚙ HOST
          </button>
        ) : (
          <button className="pill" onClick={onLeave}>
            ออก
          </button>
        )}
      </div>

      {hostMenu && isHost && (
        <HostMenu view={view} onClose={() => setHostMenu(false)} onLeave={onLeave} />
      )}

      <div className="table">
        {view.phase !== 'match_over' && (
          <CircleTable
            view={view}
            nextSeat={nextSeat}
            secs={secs}
            reactions={reactions}
            bigReaction={bigReaction}
            direction={view.direction || 1}
          />
        )}

        {view.phase === 'match_over' ? (
          <MatchOver view={view} onLeave={onLeave} />
        ) : view.phase === 'round_over' ? (
          <RoundOver view={view} />
        ) : (
          <div className="action-dock">
            <div className={`banner ${yourTurn ? 'you' : ''}`}>
              {banner}
              {view.phase === 'playing' && secs != null && (
                <>
                  {' · ⏱ '}
                  <span className={secs <= 5 ? 'cd warn' : 'cd'}>{secs}s</span>
                </>
              )}
            </div>

            <div className={`hand ${yourTurn ? 'active-turn' : ''}`}>
              {view.yourHand.length === 0 ? (
                <span className="pile-empty">คุณหมดไพ่แล้ว 🎉</span>
              ) : (
                view.yourHand.map((c) => (
                  <CardFace
                    key={cardId(c)}
                    card={c}
                    selected={selected.has(cardId(c))}
                    marked={givingIds.has(cardId(c))}
                    dim={!!playable && !playable.has(cardId(c))}
                    disabled={(!exchangeMode && !yourTurn) || (!!playable && !playable.has(cardId(c)))}
                    onClick={() => toggle(cardId(c))}
                  />
                ))
              )}
            </div>

            <div className="row" style={{ justifyContent: 'center' }}>
              {view.phase === 'exchange' ? (
                exchangeMode ? (
                  <button
                    className="btn primary"
                    disabled={selected.size !== pendingChoice!.count}
                    onClick={doExchange}
                  >
                    ให้ไพ่ ({selected.size}/{pendingChoice!.count})
                  </button>
                ) : (
                  <span className="muted">⏳ รอการแลกไพ่…</span>
                )
              ) : (
                <>
                  <button className="btn primary" disabled={!canPlay} onClick={doPlay}>
                    ลงไพ่{combo ? ` · ${COMBO_LABEL[combo.kind]}` : ''}
                  </button>
                  <button className="btn" disabled={!canPass} onClick={doPass}>
                    ผ่าน
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </Screen>
  );
}

function HostMenu({
  view,
  onClose,
  onLeave,
}: {
  view: GameView;
  onClose: () => void;
  onLeave: () => void;
}) {
  const others = view.players.filter((p) => p.id !== view.yourId && p.connected);
  const transferAndLeave = (id: string) => {
    sfx.click();
    socket.emit(EV.transferHost, { toPlayerId: id });
    setTimeout(onLeave, 150);
  };
  const kick = (id: string) => {
    sfx.click();
    socket.emit(EV.kick, { playerId: id });
  };
  const disband = () => {
    sfx.click();
    socket.emit(EV.disband);
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel modal" onClick={(e) => e.stopPropagation()}>
        <h2>จัดการห้อง (Host)</h2>
        <p className="small muted">โอนสิทธิ์ / เตะผู้เล่น / ออก / ยุบห้อง</p>
        {others.length > 0 ? (
          <div className="col">
            {others.map((p) => (
              <div key={p.id} className="row spread" style={{ gap: 6 }}>
                <span className="small">{p.name}</span>
                <span className="row" style={{ gap: 6 }}>
                  <button
                    className="btn"
                    style={{ padding: '6px 8px' }}
                    onClick={() => transferAndLeave(p.id)}
                  >
                    👑 โอน+ออก
                  </button>
                  <button
                    className="btn danger"
                    style={{ padding: '6px 8px' }}
                    onClick={() => kick(p.id)}
                  >
                    👢 เตะ
                  </button>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="small muted">ไม่มีผู้เล่นออนไลน์คนอื่น</p>
        )}
        <button className="btn ghost" style={{ marginTop: 10 }} onClick={onLeave}>
          🚪 ออกเฉยๆ (ระบบโอน host ให้อัตโนมัติ)
        </button>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn danger" onClick={disband}>
            ยุบห้อง (ทุกคนออก)
          </button>
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}
