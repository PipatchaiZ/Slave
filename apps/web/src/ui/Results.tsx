import { EV, type GameView } from '@slave/engine';
import { socket } from '../net';
import { sfx } from '../audio';
import { ROLE_LABEL } from './shared';

export function RoundOver({ view }: { view: GameView }) {
  const isHost = view.hostId === view.yourId;
  const rows = view.lastRoundResult ?? [];
  return (
    <div className="panel" style={{ maxWidth: 560 }}>
      <h2>จบรอบที่ {view.roundNumber}</h2>
      <ResultTable view={view} />
      <div className="row" style={{ marginTop: 14 }}>
        {isHost ? (
          <button
            className="btn primary"
            onClick={() => {
              sfx.click();
              socket.emit(EV.next);
            }}
          >
            รอบถัดไป →
          </button>
        ) : (
          <span className="muted">รอ host ไปต่อ… (ระบบจะไปต่ออัตโนมัติ)</span>
        )}
      </div>
      {rows.some((r) => r.regicided) && (
        <p className="small" style={{ color: 'var(--yellow)' }}>
          ⚔ King ถูกโค่น! ถูกดันลงเป็น Slave
        </p>
      )}
    </div>
  );
}

export function MatchOver({ view, onLeave }: { view: GameView; onLeave: () => void }) {
  const standings = [...view.players].sort((a, b) => b.score - a.score);
  const champ = standings[0];
  return (
    <div className="panel" style={{ maxWidth: 560 }}>
      <h2>จบการแข่งขัน 👑</h2>
      <p className="center" style={{ color: 'var(--yellow)', fontSize: 14 }}>
        แชมป์: {champ?.name}
      </p>
      <table className="results">
        <thead>
          <tr>
            <th>#</th>
            <th>ผู้เล่น</th>
            <th>แต้มรวม</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((p, i) => (
            <tr key={p.id}>
              <td>{i + 1}</td>
              <td>
                {p.name}
                {p.isYou ? ' (คุณ)' : ''}
              </td>
              <td>{p.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn danger" onClick={onLeave}>
          ออกจากห้อง
        </button>
      </div>
    </div>
  );
}

function ResultTable({ view }: { view: GameView }) {
  const rows = view.lastRoundResult ?? [];
  return (
    <table className="results">
      <thead>
        <tr>
          <th>ตำแหน่ง</th>
          <th>ผู้เล่น</th>
          <th>+แต้ม</th>
          <th>รวม</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const p = view.players.find((pl) => pl.id === r.playerId);
          return (
            <tr key={r.playerId} className={r.regicided ? 'regicide' : ''}>
              <td>
                {ROLE_LABEL[r.role]}
                {r.regicided ? ' ⚔' : ''}
              </td>
              <td>
                {r.name}
                {p?.isYou ? ' (คุณ)' : ''}
              </td>
              <td>+{r.pointsAwarded}</td>
              <td>{p?.score ?? 0}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
