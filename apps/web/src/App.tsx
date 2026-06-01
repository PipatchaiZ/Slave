import { useEffect, useState } from 'react';
import { type Ack, type CreateAck, EV, type JoinAck } from '@slave/engine';
import {
  type Session,
  clearSession,
  emitAck,
  loadName,
  loadSession,
  saveName,
  saveSession,
  socket,
  useGameView,
} from './net';
import { resumeAudio, setBgmActive, sfx } from './audio';
import { MuteButton, Screen } from './ui/shared';
import { Lobby } from './ui/Lobby';
import { Table } from './ui/Table';
import { RulesModal } from './ui/RulesModal';

async function reconnect(s: Session): Promise<Ack> {
  return emitAck<Ack>(EV.reconnect, {
    roomCode: s.roomCode,
    playerId: s.playerId,
    token: s.token,
  });
}

export function App() {
  const { view, setView, error, setError, connected } = useGameView();
  const [booting, setBooting] = useState(true);

  // Re-attach to the saved room on first load AND on every (re)connect, so a
  // transient network drop transparently rebinds the player to their seat.
  useEffect(() => {
    let settled = false;
    const settle = () => {
      if (!settled) {
        settled = true;
        setBooting(false);
      }
    };
    const onConnect = async () => {
      const s = loadSession();
      if (s) await reconnect(s);
      settle();
    };
    socket.on('connect', onConnect);
    if (socket.connected) void onConnect();
    const t = setTimeout(settle, 3000);
    return () => {
      socket.off('connect', onConnect);
      clearTimeout(t);
    };
  }, []);

  // Room disbanded by the server (e.g. host left before start).
  useEffect(() => {
    const onClosed = (e: { message: string }) => {
      clearSession();
      setView(null);
      setError(e.message);
    };
    socket.on(EV.closed, onClosed);
    return () => {
      socket.off(EV.closed, onClosed);
    };
  }, [setView, setError]);

  // Error toast.
  useEffect(() => {
    if (!error) return;
    sfx.error();
    const t = setTimeout(() => setError(null), 3200);
    return () => clearTimeout(t);
  }, [error, setError]);

  // Background music: home screen + lobby only (off once the game starts).
  useEffect(() => {
    setBgmActive(!booting && (!view || view.phase === 'lobby'));
  }, [booting, view]);

  const leave = () => {
    socket.emit(EV.leave); // explicit, immediate removal (no grace)
    clearSession();
    setView(null);
    // Let the leave event flush before tearing the socket down.
    setTimeout(() => {
      socket.disconnect();
      socket.connect();
    }, 120);
  };

  let content;
  if (booting) {
    content = (
      <Screen>
        <div className="title">SLAVE</div>
        <div className="muted">กำลังเชื่อมต่อ…</div>
      </Screen>
    );
  } else if (!view) {
    content = <Home onError={setError} />;
  } else if (view.phase === 'lobby') {
    content = <Lobby view={view} onLeave={leave} />;
  } else {
    content = <Table view={view} onLeave={leave} />;
  }

  return (
    <>
      {!connected && !booting && !!view && (
        <div className="netbar">⚠ ขาดการเชื่อมต่อ • กำลังเชื่อมต่อใหม่…</div>
      )}
      {content}
      {error && <div className="toast">{error}</div>}
    </>
  );
}

function Home({ onError }: { onError: (m: string) => void }) {
  const [name, setName] = useState(loadName());
  const [code, setCode] = useState('');
  const [rounds, setRounds] = useState(3);
  const [mode, setMode] = useState<'normal' | 'sainua'>('normal');
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<Session | null>(loadSession());
  const [showRules, setShowRules] = useState(false);

  const ready = name.trim().length > 0;

  async function create() {
    resumeAudio();
    sfx.click();
    saveName(name);
    setBusy(true);
    const ack = await emitAck<CreateAck>(EV.create, { name, totalRounds: rounds, mode });
    setBusy(false);
    if (ack.ok && ack.roomCode && ack.playerId && ack.token) {
      saveSession({ roomCode: ack.roomCode, playerId: ack.playerId, token: ack.token, name });
    } else {
      onError(ack.error ?? 'สร้างห้องไม่สำเร็จ');
    }
  }

  async function join() {
    resumeAudio();
    sfx.click();
    saveName(name);
    setBusy(true);
    const roomCode = code.trim().toUpperCase();
    const ack = await emitAck<JoinAck>(EV.join, { roomCode, name });
    setBusy(false);
    if (ack.ok && ack.playerId && ack.token) {
      saveSession({ roomCode, playerId: ack.playerId, token: ack.token, name });
    } else {
      onError(ack.error ?? 'เข้าห้องไม่สำเร็จ');
    }
  }

  async function rejoin() {
    if (!session) return;
    resumeAudio();
    sfx.click();
    setBusy(true);
    const ack = await reconnect(session);
    setBusy(false);
    if (!ack.ok) {
      onError(ack.error ?? 'กลับเข้าเกมไม่สำเร็จ — ห้องอาจปิดไปแล้ว');
      clearSession();
      setSession(null);
    }
    // On success the server pushes state and the screen switches automatically.
  }

  return (
    <Screen>
      <div className="title">SLAVE</div>
      <div className="subtitle">เกมไพ่สลาฟ · 3-6 คน · ออนไลน์</div>
      <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
        <button className="btn ghost" onClick={() => setShowRules(true)}>
          📖 วิธีเล่น
        </button>
        <MuteButton />
      </div>
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}

      {session && (
        <div className="panel" style={{ borderColor: 'var(--yellow)' }}>
          <h2>กลับเข้าเกมเดิม</h2>
          <p className="small muted">
            คุณยังมีที่นั่งค้างในห้อง <b style={{ color: 'var(--yellow)' }}>{session.roomCode}</b>{' '}
            (ชื่อ {session.name})
          </p>
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={rejoin}>
              🔄 กลับเข้าเกม
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                clearSession();
                setSession(null);
                sfx.click();
              }}
            >
              ลืมห้องนี้
            </button>
          </div>
        </div>
      )}

      <div className="panel">
        <label>ชื่อผู้เล่น</label>
        <input
          className="input centered"
          value={name}
          maxLength={16}
          placeholder="ใส่ชื่อ…"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="panel">
        <h2>สร้างห้องใหม่</h2>
        <label>โหมด</label>
        <div className="mode-cards">
          <div
            className={`mode-card ${mode === 'normal' ? 'selected' : ''}`}
            onClick={() => {
              sfx.click();
              setMode('normal');
            }}
          >
            <span className="mc-icon">♠</span>
            <span className="mc-title">ปกติ</span>
            <span className="mc-desc">กฎมาตรฐาน</span>
          </div>
          <div
            className={`mode-card ${mode === 'sainua' ? 'selected' : ''}`}
            onClick={() => {
              sfx.click();
              setMode('sainua');
            }}
          >
            <span className="mc-icon">🌶️</span>
            <span className="mc-title">จั่วเพิ่ม</span>
            <span className="mc-desc">ลงตอง→คนอื่นจั่ว1 · สี่ใบ→จั่ว2</span>
          </div>
        </div>
        <label style={{ marginTop: 12 }}>จำนวนรอบ</label>
        <div className="row">
          {[1, 3, 5, 10].map((r) => (
            <button
              key={r}
              className={`btn ${rounds === r ? 'primary' : 'ghost'}`}
              onClick={() => setRounds(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <button
          className="btn primary"
          style={{ marginTop: 12 }}
          disabled={!ready || busy}
          onClick={create}
        >
          สร้างห้อง
        </button>
      </div>

      <div className="panel">
        <h2>เข้าห้องด้วยโค้ด</h2>
        <input
          className="input code-chip"
          value={code}
          maxLength={5}
          placeholder="ABCDE"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <button
          className="btn primary"
          style={{ marginTop: 12 }}
          disabled={!ready || busy || code.trim().length < 4}
          onClick={join}
        >
          เข้าห้อง
        </button>
      </div>
    </Screen>
  );
}
