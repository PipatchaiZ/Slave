import { useState } from 'react';
import { EV, type GameView } from '@slave/engine';
import { socket } from '../net';
import { sfx } from '../audio';
import { MuteButton, Screen } from './shared';
import { RulesModal } from './RulesModal';

export function Lobby({ view, onLeave }: { view: GameView; onLeave: () => void }) {
  const isHost = view.hostId === view.yourId;
  const n = view.players.length;
  const canStart = n >= 3 && n <= 8;
  const [copied, setCopied] = useState(false);
  const [showRules, setShowRules] = useState(false);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(view.roomCode);
      sfx.click();
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <Screen>
      <div className="title">SLAVE</div>
      <div className="panel">
        <div className="row spread">
          <h2>ห้องรอผู้เล่น</h2>
          <span className="row" style={{ gap: 6 }}>
            <button className="pill" onClick={() => setShowRules(true)}>
              📖 กฎ
            </button>
            <MuteButton />
          </span>
        </div>
        {showRules && <RulesModal onClose={() => setShowRules(false)} />}
        <div className="code-chip">{view.roomCode}</div>
        <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
          <button className="btn" onClick={copyCode}>
            {copied ? '✓ คัดลอกแล้ว' : '📋 คัดลอกโค้ด'}
          </button>
        </div>
        <p className="small muted center">
          แชร์โค้ดนี้ให้เพื่อน • เล่น {view.totalRounds} รอบ •{' '}
          {view.mode === 'sainua' ? 'โหมดจั่วเพิ่ม 🌶️' : 'โหมดปกติ'}
        </p>

        <div className="col" style={{ marginTop: 12 }}>
          {view.players.map((p) => (
            <div key={p.id} className="row spread">
              <span>
                {p.seat + 1}. {p.name}
                {p.isYou ? ' (คุณ)' : ''}
              </span>
              <span className="row" style={{ gap: 6 }}>
                {view.hostId === p.id && <span className="badge king">HOST</span>}
                {isHost && p.id !== view.yourId && (
                  <button
                    className="btn danger"
                    style={{ padding: '4px 8px' }}
                    onClick={() => {
                      sfx.click();
                      socket.emit(EV.kick, { playerId: p.id });
                    }}
                  >
                    เตะ
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>

        <div className="row" style={{ marginTop: 16 }}>
          {isHost ? (
            <button
              className="btn primary"
              disabled={!canStart}
              onClick={() => {
                sfx.deal();
                socket.emit(EV.start);
              }}
            >
              เริ่มเกม ({n}/8)
            </button>
          ) : (
            <span className="muted">รอ host เริ่มเกม…</span>
          )}
          <div className="spacer" />
          <button className="btn danger" onClick={onLeave}>
            ออก
          </button>
        </div>
        {isHost && !canStart && <p className="small muted">ต้องมีผู้เล่น 3-8 คนจึงเริ่มได้</p>}
      </div>
    </Screen>
  );
}
