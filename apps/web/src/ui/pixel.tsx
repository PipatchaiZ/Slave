// Pixel-art sprites drawn entirely with CSS box-shadow — zero image assets.
// Each sprite is editable ASCII art: '.'/' ' = empty, any other char = a pixel
// coloured via `map` (overridable per-call through `colors`). Ported from the
// .scratch/pixel-prototype exploration. See CONTEXT.md for the domain terms.

import type { CSSProperties } from 'react';
import type { Role } from '@slave/engine';

interface Sprite {
  w: number;
  h: number;
  map: Record<string, string>;
  art: string[];
}

// Palette refs are CSS custom properties from styles.css (--yellow, --card-red…)
// so sprites recolour with the theme; a few literals match the .badge.* colours.
export const SPR: Record<string, Sprite> = {
  // ----- suits -----
  spade: {
    w: 7,
    h: 8,
    map: { X: 'var(--card-black)' },
    art: ['...X...', '..XXX..', '.XXXXX.', 'XXXXXXX', 'XXXXXXX', 'XX.X.XX', '...X...', '..XXX..'],
  },
  heart: {
    w: 7,
    h: 7,
    map: { X: 'var(--card-red)' },
    art: ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'],
  },
  diamond: {
    w: 7,
    h: 7,
    map: { X: 'var(--card-red)' },
    art: ['...X...', '..XXX..', '.XXXXX.', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'],
  },
  club: {
    w: 7,
    h: 8,
    map: { X: 'var(--card-black)' },
    art: ['..XXX..', '.XXXXX.', '..XXX..', 'XX.X.XX', 'XXXXXXX', 'XX.X.XX', '...X...', '..XXX..'],
  },

  // ----- reactions (two-tone: o = secondary colour) -----
  fire: {
    w: 7,
    h: 9,
    map: { X: 'var(--orange)', o: 'var(--yellow)' },
    art: ['...X...', '..XX...', '..XXo..', '.XXoo..', '.XoooX.', 'XXooooX', 'XoooooX', 'XXoooXX', '.XXXXX.'],
  },
  bomb: {
    w: 7,
    h: 8,
    // B=body(steel) H=highlight f=fuse Y=spark
    map: { B: '#566c86', H: '#f4f4f4', f: 'var(--orange)', Y: 'var(--yellow)' },
    art: ['......Y', '.....f.', '..BBf..', '.BBBBB.', 'BHBBBBB', 'BBBBBBB', 'BBBBBBB', '.BBBBB.'],
  },
  party: {
    w: 7,
    h: 7,
    map: { X: 'var(--pink)', o: 'var(--yellow)' },
    art: ['X..o..X', '.X.o.X.', '..XoX..', 'ooXXXoo', '..XoX..', '.X.o.X.', 'X..o..X'],
  },
  star: {
    w: 7,
    h: 7,
    map: { X: 'var(--yellow)' },
    art: ['...X...', '..XXX..', 'XXXXXXX', '.XXXXX.', '..XXX..', '.XX.XX.', 'X.....X'],
  },

  // ----- per-play reaction faces (F = face, e = feature) -----
  'face-happy': {
    w: 9,
    h: 10,
    map: { F: 'var(--yellow)', e: 'var(--card-black)' },
    art: [
      '..FFFFF..',
      '.FFFFFFF.',
      'FFFFFFFFF',
      'FFFFFFFFF',
      'FFeFFFeFF',
      'FFeFFFeFF',
      'FFFFFFFFF',
      'FeFFFFFeF',
      'FFeeeeeFF',
      '.FFFFFFF.',
    ],
  },
  'face-wink': {
    w: 9,
    h: 10,
    map: { F: 'var(--yellow)', e: 'var(--card-black)' },
    art: [
      '..FFFFF..',
      '.FFFFFFF.',
      'FFFFFFFFF',
      'FFFFFFFFF',
      'FFeFFFFFF',
      'FFeFFeeeF',
      'FFFFFFFFF',
      'FeFFFFFeF',
      'FFeeeeeFF',
      '.FFFFFFF.',
    ],
  },
  'face-sad': {
    w: 9,
    h: 10,
    map: { F: 'var(--pink)', e: 'var(--card-black)' },
    art: [
      '..FFFFF..',
      '.FFFFFFF.',
      'FFFFFFFFF',
      'FFFFFFFFF',
      'FFeFFFeFF',
      'FFeFFFeFF',
      'FFFFFFFFF',
      'FFeeeeeFF',
      'FeFFFFFeF',
      '.FFFFFFF.',
    ],
  },

  // ----- status / chrome icons -----
  check: {
    w: 7,
    h: 7,
    map: { X: 'var(--green)' },
    art: ['......X', '.....XX', '....XX.', 'X..XX..', 'XXXX...', '.XX....', '.......'],
  },
  warn: {
    w: 7,
    h: 7,
    map: { X: 'var(--yellow)', e: 'var(--card-black)' },
    art: ['...X...', '..XXX..', '..XeX..', '.XXeXX.', '.XXeXX.', 'XXX.XXX', 'XXXXXXX'],
  },
  shield: {
    w: 7,
    h: 8,
    map: { X: '#3b5dc9', o: '#73eff7' },
    art: ['XXXXXXX', 'XoXXXoX', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'],
  },
  hourglass: {
    w: 7,
    h: 8,
    map: { X: 'var(--yellow)', f: '#94b0c2' },
    art: ['fffffff', '.XXXXX.', '..XXX..', '...X...', '...X...', '..XXX..', '.XXXXX.', 'fffffff'],
  },
  swap: {
    w: 7,
    h: 7,
    map: { X: 'var(--yellow)' },
    art: ['..X....', '.XX....', 'XXXXXXX', '.......', 'XXXXXXX', '....XX.', '....X..'],
  },
  gear: {
    w: 7,
    h: 7,
    map: { X: '#94b0c2' },
    art: ['.X.X.X.', 'XXXXXXX', '.XXXXX.', 'XX...XX', '.XXXXX.', 'XXXXXXX', '.X.X.X.'],
  },
  'speaker-on': {
    w: 7,
    h: 7,
    map: { X: '#94b0c2', w: 'var(--yellow)' },
    art: ['..XX...', '.XXX.w.', 'XXXX.w.', 'XXXX.ww', 'XXXX.w.', '.XXX.w.', '..XX...'],
  },
  'speaker-off': {
    w: 7,
    h: 7,
    map: { X: '#94b0c2', e: 'var(--red)' },
    art: ['..XX...', '.XXX...', 'XXXXe.e', 'XXXX.e.', 'XXXXe.e', '.XXX...', '..XX...'],
  },
  chili: {
    w: 7,
    h: 7,
    map: { r: 'var(--card-red)', g: 'var(--green)' },
    art: ['....g..', '...g...', '..rr...', '.rrr...', '.rrr...', '.rr....', '.r.....'],
  },
  swords: {
    w: 7,
    h: 7,
    map: { X: '#b1a7a6' },
    art: ['X.....X', '.X...X.', '..X.X..', '...X...', '..X.X..', '.X...X.', 'X.....X'],
  },
  clock: {
    w: 7,
    h: 7,
    map: { X: 'var(--yellow)' },
    art: ['..XXX..', '.X...X.', 'X..X..X', 'X..XX.X', 'X.....X', '.X...X.', '..XXX..'],
  },
  medal: {
    w: 7,
    h: 8,
    map: { X: 'var(--yellow)', r: 'var(--card-red)' },
    art: ['r.....r', '.r...r.', '.r...r.', '..XXX..', '.XXXXX.', '.XXXXX.', '.XXXXX.', '..XXX..'],
  },
  clipboard: {
    w: 7,
    h: 8,
    map: { b: 'var(--card-face)', c: '#94b0c2', l: '#566c86' },
    art: ['..ccc..', '.bbbbb.', 'bbbbbbb', 'b.lll.b', 'b.....b', 'b.lll.b', 'b.....b', 'bbbbbbb'],
  },
  bullet: {
    w: 5,
    h: 5,
    map: { X: 'var(--yellow)' },
    art: ['..X..', '.XXX.', 'XXXXX', '.XXX.', '..X..'],
  },

  // ----- role badges (recoloured per role via `colors`) -----
  crown: {
    w: 7,
    h: 6,
    map: { X: 'var(--yellow)', o: 'var(--card-red)' },
    art: ['X.....X', 'X..X..X', 'X.XXX.X', 'XXXXXXX', 'XoXoXoX', 'XXXXXXX'],
  },
  shackle: {
    // closed ring — Slave
    w: 7,
    h: 7,
    map: { X: '#b1a7a6' },
    art: ['.XXXXX.', 'XX...XX', 'X.....X', 'X.....X', 'X.....X', 'XX...XX', '.XXXXX.'],
  },
  'shackle-open': {
    // open C-ring — Vice-Slave (distinct shape from Slave, not just colour)
    w: 7,
    h: 7,
    map: { X: '#c98fb0' },
    art: ['.XXXX..', 'XX..X..', 'X......', 'X......', 'X......', 'XX..X..', '.XXXX..'],
  },
  person: {
    w: 7,
    h: 7,
    map: { X: '#a7f070' },
    art: ['..XXX..', '.XXXXX.', '.XXXXX.', '..XXX..', '.XXXXX.', 'XXXXXXX', 'XXXXXXX'],
  },

  // ----- misc -----
  cardicon: {
    // tiny card — hand-count icon (o = red corner index)
    w: 5,
    h: 7,
    map: { X: 'var(--card-face)', o: 'var(--card-red)' },
    art: ['oXXXX', 'XXXXX', 'XXXXX', 'XXXXX', 'XXXXX', 'XXXXX', 'XXXXX'],
  },
  emblem: {
    // rhombus motif centred on the card back
    w: 7,
    h: 7,
    map: { X: 'var(--yellow)' },
    art: ['...X...', '..XXX..', '.XX.XX.', 'XX...XX', '.XX.XX.', '..XXX..', '...X...'],
  },
};

export const SUIT_SPRITE: Record<string, string> = { C: 'club', D: 'diamond', H: 'heart', S: 'spade' };

export interface RoleSprite {
  sprite: string;
  colors: Record<string, string>;
}
export const ROLE_SPRITE: Record<string, RoleSprite> = {
  king: { sprite: 'crown', colors: { X: 'var(--yellow)', o: 'var(--card-red)' } },
  queen: { sprite: 'crown', colors: { X: 'var(--pink)', o: 'var(--card-red)' } },
  people: { sprite: 'person', colors: { X: '#a7f070' } },
  viceslave: { sprite: 'shackle-open', colors: { X: '#c98fb0' } },
  slave: { sprite: 'shackle', colors: { X: '#b1a7a6' } },
};

/** Role identity icon sized to sit inline with text (Results, exchange box). */
export function RoleIcon({ role, unit = 2 }: { role: Role; unit?: number }) {
  const rs = ROLE_SPRITE[role];
  return <PixelSprite className="role-icon" name={rs.sprite} colors={rs.colors} unit={unit} />;
}

interface Props {
  name: string;
  unit?: number;
  /** Override sprite colours per-call (e.g. King vs Queen share the crown). */
  colors?: Record<string, string>;
  /** Draw a 1px outline (4-way) round the silhouette so it reads on busy art. */
  outline?: string;
  className?: string;
  style?: CSSProperties;
}

/** Render a sprite as a single transparent element painted with box-shadow. */
export function PixelSprite({ name, unit = 3, colors, outline, className, style }: Props) {
  const s = SPR[name];
  const cmap = { ...s.map, ...(colors ?? {}) };
  const on = (x: number, y: number) =>
    y >= 0 && y < s.h && x >= 0 && x < s.w && s.art[y][x] !== '.' && s.art[y][x] !== ' ';
  const M = 1; // 1-cell margin so the outline has room (keeps the box centred)
  const shadows: string[] = [];
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++)
      if (on(x, y))
        shadows.push(`${(x + M) * unit}px ${(y + M) * unit}px 0 0 ${cmap[s.art[y][x]] ?? 'var(--card-black)'}`);
  if (outline)
    for (let y = -1; y <= s.h; y++)
      for (let x = -1; x <= s.w; x++) {
        if (on(x, y)) continue;
        if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1))
          shadows.push(`${(x + M) * unit}px ${(y + M) * unit}px 0 0 ${outline}`);
      }
  return (
    <span
      className={'sprite' + (className ? ' ' + className : '')}
      style={{ width: (s.w + 2 * M) * unit, height: (s.h + 2 * M) * unit, ...style }}
    >
      <i style={{ width: unit, height: unit, boxShadow: shadows.join(',') }} />
    </span>
  );
}
