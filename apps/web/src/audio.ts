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
}
export function isMuted(): boolean {
  return muted;
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

export const sfx = {
  click: () => blip(440, 0.05),
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
