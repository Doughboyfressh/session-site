import assert from 'node:assert/strict';
import {
  clipLength,
  duplicateClip,
  gridSeconds,
  moveClip,
  snapTime,
  splitClip,
} from '../lib/clip-edit.ts';
import { loadTS } from './load-ts.mjs';
const { mergeProject, sameProject } = loadTS('lib/project-merge.ts');
const source = {
  id: 'source',
  name: 'Original',
  fileId: 'private-source',
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
  fadeIn: 3,
  fadeOut: 4,
  automation: [
    { time: 0, value: 0.1 },
    { time: 10, value: 1 },
  ],
};
const data = { bpm: 120, tracks: [source] };
let checks = 0;
function ok(value) {
  assert(value);
  checks++;
}
function near(a, b) {
  ok(Math.abs(a - b) < 1e-8);
}
function fails(fn) {
  assert.throws(fn);
  checks++;
}
const before = JSON.stringify(data);
const split = splitClip(data, 'source', 5, 'right');
near(clipLength(split.tracks[0]), 3);
near(clipLength(split.tracks[1]), 5);
near(split.tracks[0].trimEnd, 6);
near(split.tracks[1].trimStart, 4);
near(split.tracks[1].offset, 5);
for (const t of split.tracks) {
  ok(t.fileId === source.fileId);
  ok(t.fadeStart === 1 && t.fadeEnd === 9);
  ok(t.splitFrom === 'source');
  assert.deepEqual(t.automation, source.automation);
  checks++;
}
ok(before === JSON.stringify(data));
split.tracks[1].automation[0].value = 0.5;
ok(
  split.tracks[0].automation[0].value === 0.1 &&
    source.automation[0].value === 0.1,
);
const repeated = splitClip(split, 'right', 7, 'third');
ok(repeated.tracks.length === 3);
ok(
  repeated.tracks.every(
    (t) => t.fadeStart === 1 && t.fadeEnd === 9 && t.splitFrom === 'source',
  ),
);
const moved = moveClip(repeated.tracks[2], 9);
near(moved.offset, 9);
near(moved.fadeStart, 1);
near(moved.fadeEnd, 9);
near(moveClip(moved, 7).offset, 7);
for (const cut of [2.01, 9.99]) {
  const halves = splitClip(data, 'source', cut, 'short');
  for (const half of halves.tracks) {
    ok(clipLength(half) > 0);
    near(moveClip(half, 0).offset, 0);
    ok(
      duplicateClip({ bpm: 120, tracks: [half] }, half.id, 'copy').tracks
        .length === 2,
    );
  }
}
for (const at of [2, 2.001, 10, NaN, Infinity, -1])
  fails(() => splitClip(data, 'source', at, 'new'));
fails(() => splitClip(data, 'source', 5, 'source'));
fails(() => clipLength({ ...source, duration: undefined }));
fails(() => clipLength({ ...source, duration: 301 }));
fails(() => moveClip(source, 293));
fails(() => moveClip(source, -0.1));
fails(() => moveClip(source, NaN));
near(moveClip(source, 292).offset, 292);
fails(() =>
  duplicateClip(
    { bpm: 120, tracks: [{ ...source, offset: 290 }] },
    'source',
    'copy',
  ),
);
const copy = duplicateClip(repeated, 'right', 'copy').tracks.at(-1);
ok(!copy.splitFrom);
ok(copy.id === 'copy');
fails(() =>
  splitClip(
    {
      bpm: 120,
      tracks: Array.from({ length: 32 }, (_, i) => ({
        ...source,
        id: String(i),
      })),
    },
    '0',
    5,
    'new',
  ),
);
for (const bpm of [40, 60, 92, 120, 240]) {
  near(gridSeconds('beat', bpm), 60 / bpm);
  near(gridSeconds('quarter', bpm), 15 / bpm);
  near(gridSeconds('bar', bpm), 240 / bpm);
  near(
    snapTime(1.28, 'quarter', bpm),
    Math.round(1.28 / (15 / bpm)) * (15 / bpm),
  );
}
near(snapTime(1.123, 'off', 120), 1.123);
near(snapTime(-10, 'beat', 120), 0);
near(snapTime(400, 'beat', 120), 300);
fails(() => snapTime(NaN, 'beat', 120));
const snap = (d) => ({ title: 'Session', data: d });
const base = snap(data),
  local = snap(splitClip(data, 'source', 5, 'right'));
for (const remote of [
  snap({ ...data, tracks: [{ ...source, offset: 4 }] }),
  snap({ ...data, tracks: [] }),
  snap({ ...data, tracks: [{ ...source, volume: 0.4 }] }),
]) {
  const result = mergeProject(base, local, remote);
  ok(result.conflicts.some((x) => x.includes('split')));
  ok(sameProject(mergeProject(base, local, remote, 'remote').project, remote));
  ok(sameProject(mergeProject(base, local, remote, 'local').project, local));
  ok(sameProject(mergeProject(base, remote, local, 'local').project, remote));
}
const simple = mergeProject(base, local, base);
ok(!simple.conflicts.length);
ok(sameProject(simple.project, local));
const rival = snap(splitClip(data, 'source', 6, 'other'));
ok(sameProject(mergeProject(base, local, rival, 'remote').project, rival));
const geometry = mergeProject(
  base,
  snap({ ...data, tracks: [{ ...source, offset: 3 }] }),
  snap({ ...data, tracks: [{ ...source, trimStart: 2 }] }),
  'remote',
);
ok(geometry.conflicts.some((x) => x.includes('timing')));
near(geometry.project.data.tracks[0].offset, 2);
near(geometry.project.data.tracks[0].trimStart, 2);
const unrelated = { ...source, id: 'other', splitFrom: undefined };
const b2 = snap({ ...data, tracks: [source, unrelated] });
const l2 = snap(splitClip(b2.data, 'source', 5, 'right'));
const r2 = snap({ ...data, tracks: [source, { ...unrelated, pan: 0.5 }] });
const combined = mergeProject(b2, l2, r2);
ok(!combined.conflicts.length);
near(combined.project.data.tracks.find((t) => t.id === 'other').pan, 0.5);
ok(combined.project.data.tracks.length === 3);
console.log(`PASS: ${checks} clip editing and split collaboration assertions.`);
