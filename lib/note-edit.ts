import type { Arrangement, MixerTrack, Note } from './audio';
import { validateArrangement } from './arrangement-validation';
import { playlistClips } from './playlist-clips';

export type NoteEdit =
  | { kind: 'move'; beats: number }
  | { kind: 'drag'; beats: number; semitones: number }
  | { kind: 'resize'; beats: number }
  | { kind: 'transpose'; semitones: number }
  | { kind: 'duplicate'; beats: number }
  | { kind: 'quantize'; grid: number }
  | { kind: 'length'; beats: number }
  | { kind: 'velocity'; value: number }
  | { kind: 'delete' };

export function noteTimingLocked(track: MixerTrack) {
  return (
    !!track.splitFrom ||
    playlistClips(track).some(
      (clip) =>
        !!clip.trimStart ||
        (!!clip.trimEnd && !(track.noteLoopBeats && clip.trimEnd === 0.5)),
    )
  );
}

export function applyNotePatch(
  data: Arrangement,
  originalBpm: number,
  original: MixerTrack,
  patch: Partial<MixerTrack>,
): Arrangement {
  const current = data.tracks.find((t) => t.id === original.id);
  const signature = (t: MixerTrack) =>
    JSON.stringify([
      t.notes,
      t.noteLoopBeats,
      t.sound,
      t.plugin,
      t.sample,
      t.offset,
      t.trimStart,
      t.trimEnd,
      t.splitFrom,
      t.clipName,
      t.clips,
      t.fileId,
      t.sequence,
      t.drumPattern,
      t.demo,
    ]);
  if (
    !current ||
    data.bpm !== originalBpm ||
    signature(current) !== signature(original)
  )
    throw Error(
      'This instrument changed. Select the notes again in the updated project.',
    );
  if (patch.notes) checkNotes(current, data.bpm, patch.notes);
  const musicalValue = (track: MixerTrack) => {
    const { peaks: _peaks, duration: _duration, ...value } = track;
    return JSON.stringify(value);
  };
  if (musicalValue(current) === musicalValue({ ...current, ...patch }))
    return data;
  const sourceBeats = (notes: Note[]) =>
    Math.max(8, ...notes.map((n) => n.start + n.length));
  const followNewEnd =
    patch.notes &&
    current.notes &&
    playlistClips(current).every((clip) => !clip.trimStart && !clip.trimEnd) &&
    !current.splitFrom &&
    sourceBeats(patch.notes) !== sourceBeats(current.notes);
  const next = {
    ...data,
    tracks: data.tracks.map((t) =>
      t.id === original.id
        ? {
            ...t,
            ...patch,
            ...(followNewEnd
              ? {
                  fadeEnd: undefined,
                  clips: t.clips?.map((clip) => ({
                    ...clip,
                    fadeEnd: undefined,
                  })),
                }
              : {}),
            peaks: undefined,
            duration: undefined,
          }
        : t,
    ),
  };
  validateArrangement(next, true);
  if (JSON.stringify(next).length > 250000)
    throw Error(
      'This project is too large. Use fewer notes or move this instrument into a new project.',
    );
  return next;
}

export function checkNotes(
  track: MixerTrack,
  bpm: number,
  notes: Note[],
): Note[] {
  if (
    !track.notes ||
    (track.fileId && !track.sample) ||
    track.sequence ||
    track.drumPattern ||
    track.demo
  )
    throw Error('Choose an instrument track to edit notes.');
  const ids = new Set<string>();
  for (const note of notes) {
    if (!note || typeof note.id !== 'string' || !note.id || ids.has(note.id))
      throw Error(
        'Each note needs a unique identity. Reopen the current project.',
      );
    ids.add(note.id);
  }
  validateArrangement({ bpm, tracks: [{ ...track, notes }] }, true);
  if (
    noteTimingLocked(track) &&
    (notes.length !== track.notes.length ||
      notes.some(
        (n, i) =>
          n.id !== track.notes![i]?.id ||
          n.start !== track.notes![i]?.start ||
          n.length !== track.notes![i]?.length,
      ))
  )
    throw Error(
      'Use an untrimmed, unsplit instrument to change note timing or count. Pitch and velocity can still be edited here.',
    );
  const duration =
    ((track.noteLoopBeats ??
      Math.max(8, ...notes.map((n) => n.start + n.length))) *
      60) /
      bpm +
    0.5;
  if (
    duration > 300 ||
    playlistClips(track).some(
      (clip) => clip.offset + duration - clip.trimStart - clip.trimEnd > 300,
    )
  )
    throw Error(
      'These notes would extend beyond the five-minute project limit.',
    );
  if (
    playlistClips(track).some(
      (clip) => clip.trimStart + clip.trimEnd >= duration,
    )
  )
    throw Error(
      'These notes would leave this trimmed instrument silent. Shorten its trim first.',
    );
  return notes;
}

function selectedNotes(track: MixerTrack, ids: string[]) {
  if (!track.notes || !ids.length) throw Error('Select at least one note.');
  const selected = new Set(ids);
  if (
    selected.size !== ids.length ||
    ids.some((id) => !track.notes!.some((n) => n.id === id))
  )
    throw Error('The selected notes changed. Select them again.');
  return track.notes.filter((n) => selected.has(n.id));
}

export function repeatSpan(
  track: MixerTrack,
  ids: string[],
  grid: number,
): number {
  if (![0.25, 0.5, 1].includes(grid))
    throw Error('Choose an available timing grid.');
  const selected = selectedNotes(track, ids);
  return Math.max(
    grid,
    Math.ceil(
      (Math.max(...selected.map((n) => n.start + n.length)) -
        Math.min(...selected.map((n) => n.start))) /
        grid -
        1e-9,
    ) * grid,
  );
}

/** One whole selection succeeds or nothing changes. Never clip chord intervals. */
export function editNotes(
  track: MixerTrack,
  bpm: number,
  ids: string[],
  edit: NoteEdit,
): { notes: Note[]; selected: string[] } {
  const chosen = selectedNotes(track, ids);
  validateArrangement({ bpm, tracks: [track] }, true);
  if (
    new Set(track.notes!.map((n) => n.id)).size !== track.notes!.length ||
    track.notes!.some((n) => typeof n.id !== 'string' || !n.id)
  )
    throw Error(
      'Each note needs a unique identity. Reopen the current project.',
    );
  if (
    (edit.kind === 'transpose' || edit.kind === 'drag') &&
    (!Number.isInteger(edit.semitones) || Math.abs(edit.semitones) > 127)
  )
    throw Error('Choose a whole-number pitch change within 127 semitones.');
  if (
    (edit.kind === 'move' ||
      edit.kind === 'duplicate' ||
      edit.kind === 'drag' ||
      edit.kind === 'resize') &&
    (!Number.isFinite(edit.beats) ||
      Math.abs(edit.beats) > 256 ||
      (edit.kind === 'duplicate' && edit.beats <= 0))
  )
    throw Error('Choose a valid beat distance; repeats must move forward.');
  if (edit.kind === 'quantize' && ![0.25, 0.5, 1].includes(edit.grid))
    throw Error('Choose an available timing grid.');
  if (
    edit.kind === 'length' &&
    (!Number.isFinite(edit.beats) || edit.beats < 0.01 || edit.beats > 32)
  )
    throw Error('Use a note length from 0.01 to 32 beats.');
  if (
    edit.kind === 'velocity' &&
    (!Number.isFinite(edit.value) || edit.value < 0.01 || edit.value > 1)
  )
    throw Error('Use a velocity from 1% to 100%.');
  const selection = new Set(ids);
  let notes: Note[],
    nextIds = ids;
  if (edit.kind === 'delete') {
    notes = track.notes!.filter((n) => !selection.has(n.id));
    nextIds = [];
  } else if (edit.kind === 'duplicate') {
    const copies = chosen.map((n) => ({
      ...n,
      id: crypto.randomUUID(),
      start: n.start + edit.beats,
    }));
    notes = [...track.notes!, ...copies];
    nextIds = copies.map((n) => n.id);
  } else {
    notes = track.notes!.map((n) => {
      if (!selection.has(n.id)) return n;
      if (edit.kind === 'move') return { ...n, start: n.start + edit.beats };
      if (edit.kind === 'drag')
        return {
          ...n,
          start: n.start + edit.beats,
          pitch: n.pitch + edit.semitones,
        };
      if (edit.kind === 'resize') {
        let length = n.length + edit.beats;
        const epsilon =
          Number.EPSILON * Math.max(1, n.length, Math.abs(edit.beats)) * 4;
        if (Math.abs(length - 0.01) <= epsilon) length = 0.01;
        if (Math.abs(length - 32) <= epsilon) length = 32;
        return { ...n, length };
      }
      if (edit.kind === 'transpose')
        return { ...n, pitch: n.pitch + edit.semitones };
      if (edit.kind === 'quantize')
        return { ...n, start: Math.round(n.start / edit.grid) * edit.grid };
      if (edit.kind === 'length') return { ...n, length: edit.beats };
      if (edit.kind === 'velocity') return { ...n, velocity: edit.value };
      throw Error('Choose an available note edit.');
    });
  }
  if (notes.some((n) => n.pitch < 0 || n.pitch > 127))
    throw Error('The entire selection must stay within MIDI pitches 0–127.');
  if (notes.some((n) => n.start < 0 || n.start > 256))
    throw Error('The entire selection must stay between beats 1 and 257.');
  if (notes.some((n) => n.length < 0.01 || n.length > 32))
    throw Error(
      'Every selected note must stay between 0.01 and 32 beats long.',
    );
  checkNotes(track, bpm, notes);
  if (JSON.stringify(notes) === JSON.stringify(track.notes))
    notes = track.notes!;
  return { notes, selected: [...nextIds] };
}
