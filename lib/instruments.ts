export const SOUNDS = [
  'keys',
  'bass',
  'pad',
  'lead',
  'pluck',
  'organ',
  'bell',
] as const;
export type Sound = (typeof SOUNDS)[number];
type Voice = {
  type: OscillatorType;
  cutoff: number;
  attack: number;
  pluck?: boolean;
  release?: number;
};
const VOICES: Record<Sound, Voice> = {
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
export function voiceFor(sound?: string): Voice {
  return sound && Object.hasOwn(VOICES, sound)
    ? VOICES[sound as Sound]
    : VOICES.keys;
}
