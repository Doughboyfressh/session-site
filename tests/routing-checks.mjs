import assert from 'node:assert/strict';
import { loadTS } from './load-ts.mjs';
const { defaultRouting, audibleTrack } = loadTS('lib/mixer-routing.ts');
const { validateArrangement } = loadTS('lib/arrangement-validation.ts');
const { cleanProject, sameProject, mergeProject } = loadTS(
  'lib/project-merge.ts',
);
const { recoverySnapshot } = loadTS('lib/draft-recovery.ts');
const track = (id, groupId) => ({
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
  ...(groupId ? { groupId } : {}),
});
const old = {
  title: 'Legacy project',
  data: {
    bpm: 92,
    tracks: [
      track('vocal', 'group-1'),
      track('double', 'group-1'),
      track('drums', 'group-2'),
      track('main'),
    ],
  },
};
const project = {
  ...structuredClone(old),
  data: { ...structuredClone(old.data), routing: defaultRouting() },
};
let checks = 0;
const check = (ok, m) => {
  assert.ok(ok, m);
  checks++;
};
const reject = (data) => {
  assert.throws(
    () => validateArrangement(data),
    (e) => e.status === 400,
  );
  checks++;
};
const edit = (value, fn) => {
  const next = structuredClone(value);
  fn(next);
  return next;
};
validateArrangement(old.data);
validateArrangement(project.data);
checks += 2;
check(
  !cleanProject(old).data.routing && !recoverySnapshot(old).data.routing,
  'Legacy projects acquire routing metadata',
);
project.data.tracks[0].sendReverb = 0.4;
project.data.tracks[1].sendDelay = 0.3;
check(
  sameProject(project, recoverySnapshot(project)),
  'Recovery drops groups/sends',
);
check(
  JSON.stringify(cleanProject(project).data.routing) ===
    JSON.stringify(project.data.routing),
  'Save snapshot drops routing',
);
const before = JSON.stringify(project);
const b = structuredClone(project);
const l = edit(b, (p) => {
  p.data.routing.groups[0].name = 'Lead vocals';
  p.data.routing.reverb = 0.5;
});
const r = edit(b, (p) => {
  p.data.routing.groups[0].volume = 0.7;
  p.data.tracks[0].sendDelay = 0.2;
});
const merged = mergeProject(b, l, r);
check(
  merged.conflicts.length === 0 &&
    merged.project.data.routing.groups[0].name === 'Lead vocals' &&
    merged.project.data.routing.groups[0].volume === 0.7 &&
    merged.project.data.tracks[0].sendDelay === 0.2 &&
    merged.project.data.routing.reverb === 0.5,
  'Independent routing edits fail to merge',
);
check(
  sameProject(merged.project, mergeProject(b, r, l).project),
  'Routing merge depends on side order',
);
const a = edit(b, (p) => (p.data.routing.groups[0].volume = 0.3)),
  z = edit(b, (p) => (p.data.routing.groups[0].volume = 0.9));
check(
  mergeProject(b, a, z).conflicts.includes('Vocals group · volume'),
  'Competing group faders silently overwrite',
);
check(
  mergeProject(b, a, z, 'remote').project.data.routing.groups[0].volume === 0.9,
  'Remote conflict choice ignored',
);
const initMerge = mergeProject(
  old,
  edit(old, (p) => {
    p.data.routing = defaultRouting();
    p.data.routing.delay = 0.6;
  }),
  edit(old, (p) => (p.data.tracks[0].volume = 0.4)),
);
check(
  initMerge.conflicts.length === 0 &&
    initMerge.project.data.routing.delay === 0.6 &&
    initMerge.project.data.tracks[0].volume === 0.4,
  'Adding routing loses legacy edits',
);
for (const field of ['volume', 'pan'])
  for (const value of [NaN, Infinity, '1', null, field === 'pan' ? 2 : -1])
    reject(edit(b.data, (d) => (d.routing.groups[0][field] = value)));
for (const field of ['sendReverb', 'sendDelay'])
  for (const value of [NaN, Infinity, -1, 1.01, '1', null])
    reject(edit(b.data, (d) => (d.tracks[0][field] = value)));
for (const field of ['reverb', 'delay'])
  for (const value of [NaN, Infinity, -1, 1.51, '1', null])
    reject(edit(b.data, (d) => (d.routing[field] = value)));
for (const value of ['other', '', null, 42])
  reject(edit(b.data, (d) => (d.tracks[0].groupId = value)));
for (const value of [null, [], {}, { ...defaultRouting(), groups: [] }])
  reject({ ...b.data, routing: value });
reject(edit(b.data, (d) => (d.routing.groups[1].id = d.routing.groups[0].id)));
reject(edit(b.data, (d) => (d.routing.groups[0].muted = 'true')));
reject(edit(b.data, (d) => (d.routing.groups[0].name = '')));
reject(edit(b.data, (d) => (d.routing.groups[0].name = 'x'.repeat(41))));
const all = (d) =>
  d.tracks
    .filter((t) => audibleTrack(d, t))
    .map((t) => t.id)
    .join(',');
check(
  all(b.data) === 'vocal,double,drums,main',
  'Default routing mutes legacy audio',
);
check(
  all(edit(b.data, (d) => (d.routing.groups[0].muted = true))) === 'drums,main',
  'Muted group remains audible',
);
check(
  all(edit(b.data, (d) => (d.routing.groups[0].solo = true))) ===
    'vocal,double',
  'Group solo leaks other channels',
);
check(
  all(edit(b.data, (d) => (d.tracks[0].solo = true))) === 'vocal',
  'Track solo opens siblings',
);
check(
  all(
    edit(b.data, (d) => {
      d.tracks[0].solo = true;
      d.routing.groups[1].solo = true;
    }),
  ) === 'vocal,drums',
  'Track and group solo union wrong',
);
check(
  all(
    edit(b.data, (d) => {
      d.tracks[0].solo = true;
      d.routing.groups[0].muted = true;
    }),
  ) === '',
  'Solo bypasses group mute',
);
check(
  all(
    edit(b.data, (d) => {
      d.tracks[0].muted = true;
      d.routing.groups[0].solo = true;
    }),
  ) === 'double',
  'Group solo bypasses track mute',
);
check(before === JSON.stringify(project), 'Validation/merging mutates input');
console.log(
  `PASS: ${checks} routing validation, audibility, merging and recovery-snapshot assertions.`,
);
