import assert from 'node:assert/strict';
import { loadTS } from './load-ts.mjs';
const { mergeProject, sameProject } = loadTS('lib/project-merge.ts');
const track = (id) => ({
  id,
  name: id,
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
});
const make = (ids = ['a']) => ({
  title: 'Session',
  data: { bpm: 92, tracks: ids.map(track) },
});
const edit = (p, fn) => {
  const n = structuredClone(p);
  fn(n);
  return n;
};
let checks = 0;
function clean(b, l, r, verify) {
  const inputs = JSON.stringify([b, l, r]),
    result = mergeProject(b, l, r);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(mergeProject(b, r, l).project, result.project);
  assert.equal(JSON.stringify([b, l, r]), inputs);
  verify(result.project);
  checks += 4;
}
let b = make();
clean(
  b,
  edit(b, (p) => (p.data.tracks[0].volume = 0.5)),
  edit(b, (p) => (p.data.tracks[0].pan = 0.2)),
  (p) =>
    assert.deepEqual(
      [p.data.tracks[0].volume, p.data.tracks[0].pan],
      [0.5, 0.2],
    ),
);
clean(
  b,
  edit(b, (p) => (p.title = 'Local')),
  edit(b, (p) => (p.data.bpm = 100)),
  (p) => assert.deepEqual([p.title, p.data.bpm], ['Local', 100]),
);
clean(
  b,
  edit(
    b,
    (p) =>
      (p.data.tracks[0].notes = [
        { id: 'n', pitch: 60, start: 0, length: 1, velocity: 0.8 },
      ]),
  ),
  edit(b, (p) => (p.data.tracks[0].volume = 0.3)),
  (p) => assert.equal(p.data.tracks[0].notes.length, 1),
);
clean(
  b,
  edit(b, (p) => p.data.tracks.push(track('z'))),
  edit(b, (p) => p.data.tracks.push(track('y'))),
  (p) =>
    assert.deepEqual(
      p.data.tracks.map((t) => t.id),
      ['a', 'y', 'z'],
    ),
);
clean(
  b,
  edit(b, (p) => (p.data.tracks = [])),
  b,
  (p) => assert.equal(p.data.tracks.length, 0),
);
clean(
  b,
  edit(b, (p) => {
    p.data.tracks[0].peaks = [0.8];
    p.data.tracks[0].duration = 4;
  }),
  edit(b, (p) => (p.data.tracks[0].volume = 0.2)),
  (p) => assert.equal(p.data.tracks[0].volume, 0.2),
);
assert(
  sameProject(
    b,
    edit(b, (p) => {
      p.data.tracks[0].peaks = [1];
      p.data.tracks[0].duration = 33;
      p.data.tracks[0].notes = undefined;
    }),
  ),
);
checks++;
const l = edit(b, (p) => {
  p.data.tracks[0].volume = 0.4;
  p.title = 'Independent local';
});
const r = edit(b, (p) => {
  p.data.tracks[0].volume = 0.2;
  p.data.bpm = 120;
});
assert.deepEqual(mergeProject(b, l, r).conflicts, ['a · volume']);
checks++;
for (const choice of ['local', 'remote']) {
  const result = mergeProject(b, l, r, choice);
  assert.equal(
    result.project.data.tracks[0].volume,
    choice === 'local' ? 0.4 : 0.2,
  );
  assert.equal(result.project.title, 'Independent local');
  assert.equal(result.project.data.bpm, 120);
  checks += 3;
}
assert(
  mergeProject(
    b,
    edit(b, (p) => (p.data.tracks = [])),
    l,
  ).conflicts.length,
);
checks++;
assert(
  mergeProject(
    make([]),
    make(['a']),
    edit(make(['a']), (p) => (p.data.tracks[0].volume = 0.1)),
  ).conflicts.length,
);
checks++;
b = make(['a', 'b', 'c']);
clean(b, make(['b', 'a', 'c']), b, (p) =>
  assert.deepEqual(
    p.data.tracks.map((t) => t.id),
    ['b', 'a', 'c'],
  ),
);
assert(
  mergeProject(
    b,
    make(['b', 'a', 'c']),
    make(['a', 'c', 'b']),
  ).conflicts.includes('Track order'),
);
checks++;
assert(
  mergeProject(b, make(['a', 'c']), make(['b', 'a', 'c'])).conflicts.length,
);
checks++;
const full = make(Array.from({ length: 31 }, (_, i) => String(i)));
assert.equal(
  mergeProject(
    full,
    edit(full, (p) => p.data.tracks.push(track('x'))),
    edit(full, (p) => p.data.tracks.push(track('y'))),
  ).overflow,
  true,
);
checks++;
assert.throws(() => mergeProject(b, make(['a', 'a']), b), /Duplicate/);
checks++;
console.log(checks + ' collaboration merge checks passed.');

const largeBase = make(Array.from({ length: 32 }, (_, i) => String(i)));
const addNotes = (p, start, end) => {
  for (let i = start; i < end; i++)
    p.data.tracks[i].notes = Array.from({ length: 100 }, (_, n) => ({
      id: 'note_' + n + 'x'.repeat(25),
      pitch: 60,
      start: n,
      length: 1,
      velocity: 0.8,
    }));
};
const largeLocal = edit(largeBase, (p) => addNotes(p, 0, 16)),
  largeRemote = edit(largeBase, (p) => addNotes(p, 16, 32));
assert(JSON.stringify(largeLocal.data).length < 250000);
assert(JSON.stringify(largeRemote.data).length < 250000);
assert(mergeProject(largeBase, largeLocal, largeRemote).overflow);
console.log('3 additional combined-size checks passed.');
