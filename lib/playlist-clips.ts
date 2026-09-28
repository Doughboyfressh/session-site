import type { Arrangement, ClipPlacement, MixerTrack } from './audio';

export const PRIMARY_CLIP_ID = '$primary';
export const MAX_CLIPS_PER_TRACK = 32;
export const MAX_CLIPS_PER_PROJECT = 256;
export const MIN_PLAYLIST_CLIP = 0.01;

export type PlaylistClip = ClipPlacement & { primary: boolean };

function sourceDuration(track: MixerTrack, duration = track.duration) {
  if (!Number.isFinite(duration) || !duration)
    throw new Error('Wait for this clip’s audio to finish loading.');
  if (duration > 300)
    throw new Error('Use source audio up to five minutes long.');
  return duration;
}

export function playlistClips(track: MixerTrack): PlaylistClip[] {
  return [
    {
      id: PRIMARY_CLIP_ID,
      name: track.clipName || track.name,
      offset: track.offset,
      trimStart: track.trimStart,
      trimEnd: track.trimEnd,
      ...(track.fadeIn === undefined ? {} : { fadeIn: track.fadeIn }),
      ...(track.fadeOut === undefined ? {} : { fadeOut: track.fadeOut }),
      ...(track.fadeStart === undefined ? {} : { fadeStart: track.fadeStart }),
      ...(track.fadeEnd === undefined ? {} : { fadeEnd: track.fadeEnd }),
      primary: true,
    },
    ...(track.clips || []).map((clip) => ({ ...clip, primary: false })),
  ];
}

export function playlistClip(track: MixerTrack, clipId = PRIMARY_CLIP_ID) {
  const clip = playlistClips(track).find((item) => item.id === clipId);
  if (!clip) throw new Error('Select an available clip.');
  return clip;
}

export function playlistClipLength(
  track: MixerTrack,
  clipId = PRIMARY_CLIP_ID,
  duration = track.duration,
) {
  const clip = playlistClip(track, clipId);
  const length =
    sourceDuration(track, duration) - clip.trimStart - clip.trimEnd;
  if (!Number.isFinite(length) || length < MIN_PLAYLIST_CLIP - 1e-8)
    throw new Error('The clip must contain at least 0.01 seconds of audio.');
  return length;
}

export function trackForPlaylistClip(
  track: MixerTrack,
  clip: PlaylistClip | ClipPlacement,
): MixerTrack {
  return {
    ...track,
    offset: clip.offset,
    trimStart: clip.trimStart,
    trimEnd: clip.trimEnd,
    fadeIn: clip.fadeIn,
    fadeOut: clip.fadeOut,
    fadeStart: clip.fadeStart,
    fadeEnd: clip.fadeEnd,
  };
}

export function playlistTrackViews(track: MixerTrack) {
  return playlistClips(track).map((clip) => trackForPlaylistClip(track, clip));
}

function storedClip(clip: ClipPlacement): ClipPlacement {
  return {
    id: clip.id,
    name: clip.name,
    offset: clip.offset,
    trimStart: clip.trimStart,
    trimEnd: clip.trimEnd,
    ...(clip.fadeIn === undefined ? {} : { fadeIn: clip.fadeIn }),
    ...(clip.fadeOut === undefined ? {} : { fadeOut: clip.fadeOut }),
    ...(clip.fadeStart === undefined ? {} : { fadeStart: clip.fadeStart }),
    ...(clip.fadeEnd === undefined ? {} : { fadeEnd: clip.fadeEnd }),
  };
}

export function playlistTrackEnd(
  track: MixerTrack,
  duration = track.duration || 20,
) {
  return Math.max(
    ...playlistClips(track).map(
      (clip) => clip.offset + duration - clip.trimStart - clip.trimEnd,
    ),
  );
}

export function playlistClipCount(data: Arrangement) {
  return data.tracks.reduce(
    (total, track) => total + playlistClips(track).length,
    0,
  );
}

function ensureCapacity(data: Arrangement, track: MixerTrack, added: number) {
  if (playlistClips(track).length + added > MAX_CLIPS_PER_TRACK)
    throw new Error(`Use up to ${MAX_CLIPS_PER_TRACK} clips on one channel.`);
  if (playlistClipCount(data) + added > MAX_CLIPS_PER_PROJECT)
    throw new Error(`Use up to ${MAX_CLIPS_PER_PROJECT} clips in one project.`);
}

function ensureNewIds(data: Arrangement, ids: string[]) {
  if (
    ids.some(
      (id) =>
        !id ||
        id.length > 128 ||
        id === PRIMARY_CLIP_ID ||
        data.tracks.some(
          (track) =>
            track.id === id ||
            (track.clips || []).some((clip) => clip.id === id),
        ),
    ) ||
    new Set(ids).size !== ids.length
  )
    throw new Error('Create clips with unique identities.');
}

function updateTrackClip(
  track: MixerTrack,
  clipId: string,
  update: (clip: PlaylistClip) => ClipPlacement,
) {
  const current = playlistClip(track, clipId);
  const next = update(current);
  if (current.primary) {
    const {
      name,
      offset,
      trimStart,
      trimEnd,
      fadeIn,
      fadeOut,
      fadeStart,
      fadeEnd,
    } = next;
    return {
      ...track,
      clipName: name,
      offset,
      trimStart,
      trimEnd,
      fadeIn,
      fadeOut,
      fadeStart,
      fadeEnd,
    };
  }
  return {
    ...track,
    clips: (track.clips || []).map((clip) =>
      clip.id === clipId ? storedClip(next) : clip,
    ),
  };
}

function updateArrangementTrack(
  data: Arrangement,
  trackId: string,
  update: (track: MixerTrack) => MixerTrack,
) {
  if (!data.tracks.some((track) => track.id === trackId))
    throw new Error('Select an available channel.');
  return {
    ...data,
    tracks: data.tracks.map((track) =>
      track.id === trackId ? update(track) : track,
    ),
  };
}

export function patchPlaylistClip(
  data: Arrangement,
  trackId: string,
  clipId: string,
  patch: Partial<Omit<ClipPlacement, 'id'>>,
) {
  return updateArrangementTrack(data, trackId, (track) =>
    updateTrackClip(track, clipId, (clip) => ({
      ...clip,
      ...patch,
      id: clip.id,
      name: String(patch.name ?? clip.name).slice(0, 100),
    })),
  );
}

export function movePlaylistClip(
  data: Arrangement,
  trackId: string,
  clipId: string,
  offset: number,
) {
  const track = data.tracks.find((item) => item.id === trackId);
  if (!track) throw new Error('Select an available channel.');
  const length = playlistClipLength(track, clipId);
  if (!Number.isFinite(offset) || offset < 0 || offset + length > 300 + 1e-8)
    throw new Error('Keep the entire clip within the five-minute timeline.');
  return patchPlaylistClip(data, trackId, clipId, {
    offset: Math.min(offset, 300 - length),
  });
}

export function trimPlaylistClip(
  data: Arrangement,
  trackId: string,
  clipId: string,
  key: 'trimStart' | 'trimEnd',
  value: number,
) {
  const track = data.tracks.find((item) => item.id === trackId);
  if (!track) throw new Error('Select an available channel.');
  const clip = playlistClip(track, clipId),
    duration = sourceDuration(track),
    other = key === 'trimStart' ? 'trimEnd' : 'trimStart',
    min = Math.max(0, duration + clip.offset - clip[other] - 300),
    max = Math.max(min, duration - clip[other] - MIN_PLAYLIST_CLIP),
    next = Math.max(min, Math.min(max, value));
  if (!Number.isFinite(value)) throw new Error('Choose a valid trim amount.');
  const candidate = { ...clip, [key]: next };
  if (
    duration - candidate.trimStart - candidate.trimEnd <
    MIN_PLAYLIST_CLIP - 1e-8
  )
    throw new Error('The clip must contain at least 0.01 seconds of audio.');
  return patchPlaylistClip(data, trackId, clipId, { [key]: next });
}

export function duplicatePlaylistClip(
  data: Arrangement,
  trackId: string,
  clipId: string,
  newId: string,
) {
  const track = data.tracks.find((item) => item.id === trackId);
  if (!track) throw new Error('Select an available channel.');
  ensureCapacity(data, track, 1);
  ensureNewIds(data, [newId]);
  const source = playlistClip(track, clipId),
    length = playlistClipLength(track, clipId),
    offset = source.offset + length;
  if (offset + length > 300 + 1e-8)
    throw new Error('The copy would extend beyond the five-minute timeline.');
  const copy: ClipPlacement = {
    ...storedClip(source),
    id: newId,
    name: (source.name || track.name).slice(0, 95) + ' copy',
    offset,
  };
  return updateArrangementTrack(data, trackId, (current) => ({
    ...current,
    clips: [...(current.clips || []), copy],
  }));
}

export function repeatPlaylistClip(
  data: Arrangement,
  trackId: string,
  clipId: string,
  copies: number,
  newIds: string[],
) {
  if (
    !Number.isInteger(copies) ||
    copies < 2 ||
    copies > 8 ||
    newIds.length !== copies
  )
    throw new Error('Repeat a clip two to eight times.');
  const track = data.tracks.find((item) => item.id === trackId);
  if (!track) throw new Error('Select an available channel.');
  ensureCapacity(data, track, copies);
  ensureNewIds(data, newIds);
  const source = playlistClip(track, clipId),
    length = playlistClipLength(track, clipId);
  if (source.offset + length * (copies + 1) > 300 + 1e-8)
    throw new Error(
      'These repeats would extend beyond the five-minute timeline.',
    );
  const repeated = newIds.map((id, index) => {
    const copy: ClipPlacement = {
      ...storedClip(source),
      id,
      name: `${(source.name || track.name).slice(0, 93)} · ${index + 2}`,
      offset: source.offset + length * (index + 1),
    };
    return copy;
  });
  return updateArrangementTrack(data, trackId, (current) => ({
    ...current,
    clips: [...(current.clips || []), ...repeated],
  }));
}

export function splitPlaylistClip(
  data: Arrangement,
  trackId: string,
  clipId: string,
  at: number,
  newId: string,
) {
  const track = data.tracks.find((item) => item.id === trackId);
  if (!track) throw new Error('Select an available channel.');
  ensureCapacity(data, track, 1);
  ensureNewIds(data, [newId]);
  const source = playlistClip(track, clipId),
    length = playlistClipLength(track, clipId),
    leftLength = at - source.offset;
  if (
    !Number.isFinite(at) ||
    leftLength < MIN_PLAYLIST_CLIP - 1e-8 ||
    length - leftLength < MIN_PLAYLIST_CLIP - 1e-8
  )
    throw new Error(
      'Place the playhead inside the selected clip, at least 0.01 seconds from either edge.',
    );
  const shared = {
      ...storedClip(source),
      fadeStart: source.fadeStart ?? source.trimStart,
      fadeEnd: source.fadeEnd ?? sourceDuration(track) - source.trimEnd,
    },
    left: ClipPlacement = {
      ...shared,
      trimEnd: source.trimEnd + length - leftLength,
    },
    right: ClipPlacement = {
      ...shared,
      id: newId,
      name: (source.name || track.name).slice(0, 89) + ' · split',
      offset: at,
      trimStart: source.trimStart + leftLength,
    };
  return updateArrangementTrack(data, trackId, (current) => {
    const updated = updateTrackClip(current, clipId, () => left);
    return { ...updated, clips: [...(updated.clips || []), right] };
  });
}

export function removePlaylistClip(
  data: Arrangement,
  trackId: string,
  clipId: string,
) {
  if (clipId === PRIMARY_CLIP_ID)
    throw new Error(
      'Use the track trash button to remove the primary clip and channel.',
    );
  return updateArrangementTrack(data, trackId, (track) => {
    if (!(track.clips || []).some((clip) => clip.id === clipId))
      throw new Error('Select an available clip.');
    const clips = (track.clips || []).filter((clip) => clip.id !== clipId);
    return { ...track, ...(clips.length ? { clips } : { clips: undefined }) };
  });
}
