import type { Arrangement, MixerTrack } from './audio';
import type { RecordedTake } from './recording';
import { encodeWave, type Samples } from './audio-files';
import { sameProject } from './project-merge';

export function checkPunchTarget(data: Arrangement, target: MixerTrack) {
  if (
    target.sample ||
    target.notes ||
    target.sequence ||
    target.drumPattern ||
    target.demo
  )
    throw new Error('Choose a recorded audio clip for vocal punch-in.');
  const current = data.tracks.find((t) => t.id === target.id);
  if (
    !current ||
    !sameProject(
      { title: '', data: { bpm: 92, tracks: [current] } },
      { title: '', data: { bpm: 92, tracks: [target] } },
    )
  )
    throw new Error(
      'This clip changed while the punch was being prepared. Your recording is kept; reopen the selected clip to try again.',
    );
}
export async function punchSeed(
  target: MixerTrack,
  audio: Samples,
  signal?: AbortSignal,
) {
  const seconds = audio.length / audio.sampleRate;
  if (
    !target.fileId ||
    target.sample ||
    target.notes ||
    target.sequence ||
    target.drumPattern ||
    target.demo ||
    target.trimStart ||
    target.trimEnd ||
    audio.numberOfChannels !== 1 ||
    seconds < 0.1 ||
    seconds > 120 ||
    !Number.isFinite(target.offset) ||
    target.offset < 0 ||
    target.offset + seconds > 300 + 1 / audio.sampleRate
  )
    throw new Error(
      'Punch-in currently supports an untrimmed mono audio clip from 0.1 to 120 seconds long. Import that vocal as its own clip to use punch-in.',
    );
  const encoded = await encodeWave(audio, 32, { channels: 1, signal });
  return {
    blob: encoded.blob,
    seconds,
    offset: target.offset,
    peak: encoded.peak,
    sampleRate: audio.sampleRate,
    depth: 32 as const,
    name: target.name + ' · original',
  };
}
export function punchBacking(
  data: Arrangement,
  target: MixerTrack,
): Arrangement {
  // Retaining the muted channel also retains the existing solo selection.
  return {
    ...structuredClone(data),
    tracks: data.tracks.map((t) =>
      structuredClone(t.id === target.id ? { ...t, muted: true } : t),
    ),
  };
}
export function applyPunchClip(
  data: Arrangement,
  target: MixerTrack,
  seed: RecordedTake,
  take: RecordedTake,
  fileId: string,
  peaks: number[],
): Arrangement {
  checkPunchTarget(data, target);
  if (
    take.offset !== seed.offset ||
    take.sampleRate !== seed.sampleRate ||
    Math.round(take.seconds * take.sampleRate) !==
      Math.round(seed.seconds * seed.sampleRate)
  )
    throw new Error(
      'The finished vocal must keep the original clip’s position and length. Your original clip is unchanged.',
    );
  return {
    ...data,
    tracks: data.tracks.map((t) =>
      t.id === target.id ? { ...t, fileId, duration: take.seconds, peaks } : t,
    ),
  };
}
