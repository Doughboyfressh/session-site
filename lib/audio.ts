import { defaultPattern, type Track } from './catalog';
import {
  checkSampleBuffer,
  playSample,
  sampleSettings,
  type SampleSettings,
} from './sample-instrument';
import { validateArrangement } from './arrangement-validation';
import { loopSegments, type RecordingLoop } from './loop-recording';
import {
  routingFor,
  audibleTrack,
  type GroupId,
  type MixerRouting,
} from './mixer-routing';
import { buildInsertFx, type DriveType, type ModType } from './effects';
import { voiceFor } from './instruments';
import { schedulePump } from './pump';
export type Note = {
  id: string;
  pitch: number;
  start: number;
  length: number;
  velocity: number;
};
export type AutomationPoint = { time: number; value: number };
export type MixerTrack = {
  id: string;
  name: string;
  fileId?: string;
  demo?: string;
  sequence?: number[][];
  notes?: Note[];
  sound?: 'keys' | 'bass' | 'pad' | 'lead' | 'pluck' | 'organ' | 'bell';
  sample?: SampleSettings;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  offset: number;
  trimStart: number;
  trimEnd: number;
  low: number;
  mid: number;
  high: number;
  duration?: number;
  peaks?: number[];
  reverb?: number;
  delay?: number;
  compression?: number;
  fadeIn?: number;
  fadeOut?: number;
  fadeStart?: number;
  fadeEnd?: number;
  splitFrom?: string;
  automation?: AutomationPoint[];
  groupId?: GroupId;
  sendReverb?: number;
  sendDelay?: number;
  drive?: number;
  driveType?: DriveType;
  mod?: number;
  modType?: ModType;
  modRate?: number;
  limiter?: number;
  pump?: number;
  denoise?: number;
  autoPitch?: number;
  pitchKey?: number;
  pitchMinor?: boolean;
  pitchShift?: number;
  stretch?: number;
};
export type Arrangement = {
  bpm: number;
  tracks: MixerTrack[];
  routing?: MixerRouting;
};
export type StudioOutput = (node: AudioNode) => () => void;
export type TransportOptions = {
  recordingLoop?: RecordingLoop;
  from?: number;
  loop?: boolean;
  loopStart?: number;
  loopEnd?: number;
  metronome?: boolean;
  audioContext?: AudioContext;
  startDelay?: number;
  allowPastEnd?: boolean;
  signal?: AbortSignal;
  output?: StudioOutput;
};
let audio: AudioContext | null = null;
const cache = new Map<string, AudioBuffer>();
export function context() {
  if (!audio || audio.state === 'closed')
    audio = new AudioContext({ latencyHint: 'interactive' });
  return audio;
}
export function defaults(name = 'Instrument'): MixerTrack {
  return {
    id: crypto.randomUUID(),
    name,
    volume: 0.8,
    pan: 0,
    muted: false,
    solo: false,
    offset: 0,
    trimStart: 0,
    trimEnd: 0,
    low: 0,
    mid: 0,
    high: 0,
    reverb: 0,
    delay: 0,
    compression: 0,
    fadeIn: 0,
    fadeOut: 0,
    automation: [],
  };
}
export function trackFrom(t: Track): MixerTrack {
  return {
    ...defaults(t.title),
    fileId: t.fileId,
    demo: t.demo ? t.id : undefined,
  };
}
export function instrument(
  c: BaseAudioContext,
  dest: AudioNode,
  index: number,
  time: number,
  volume = 1,
  random = Math.random,
) {
  const gain = c.createGain();
  gain.connect(dest);
  if (index === 0) {
    const osc = c.createOscillator();
    osc.frequency.setValueAtTime(145, time);
    osc.frequency.exponentialRampToValueAtTime(43, time + 0.18);
    gain.gain.setValueAtTime(0.7 * volume, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.34);
    osc.connect(gain);
    osc.start(time);
    osc.stop(time + 0.36);
  } else {
    const length = index === 1 ? 0.16 : 0.045,
      buffer = c.createBuffer(
        1,
        Math.floor(c.sampleRate * length),
        c.sampleRate,
      ),
      data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++)
      data[i] = (random() * 2 - 1) * (1 - i / data.length);
    const source = c.createBufferSource();
    source.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = index === 1 ? 1100 : 7500;
    gain.gain.setValueAtTime((index === 1 ? 0.3 : 0.15) * volume, time);
    source.connect(filter).connect(gain);
    source.start(time);
  }
}
export function playNote(
  c: BaseAudioContext,
  dest: AudioNode,
  pitch: number,
  time: number,
  length: number,
  velocity = 0.75,
  sound = 'keys',
) {
  const v = voiceFor(sound);
  const oscillator = c.createOscillator(),
    gain = c.createGain(),
    filter = c.createBiquadFilter();
  oscillator.type = v.type;
  oscillator.frequency.value = 440 * Math.pow(2, (pitch - 69) / 12);
  filter.type = 'lowpass';
  filter.frequency.value = v.cutoff;
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(velocity * 0.2, time + v.attack);
  if (v.pluck) {
    gain.gain.setTargetAtTime(0.00001, time + v.attack, v.release || 0.12);
  } else {
    gain.gain.setTargetAtTime(velocity * 0.13, time + 0.09, 0.2);
    gain.gain.setTargetAtTime(
      0.00001,
      time + Math.max(0.1, length - 0.04),
      0.04,
    );
  }
  oscillator.connect(filter).connect(gain).connect(dest);
  oscillator.start(time);
  oscillator.stop(time + length + 0.4);
  return oscillator;
}
export async function synth(
  bpm: number,
  pattern = defaultPattern,
  demo?: string,
  sampleRate = 44100,
) {
  const c = new OfflineAudioContext(
      2,
      Math.ceil(((60 / bpm) * 32 + 0.5) * sampleRate),
      sampleRate,
    ),
    master = c.createGain();
  master.gain.value = 0.7;
  master.connect(c.destination);
  const step = 60 / bpm / 4;
  let seed = 2166136261;
  for (const letter of JSON.stringify([bpm, pattern, demo]))
    seed = Math.imul(seed ^ letter.charCodeAt(0), 16777619) >>> 0;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let bar = 0; bar < 8; bar++)
    for (let i = 0; i < 16; i++)
      for (let row = 0; row < 3; row++)
        if (pattern[row]?.[i])
          instrument(c, master, row, (bar * 16 + i) * step, 0.8, random);
  if (demo) {
    const rootsFor: Record<string, number[]> = {
      'demo-1': [41, 37, 44, 39],
      'demo-2': [36, 39, 34, 37],
      'demo-3': [38, 36, 41, 36],
      'demo-4': [33, 36, 38, 36],
      'demo-5': [43, 38, 45, 40],
      'demo-6': [45, 40, 43, 38],
      'demo-7': [40, 35, 43, 38],
      'demo-8': [38, 33, 41, 36],
      'demo-9': [41, 36, 44, 39],
      'demo-10': [36, 43, 39, 34],
    };
    const roots = rootsFor[demo] || rootsFor['demo-2'];
    const richer = !['demo-1', 'demo-2', 'demo-3', 'demo-4'].includes(demo);
    for (let bar = 0; bar < 8; bar++) {
      const at = bar * 16 * step,
        root = roots[bar % 4];
      for (const interval of [12, 15, 19, 24])
        playNote(c, master, root + interval, at, 16 * step, 0.22, 'pad');
      for (let beat = 0; beat < 4; beat++)
        playNote(c, master, root, at + beat * 4 * step, 3 * step, 0.6, 'bass');
      if (richer)
        for (let s = 0; s < 8; s++)
          playNote(
            c,
            master,
            root + 24 + [0, 7, 12, 7, 15, 12, 7, 0][s],
            at + s * 2 * step,
            2 * step,
            0.16,
            'pluck',
          );
    }
  }
  return c.startRendering();
}
export async function bufferFor(
  t: MixerTrack,
  bpm: number,
  options: {
    sampleRate?: number;
    signal?: AbortSignal;
    revalidate?: boolean;
  } = {},
) {
  const sampleRate = options.sampleRate || 44100;
  if (t.fileId && !t.sample && t.autoPitch)
    throw new Error(
      'AutoPitch is unavailable while its audio quality is being improved. Turn it off in Vocal effects to play or export.',
    );
  if (t.sample) validateArrangement({ bpm, tracks: [t] }, true);
  const key =
    (t.sample
      ? `sample-${t.fileId}-${bpm}-${JSON.stringify(t.sample)}-${JSON.stringify(t.notes)}`
      : t.fileId ||
        `${t.demo || 'seq'}-${bpm}-${t.sound}-${JSON.stringify(t.notes ?? t.sequence ?? [])}`) +
    ':' +
    (options.sampleRate || 'playback') +
    (t.denoise || t.autoPitch
      ? `-v${t.denoise || 0},${t.autoPitch || 0},${t.pitchKey || 0},${
          t.pitchMinor ? 1 : 0
        }`
      : '') +
    (t.pitchShift || (t.stretch && t.stretch !== 1)
      ? `-t${t.pitchShift || 0},${t.stretch || 1}`
      : '');
  const cached = cache.get(key);
  if (options.signal?.aborted)
    throw new DOMException('Playback cancelled.', 'AbortError');
  if (cached && !(t.fileId && options.revalidate)) return cached;
  let b: AudioBuffer;
  if (t.sample) {
    sampleSettings(t.sample);
    if (!t.fileId || !t.notes || t.demo || t.sequence)
      throw new Error('This sampled instrument is incomplete.');
    const source = await sampleBuffer(t, options);
    if (cached) return cached;
    const duration =
      (Math.max(8, ...t.notes.map((n) => n.start + n.length)) * 60) / bpm + 0.5;
    if (duration > 300)
      throw new Error(
        'These notes extend beyond the five-minute instrument limit.',
      );
    const c = new OfflineAudioContext(
      2,
      Math.ceil(duration * sampleRate),
      sampleRate,
    );
    for (const n of t.notes)
      playSample(
        c,
        c.destination,
        source,
        t.sample,
        n.pitch,
        (n.start * 60) / bpm,
        (n.length * 60) / bpm,
        n.velocity,
      );
    b = await c.startRendering();
  } else if (t.fileId) {
    const r = await fetch('/api/file/' + t.fileId, {
      signal: options.signal,
      cache: 'no-store',
    });
    if (!r.ok)
      throw new Error('This audio is private or is no longer available.');
    if (cached) {
      await r.body?.cancel();
      return cached;
    }
    const decoder = options.sampleRate
      ? new OfflineAudioContext(2, 1, sampleRate)
      : context();
    b = await decoder.decodeAudioData(await r.arrayBuffer());
    if (
      b.duration > 300 ||
      b.duration * (t.stretch || 1) > 300 ||
      b.numberOfChannels > 2 ||
      b.length * b.numberOfChannels * 4 > 120 * 1024 * 1024
    )
      throw new Error(
        'Use mono or stereo audio up to five minutes long, including time stretching. Shorten this source before importing.',
      );
    if (
      t.denoise ||
      t.autoPitch ||
      t.pitchShift ||
      (t.stretch && t.stretch !== 1)
    ) {
      const { processInWorker } = await import('./audio-processing');
      b = await processInWorker(b, t, options.signal);
    }
  } else if (t.notes) {
    const beats = Math.max(8, ...t.notes.map((n) => n.start + n.length));
    const c = new OfflineAudioContext(
      2,
      Math.ceil(Math.min(300, (beats * 60) / bpm + 0.5) * sampleRate),
      sampleRate,
    );
    for (const n of t.notes)
      playNote(
        c,
        c.destination,
        n.pitch,
        (n.start * 60) / bpm,
        (n.length * 60) / bpm,
        n.velocity,
        t.sound,
      );
    b = await c.startRendering();
  } else b = await synth(bpm, t.sequence || defaultPattern, t.demo, sampleRate);
  if (
    b.numberOfChannels > 2 ||
    b.length * b.numberOfChannels * 4 > 180 * 1024 * 1024
  )
    throw new Error(
      'Use mono or stereo audio within the studio memory limit. Shorten or convert this source before importing.',
    );
  cache.set(key, b);
  let bytes = 0;
  for (const v of cache.values()) bytes += v.length * v.numberOfChannels * 4;
  while (bytes > 180 * 1024 * 1024 && cache.size > 1) {
    const first = cache.keys().next().value!;
    const old = cache.get(first)!;
    bytes -= old.length * old.numberOfChannels * 4;
    cache.delete(first);
  }
  return b;
}
export async function sampleBuffer(
  t: MixerTrack,
  options: {
    sampleRate?: number;
    signal?: AbortSignal;
    revalidate?: boolean;
  } = {},
) {
  if (!t.sample || !t.fileId) throw new Error('Load a sample first.');
  const b = await bufferFor(
    {
      ...t,
      sample: undefined,
      notes: undefined,
      denoise: undefined,
      autoPitch: undefined,
      pitchShift: undefined,
      stretch: undefined,
    },
    120,
    options,
  );
  if (options.signal?.aborted)
    throw new DOMException('Playback cancelled.', 'AbortError');
  checkSampleBuffer(b, t.sample);
  return b;
}
export function peaks(b: AudioBuffer) {
  const d = b.getChannelData(0),
    out = [];
  for (let i = 0; i < 120; i++) {
    const begin = Math.floor((i * d.length) / 120),
      end = Math.floor(((i + 1) * d.length) / 120);
    let peak = 0;
    for (
      let j = begin;
      j < end;
      j += Math.max(1, Math.floor((end - begin) / 100))
    )
      peak = Math.max(peak, Math.abs(d[j]));
    out.push(peak);
  }
  return out;
}
export function stereoMeter(c: BaseAudioContext, source: AudioNode) {
  const splitter = c.createChannelSplitter(2);
  source.connect(splitter);
  const meters = [0, 1].map((index) => {
    const analyser = c.createAnalyser();
    analyser.fftSize = 256;
    splitter.connect(analyser, index);
    return { analyser, samples: new Float32Array(256) };
  });
  return {
    level: () => {
      let peak = 0;
      for (const { analyser, samples } of meters) {
        analyser.getFloatTimeDomainData(samples);
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      }
      return peak;
    },
    dispose: () => {
      splitter.disconnect();
      meters.forEach((m) => m.analyser.disconnect());
    },
  };
}
function roomImpulse(c: BaseAudioContext) {
  const impulse = c.createBuffer(2, c.sampleRate * 1.6, c.sampleRate);
  let seed = 31253;
  for (let ch = 0; ch < 2; ch++) {
    const d = impulse.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      d[i] =
        ((seed / 4294967296) * 2 - 1) * Math.pow(1 - i / d.length, 3) * 0.4;
    }
  }
  return impulse;
}
export function channel(
  c: BaseAudioContext,
  t: MixerTrack,
  dest: AudioNode,
  metering = false,
  bpm = 120,
) {
  const output = c.createGain();
  output.connect(dest);
  const meter = metering ? stereoMeter(c, output) : null;
  const input = c.createGain(),
    eqs = [200, 1200, 5000].map((f, i) => {
      const e = c.createBiquadFilter();
      e.type = (['lowshelf', 'peaking', 'highshelf'] as const)[i];
      e.frequency.value = f;
      return e;
    }),
    pan = c.createStereoPanner(),
    gain = c.createGain(),
    auto = c.createGain();
  const fx = buildInsertFx(c);
  input.connect(eqs[0]).connect(eqs[1]).connect(eqs[2]).connect(fx.input);
  fx.output.connect(pan).connect(gain).connect(auto).connect(output);
  let compressor = c.createDynamicsCompressor();
  const convolver = c.createConvolver(),
    wet = c.createGain(),
    delay = c.createDelay(1),
    feedback = c.createGain(),
    echo = c.createGain();
  convolver.buffer = roomImpulse(c);
  auto.connect(convolver).connect(wet).connect(output);
  auto.connect(delay);
  delay.delayTime.value = 0.25;
  feedback.gain.value = 0.28;
  delay.connect(feedback).connect(delay);
  delay.connect(echo).connect(output);
  let compressionEnabled = false;
  const update = (next: MixerTrack, solo = false, initial = false) => {
    const set = (param: AudioParam, value: number, smoothing = 0.015) => {
      if (initial) param.setValueAtTime(value, c.currentTime);
      else param.setTargetAtTime(value, c.currentTime, smoothing);
    };
    eqs.forEach((e, i) => set(e.gain, [next.low, next.mid, next.high][i] || 0));
    set(pan.pan, next.pan);
    set(gain.gain, next.muted || (solo && !next.solo) ? 0 : next.volume);
    const enableCompression = Boolean(next.compression);
    if (enableCompression !== compressionEnabled) {
      eqs[2].disconnect();
      compressor.disconnect();
      if (enableCompression) {
        // A disconnected compressor can retain old lookahead audio. Re-enable with fresh state.
        compressor = c.createDynamicsCompressor();
        compressor.knee.value = 12;
        compressor.attack.value = 0.012;
        compressor.release.value = 0.18;
        eqs[2].connect(compressor).connect(fx.input);
      } else eqs[2].connect(fx.input);
      compressionEnabled = enableCompression;
    }
    compressor.threshold.value = next.compression
      ? -12 - (next.compression || 0) * 24
      : 0;
    compressor.ratio.value = next.compression ? 2 + next.compression * 8 : 1;
    set(wet.gain, next.reverb || 0, 0.02);
    set(echo.gain, next.delay || 0, 0.02);
    fx.update(next, set);
  };
  update(t, false, true);
  return {
    input,
    auto,
    bpm,
    update,
    level: () => {
      return meter?.level() || 0;
    },
    dispose: () => {
      meter?.dispose();
      fx.dispose();
      [
        input,
        ...eqs,
        compressor,
        pan,
        gain,
        auto,
        convolver,
        wet,
        delay,
        feedback,
        echo,
        output,
      ].forEach((n) => n.disconnect());
    },
  };
}
// Linear group buses and shared returns. The same graph renders each exported
// contribution, so processed stems include their own share of the shared effects.
export function routingGraph(
  c: BaseAudioContext,
  data: Arrangement,
  destination: AudioNode,
  metering = false,
  ignoreListening = false,
) {
  const nodes: AudioNode[] = [];
  const own = <T extends AudioNode>(node: T): T => {
    nodes.push(node);
    return node;
  };
  const reverb = own(c.createConvolver()),
    delay = own(c.createDelay(1)),
    feedback = own(c.createGain());
  reverb.buffer = roomImpulse(c);
  delay.delayTime.value = 0.25;
  feedback.gain.value = 0.28;
  delay.connect(feedback).connect(delay);
  const reverbOut = own(c.createGain()),
    delayOut = own(c.createGain());
  reverb.connect(reverbOut).connect(destination);
  delay.connect(delayOut).connect(destination);
  const meters = new Map<string, ReturnType<typeof stereoMeter>>();
  if (metering) {
    meters.set('return:reverb', stereoMeter(c, reverbOut));
    meters.set('return:delay', stereoMeter(c, delayOut));
  }
  const bus = (dest: AudioNode) => {
    const input = own(c.createGain()),
      pan = own(c.createStereoPanner()),
      gain = own(c.createGain());
    input.connect(pan).connect(gain).connect(dest);
    return { input, pan, gain };
  };
  const groups = new Map(
    routingFor(data).groups.map((g) => {
      const dry = bus(destination),
        verb = bus(reverb),
        echo = bus(delay);
      if (metering) meters.set('group:' + g.id, stereoMeter(c, dry.gain));
      return [g.id as string, { dry, verb, echo }];
    }),
  );
  const direct = { dry: bus(destination), verb: bus(reverb), echo: bus(delay) };
  groups.set('', direct);
  const routes = new Map(
    data.tracks.map((t) => {
      const input = own(c.createGain()),
        verb = own(c.createGain()),
        echo = own(c.createGain());
      input.connect(verb);
      input.connect(echo);
      return [
        t.id,
        { input, verb, echo, group: undefined as string | undefined },
      ];
    }),
  );
  let initial = true,
    disposed = false;
  const set = (param: AudioParam, value: number) => {
    if (initial) param.setValueAtTime(value, c.currentTime);
    else param.setTargetAtTime(value, c.currentTime, 0.015);
  };
  function update(next: Arrangement) {
    if (disposed) return;
    const config = routingFor(next);
    set(reverbOut.gain, config.reverb);
    set(delayOut.gain, config.delay);
    for (const group of config.groups) {
      const target = groups.get(group.id)!;
      for (const b of [target.dry, target.verb, target.echo]) {
        set(b.gain.gain, group.volume);
        set(b.pan.pan, group.pan);
      }
    }
    for (const [id, route] of routes) {
      const track = next.tracks.find((t) => t.id === id);
      const group = track?.groupId || '';
      const dest = groups.get(group) || direct;
      if (group !== route.group) {
        if (route.group !== undefined)
          route.input.disconnect((groups.get(route.group) || direct).dry.input);
        route.verb.disconnect();
        route.echo.disconnect();
        route.input.connect(dest.dry.input);
        route.verb.connect(dest.verb.input);
        route.echo.connect(dest.echo.input);
        route.group = group;
      }
      set(
        route.input.gain,
        track && (ignoreListening || audibleTrack(next, track)) ? 1 : 0,
      );
      set(route.verb.gain, track?.sendReverb || 0);
      set(route.echo.gain, track?.sendDelay || 0);
    }
    initial = false;
  }
  update(data);
  return {
    inputs: new Map([...routes].map(([id, r]) => [id, r.input])),
    update,
    levels: () =>
      Object.fromEntries([...meters].map(([id, m]) => [id, m.level()])),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      meters.forEach((m) => m.dispose());
      nodes.forEach((n) => n.disconnect());
    },
  };
}
export function automationAt(points: AutomationPoint[], time: number) {
  if (!points.length) return 1;
  const sorted = [...points].sort((a, b) => a.time - b.time);
  if (time <= sorted[0].time) return sorted[0].value;
  for (let i = 1; i < sorted.length; i++)
    if (time <= sorted[i].time) {
      const a = sorted[i - 1],
        b = sorted[i];
      return (
        a.value +
        ((b.value - a.value) * (time - a.time)) / (b.time - a.time || 1)
      );
    }
  return sorted.at(-1)!.value;
}
export function mixDuration(data: Arrangement) {
  return Math.min(
    300,
    Math.max(
      1,
      ...data.tracks.map(
        (t) => t.offset + (t.duration || 20) - t.trimStart - t.trimEnd,
      ),
    ),
  );
}
export function scheduleClip(
  c: BaseAudioContext,
  t: MixerTrack,
  b: AudioBuffer,
  ch: { input: AudioNode; auto: GainNode; bpm?: number },
  when: number,
  from: number,
  to: number,
  automationDelay = 0,
) {
  const end = t.offset + b.duration - t.trimStart - t.trimEnd;
  // Shared boundaries land on the same output sample. Fractional start times
  // otherwise combine browser grain rounding with a second source correction.
  const startFrame = Math.round(
    (when + Math.max(from, t.offset) - from) * c.sampleRate,
  );
  const endFrame = Math.round((when + Math.min(to, end) - from) * c.sampleRate);
  const first = from + startFrame / c.sampleRate - when;
  const last = from + endFrame / c.sampleRate - when;
  if (last <= first) return null;
  const source = c.createBufferSource(),
    fade = c.createGain(),
    fadeOut = c.createGain(),
    pump = c.createGain();
  source.buffer = b;
  source.connect(fade).connect(fadeOut).connect(pump).connect(ch.input);
  const at = startFrame / c.sampleRate,
    dur = (endFrame - startFrame) / c.sampleRate,
    relative = first - t.offset,
    fadeElapsed = t.trimStart + relative - (t.fadeStart ?? t.trimStart);
  if (t.pump) schedulePump(pump.gain, at, first, last, ch.bpm || 120, t.pump);
  fade.gain.value = t.fadeIn
    ? Math.max(0, Math.min(1, fadeElapsed / t.fadeIn))
    : 1;
  fade.gain.setValueAtTime(
    t.fadeIn ? Math.max(0, Math.min(1, fadeElapsed / t.fadeIn)) : 1,
    at,
  );
  if (t.fadeIn && fadeElapsed < t.fadeIn) {
    if (fadeElapsed < 0)
      fade.gain.setValueAtTime(0, Math.min(at + dur, at - fadeElapsed));
    fade.gain.linearRampToValueAtTime(
      Math.max(0, Math.min(1, (fadeElapsed + dur) / t.fadeIn)),
      Math.min(at + dur, at + t.fadeIn - fadeElapsed),
    );
  }
  if (t.fadeOut) {
    const fadeEnd =
      t.offset + (t.fadeEnd ?? b.duration - t.trimEnd) - t.trimStart;
    const start = fadeEnd - t.fadeOut;
    fadeOut.gain.value = Math.min(
      1,
      Math.max(0, (fadeEnd - first) / t.fadeOut),
    );
    if (start < last) {
      fadeOut.gain.setValueAtTime(
        Math.min(1, Math.max(0, (fadeEnd - first) / t.fadeOut)),
        Math.max(at, when + start - from),
      );
      fadeOut.gain.linearRampToValueAtTime(
        Math.max(0, (fadeEnd - last) / t.fadeOut),
        Math.max(at, Math.min(at + dur, when + fadeEnd - from)),
      );
    }
  }
  const points = (t.automation || []).slice().sort((a, b) => a.time - b.time);
  ch.auto.gain.setValueAtTime(
    automationAt(points, from),
    when + automationDelay,
  );
  for (const p of points)
    if (p.time > from && p.time <= to)
      ch.auto.gain.linearRampToValueAtTime(
        p.value,
        when + automationDelay + p.time - from,
      );
  ch.auto.gain.linearRampToValueAtTime(
    automationAt(points, to),
    when + automationDelay + to - from,
  );
  source.start(at, Math.max(0, t.trimStart + relative), dur);
  source.onended = () => {
    source.disconnect();
    fade.disconnect();
    fadeOut.disconnect();
    pump.disconnect();
  };
  return source;
}
async function loadArrangementBuffers(
  data: Arrangement,
  options: { sampleRate: number; signal?: AbortSignal; revalidate: boolean },
) {
  const loaded: { t: MixerTrack; b: AudioBuffer }[] = [];
  const unique = new Set<AudioBuffer>();
  let bytes = 0;
  for (const t of data.tracks) {
    const b = await bufferFor(t, data.bpm, options);
    if (!unique.has(b)) bytes += b.length * b.numberOfChannels * 4;
    unique.add(b);
    if (bytes > 180 * 1024 * 1024)
      throw new Error(
        'This session exceeds the playback memory limit. Shorten the source audio or remove some tracks.',
      );
    loaded.push({ t, b });
  }
  return loaded;
}
export async function playMix(
  data: Arrangement,
  onEnd?: () => void,
  options: TransportOptions = {},
) {
  const c = options.audioContext || context();
  const finiteLoop = options.recordingLoop
    ? loopSegments(options.recordingLoop, c.sampleRate)
    : null;
  if (finiteLoop && options.loop)
    throw new Error('Choose one playback loop mode.');
  await c.resume();
  if (options.signal?.aborted)
    throw new DOMException('Playback cancelled.', 'AbortError');
  if (!data.tracks.length) throw new Error('Add a track to play.');
  const loaded = await loadArrangementBuffers(data, {
    signal: options.signal,
    sampleRate: c.sampleRate,
    revalidate: true,
  });
  if (options.signal?.aborted)
    throw new DOMException('Playback cancelled.', 'AbortError');
  for (const { t, b } of loaded)
    if (t.trimStart + t.trimEnd >= b.duration)
      throw new Error(t.name + ' is fully trimmed. Shorten its trim settings.');
  const duration = Math.min(
      300,
      Math.max(
        ...loaded.map(
          ({ t, b }) => t.offset + b.duration - t.trimStart - t.trimEnd,
        ),
      ),
    ),
    from = Math.max(
      0,
      Math.min(options.from || 0, options.allowPastEnd ? 300 : duration - 0.01),
    ),
    end = options.loop
      ? Math.min(
          duration,
          Math.max(
            (options.loopStart || 0) + 0.25,
            options.loopEnd || duration,
          ),
        )
      : duration,
    startLoop = Math.min(options.loopStart || 0, end - 0.25);
  const master = c.createDynamicsCompressor();
  master.threshold.value = -1;
  master.ratio.value = 20;
  master.connect(c.destination);
  const masterMeter = stereoMeter(c, master);
  const releaseOutput = options.output?.(master);
  const routing = routingGraph(c, data, master, true);
  const channels = new Map(
    loaded.map(({ t }) => [
      t.id,
      channel(
        c,
        {
          ...t,
          muted: !audibleTrack(data, t),
        },
        routing.inputs.get(t.id)!,
        true,
        data.bpm,
      ),
    ]),
  );
  channels.forEach((ch, id) => {
    const track = data.tracks.find((t) => t.id === id)!;
    ch.update({ ...track, muted: !audibleTrack(data, track) }, false);
  });
  const nodes = new Set<AudioBufferSourceNode>();
  const clicks = new Set<OscillatorNode>();
  let stopped = false,
    next =
      Math.ceil(
        (c.currentTime + Math.max(0.08, options.startDelay || 0)) *
          c.sampleRate,
      ) / c.sampleRate,
    currentFrom = options.allowPastEnd ? from : Math.min(from, end - 0.01),
    firstWhen = next;
  const initialFrom = currentFrom;
  let latest = data;
  function schedule() {
    if (stopped) return;
    if (finiteLoop) {
      for (const segment of finiteLoop)
        scheduleSlice(
          firstWhen + segment.frame / c.sampleRate,
          segment.from,
          segment.to,
        );
      return;
    }
    if (currentFrom >= end) return;
    while (!options.loop || next < c.currentTime + 0.4) {
      scheduleSlice(next, currentFrom, end);
      next += end - currentFrom;
      if (!options.loop) break;
      currentFrom = startLoop;
    }
  }
  function scheduleSlice(next: number, currentFrom: number, end: number) {
    for (const { t, b } of loaded) {
      const tr = latest.tracks.find((x) => x.id === t.id);
      if (!tr) continue;
      const n = scheduleClip(
        c,
        tr,
        b,
        channels.get(t.id)!,
        next,
        currentFrom,
        end,
      );
      if (n) {
        nodes.add(n);
        n.addEventListener('ended', () => nodes.delete(n));
      }
    }
    if (options.metronome) {
      const beat = 60 / data.bpm;
      for (
        let pos = Math.ceil(currentFrom / beat) * beat;
        pos < end;
        pos += beat
      ) {
        const o = c.createOscillator(),
          g = c.createGain();
        o.frequency.value = Math.round(pos / beat) % 4 === 0 ? 1200 : 800;
        g.gain.setValueAtTime(0.05, next + pos - currentFrom);
        g.gain.exponentialRampToValueAtTime(
          0.0001,
          next + pos - currentFrom + 0.045,
        );
        o.connect(g).connect(master);
        clicks.add(o);
        o.onended = () => {
          clicks.delete(o);
          o.disconnect();
          g.disconnect();
        };
        o.start(next + pos - currentFrom);
        o.stop(next + pos - currentFrom + 0.05);
      }
    }
  }
  schedule();
  const timer = setInterval(() => {
    if (options.loop) schedule();
    else if (
      c.currentTime >=
      firstWhen +
        (options.recordingLoop
          ? (options.recordingLoop.preRollFrames +
              options.recordingLoop.frames * options.recordingLoop.passes) /
            c.sampleRate
          : duration - initialFrom) +
        1.8
    ) {
      stop();
      onEnd?.();
    }
  }, 80);
  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    for (const n of nodes)
      try {
        n.stop();
      } catch {}
    nodes.clear();
    for (const click of clicks) {
      try {
        click.stop();
      } catch {}
    }
    clicks.clear();
    options.signal?.removeEventListener('abort', stop);
    channels.forEach((ch) => ch.dispose());
    routing.dispose();
    releaseOutput?.();
    master.disconnect();
    masterMeter.dispose();
  }
  options.signal?.addEventListener('abort', stop, { once: true });
  return {
    duration,
    audioStartTime: firstWhen,
    audioStartFrame: Math.round(firstWhen * c.sampleRate),
    start: performance.now(),
    stop,
    position: () => {
      const elapsed = Math.max(0, c.currentTime - firstWhen);
      return options.loop && elapsed >= end - initialFrom
        ? startLoop + ((elapsed - (end - initialFrom)) % (end - startLoop))
        : Math.min(duration, initialFrom + elapsed);
    },
    update: (d: Arrangement) => {
      latest = d;
      routing.update(d);
      channels.forEach((ch, id) => {
        const t = d.tracks.find((x) => x.id === id);
        if (t) ch.update({ ...t, muted: !audibleTrack(d, t) }, false);
        else ch.update({ ...defaults(), muted: true });
      });
    },
    level: () => {
      return masterMeter.level();
    },
    levels: () => ({
      ...Object.fromEntries([...channels].map(([id, ch]) => [id, ch.level()])),
      ...routing.levels(),
    }),
  };
}
export async function renderBuffer(data: Arrangement) {
  const loaded = await loadArrangementBuffers(
    { ...data, tracks: data.tracks.filter((t) => audibleTrack(data, t)) },
    { sampleRate: 44100, revalidate: true },
  );
  if (!loaded.length) throw new Error('Add or unmute a track first.');
  const duration = Math.min(
      300,
      Math.max(
        ...loaded.map(
          ({ t, b }) => t.offset + b.duration - t.trimStart - t.trimEnd,
        ),
      ) + 1.8,
    ),
    c = new OfflineAudioContext(2, Math.ceil(duration * 44100), 44100),
    master = c.createDynamicsCompressor();
  master.threshold.value = -1;
  master.ratio.value = 20;
  master.connect(c.destination);
  const routing = routingGraph(c, data, master);
  const channels = loaded.map(({ t, b }) => {
    const input = channel(c, t, routing.inputs.get(t.id)!, false, data.bpm);
    scheduleClip(c, t, b, input, 0, 0, duration);
    return input;
  });
  try {
    return await c.startRendering();
  } finally {
    channels.forEach((ch) => ch.dispose());
    routing.dispose();
    master.disconnect();
  }
}
export async function renderMix(data: Arrangement) {
  return wav(await renderBuffer(data));
}
export function wav(b: AudioBuffer) {
  const n = b.length,
    buffer = new ArrayBuffer(44 + n * 4),
    v = new DataView(buffer);
  const word = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  word(0, 'RIFF');
  v.setUint32(4, 36 + n * 4, true);
  word(8, 'WAVE');
  word(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, b.sampleRate, true);
  v.setUint32(28, b.sampleRate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  word(36, 'data');
  v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++)
    for (let ch = 0; ch < 2; ch++) {
      const x = Math.max(
        -1,
        Math.min(1, b.getChannelData(Math.min(ch, b.numberOfChannels - 1))[i]),
      );
      v.setInt16(44 + i * 4 + ch * 2, x < 0 ? x * 32768 : x * 32767, true);
    }
  return new Blob([buffer], { type: 'audio/wav' });
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function midiFile(notes: Note[], bpm: number) {
  const events: { tick: number; bytes: number[] }[] = [];
  for (const n of notes) {
    events.push(
      {
        tick: Math.round(n.start * 480),
        bytes: [
          0x90,
          n.pitch,
          Math.max(1, Math.min(127, Math.round(n.velocity * 127))),
        ],
      },
      {
        tick: Math.round((n.start + n.length) * 480),
        bytes: [0x80, n.pitch, 0],
      },
    );
  }
  events.sort((a, b) => a.tick - b.tick || a.bytes[0] - b.bytes[0]);
  const tempo = Math.round(60000000 / bpm),
    track = [
      0,
      255,
      81,
      3,
      (tempo >> 16) & 255,
      (tempo >> 8) & 255,
      tempo & 255,
    ];
  let last = 0;
  for (const e of events) {
    let n = e.tick - last,
      vl = [n & 127];
    while ((n >>= 7)) vl.unshift((n & 127) | 128);
    track.push(...vl, ...e.bytes);
    last = e.tick;
  }
  track.push(0, 255, 47, 0);
  const len = track.length;
  return new Blob(
    [
      new Uint8Array([
        77,
        84,
        104,
        100,
        0,
        0,
        0,
        6,
        0,
        0,
        0,
        1,
        1,
        224,
        77,
        84,
        114,
        107,
        (len >>> 24) & 255,
        (len >>> 16) & 255,
        (len >>> 8) & 255,
        len & 255,
        ...track,
      ]),
    ],
    { type: 'audio/midi' },
  );
}
