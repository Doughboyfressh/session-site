import { defaultPattern, type Track } from './catalog';
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
  sound?: 'keys' | 'bass' | 'pad';
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
  automation?: AutomationPoint[];
};
export type Arrangement = { bpm: number; tracks: MixerTrack[] };
export type TransportOptions = {
  from?: number;
  loop?: boolean;
  loopStart?: number;
  loopEnd?: number;
  metronome?: boolean;
  audioContext?: AudioContext;
  startDelay?: number;
  allowPastEnd?: boolean;
  signal?: AbortSignal;
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
  const oscillator = c.createOscillator(),
    gain = c.createGain(),
    filter = c.createBiquadFilter();
  oscillator.type =
    sound === 'bass' ? 'sawtooth' : sound === 'pad' ? 'triangle' : 'sine';
  oscillator.frequency.value = 440 * Math.pow(2, (pitch - 69) / 12);
  filter.type = 'lowpass';
  filter.frequency.value =
    sound === 'bass' ? 650 : sound === 'pad' ? 1800 : 8000;
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(
    velocity * 0.2,
    time + (sound === 'pad' ? 0.08 : 0.008),
  );
  gain.gain.setTargetAtTime(velocity * 0.13, time + 0.09, 0.2);
  gain.gain.setTargetAtTime(0.00001, time + Math.max(0.1, length - 0.04), 0.04);
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
    const roots =
      demo === 'demo-1'
        ? [41, 37, 44, 39]
        : demo === 'demo-3'
          ? [38, 36, 41, 36]
          : demo === 'demo-4'
            ? [33, 36, 38, 36]
            : [36, 39, 34, 37];
    for (let bar = 0; bar < 8; bar++) {
      const at = bar * 16 * step,
        root = roots[bar % 4];
      for (const interval of [12, 15, 19, 24])
        playNote(c, master, root + interval, at, 16 * step, 0.22, 'pad');
      for (let beat = 0; beat < 4; beat++)
        playNote(c, master, root, at + beat * 4 * step, 3 * step, 0.6, 'bass');
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
  const key =
    (t.fileId ||
      `${t.demo || 'seq'}-${bpm}-${t.sound}-${JSON.stringify(t.notes ?? t.sequence ?? [])}`) +
    ':' +
    (options.sampleRate || 'playback');
  const cached = cache.get(key);
  if (cached && !(t.fileId && options.revalidate)) return cached;
  let b: AudioBuffer;
  if (t.fileId) {
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
export function channel(c: BaseAudioContext, t: MixerTrack, dest: AudioNode) {
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
  input
    .connect(eqs[0])
    .connect(eqs[1])
    .connect(eqs[2])
    .connect(pan)
    .connect(gain)
    .connect(auto)
    .connect(dest);
  let compressor = c.createDynamicsCompressor();
  const convolver = c.createConvolver(),
    wet = c.createGain(),
    delay = c.createDelay(1),
    feedback = c.createGain(),
    echo = c.createGain();
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
  convolver.buffer = impulse;
  auto.connect(convolver).connect(wet).connect(dest);
  auto.connect(delay);
  delay.delayTime.value = 0.25;
  feedback.gain.value = 0.28;
  delay.connect(feedback).connect(delay);
  delay.connect(echo).connect(dest);
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
        eqs[2].connect(compressor).connect(pan);
      } else eqs[2].connect(pan);
      compressionEnabled = enableCompression;
    }
    compressor.threshold.value = next.compression
      ? -12 - (next.compression || 0) * 24
      : 0;
    compressor.ratio.value = next.compression ? 2 + next.compression * 8 : 1;
    set(wet.gain, next.reverb || 0, 0.02);
    set(echo.gain, next.delay || 0, 0.02);
  };
  update(t, false, true);
  return {
    input,
    auto,
    update,
    dispose: () => {
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
      ].forEach((n) => n.disconnect());
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
  ch: { input: AudioNode; auto: GainNode },
  when: number,
  from: number,
  to: number,
  automationDelay = 0,
) {
  const end = t.offset + b.duration - t.trimStart - t.trimEnd,
    first = Math.max(from, t.offset),
    last = Math.min(to, end);
  if (last <= first) return null;
  const source = c.createBufferSource(),
    fade = c.createGain(),
    fadeOut = c.createGain();
  source.buffer = b;
  source.connect(fade).connect(fadeOut).connect(ch.input);
  const at = when + first - from,
    dur = last - first,
    relative = first - t.offset;
  fade.gain.setValueAtTime(t.fadeIn ? Math.min(1, relative / t.fadeIn) : 1, at);
  if (t.fadeIn && relative < t.fadeIn)
    fade.gain.linearRampToValueAtTime(
      Math.min(1, (last - t.offset) / t.fadeIn),
      Math.min(at + dur, at + t.fadeIn - relative),
    );
  if (t.fadeOut) {
    const start = end - t.fadeOut;
    if (start < last) {
      fadeOut.gain.setValueAtTime(
        Math.min(1, Math.max(0, (end - first) / t.fadeOut)),
        Math.max(at, when + start - from),
      );
      fadeOut.gain.linearRampToValueAtTime(
        Math.max(0, (end - last) / t.fadeOut),
        at + dur,
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
  source.start(at, t.trimStart + relative, dur);
  source.onended = () => {
    source.disconnect();
    fade.disconnect();
    fadeOut.disconnect();
  };
  return source;
}
export async function playMix(
  data: Arrangement,
  onEnd?: () => void,
  options: TransportOptions = {},
) {
  const c = options.audioContext || context();
  await c.resume();
  if (options.signal?.aborted)
    throw new DOMException('Playback cancelled.', 'AbortError');
  if (!data.tracks.length) throw new Error('Add a track to play.');
  const loaded = await Promise.all(
    data.tracks.map(async (t) => ({
      t,
      b: await bufferFor(t, data.bpm, { signal: options.signal }),
    })),
  );
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
  const analyser = c.createAnalyser();
  analyser.fftSize = 256;
  master.connect(analyser);
  const channels = new Map(
    loaded.map(({ t }) => [
      t.id,
      channel(
        c,
        {
          ...t,
          muted: t.muted || (data.tracks.some((x) => x.solo) && !t.solo),
        },
        master,
      ),
    ]),
  );
  channels.forEach((ch, id) =>
    ch.update(
      data.tracks.find((t) => t.id === id)!,
      data.tracks.some((t) => t.solo),
    ),
  );
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
    if (currentFrom >= end) return;
    while (!options.loop || next < c.currentTime + 0.4) {
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
      next += end - currentFrom;
      if (!options.loop) break;
      currentFrom = startLoop;
    }
  }
  schedule();
  const timer = setInterval(() => {
    if (options.loop) schedule();
    else if (c.currentTime >= firstWhen + duration - initialFrom + 1.8) {
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
    master.disconnect();
    analyser.disconnect();
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
      channels.forEach((ch, id) => {
        const t = d.tracks.find((x) => x.id === id);
        if (t)
          ch.update(
            t,
            d.tracks.some((x) => x.solo),
          );
        else ch.update({ ...defaults(), muted: true });
      });
    },
    level: () => {
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      return Math.max(...samples.map(Math.abs));
    },
  };
}
export async function renderBuffer(data: Arrangement) {
  const loaded = await Promise.all(
    data.tracks
      .filter((t) => !t.muted && (!data.tracks.some((x) => x.solo) || t.solo))
      .map(async (t) => ({ t, b: await bufferFor(t, data.bpm) })),
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
  for (const { t, b } of loaded)
    scheduleClip(c, t, b, channel(c, t, master), 0, 0, duration);
  return c.startRendering();
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
        bytes: [0x90, n.pitch, Math.round(n.velocity * 126) + 1],
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
