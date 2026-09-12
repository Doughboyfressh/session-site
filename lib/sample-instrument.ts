export type SampleSettings = {
  rootPitch: number;
  start: number;
  end: number;
  attack: number;
  release: number;
  name?: string;
};
export function sampleSettings(input: unknown): SampleSettings {
  const value = input as SampleSettings | undefined;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Number.isInteger(value.rootPitch) ||
    value.rootPitch < 0 ||
    value.rootPitch > 127 ||
    ![value.start, value.end, value.attack, value.release].every(
      Number.isFinite,
    ) ||
    value.start < 0 ||
    value.end > 30 ||
    value.end - value.start < 0.01 - 1e-12 ||
    value.attack < 0 ||
    value.attack > 2 ||
    value.release < 0 ||
    value.release > 0.5 ||
    (value.name !== undefined &&
      (typeof value.name !== 'string' ||
        !value.name.trim() ||
        value.name.length > 100))
  )
    throw new Error(
      'Use a sample region of at least 0.01 seconds within 30 seconds, a MIDI root note from 0–127, attack up to 2 seconds and release up to 0.5 seconds.',
    );
  return {
    rootPitch: value.rootPitch,
    start: value.start,
    end: value.end,
    attack: value.attack,
    release: value.release,
    ...(value.name !== undefined ? { name: value.name } : {}),
  };
}
export function checkSampleBuffer(
  buffer: AudioBuffer,
  settings?: SampleSettings,
) {
  if (
    ![1, 2].includes(buffer.numberOfChannels) ||
    !Number.isFinite(buffer.duration) ||
    buffer.duration < 0.01 ||
    buffer.duration > 30 + 1 / buffer.sampleRate ||
    buffer.length * buffer.numberOfChannels * 4 > 32 * 1024 * 1024
  )
    throw new Error(
      'Choose a mono or stereo sample from 0.01 to 30 seconds long.',
    );
  if (
    settings &&
    sampleSettings(settings).end > buffer.duration + 1 / buffer.sampleRate
  )
    throw new Error(
      'The sample region ends after the audio file. Shorten its end time.',
    );
}
export function defaultSample(duration: number): SampleSettings {
  if (
    !Number.isFinite(duration) ||
    duration < 0.01 ||
    duration > 30 + 1 / 44100
  )
    throw new Error('Choose a sample from 0.01 to 30 seconds long.');
  return sampleSettings({
    rootPitch: 60,
    start: 0,
    end: Math.min(30, Math.floor(duration * 1000) / 1000),
    attack: 0.005,
    release: 0.08,
  });
}
export function sampleTiming(
  settings: SampleSettings,
  pitch: number,
  length: number,
) {
  sampleSettings(settings);
  if (
    !Number.isInteger(pitch) ||
    pitch < 0 ||
    pitch > 127 ||
    !Number.isFinite(length) ||
    length <= 0 ||
    length > 300
  )
    throw new Error('Choose a valid sample note and duration.');
  const rate = 2 ** ((pitch - settings.rootPitch) / 12);
  const available = (settings.end - settings.start) / rate;
  const naturalReleaseAt =
    available - Math.min(settings.release, available / 2);
  const releaseAt = Math.min(length, naturalReleaseAt);
  const duration =
    length < naturalReleaseAt
      ? Math.min(length + settings.release, available)
      : available;
  return {
    rate,
    duration,
    releaseAt,
    attack: Math.min(settings.attack, releaseAt),
    peakFactor: settings.attack ? Math.min(1, releaseAt / settings.attack) : 1,
  };
}

/** One-shot, note-gated sample. Pitch changes playback speed; it does not time-stretch. */
export function playSample(
  c: BaseAudioContext,
  dest: AudioNode,
  buffer: AudioBuffer,
  settings: SampleSettings,
  pitch: number,
  time: number,
  length: number,
  velocity = 0.75,
  onEnded?: () => void,
) {
  checkSampleBuffer(buffer, settings);
  const timing = sampleTiming(settings, pitch, length);
  if (
    !Number.isFinite(time) ||
    time < 0 ||
    !Number.isFinite(velocity) ||
    velocity < 0 ||
    velocity > 1
  )
    throw new Error('Invalid sample playback settings.');
  const source = c.createBufferSource(),
    gain = c.createGain();
  source.buffer = buffer;
  source.playbackRate.setValueAtTime(timing.rate, time);
  const level = velocity * 0.5 * timing.peakFactor;
  gain.gain.setValueAtTime(timing.attack ? 0 : level, time);
  gain.gain.linearRampToValueAtTime(level, time + timing.attack);
  gain.gain.setValueAtTime(level, time + timing.releaseAt);
  gain.gain.linearRampToValueAtTime(0, time + timing.duration);
  source.connect(gain).connect(dest);
  let ended = false,
    released = false;
  const stop = () => {
    if (ended) return;
    ended = true;
    source.onended = null;
    try {
      source.stop();
    } catch {}
    source.disconnect();
    gain.disconnect();
    onEnded?.();
  };
  source.onended = stop;
  source.start(time, settings.start, settings.end - settings.start);
  source.stop(time + timing.duration);
  return {
    source,
    stop,
    release: () => {
      if (ended || released) return;
      released = true;
      const at = Math.max(time, c.currentTime);
      if (at >= time + timing.releaseAt) return;
      gain.gain.cancelAndHoldAtTime(at);
      const end = Math.min(time + timing.duration, at + settings.release);
      gain.gain.linearRampToValueAtTime(0, end);
      source.stop(end);
    },
  };
}
