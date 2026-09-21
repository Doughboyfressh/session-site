// Waveform-similarity overlap-add. Shared grain positions preserve stereo phase.
// Audition complex material: this is not formant-preserving vocal correction.
type F32 = Float32Array<ArrayBuffer>;
export function stretchChannels(input: F32[], factor: number): F32[] {
  const sourceLength = input[0]?.length || 0;
  if (
    !Number.isFinite(factor) ||
    factor < 0.5 ||
    factor > 2 ||
    !sourceLength ||
    input.some((c) => c.length !== sourceLength)
  )
    throw new Error('Invalid audio stretch settings.');
  const length = Math.max(1, Math.round(sourceLength * factor));
  if (factor === 1) return input;
  const output = input.map(() => new Float32Array(length));
  if (Math.min(sourceLength, length) < 32) {
    output.forEach((out, ch) => {
      for (let i = 0; i < length; i++) {
        const p = (i * (sourceLength - 1)) / Math.max(1, length - 1);
        const j = Math.floor(p),
          f = p - j;
        out[i] =
          input[ch][j] * (1 - f) +
          input[ch][Math.min(j + 1, sourceLength - 1)] * f;
      }
    });
    return output;
  }
  const frame =
    2 **
    Math.floor(Math.log2(Math.min(2048, Math.min(sourceLength, length) / 4)));
  const hop = Math.max(1, frame / 4),
    search = Math.min(512, frame / 2);
  const norm = new Float32Array(length);
  const window = Float32Array.from(
    { length: frame },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frame - 1)),
  );
  const refs = input.map(() => new Float64Array(Math.min(512, frame)));
  const last = length - frame;
  let previous = -frame;
  for (let pos = 0; ; pos = Math.min(last, pos + hop)) {
    const expected =
      pos === last
        ? sourceLength - frame
        : Math.round((pos / last) * (sourceLength - frame));
    let base = expected;
    if (pos > 0 && pos < last) {
      const lo = Math.max(0, expected - search),
        hi = Math.min(sourceLength - frame, expected + search);
      const span = Math.min(512, frame, previous + frame - pos);
      let refEnergy = 0;
      for (let ch = 0; ch < input.length; ch++)
        for (let i = 0; i < span; i += 4) {
          const value =
            norm[pos + i] > 1e-8 ? output[ch][pos + i] / norm[pos + i] : 0;
          refs[ch][i] = value;
          refEnergy += value * value;
        }
      if (refEnergy > 1e-9) {
        let score = -Infinity,
          best = expected;
        const evaluate = (candidate: number) => {
          let xy = 0,
            xx = 0;
          for (let ch = 0; ch < input.length; ch++)
            for (let i = 0; i < span; i += 4) {
              const x = input[ch][candidate + i];
              xy += x * refs[ch][i];
              xx += x * x;
            }
          const next =
            xy / Math.sqrt(xx * refEnergy + 1e-30) -
            1e-7 * Math.abs(candidate - expected);
          if (next > score) {
            score = next;
            best = candidate;
          }
        };
        for (let candidate = lo; candidate <= hi; candidate += 4)
          evaluate(candidate);
        const coarse = best;
        for (
          let candidate = Math.max(lo, coarse - 4);
          candidate <= Math.min(hi, coarse + 4);
          candidate++
        )
          evaluate(candidate);
        base = best;
      }
    }
    for (let i = 0; i < frame; i++) {
      const weight =
        (pos === 0 && i < frame / 2) || (pos === last && i >= frame / 2)
          ? 1
          : window[i];
      for (let ch = 0; ch < input.length; ch++)
        output[ch][pos + i] += input[ch][base + i] * weight;
      norm[pos + i] += weight;
    }
    previous = pos;
    if (pos === last) break;
  }
  for (const out of output)
    for (let i = 0; i < length; i++)
      out[i] = norm[i] > 1e-8 ? out[i] / norm[i] : 0;
  return output;
}
export const timeStretch = (input: F32, factor: number): F32 =>
  stretchChannels([input], factor)[0];

// Windowed-sinc resampling filters frequencies above the destination Nyquist.
function resample(input: F32, length: number): F32 {
  const out = new Float32Array(length),
    scale = input.length / length;
  const cutoff = Math.min(1, 1 / scale) * 0.95,
    radius = 24;
  for (let i = 0; i < length; i++) {
    const p = i * scale,
      center = Math.floor(p);
    let sum = 0,
      weight = 0;
    for (
      let j = Math.max(0, center - radius);
      j <= Math.min(input.length - 1, center + radius);
      j++
    ) {
      const d = j - p,
        x = Math.PI * cutoff * d;
      const w =
        (Math.abs(x) < 1e-10 ? cutoff : (cutoff * Math.sin(x)) / x) *
        (0.5 + 0.5 * Math.cos((Math.PI * d) / (radius + 1)));
      sum += input[j] * w;
      weight += w;
    }
    out[i] = Math.abs(weight) > 1e-8 ? sum / weight : 0;
  }
  return out;
}
export function shiftChannels(input: F32[], semitones: number): F32[] {
  if (!Number.isFinite(semitones) || semitones < -12 || semitones > 12)
    throw new Error('Choose a pitch shift within one octave.');
  if (!semitones) return input;
  const stretched = stretchChannels(input, 2 ** (semitones / 12));
  return stretched.map((channel) => resample(channel, input[0].length));
}
export const pitchShift = (input: F32, semitones: number): F32 =>
  shiftChannels([input], semitones)[0];
export function processTimePitch(
  buffer: AudioBuffer,
  opts: { pitchShift?: number; stretch?: number },
): AudioBuffer {
  if (!opts.pitchShift && (!opts.stretch || opts.stretch === 1)) return buffer;
  let channels = Array.from({ length: buffer.numberOfChannels }, (_, ch) =>
    buffer.getChannelData(ch).slice(),
  );
  channels = shiftChannels(channels, opts.pitchShift || 0);
  channels = stretchChannels(channels, opts.stretch || 1);
  const out = new AudioBuffer({
    numberOfChannels: channels.length,
    length: channels[0].length,
    sampleRate: buffer.sampleRate,
  });
  channels.forEach((data, ch) => out.copyToChannel(data, ch));
  return out;
}
