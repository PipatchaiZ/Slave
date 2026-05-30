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

/** Identity icon shown in front of each role for at-a-glance recognition. */
export const ROLE_ICON: Record<Role, string> = {
  king: '👑',
  queen: '👸',
  people: '🧑',
  viceslave: '🙇',
  slave: '⛓️',
};

/** "👑 KING" — icon + label with a normal space (regular-width contexts). */
export function roleText(role: Role): string {
  return `${ROLE_ICON[role]} ${ROLE_LABEL[role]}`;
}

export function RoleBadge({ role }: { role: Role | null }) {
  if (!role) return null;
  // A non-breaking space glues the icon to the label so the icon never orphans
  // onto its own line; a long label like VICE-SLAVE may still wrap at its hyphen.
  const nbsp = String.fromCharCode(0xa0);
  return <span className={`badge ${role}`}>{ROLE_ICON[role] + nbsp + ROLE_LABEL[role]}</span>;
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
