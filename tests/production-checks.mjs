import assert from 'node:assert/strict';
import { loadTS } from './load-ts.mjs';
const { defaults } = loadTS('lib/audio.ts');
const { recoverySnapshot } = loadTS('lib/draft-recovery.ts');
const { validateArrangement } = loadTS('lib/arrangement-validation.ts');
const {
  builtInPresets,
  presetPatch,
  cleanFxSettings,
  saveUserPreset,
  loadUserPresets,
} = loadTS('lib/presets.ts');
const { SOUNDS, voiceFor } = loadTS('lib/instruments.ts');
const { timeStretch, pitchShift, stretchChannels } =
  loadTS('lib/timestretch.ts');
const { autoPitchChannel } = loadTS('lib/pitch.ts');
const { clipLength, splitClip } = loadTS('lib/clip-edit.ts');
const { exportSource } = loadTS('lib/audio-export.ts');
const { pumpAt, schedulePump } = loadTS('lib/pump.ts');
let checks = 0;
const check = (truth, label) => {
  assert.ok(truth, label);
  checks++;
};
const base = defaults('Test');
for (const preset of builtInPresets) {
  const track = { ...base, ...presetPatch(preset.settings) };
  validateArrangement({ bpm: 120, tracks: [track] });
  recoverySnapshot({ title: 'Preset', data: { bpm: 120, tracks: [track] } });
  checks += 2;
}
const fx = {
  drive: 0.3,
  driveType: 'hard',
  mod: 0.3,
  modType: 'flanger',
  modRate: 0.2,
  limiter: 0.2,
  pump: 0.4,
  denoise: 0.2,
  autoPitch: 0.8,
  pitchKey: 5,
  pitchMinor: true,
  pitchShift: 2,
  stretch: 1.5,
};
for (const sound of SOUNDS) {
  const track = { ...base, ...fx, sound };
  const snapshot = recoverySnapshot({
    title: 'Round trip',
    data: { bpm: 120, tracks: [track] },
  });
  for (const key of Object.keys(fx))
    check(snapshot.data.tracks[0][key] === fx[key], key);
  check(snapshot.data.tracks[0].sound === sound, sound);
}
for (const sound of ['constructor', '__proto__', 'unknown']) {
  assert.throws(() =>
    validateArrangement({ bpm: 120, tracks: [{ ...base, sound }] }),
  );
  checks++;
  check(voiceFor(sound).type === 'sine', 'safe fallback');
}
for (const bad of [
  { low: NaN },
  { drive: 3 },
  { modType: 'constructor' },
  { low: '3' },
  null,
]) {
  assert.throws(() => cleanFxSettings(bad));
  checks++;
}
let stored = '[]';
globalThis.localStorage = {
  getItem: () => stored,
  setItem: (_key, value) => {
    stored = value;
  },
};
assert.throws(() => saveUserPreset('warm vocal', {}));
checks++;
saveUserPreset('My vocal', { drive: 0.3 });
check(loadUserPresets()[0].settings.drive === 0.3, 'preset persistence');
globalThis.localStorage.setItem = () => {
  throw Error('quota');
};
assert.throws(() => saveUserPreset('Other', {}), /could not save/);
checks++;
const stretched = { ...base, duration: 15, stretch: 1.5 };
check(clipLength(stretched) === 15, 'processed duration counted once');
const split = splitClip(
  { bpm: 120, tracks: [stretched] },
  base.id,
  7,
  'second',
);
check(
  Math.abs(split.tracks.reduce((n, t) => n + clipLength(t), 0) - 15) < 1e-8,
  'split duration preserved',
);
check(
  exportSource({ ...base, ...fx }, 'dry').autoPitch === 0,
  'dry vocal bypass',
);
check(
  exportSource({ ...base, ...fx }, 'dry').stretch === 1.5,
  'dry structural edit kept',
);
assert.throws(
  () => autoPitchChannel(new Float32Array(4000), 44100, 1, 0, false),
  /unavailable/,
);
checks++;

function dominant(data, sr, expected) {
  const start = Math.floor(data.length * 0.3),
    length = Math.min(Math.floor(sr * 0.2), data.length - start);
  let best = 0,
    answer = 0;
  for (
    let freq = Math.floor(expected) - 8;
    freq <= Math.ceil(expected) + 8;
    freq++
  ) {
    let real = 0,
      imag = 0;
    for (let i = 0; i < length; i++) {
      const value =
          data[start + i] *
          (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1))),
        angle = (2 * Math.PI * freq * i) / sr;
      real += value * Math.cos(angle);
      imag += value * Math.sin(angle);
    }
    const power = real * real + imag * imag;
    if (power > best) {
      best = power;
      answer = freq;
    }
  }
  return answer;
}
for (const sr of [44100, 48000]) {
  const sine = Float32Array.from(
    { length: sr },
    (_, i) => 0.25 * Math.sin((2 * Math.PI * 440 * i) / sr),
  );
  for (const factor of [0.5, 0.75, 1.5, 2]) {
    const out = timeStretch(sine, factor);
    check(out.length === Math.round(sr * factor), 'stretch length');
    check(Math.abs(dominant(out, sr, 440) - 440) <= 1, 'stretch keeps pitch');
    check(out.every(Number.isFinite), 'finite stretch');
  }
  for (const semitones of [-12, -1, 1, 12]) {
    const out = pitchShift(sine, semitones),
      expected = 440 * 2 ** (semitones / 12);
    check(out.length === sr, 'shift keeps duration');
    check(
      Math.abs(dominant(out, sr, expected) - expected) <= 1.1,
      'shift target ' + semitones,
    );
  }
  const channels = stretchChannels(
    [sine, Float32Array.from(sine, (v) => -v)],
    1.5,
  );
  check(
    channels[0].every((value, i) => Math.abs(value + channels[1][i]) < 1e-6),
    'stereo phase',
  );
}
for (const length of [1, 16, 100, 512, 1024, 2048, 5000])
  for (const factor of [0.5, 2]) {
    const out = timeStretch(new Float32Array(length).fill(0.5), factor);
    check(
      out.length === Math.max(1, Math.round(length * factor)),
      'short length',
    );
    check(
      out.every((v) => Math.abs(v - 0.5) < 1e-6),
      'no zero tails',
    );
  }
const points = [];
schedulePump(
  {
    setValueAtTime: (v, t) => points.push([v, t]),
    linearRampToValueAtTime: (v, t) => points.push([v, t]),
  },
  2,
  0.2,
  1.2,
  120,
  0.6,
);
check(Math.abs(points[0][0] - pumpAt(0.2, 120, 0.6)) < 1e-9, 'seek phase');
check(
  points.some(
    ([value, time]) =>
      Math.abs(time - 2.305) < 1e-8 && Math.abs(value - 0.4) < 1e-6,
  ),
  'beat-aligned duck',
);
console.log('Production audio/save checks passed:', checks);
