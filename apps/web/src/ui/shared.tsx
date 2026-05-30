import { type ReactNode, useState } from 'react';
import { isMuted, setMuted, sfx } from '../audio';
import type { Role } from '@slave/engine';

export function Screen({ children }: { children: ReactNode }) {
  return <div className="screen">{children}</div>;
}

export const ROLE_LABEL: Record<Role, string> = {
  king: 'KING',
  queen: 'QUEEN',
  people: 'PEOPLE',
  viceslave: 'VICE-SLAVE',
  slave: 'SLAVE',
};

export function RoleBadge({ role }: { role: Role | null }) {
  if (!role) return null;
  return <span className={`badge ${role}`}>{ROLE_LABEL[role]}</span>;
}

export function MuteButton() {
  const [m, setM] = useState(isMuted());
  return (
    <button
      className="pill"
      onClick={() => {
        const next = !m;
        setMuted(next);
        setM(next);
        if (!next) sfx.click();
      }}
    >
      {m ? '🔇 OFF' : '🔊 ON'}
    </button>
  );
}
