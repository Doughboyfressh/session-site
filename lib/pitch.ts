// Offline vocal processing for recorded / imported audio clips.
// Denoise is a smoothed downward expander for quieter gaps. AutoPitch settings
// remain serializable for project recovery, but processing is disabled until
// the pitch-correction algorithm passes numerical and listening validation.

export type PitchOptions = {
  denoise?: number;
  autoPitch?: number;
  pitchKey?: number; // 0..11, 0 = C
  pitchMinor?: boolean;
};

export const NOTE_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
];

type F32 = Float32Array<ArrayBuffer>;

function makeBuffer(ref: AudioBuffer, channels: F32[]): AudioBuffer {
  const out = new AudioBuffer({
    numberOfChannels: channels.length,
    length: channels[0].length,
    sampleRate: ref.sampleRate,
  });
  channels.forEach((data, i) => out.copyToChannel(data, i));
  return out;
}

// Attenuate audio that sits below an estimated noise floor.
export function denoiseChannel(
  input: F32,
  sampleRate: number,
  amount: number,
): F32 {
  const a = Math.max(0, Math.min(1, amount));
  if (a <= 0) return input;
  const out = new Float32Array(input.length);
  const win = Math.max(64, Math.floor(sampleRate * 0.02));
  const rms: number[] = [];
  for (let i = 0; i < input.length; i += win) {
    let s = 0,
      n = 0;
    for (let j = i; j < Math.min(i + win, input.length); j++) {
      s += input[j] * input[j];
      n++;
    }
    rms.push(Math.sqrt(s / Math.max(1, n)));
  }
  const sorted = [...rms].sort((x, y) => x - y);
  const floor = sorted[Math.floor(sorted.length * 0.1)] || 0;
  const threshold = floor * (1 + a * 6) + 1e-5;
  const attack = Math.exp(-1 / (sampleRate * 0.005));
  const release = Math.exp(-1 / (sampleRate * 0.08));
  let env = 0,
    gain = 1;
  for (let i = 0; i < input.length; i++) {
    const x = Math.abs(input[i]);
    env =
      x > env
        ? attack * env + (1 - attack) * x
        : release * env + (1 - release) * x;
    const target =
      env < threshold
        ? Math.max(1 - a, (env / threshold) * (env / threshold))
        : 1;
    gain =
      gain < target
        ? attack * gain + (1 - attack) * target
        : release * gain + (1 - release) * target;
    out[i] = input[i] * gain;
  }
  return out;
}

// Preserve saved settings while the unfinished pitch-correction engine is gated.
export function autoPitchChannel(
  input: F32,
  _sampleRate: number,
  strength: number,
  _keyRoot: number,
  _minor: boolean,
): F32 {
  if (strength > 0)
    throw new Error(
      'AutoPitch is unavailable while its audio quality is being improved. Turn it off in Vocal effects to play or export.',
    );
  return input;
}
export function processAudioBuffer(
  buffer: AudioBuffer,
  opts: PitchOptions,
): AudioBuffer {
  const denoiseAmt = opts.denoise || 0;
  const pitchAmt = opts.autoPitch || 0;
  if (denoiseAmt <= 0 && pitchAmt <= 0) return buffer;
  const keyRoot = (((opts.pitchKey || 0) % 12) + 12) % 12;
  const channels: F32[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    let data = buffer.getChannelData(ch).slice();
    if (denoiseAmt > 0)
      data = denoiseChannel(data, buffer.sampleRate, denoiseAmt);
    if (pitchAmt > 0)
      data = autoPitchChannel(
        data,
        buffer.sampleRate,
        pitchAmt,
        keyRoot,
        !!opts.pitchMinor,
      );
    channels.push(data);
  }
  return makeBuffer(buffer, channels);
}
