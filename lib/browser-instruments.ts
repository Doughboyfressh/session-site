export type BrowserInstrumentId = 'session-wavetable' | 'session-fm';

export type BrowserEnvelopeParameters = {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  cutoff: number;
  resonance: number;
  drive: number;
  level: number;
  modulation: number;
  rate: number;
};
export type WavetableParameters = BrowserEnvelopeParameters & {
  morph: number;
  unison: number;
  detune: number;
  spread: number;
};
export type FmParameters = BrowserEnvelopeParameters & {
  ratio: number;
  depth: number;
};
export type WavetableInstrument = {
  format: 'browser';
  version: 1;
  id: 'session-wavetable';
  parameters: WavetableParameters;
};
export type FmInstrument = {
  format: 'browser';
  version: 1;
  id: 'session-fm';
  parameters: FmParameters;
};
export type BrowserInstrument = WavetableInstrument | FmInstrument;
export type BrowserVoice = {
  /** MIDI note-off: fade over the instrument's configured release. */
  release: (when?: number) => void;
  /** Transport/preview cancellation: fade over 5 milliseconds. */
  stop: (when?: number) => void;
  disconnect: () => void;
};

export const BROWSER_INSTRUMENTS = [
  {
    id: 'session-wavetable',
    name: 'SESSION Wavetable',
    description:
      'Original harmonic morphing with stereo unison and moving filters.',
  },
  {
    id: 'session-fm',
    name: 'SESSION FM',
    description: 'Two sine operators for clear keys, bells and electric bass.',
  },
] as const;

export const BROWSER_PARAMETER_RANGES = {
  attack: [0.001, 2],
  decay: [0.001, 2],
  sustain: [0, 1],
  release: [0.005, 0.45],
  cutoff: [60, 20000],
  resonance: [0, 1],
  drive: [0, 1],
  level: [0, 1],
  modulation: [0, 1],
  rate: [0.1, 12],
  morph: [0, 1],
  unison: [1, 4],
  detune: [0, 30],
  spread: [0, 1],
  ratio: [0.25, 8],
  depth: [0, 6],
} as const;
const commonKeys = [
  'attack',
  'decay',
  'sustain',
  'release',
  'cutoff',
  'resonance',
  'drive',
  'level',
  'modulation',
  'rate',
] as const;
const wavetableKeys = [
  ...commonKeys,
  'morph',
  'unison',
  'detune',
  'spread',
] as const;
const fmKeys = [...commonKeys, 'ratio', 'depth'] as const;

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return (
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

/** Persist only this versioned allowlist. Invalid values are rejected, never clamped. */
export function validateBrowserInstrument(input: unknown): BrowserInstrument {
  if (
    !record(input) ||
    !exactKeys(input, ['format', 'version', 'id', 'parameters']) ||
    input.format !== 'browser' ||
    input.version !== 1 ||
    (input.id !== 'session-wavetable' && input.id !== 'session-fm') ||
    !record(input.parameters)
  ) {
    throw new Error('Choose a supported SESSION browser instrument.');
  }
  const keys = input.id === 'session-wavetable' ? wavetableKeys : fmKeys;
  if (!exactKeys(input.parameters, keys))
    throw new Error(
      'Browser instrument parameters must match the selected instrument.',
    );
  const parameters: Record<string, number> = {};
  for (const key of keys) {
    const value = input.parameters[key];
    const [min, max] = BROWSER_PARAMETER_RANGES[key];
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (key === 'unison' && !Number.isInteger(value))
    ) {
      throw new Error(
        `Browser instrument ${key} must be between ${min} and ${max}.`,
      );
    }
    parameters[key] = value;
  }
  return {
    format: 'browser',
    version: 1,
    id: input.id,
    parameters,
  } as BrowserInstrument;
}

const initialEnvelope: BrowserEnvelopeParameters = {
  attack: 0.012,
  decay: 0.3,
  sustain: 0.65,
  release: 0.16,
  cutoff: 8000,
  resonance: 0.15,
  drive: 0.08,
  level: 0.8,
  modulation: 0.12,
  rate: 0.7,
};
export function defaultBrowserInstrument(
  id: 'session-wavetable',
): WavetableInstrument;
export function defaultBrowserInstrument(id: 'session-fm'): FmInstrument;
export function defaultBrowserInstrument(
  id: BrowserInstrumentId,
): BrowserInstrument;
export function defaultBrowserInstrument(
  id: BrowserInstrumentId,
): BrowserInstrument {
  if (id === 'session-wavetable')
    return {
      format: 'browser',
      version: 1,
      id,
      parameters: {
        ...initialEnvelope,
        morph: 0.45,
        unison: 3,
        detune: 7,
        spread: 0.65,
      },
    };
  if (id === 'session-fm')
    return {
      format: 'browser',
      version: 1,
      id,
      parameters: {
        ...initialEnvelope,
        ratio: 2,
        depth: 1.5,
        modulation: 0.05,
      },
    };
  throw new Error('Choose a supported SESSION browser instrument.');
}
export type BrowserInstrumentPreset = {
  id: string;
  name: string;
  instrument: BrowserInstrument;
};
function preset(
  id: BrowserInstrumentId,
  name: string,
  parameters: Record<string, number>,
) {
  const instrument = validateBrowserInstrument({
    ...defaultBrowserInstrument(id),
    parameters: { ...defaultBrowserInstrument(id).parameters, ...parameters },
  });
  Object.freeze(instrument.parameters);
  Object.freeze(instrument);
  return Object.freeze({
    id: name.toLowerCase().replaceAll(' ', '-'),
    name,
    instrument,
  });
}
export const BROWSER_INSTRUMENT_PRESETS: Readonly<
  Record<BrowserInstrumentId, readonly BrowserInstrumentPreset[]>
> = Object.freeze({
  'session-wavetable': Object.freeze([
    preset('session-wavetable', 'Pearl Pad', {
      attack: 0.3,
      decay: 0.7,
      sustain: 0.85,
      release: 0.4,
      morph: 0.28,
      cutoff: 2800,
      modulation: 0.35,
      unison: 4,
      detune: 12,
      spread: 0.9,
    }),
    preset('session-wavetable', 'Copper Pluck', {
      attack: 0.003,
      decay: 0.2,
      sustain: 0.12,
      release: 0.08,
      morph: 0.8,
      cutoff: 4200,
      drive: 0.2,
      modulation: 0,
      unison: 2,
      detune: 4,
      spread: 0.35,
    }),
    preset('session-wavetable', 'Clear Current', {
      attack: 0.015,
      decay: 0.35,
      sustain: 0.7,
      release: 0.22,
      morph: 0.6,
      cutoff: 11000,
      modulation: 0.4,
      rate: 2.4,
      unison: 3,
      detune: 8,
      spread: 0.7,
    }),
  ]),
  'session-fm': Object.freeze([
    preset('session-fm', 'Porcelain Keys', {
      ratio: 2,
      depth: 1.1,
      attack: 0.004,
      decay: 0.6,
      sustain: 0.2,
      release: 0.24,
      cutoff: 6500,
      modulation: 0.05,
      drive: 0.03,
    }),
    preset('session-fm', 'Orbit Bell', {
      ratio: 3.5,
      depth: 2.8,
      attack: 0.002,
      decay: 1.2,
      sustain: 0.08,
      release: 0.42,
      cutoff: 12000,
      modulation: 0.2,
      rate: 3.2,
      drive: 0,
    }),
    preset('session-fm', 'Wire Bass', {
      ratio: 1,
      depth: 2.2,
      attack: 0.003,
      decay: 0.22,
      sustain: 0.55,
      release: 0.07,
      cutoff: 2200,
      modulation: 0,
      drive: 0.35,
    }),
  ]),
});

function harmonicWave(
  c: BaseAudioContext,
  frequency: number,
  morph: number,
  detune: number,
) {
  const count = Math.max(
    1,
    Math.min(
      48,
      Math.floor((c.sampleRate * 0.45) / (frequency * 2 ** (detune / 1200))),
    ),
  );
  const real = new Float32Array(count + 1);
  const imaginary = new Float32Array(count + 1);
  let total = 0;
  // A continuous sine → rounded triangle → bright saw table, composed here.
  for (let harmonic = 1; harmonic <= count; harmonic++) {
    const sine = harmonic === 1 ? 1 : 0;
    const triangle =
      harmonic % 2 ? (harmonic % 4 === 1 ? 1 : -1) / harmonic ** 2 : 0;
    const saw = (harmonic % 2 ? 1 : -1) / harmonic;
    const amount = morph < 0.5 ? morph * 2 : (morph - 0.5) * 2;
    const coefficient =
      morph < 0.5
        ? sine * (1 - amount) + triangle * amount
        : triangle * (1 - amount) + saw * amount;
    imaginary[harmonic] = coefficient;
    total += Math.abs(coefficient);
  }
  for (let harmonic = 1; harmonic <= count; harmonic++)
    imaginary[harmonic] /= total;
  return c.createPeriodicWave(real, imaginary, { disableNormalization: true });
}
function driveCurve(amount: number) {
  const curve = new Float32Array(1025),
    strength = 1 + amount * 5;
  for (let i = 0; i < curve.length; i++) {
    const x = (i * 2) / (curve.length - 1) - 1;
    curve[i] = amount ? Math.tanh(strength * x) / Math.tanh(strength) : x;
  }
  return curve;
}

/** A bounded native Web Audio graph usable by AudioContext and OfflineAudioContext. */
export function playBrowserNote(
  c: BaseAudioContext,
  dest: AudioNode,
  pitch: number,
  time: number,
  length: number,
  velocity: number,
  value: BrowserInstrument,
): BrowserVoice {
  const instrument = validateBrowserInstrument(value),
    p = instrument.parameters;
  if (
    !Number.isInteger(pitch) ||
    pitch < 0 ||
    pitch > 127 ||
    !Number.isFinite(time) ||
    time < 0 ||
    !Number.isFinite(length) ||
    length <= 0 ||
    length > 300 ||
    !Number.isFinite(velocity) ||
    velocity < 0 ||
    velocity > 1
  )
    throw new Error(
      'Choose a MIDI note from 0–127, a duration up to 300 seconds and velocity from 0–1.',
    );
  if (!velocity || !p.level)
    return { release() {}, stop() {}, disconnect() {} };
  const at = Math.max(time, c.currentTime),
    off = at + length;
  const frequency = 440 * 2 ** ((pitch - 69) / 12),
    peak = 0.18 * p.level * velocity;
  const nodes: AudioNode[] = [],
    sources: OscillatorNode[] = [];
  let disconnected = false,
    remaining = 0,
    stopAt = off + p.release,
    releaseAt = off;
  const noteLevel = (elapsed: number) =>
    elapsed < p.attack
      ? (peak * elapsed) / p.attack
      : elapsed < p.attack + p.decay
        ? peak * (1 - ((1 - p.sustain) * (elapsed - p.attack)) / p.decay)
        : peak * p.sustain;
  let releaseLevel = noteLevel(length);
  function remember<T extends AudioNode>(node: T): T {
    nodes.push(node);
    return node;
  }
  function oscillator() {
    const node = remember(c.createOscillator());
    sources.push(node);
    return node;
  }
  const disconnect = () => {
    if (disconnected) return;
    disconnected = true;
    for (const source of sources) {
      source.onended = null;
      try {
        source.stop(c.currentTime);
      } catch {}
    }
    for (const node of nodes) node.disconnect();
  };
  function envelopeAt(when: number) {
    const elapsed = when - at;
    if (elapsed <= 0) return 0;
    if (when >= stopAt) return 0;
    return when <= releaseAt
      ? noteLevel(elapsed)
      : releaseLevel * (1 - (when - releaseAt) / (stopAt - releaseAt));
  }
  try {
    const envelope = remember(c.createGain()),
      filter = remember(c.createBiquadFilter()),
      drive = remember(c.createWaveShaper());
    filter.type = 'lowpass';
    const cutoff = Math.min(p.cutoff, c.sampleRate * 0.4);
    filter.frequency.setValueAtTime(cutoff, at);
    filter.Q.setValueAtTime(0.15 + p.resonance * 2.85, at);
    drive.curve = driveCurve(p.drive);
    // Resampling can overshoot the shaping curve; preserve the explicit voice peak bound.
    drive.oversample = 'none';
    filter.connect(drive).connect(envelope).connect(dest);
    envelope.gain.setValueAtTime(0, at);
    const attackEnd = Math.min(off, at + p.attack);
    envelope.gain.linearRampToValueAtTime(envelopeAt(attackEnd), attackEnd);
    if (off > at + p.attack) {
      const decayEnd = Math.min(off, at + p.attack + p.decay);
      envelope.gain.linearRampToValueAtTime(envelopeAt(decayEnd), decayEnd);
    }
    envelope.gain.setValueAtTime(envelopeAt(off), off);
    envelope.gain.linearRampToValueAtTime(0, stopAt);
    if (instrument.id === 'session-wavetable') {
      const w = instrument.parameters,
        wave = harmonicWave(c, frequency, w.morph, w.detune);
      for (let voice = 0; voice < w.unison; voice++) {
        const position = w.unison === 1 ? 0 : (voice * 2) / (w.unison - 1) - 1;
        const source = oscillator(),
          gain = remember(c.createGain()),
          pan = remember(c.createStereoPanner());
        source.setPeriodicWave(wave);
        source.frequency.setValueAtTime(frequency, at);
        source.detune.setValueAtTime(position * w.detune, at);
        gain.gain.setValueAtTime(1 / w.unison, at);
        pan.pan.setValueAtTime(position * w.spread, at);
        source.connect(gain).connect(pan).connect(filter);
      }
    } else {
      const f = instrument.parameters,
        carrier = oscillator(),
        modulator = oscillator(),
        index = remember(c.createGain());
      carrier.type = modulator.type = 'sine';
      carrier.frequency.setValueAtTime(frequency, at);
      modulator.frequency.setValueAtTime(
        Math.min(frequency * f.ratio, c.sampleRate * 0.45),
        at,
      );
      const depth = Math.min(frequency * f.depth, c.sampleRate * 0.35);
      index.gain.setValueAtTime(depth, at);
      modulator.connect(index).connect(carrier.frequency);
      carrier.connect(filter);
      if (f.modulation && depth) {
        const lfo = oscillator(),
          amount = remember(c.createGain());
        lfo.frequency.setValueAtTime(f.rate, at);
        amount.gain.setValueAtTime(depth * f.modulation * 0.5, at);
        lfo.connect(amount).connect(index.gain);
      }
    }
    if (instrument.id === 'session-wavetable' && p.modulation) {
      const lfo = oscillator(),
        amount = remember(c.createGain());
      lfo.frequency.setValueAtTime(p.rate, at);
      amount.gain.setValueAtTime(cutoff * p.modulation * 0.45, at);
      lfo.connect(amount).connect(filter.frequency);
    }
    remaining = sources.length;
    for (const source of sources) {
      source.onended = () => {
        if (--remaining === 0) disconnect();
      };
      source.start(at);
      source.stop(stopAt);
    }
    function finish(when: number, duration: number) {
      if (!Number.isFinite(when) || when < 0)
        throw new Error('Invalid browser instrument release/stop time.');
      if (disconnected) return;
      const start = Math.max(c.currentTime, when),
        end = start + duration;
      // Repeated note-offs and cancellation must never postpone an existing finish.
      if (end >= stopAt) return;
      const level = envelopeAt(start);
      if (typeof envelope.gain.cancelAndHoldAtTime === 'function')
        envelope.gain.cancelAndHoldAtTime(start);
      else {
        envelope.gain.cancelScheduledValues(start);
        envelope.gain.linearRampToValueAtTime(level, start);
      }
      envelope.gain.linearRampToValueAtTime(0, end);
      releaseAt = start;
      releaseLevel = level;
      stopAt = end;
      for (const source of sources) {
        try {
          source.stop(end);
        } catch {}
      }
    }
    return {
      release(when = c.currentTime) {
        finish(when, p.release);
      },
      stop(when = c.currentTime) {
        finish(when, 0.005);
      },
      disconnect,
    };
  } catch (error) {
    disconnect();
    throw error;
  }
}
