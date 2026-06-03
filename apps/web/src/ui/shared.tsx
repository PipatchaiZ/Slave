import { type ReactNode, useState } from 'react';
import { isMuted, setMuted, sfx } from '../audio';
import type { Role } from '@slave/engine';
import { PixelSprite, ROLE_SPRITE } from './pixel';

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

export function RoleBadge({ role, prev }: { role: Role | null; prev?: boolean }) {
  if (!role) return null;
  // `prev` = a carry-over position from the previous round (not yet decided this
  // round) — rendered faded + with a "↩" so it isn't read as the live standing.
  // Pixel icon + label on one line; the label never wraps (ellipsis if too long).
  const rs = ROLE_SPRITE[role];
  return (
    <span className={`badge ${role}${prev ? ' prev' : ''}`}>
      {prev && <span className="badge-prev">↩</span>}
      <PixelSprite name={rs.sprite} colors={rs.colors} unit={2} outline="var(--shadow)" />
      <span className="role-text">{ROLE_LABEL[role]}</span>
    </span>
  );
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
      {m ? (
        <>
          <PixelSprite className="ico" name="speaker-off" unit={2} /> OFF
        </>
      ) : (
        <>
          <PixelSprite className="ico" name="speaker-on" unit={2} /> ON
        </>
      )}
    </button>
  );
}
