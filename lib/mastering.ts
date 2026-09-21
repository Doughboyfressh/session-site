// One-tap mastering for the export mix bus: tonal EQ → glue compression →
// limiter, rendered offline over the summed stereo mix. Presets trade tone and
// loudness; `off` returns the mix untouched. Applied only to the stereo mix /
// reference file, never to individual stems.
import { compressorLatency } from './audio-latency';

export type MasterPreset = 'off' | 'universal' | 'warm' | 'bright' | 'loud';

export const MASTER_PRESETS: { id: MasterPreset; name: string }[] = [
  { id: 'off', name: 'No mastering' },
  { id: 'universal', name: 'Universal' },
  { id: 'warm', name: 'Warm' },
  { id: 'bright', name: 'Bright' },
  { id: 'loud', name: 'Loud' },
];

export const MASTER_PRESET_IDS = MASTER_PRESETS.map((p) => p.id);

type Cfg = {
  low: number;
  presence: number;
  high: number;
  glue: number;
  makeup: number;
  ceiling: number;
};

const CONFIG: Record<Exclude<MasterPreset, 'off'>, Cfg> = {
  universal: {
    low: 1,
    presence: 1.5,
    high: 1,
    glue: -18,
    makeup: 2,
    ceiling: -0.3,
  },
  warm: {
    low: 2.5,
    presence: 0,
    high: -1.5,
    glue: -20,
    makeup: 2,
    ceiling: -0.5,
  },
  bright: { low: 0, presence: 2, high: 3, glue: -18, makeup: 2, ceiling: -0.5 },
  loud: { low: 1, presence: 1, high: 1, glue: -24, makeup: 5, ceiling: -0.2 },
};

type F32 = Float32Array<ArrayBuffer>;

export async function masterStereo(
  channels: F32[],
  sampleRate: number,
  preset: MasterPreset,
): Promise<F32[]> {
  const cfg = preset === 'off' ? null : CONFIG[preset];
  const length = channels[0]?.length || 0;
  if (!cfg || !length) return channels;
  const latency = 2 * (await compressorLatency(sampleRate));
  const c = new OfflineAudioContext(2, length + latency, sampleRate);
  const buffer = c.createBuffer(2, length, sampleRate);
  for (let ch = 0; ch < 2; ch++)
    buffer.copyToChannel(channels[Math.min(ch, channels.length - 1)], ch);
  const src = c.createBufferSource();
  src.buffer = buffer;
  const low = c.createBiquadFilter();
  low.type = 'lowshelf';
  low.frequency.value = 120;
  low.gain.value = cfg.low;
  const presence = c.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 3000;
  presence.Q.value = 0.7;
  presence.gain.value = cfg.presence;
  const high = c.createBiquadFilter();
  high.type = 'highshelf';
  high.frequency.value = 9000;
  high.gain.value = cfg.high;
  const glue = c.createDynamicsCompressor();
  glue.threshold.value = cfg.glue;
  glue.ratio.value = 2;
  glue.knee.value = 6;
  glue.attack.value = 0.02;
  glue.release.value = 0.2;
  const makeup = c.createGain();
  makeup.gain.value = Math.pow(10, cfg.makeup / 20);
  const limiter = c.createDynamicsCompressor();
  limiter.threshold.value = cfg.ceiling;
  limiter.ratio.value = 20;
  limiter.knee.value = 0;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.05;
  src
    .connect(low)
    .connect(presence)
    .connect(high)
    .connect(glue)
    .connect(makeup)
    .connect(limiter)
    .connect(c.destination);
  src.start();
  const rendered = await c.startRendering();
  const ceiling = 10 ** (cfg.ceiling / 20);
  return [0, 1].map((ch) => {
    const samples = rendered
      .getChannelData(ch)
      .slice(latency, latency + length);
    // Bound sample peaks including transients that pass the compressor attack.
    for (let i = 0; i < samples.length; i++)
      samples[i] = Math.max(-ceiling, Math.min(ceiling, samples[i]));
    return samples;
  });
}
