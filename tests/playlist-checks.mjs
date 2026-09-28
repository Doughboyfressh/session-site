import assert from 'node:assert/strict';
import { loadTS } from './load-ts.mjs';

const playlist = loadTS('lib/playlist-clips.ts');
const { validateArrangement } = loadTS('lib/arrangement-validation.ts');
const { recoverySnapshot } = loadTS('lib/draft-recovery.ts');
const { mergeProject, sameProject } = loadTS('lib/project-merge.ts');
const { mixDuration } = loadTS('lib/audio.ts');
const { exportEnd } = loadTS('lib/audio-export.ts');
const { checkNotes } = loadTS('lib/note-edit.ts');
const { midiPlan } = loadTS('lib/midi-notes.ts');
const {
  PRIMARY_CLIP_ID,
  MAX_CLIPS_PER_PROJECT,
  MAX_CLIPS_PER_TRACK,
  duplicatePlaylistClip,
  movePlaylistClip,
  patchPlaylistClip,
  playlistClip,
  playlistClipCount,
  playlistClipLength,
  playlistClips,
  playlistTrackEnd,
  removePlaylistClip,
  repeatPlaylistClip,
  splitPlaylistClip,
  trimPlaylistClip,
} = playlist;

let checks = 0;
const ok = (condition, message) => {
  assert.ok(condition, message);
  checks++;
};
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks++;
};
const near = (actual, expected, message) => {
  ok(Math.abs(actual - expected) < 1e-8, message);
};
const fails = (fn, pattern) => {
  assert.throws(fn, pattern);
  checks++;
};
const track = (patch = {}) => ({
  id: 'channel-a',
  name: 'Keys',
  fileId: 'private-audio',
  duration: 10,
  volume: 0.8,
  pan: 0,
  muted: false,
  solo: false,
  offset: 2,
  trimStart: 1,
  trimEnd: 1,
  low: 0,
  mid: 0,
  high: 0,
  fadeIn: 2,
  fadeOut: 3,
  ...patch,
});
const arrangement = (source = track()) => ({ bpm: 120, tracks: [source] });
const snapshot = (data) => ({ title: 'Playlist test', data });

const base = arrangement();
const original = JSON.stringify(base);
equal(playlistClips(base.tracks[0]).map((clip) => clip.id), [PRIMARY_CLIP_ID]);
equal(playlistClip(base.tracks[0]).name, 'Keys');
near(playlistClipLength(base.tracks[0]), 8);
near(playlistTrackEnd(base.tracks[0]), 10);
equal(playlistClipCount(base), 1);

let edited = duplicatePlaylistClip(base, 'channel-a', PRIMARY_CLIP_ID, 'copy-a');
equal(edited.tracks.length, 1, 'Duplicating a clip must not create a mixer channel.');
equal(edited.tracks[0].clips.length, 1);
near(edited.tracks[0].clips[0].offset, 10);
equal(JSON.stringify(base), original, 'Playlist helpers must not mutate their input.');

edited = movePlaylistClip(edited, 'channel-a', 'copy-a', 14);
near(playlistClip(edited.tracks[0], 'copy-a').offset, 14);
edited = trimPlaylistClip(edited, 'channel-a', 'copy-a', 'trimStart', 2.5);
near(playlistClipLength(edited.tracks[0], 'copy-a'), 6.5);
edited = patchPlaylistClip(edited, 'channel-a', 'copy-a', {
  name: 'Verse loop',
  fadeIn: 0.5,
});
equal(playlistClip(edited.tracks[0], 'copy-a').name, 'Verse loop');
near(playlistClip(edited.tracks[0], 'copy-a').fadeIn, 0.5);
ok(!('primary' in edited.tracks[0].clips[0]));
equal(edited.tracks[0].name, 'Keys', 'Clip renaming must not rename the channel.');

const split = splitPlaylistClip(base, 'channel-a', PRIMARY_CLIP_ID, 5, 'right');
near(playlistClipLength(split.tracks[0], PRIMARY_CLIP_ID), 3);
near(playlistClipLength(split.tracks[0], 'right'), 5);
near(playlistClip(split.tracks[0], 'right').offset, 5);
near(playlistClip(split.tracks[0], PRIMARY_CLIP_ID).fadeStart, 1);
near(playlistClip(split.tracks[0], 'right').fadeEnd, 9);
equal(split.tracks.length, 1);

const repeated = repeatPlaylistClip(
  base,
  'channel-a',
  PRIMARY_CLIP_ID,
  3,
  ['repeat-1', 'repeat-2', 'repeat-3'],
);
equal(playlistClipCount(repeated), 4);
equal(
  repeated.tracks[0].clips.map((clip) => clip.offset),
  [10, 18, 26],
);
near(playlistTrackEnd(repeated.tracks[0]), 34);
near(mixDuration(repeated), 34);
near(exportEnd(repeated.tracks[0], 10), 34);

const removed = removePlaylistClip(repeated, 'channel-a', 'repeat-2');
equal(playlistClipCount(removed), 3);
ok(!removed.tracks[0].clips.some((clip) => clip.id === 'repeat-2'));
fails(
  () => removePlaylistClip(base, 'channel-a', PRIMARY_CLIP_ID),
  /track trash button/i,
);

for (const invalid of [-1, NaN, 293])
  fails(() => movePlaylistClip(base, 'channel-a', PRIMARY_CLIP_ID, invalid));
for (const invalid of [0, 1, 9, 2.5])
  fails(() =>
    repeatPlaylistClip(
      base,
      'channel-a',
      PRIMARY_CLIP_ID,
      invalid,
      Array.from({ length: Math.max(0, Math.floor(invalid)) }, (_, i) => `x-${i}`),
    ),
  );
fails(() => splitPlaylistClip(base, 'channel-a', PRIMARY_CLIP_ID, 2, 'x'));
fails(() => splitPlaylistClip(base, 'channel-a', PRIMARY_CLIP_ID, 10, 'x'));
fails(() => trimPlaylistClip(base, 'channel-a', PRIMARY_CLIP_ID, 'trimStart', NaN));
fails(() => duplicatePlaylistClip(base, 'channel-a', PRIMARY_CLIP_ID, 'channel-a'));

const fullTrack = track({
  clips: Array.from({ length: MAX_CLIPS_PER_TRACK - 1 }, (_, index) => ({
    id: `full-${index}`,
    name: `Clip ${index}`,
    offset: 0,
    trimStart: 1,
    trimEnd: 1,
  })),
});
fails(() =>
  duplicatePlaylistClip(arrangement(fullTrack), 'channel-a', PRIMARY_CLIP_ID, 'overflow'),
);
const fullProject = {
  bpm: 120,
  tracks: Array.from({ length: MAX_CLIPS_PER_PROJECT / MAX_CLIPS_PER_TRACK }, (_, row) =>
    track({
      id: `channel-${row}`,
      clips: Array.from({ length: MAX_CLIPS_PER_TRACK - 1 }, (_, column) => ({
        id: `clip-${row}-${column}`,
        name: `Clip ${row}-${column}`,
        offset: 0,
        trimStart: 1,
        trimEnd: 1,
      })),
    }),
  ),
};
validateArrangement(fullProject);
checks++;
equal(playlistClipCount(fullProject), MAX_CLIPS_PER_PROJECT);
fails(() =>
  duplicatePlaylistClip(fullProject, 'channel-0', PRIMARY_CLIP_ID, 'too-many'),
);

validateArrangement(repeated);
checks++;
fails(
  () =>
    validateArrangement({
      ...repeated,
      tracks: [
        {
          ...repeated.tracks[0],
          clips: [
            ...repeated.tracks[0].clips,
            { ...repeated.tracks[0].clips[0] },
          ],
        },
      ],
    }),
  /unique identity/i,
);
fails(
  () =>
    validateArrangement({
      ...base,
      tracks: [
        {
          ...base.tracks[0],
          clips: [
            {
              id: 'bad',
              name: 'Bad',
              offset: 0,
              trimStart: -1,
              trimEnd: 0,
            },
          ],
        },
      ],
    }),
  /playlist clip control/i,
);

const recovered = recoverySnapshot({
  title: 'Recovered',
  data: {
    ...repeated,
    tracks: repeated.tracks.map((item) => ({
      ...item,
      clips: item.clips.map((clip) => ({ ...clip, ignored: 'drop me' })),
    })),
  },
});
equal(recovered.data.tracks[0].clips.length, 3);
ok(!('ignored' in recovered.data.tracks[0].clips[0]));

const mergeBase = snapshot(base);
const localAdd = snapshot(
  duplicatePlaylistClip(base, 'channel-a', PRIMARY_CLIP_ID, 'local-clip'),
);
const remoteAdd = snapshot({
  ...base,
  tracks: [
    {
      ...base.tracks[0],
      clips: [
        {
          id: 'remote-clip',
          name: 'Remote clip',
          offset: 20,
          trimStart: 1,
          trimEnd: 1,
        },
      ],
    },
  ],
});
const addedMerge = mergeProject(mergeBase, localAdd, remoteAdd);
equal(addedMerge.conflicts, []);
equal(
  addedMerge.project.data.tracks[0].clips.map((clip) => clip.id),
  ['local-clip', 'remote-clip'],
);

const placedBase = snapshot(
  duplicatePlaylistClip(base, 'channel-a', PRIMARY_CLIP_ID, 'shared-clip'),
);
const localMove = snapshot(
  movePlaylistClip(placedBase.data, 'channel-a', 'shared-clip', 15),
);
const remoteRename = snapshot(
  patchPlaylistClip(placedBase.data, 'channel-a', 'shared-clip', {
    name: 'Renamed remotely',
  }),
);
const independentMerge = mergeProject(placedBase, localMove, remoteRename);
equal(independentMerge.conflicts, []);
near(playlistClip(independentMerge.project.data.tracks[0], 'shared-clip').offset, 15);
equal(
  playlistClip(independentMerge.project.data.tracks[0], 'shared-clip').name,
  'Renamed remotely',
);
const rivalMove = snapshot(
  movePlaylistClip(placedBase.data, 'channel-a', 'shared-clip', 17),
);
const conflict = mergeProject(placedBase, localMove, rivalMove, 'remote');
ok(conflict.conflicts.some((label) => label.includes('offset')));
near(playlistClip(conflict.project.data.tracks[0], 'shared-clip').offset, 17);
ok(sameProject(mergeProject(placedBase, localMove, placedBase).project, localMove));

const instrument = track({
  fileId: undefined,
  notes: [{ id: 'note-a', pitch: 60, start: 0, length: 1, velocity: 0.8 }],
  sound: 'keys',
  offset: 0,
  trimStart: 0,
  trimEnd: 0,
  clips: [
    {
      id: 'late-copy',
      name: 'Late copy',
      offset: 297,
      trimStart: 0,
      trimEnd: 0,
    },
  ],
});
fails(() => checkNotes(instrument, 120, instrument.notes), /five-minute/i);
fails(() => midiPlan(instrument, 120, 0, 8), /five-minute/i);
const trimmedInstrument = {
  ...instrument,
  clips: [{ ...instrument.clips[0], offset: 10, trimStart: 0.5 }],
};
fails(
  () =>
    checkNotes(trimmedInstrument, 120, [
      ...trimmedInstrument.notes,
      { id: 'note-b', pitch: 64, start: 2, length: 1, velocity: 0.7 },
    ]),
  /untrimmed, unsplit instrument/i,
);

console.log(`PASS: ${checks} reusable playlist clip assertions.`);
