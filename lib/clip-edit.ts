import type { Arrangement, MixerTrack } from './audio';

export type ClipGrid = 'off' | 'bar' | 'beat' | 'half' | 'quarter';
export const MIN_CLIP = 0.01;
export function clipLength(track: MixerTrack) {
  if (!Number.isFinite(track.duration) || !track.duration)
    throw new Error('Wait for this clip’s audio to finish loading.');
  if (track.duration > 300)
    throw new Error('Use source audio up to five minutes long.');
  const length = track.duration - track.trimStart - track.trimEnd;
  if (!Number.isFinite(length) || length < MIN_CLIP - 1e-8)
    throw new Error('The clip must contain at least 0.01 seconds of audio.');
  return length;
}
export function gridSeconds(grid: ClipGrid, bpm: number) {
  const beats = { off: 0, bar: 4, beat: 1, half: 0.5, quarter: 0.25 }[grid];
  return (beats * 60) / bpm;
}
export function snapTime(time: number, grid: ClipGrid, bpm: number) {
  if (!Number.isFinite(time) || !Number.isFinite(bpm) || bpm < 40 || bpm > 240)
    throw new Error('Choose a valid timeline position and tempo.');
  const step = gridSeconds(grid, bpm);
  return Math.max(
    0,
    Math.min(300, step ? Math.round(time / step) * step : time),
  );
}
export function moveClip(track: MixerTrack, offset: number): MixerTrack {
  const length = clipLength(track);
  if (!Number.isFinite(offset) || offset < 0 || offset + length > 300 + 1e-8)
    throw new Error('Keep the entire clip within the five-minute timeline.');
  // Automation points deliberately stay at their project times, like the automation editor.
  return { ...track, offset: Math.min(offset, 300 - length) };
}
export function splitClip(
  data: Arrangement,
  id: string,
  at: number,
  newId: string,
): Arrangement {
  if (data.tracks.length >= 48)
    throw new Error(
      'Splitting needs a free track. This session has reached the track limit.',
    );
  const index = data.tracks.findIndex((t) => t.id === id);
  if (index < 0 || data.tracks.some((t) => t.id === newId))
    throw new Error('Select a clip to split.');
  const track = data.tracks[index],
    length = clipLength(track),
    leftLength = at - track.offset;
  if (track.offset < 0 || track.offset + length > 300 + 1e-8)
    throw new Error(
      'Move or trim the clip within the five-minute timeline before splitting.',
    );
  if (
    !Number.isFinite(at) ||
    leftLength < MIN_CLIP - 1e-8 ||
    length - leftLength < MIN_CLIP - 1e-8
  )
    throw new Error(
      'Place the playhead inside the clip, at least 0.01 seconds from either edge.',
    );
  const shared = {
    ...structuredClone(track),
    splitFrom: track.splitFrom || track.id,
    // Source coordinates preserve a continuous fade through any number of cuts.
    fadeStart: track.fadeStart ?? track.trimStart,
    fadeEnd: track.fadeEnd ?? track.duration! - track.trimEnd,
  };
  const left = { ...shared, trimEnd: track.trimEnd + length - leftLength };
  const right = {
    ...structuredClone(shared),
    id: newId,
    name: track.name.slice(0, 89) + ' · split',
    offset: at,
    trimStart: track.trimStart + leftLength,
  };
  return {
    ...data,
    tracks: [
      ...data.tracks.slice(0, index),
      left,
      right,
      ...data.tracks.slice(index + 1),
    ],
  };
}
export function duplicateClip(
  data: Arrangement,
  id: string,
  newId: string,
): Arrangement {
  if (data.tracks.length >= 48)
    throw new Error('This session has reached the track limit.');
  const track = data.tracks.find((t) => t.id === id);
  if (!track || data.tracks.some((t) => t.id === newId))
    throw new Error('Select a clip to duplicate.');
  const copy = moveClip(
    structuredClone(track),
    track.offset + clipLength(track),
  );
  delete copy.splitFrom;
  copy.id = newId;
  copy.name = track.name.slice(0, 94) + ' copy';
  return { ...data, tracks: [...data.tracks, copy] };
}
