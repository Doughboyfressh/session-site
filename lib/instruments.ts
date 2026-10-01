export const SOUNDS = [
  'keys',
  'bass',
  'pad',
  'lead',
  'pluck',
  'organ',
  'bell',
  'epiano',
  'guitar',
  'strings',
  'brass',
  'mallet',
  'sub',
  'log',
] as const;
export type Sound = (typeof SOUNDS)[number];
type Voice = {
  type: OscillatorType;
  cutoff: number;
  attack: number;
  pluck?: boolean;
  release?: number;
  harmonics?: number[];
};
const VOICES: Record<Sound, Voice> = {
  epiano: {
    type: 'sine',
    cutoff: 6000,
    attack: 0.004,
    pluck: true,
    release: 0.32,
    harmonics: [1, 0.15, 0.42, 0.06, 0.12],
  },
  guitar: {
    type: 'triangle',
    cutoff: 4300,
    attack: 0.003,
    pluck: true,
    release: 0.18,
    harmonics: [1, 0.5, 0.28, 0.18, 0.12, 0.07],
  },
  strings: {
    type: 'sawtooth',
    cutoff: 2400,
    attack: 0.14,
    harmonics: [1, 0.42, 0.3, 0.18, 0.12, 0.08],
  },
  brass: {
    type: 'sawtooth',
    cutoff: 3900,
    attack: 0.025,
    harmonics: [1, 0.62, 0.35, 0.2, 0.09],
  },
  mallet: {
    type: 'sine',
    cutoff: 7200,
    attack: 0.002,
    pluck: true,
    release: 0.16,
    harmonics: [1, 0, 0.24, 0, 0.08],
  },
  sub: { type: 'sine', cutoff: 380, attack: 0.006, harmonics: [1, 0.08, 0.04] },
  log: {
    type: 'sine',
    cutoff: 1700,
    attack: 0.002,
    pluck: true,
    release: 0.18,
    harmonics: [1, 0.3, 0, 0.12],
  },
  keys: { type: 'sine', cutoff: 8000, attack: 0.008 },
  bass: { type: 'sawtooth', cutoff: 650, attack: 0.008 },
  pad: { type: 'triangle', cutoff: 1800, attack: 0.08 },
  lead: { type: 'sawtooth', cutoff: 5200, attack: 0.01 },
  pluck: {
    type: 'triangle',
    cutoff: 3600,
    attack: 0.004,
    pluck: true,
    release: 0.12,
  },
  organ: { type: 'square', cutoff: 2600, attack: 0.02 },
  bell: {
    type: 'sine',
    cutoff: 9000,
    attack: 0.002,
    pluck: true,
    release: 0.6,
  },
};
export const SOUND_LABELS: Record<Sound, string> = {
  keys: 'Soft keys',
  bass: 'Analog bass',
  pad: 'Warm pad',
  lead: 'Bright lead',
  pluck: 'Plucked synth',
  organ: 'Electric organ',
  bell: 'Glass bell',
  epiano: 'Electric piano',
  guitar: 'Synth guitar',
  strings: 'Synth strings',
  brass: 'Synth brass',
  mallet: 'Mallet',
  sub: 'Sub bass',
  log: 'Log drum',
};
export function voiceFor(sound?: string): Voice {
  return sound && Object.hasOwn(VOICES, sound)
    ? VOICES[sound as Sound]
    : VOICES.keys;
}
