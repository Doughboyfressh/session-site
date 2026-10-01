import assert from 'node:assert/strict';
import { loadTS } from './load-ts.mjs';
const {
  originals,
  originalArrangement,
  originalFor,
  originalBars,
  ORIGINAL_GENRES,
} = loadTS('lib/originals.ts');
const { demos, legacyDemos, genres } = loadTS('lib/catalog.ts');
const { validateArrangement } = loadTS('lib/arrangement-validation.ts');
const { playlistTrackEnd, playlistClips, playlistClipCount } = loadTS(
  'lib/playlist-clips.ts',
);
const { changeArrangementTempo } = loadTS('lib/arrangement-tempo.ts');
const { recoverySnapshot } = loadTS('lib/draft-recovery.ts');
const { AudioCache } = loadTS('lib/audio-cache.ts');
const { checkNotes, editNotes, applyNotePatch } = loadTS('lib/note-edit.ts');
const { midiPlan } = loadTS('lib/midi-notes.ts');
assert.equal(originals.length, 48);
assert.equal(demos.length, 58);
assert.equal(legacyDemos.length, 10);
assert.equal(genres.length, 25);
assert.equal(new Set(demos.map((t) => t.id)).size, 58);
assert.equal(new Set(originals.map((t) => t.title)).size, 48);
assert.equal(originalFor('demo-original-v2-1-1'), undefined);
assert.equal(originalArrangement('unknown'), null);
const fingerprints = new Set();
for (const family of ORIGINAL_GENRES)
  assert.equal(originals.filter((o) => o.family.genre === family).length, 2);
for (const o of originals) {
  const full = originalArrangement(o.id),
    preview = originalArrangement(o.id, { preview: true });
  validateArrangement(full);
  assert.ok(JSON.stringify(full).length < 250000);
  for (const stem of full.tracks.filter((t) => t.notes)) {
    midiPlan(stem, full.bpm, 0, 16);
    assert.throws(() => midiPlan(stem, full.bpm, 0, 32), /recording range/);
    editNotes(
      stem,
      full.bpm,
      stem.notes.map((n) => n.id),
      { kind: 'quantize', grid: 0.25 },
    );
    const first = stem.notes[0];
    for (const operation of [
      { kind: 'delete' },
      { kind: 'move', beats: 0.25 },
      { kind: 'resize', beats: 0.1 },
      { kind: 'duplicate', beats: 0.5 },
      { kind: 'quantize', grid: 0.25 },
    ]) {
      const edit = editNotes(stem, full.bpm, [first.id], operation);
      const edited = applyNotePatch(full, full.bpm, stem, {
        notes: edit.notes,
      });
      assert.equal(
        edited.tracks.find((t) => t.id === stem.id).noteLoopBeats,
        16,
      );
      validateArrangement(edited);
    }
    checkNotes(stem, full.bpm, [
      ...stem.notes,
      {
        id: 'new',
        pitch: first.pitch,
        start: 2.25,
        length: 0.25,
        velocity: 0.4,
      },
    ]);
    assert.throws(
      () =>
        checkNotes(stem, full.bpm, [
          ...stem.notes,
          {
            id: 'outside',
            pitch: first.pitch,
            start: 16,
            length: 1,
            velocity: 0.4,
          },
        ]),
      /Invalid instrument/,
    );
    const actuallyTrimmed = { ...stem, trimStart: 0.1 };
    assert.throws(
      () => checkNotes(actuallyTrimmed, full.bpm, stem.notes.slice(1)),
      /untrimmed/,
    );
  }
  validateArrangement(preview);
  assert.ok(full.tracks.length >= 5 && full.tracks.length <= 8);
  const end = Math.max(...full.tracks.map((t) => playlistTrackEnd(t)));
  assert.ok(end >= 90 && end <= 150, `${o.title}: ${end}`);
  assert.ok(Math.abs(end - (originalBars(o) * 4 * 60) / o.bpm) < 1e-6);
  assert.ok(
    Math.abs(
      Math.max(...preview.tracks.map((t) => playlistTrackEnd(t))) -
        (32 * 60) / o.bpm,
    ) < 1e-6,
  );
  assert.ok(playlistClipCount(full) <= 256);
  const tones = (o.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11]).map(
    (n) => (n + o.root) % 12,
  );
  for (const t of full.tracks) {
    assert.ok(!t.fileId && !t.demo && (t.notes || t.drumPattern));
    if (t.notes)
      assert.ok(
        t.notes.every((n) => tones.includes(n.pitch % 12)),
        `${o.title}: out-of-key note`,
      );
    const same = preview.tracks.find((p) => p.name === t.name);
    if (same)
      assert.deepEqual(
        same.notes || same.drumPattern,
        t.notes || t.drumPattern,
      );
    assert.ok(playlistClips(t).length <= 32);
  }
  const fingerprint = JSON.stringify(
    full.tracks.map((t) => ({
      notes: t.notes?.map((n) => [
        n.pitch - o.root,
        n.start,
        n.length,
        n.velocity,
      ]),
      drums: t.drumPattern,
      sound: t.sound,
    })),
  );
  assert.ok(!fingerprints.has(fingerprint), `Duplicate score: ${o.title}`);
  fingerprints.add(fingerprint);
  const hydrated = structuredClone(full);
  hydrated.tracks.forEach((t) => (t.peaks = [0.2]));
  const faster = changeArrangementTempo(hydrated, o.bpm * 1.2);
  assert.ok(faster.tracks.every((t) => t.peaks === undefined));
  assert.ok(
    Math.abs(
      Math.max(...faster.tracks.map((t) => playlistTrackEnd(t))) - end / 1.2,
    ) < 1e-6,
  );
  const restored = changeArrangementTempo(faster, o.bpm);
  validateArrangement(restored);
  assert.ok(
    Math.abs(
      Math.max(...restored.tracks.map((t) => playlistTrackEnd(t))) - end,
    ) < 1e-6,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(full)), full);
  const recovered = recoverySnapshot({ title: o.title, data: full });
  assert.ok(
    recovered.data.tracks
      .filter((t) => t.notes)
      .every((t) => t.noteLoopBeats === 16),
  );
  const another = originalArrangement(o.id);
  assert.ok(full.tracks.every((t, i) => t.id !== another.tracks[i].id));
  const merged = { bpm: o.bpm, tracks: [...full.tracks, ...another.tracks] };
  validateArrangement(merged);
}
const fast = originalArrangement(originals[17].id);
assert.throws(() => changeArrangementTempo(fast, 40), /five minutes|control/);
const file = {
  ...fast.tracks[2],
  fileId: 'recorded',
  notes: undefined,
  noteLoopBeats: undefined,
};
const untrimmed = {
  ...fast.tracks[2],
  noteLoopBeats: undefined,
  offset: 0,
  trimEnd: 0,
  clips: undefined,
  notes: [{ id: 'tail', pitch: 60, start: 0, length: 16, velocity: 0.5 }],
  duration: 8.5,
};
const slow = changeArrangementTempo({ bpm: 120, tracks: [untrimmed] }, 60);
assert.equal(changeArrangementTempo(slow, 120).tracks[0].trimEnd, 0);
assert.throws(
  () =>
    changeArrangementTempo(
      {
        bpm: 120,
        tracks: [
          {
            ...untrimmed,
            notes: [
              { id: 'long', pitch: 60, start: 240, length: 16, velocity: 0.5 },
            ],
            duration: undefined,
          },
        ],
      },
      40,
    ),
  /five minutes/,
);
assert.equal(
  changeArrangementTempo({ bpm: 120, tracks: [file] }, 100).tracks[0],
  file,
);
const cache = new AudioCache(64);
const tiny = { length: 4, numberOfChannels: 2 };
cache.set('a', tiny);
cache.set('b', tiny);
assert.equal(cache.stats().bytes, 64);
cache.get('a');
cache.set('c', tiny);
assert.equal(cache.get('b'), undefined);
assert.equal(cache.get('a'), tiny);
cache.set('a', { length: 100, numberOfChannels: 2 });
assert.equal(cache.get('a'), undefined);
assert.equal(cache.stats().bytes, 32);
cache.set('c', tiny);
assert.equal(cache.stats().bytes, 32);
console.log(
  'PASS 48 scores: keys, preview/full identity, uniqueness, project limits, recovery, tempo, append identities, bounded LRU cache',
);
