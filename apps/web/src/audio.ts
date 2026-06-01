// Chiptune SFX synthesized with the Web Audio API — no asset files needed.

let ctx: AudioContext | null = null;
let muted = false;

function ac(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  return ctx;
}

export function resumeAudio(): void {
  void ac().resume?.();
}
export function setMuted(m: boolean): void {
  muted = m;
  syncBgm();
}
export function isMuted(): boolean {
  return muted;
}

// ---- background music (looping mp3, home + lobby only) ----
let bgm: HTMLAudioElement | null = null;
let bgmWanted = false;

function ensureBgm(): HTMLAudioElement {
  if (!bgm) {
    bgm = new Audio('/bgm.mp3');
    bgm.loop = true;
    bgm.volume = 0.3; // sit under the SFX
    bgm.preload = 'auto';
  }
  return bgm;
}
function syncBgm(): void {
  if (!bgm && !bgmWanted) return; // nothing created and nothing to play
  const el = ensureBgm();
  if (bgmWanted && !muted) {
    void el.play().catch(() => {}); // may be blocked until a user gesture
  } else {
    el.pause();
  }
}
/** Turn the looping background music on/off for the current screen. */
export function setBgmActive(active: boolean): void {
  bgmWanted = active;
  syncBgm();
}
// Browsers block autoplay until the first gesture — retry on early interactions.
if (typeof window !== 'undefined') {
  const kick = () => {
    if (bgmWanted) syncBgm();
  };
  window.addEventListener('pointerdown', kick);
  window.addEventListener('keydown', kick);
}

type Wave = 'square' | 'sawtooth' | 'triangle' | 'sine';

function blip(freq: number, dur: number, type: Wave = 'square', vol = 0.06, when = 0): void {
  if (muted) return;
  const c = ac();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  o.connect(g).connect(c.destination);
  const t = c.currentTime + when;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t);
  o.stop(t + dur);
}

// ---- one-shot mp3 sound effects (cached <audio> per clip) ----
const clips: Record<string, HTMLAudioElement> = {};
function playClip(name: string, vol: number): void {
  if (muted) return;
  let a = clips[name];
  if (!a) {
    a = new Audio(`/${name}.mp3`);
    a.preload = 'auto';
    clips[name] = a;
  }
  a.volume = vol;
  try {
    a.currentTime = 0;
  } catch {
    /* not ready yet */
  }
  void a.play().catch(() => {});
}

export const sfx = {
  click: () => blip(440, 0.05),
  lastCard: () => playClip('yeah-boy', 0.75), // a player is down to 1 card
  slapTriple: () => playClip('thud', 0.85), // triple played
  slapFour: () => playClip('huh', 0.85), // four-of-a-kind played
  royalFinish: () => playClip('victory', 0.8), // someone went out as King/Queen
  select: () => blip(720, 0.04, 'square', 0.05),
  play: () => {
    blip(660, 0.06);
    blip(990, 0.06, 'square', 0.05, 0.05);
  },
  pass: () => blip(200, 0.12, 'sawtooth', 0.05),
  deal: () => {
    for (let i = 0; i < 6; i++) blip(420 + i * 70, 0.04, 'square', 0.04, i * 0.05);
  },
  win: () => [523, 659, 784, 1046].forEach((f, i) => blip(f, 0.13, 'square', 0.08, i * 0.1)),
  lose: () => [392, 330, 262].forEach((f, i) => blip(f, 0.16, 'sawtooth', 0.07, i * 0.12)),
  error: () => blip(130, 0.18, 'square', 0.08),
  turn: () => blip(880, 0.05, 'triangle', 0.06),
};
