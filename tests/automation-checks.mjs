import assert from 'node:assert/strict';
import { loadTS } from './load-ts.mjs';

const automation = loadTS('lib/automation.ts');
const { validateArrangement } = loadTS('lib/arrangement-validation.ts');
const { recoverySnapshot } = loadTS('lib/draft-recovery.ts');
const { mergeProject } = loadTS('lib/project-merge.ts');
const {
  AUTOMATION_SPECS,
  AUTOMATION_TARGETS,
  MAX_AUTOMATION_POINTS_PER_LANE,
  MAX_AUTOMATION_POINTS_PER_TRACK,
  activeAutomationTargets,
  automationAt,
  automationLane,
  automationPointCount,
  clampAutomationValue,
  formatAutomationValue,
  scheduleAutomation,
  sortedAutomation,
} = automation;

let checks = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  checks++;
};
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks++;
};
const rejects = (fn, pattern) => {
  assert.throws(fn, pattern);
  checks++;
};
const track = (patch = {}) => ({
  id: 'track-a',
  name: 'Lead vocal',
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
  ...patch,
});
const project = (source = track()) => ({
  title: 'Automation test',
  data: { bpm: 120, tracks: [source] },
});

const legacy = track({
  automation: [
    { time: 0, value: 0.5 },
    { time: 2, value: 1 },
  ],
});
equal(automationLane(legacy, 'volume'), legacy.automation);
equal(activeAutomationTargets(legacy), ['volume']);
equal(automationPointCount(legacy), 2);
equal(
  automationLane({ ...legacy, automationLanes: { volume: [] } }, 'volume'),
  [],
);
checks += 4;

const unsorted = [
  { time: 2, value: 1 },
  { time: 0, value: 0 },
];
equal(
  sortedAutomation(unsorted).map((point) => point.time),
  [0, 2],
);
equal(
  unsorted.map((point) => point.time),
  [2, 0],
  'Sorting must not mutate saved points.',
);
assert.equal(automationAt(unsorted, 1), 0.5);
assert.equal(
  automationAt(
    [
      { time: 0, value: 0.25, curve: 'hold' },
      { time: 2, value: 1 },
    ],
    1.99,
  ),
  0.25,
);
assert.equal(
  automationAt(
    [
      { time: 0, value: 0.25, curve: 'hold' },
      { time: 2, value: 1 },
    ],
    2,
  ),
  1,
);
checks += 3;

const events = [];
const parameter = {
  setValueAtTime(value, time) {
    events.push(['set', value, time]);
  },
  linearRampToValueAtTime(value, time) {
    events.push(['linear', value, time]);
  },
};
scheduleAutomation(
  parameter,
  [
    { time: 0, value: 0 },
    { time: 2, value: 1, curve: 'hold' },
    { time: 4, value: 0.5 },
  ],
  1,
  3,
  10,
  0.25,
);
equal(events, [
  ['set', 0.5, 10.25],
  ['linear', 1, 11.25],
  ['set', 1, 12.25],
]);
events.length = 0;
scheduleAutomation(
  parameter,
  [
    { time: 0, value: 0 },
    { time: 2, value: 1, curve: 'hold' },
    { time: 4, value: 0.5 },
  ],
  0,
  4,
  5,
);
equal(events, [
  ['set', 0, 5],
  ['linear', 1, 7],
  ['set', 0.5, 9],
]);

assert.equal(clampAutomationValue('pan', 3), 1);
assert.equal(clampAutomationValue('mid', -4.26), -4.3);
assert.equal(formatAutomationValue('pan', -0.42), '42 L');
assert.equal(formatAutomationValue('high', 2), '+2.0 dB');
checks += 4;

const boundaryLanes = Object.fromEntries(
  AUTOMATION_TARGETS.map((target) => [
    target,
    [
      { time: 0, value: AUTOMATION_SPECS[target].min, curve: 'hold' },
      { time: 1, value: AUTOMATION_SPECS[target].max, curve: 'linear' },
    ],
  ]),
);
validateArrangement({
  bpm: 120,
  tracks: [track({ automationLanes: boundaryLanes })],
});
checks++;

rejects(
  () =>
    validateArrangement({
      bpm: 120,
      tracks: [track({ automationLanes: { unknown: [] } })],
    }),
  /available automation target/i,
);
rejects(
  () =>
    validateArrangement({
      bpm: 120,
      tracks: [
        track({
          automationLanes: {
            volume: Array.from(
              { length: MAX_AUTOMATION_POINTS_PER_LANE + 1 },
              (_, index) => ({ time: index, value: 1 }),
            ),
          },
        }),
      ],
    }),
  /each automation lane/i,
);
const overTrackLimit = Object.fromEntries(
  AUTOMATION_TARGETS.map((target) => [
    target,
    Array.from({ length: 37 }, (_, index) => ({
      time: index,
      value: AUTOMATION_SPECS[target].min,
    })),
  ]),
);
check(
  Object.values(overTrackLimit).flat().length > MAX_AUTOMATION_POINTS_PER_TRACK,
);
rejects(
  () =>
    validateArrangement({
      bpm: 120,
      tracks: [track({ automationLanes: overTrackLimit })],
    }),
  /per track/i,
);
for (const automationLanes of [
  { pan: [{ time: 0, value: 2 }] },
  {
    volume: [
      { time: 1, value: 1 },
      { time: 1, value: 0.5 },
    ],
  },
  { delay: [{ time: 301, value: 0.5 }] },
  { reverb: [{ time: 1, value: 0.5, curve: 'spline' }] },
])
  rejects(
    () =>
      validateArrangement({
        bpm: 120,
        tracks: [track({ automationLanes })],
      }),
    /automation point/i,
  );

const recovered = recoverySnapshot({
  title: 'Recovered automation',
  data: {
    bpm: 120,
    tracks: [
      track({
        automationLanes: {
          pan: [{ time: 0.5, value: -0.25, curve: 'hold', unsafe: 'remove' }],
        },
      }),
    ],
  },
});
equal(recovered.data.tracks[0].automationLanes, {
  pan: [{ time: 0.5, value: -0.25, curve: 'hold' }],
});
rejects(
  () =>
    recoverySnapshot({
      title: 'Bad recovery',
      data: {
        bpm: 120,
        tracks: [track({ automationLanes: JSON.parse('{"__proto__":[]}') })],
      },
    }),
  /automation lanes|available automation target/i,
);
rejects(
  () =>
    recoverySnapshot({
      title: 'Oversized recovery',
      data: {
        bpm: 120,
        tracks: [track({ automationLanes: overTrackLimit })],
      },
    }),
  /too many automation points/i,
);

const base = project();
const local = structuredClone(base);
const remote = structuredClone(base);
local.data.tracks[0].automationLanes = {
  volume: [{ time: 0, value: 0.8 }],
};
remote.data.tracks[0].automationLanes = {
  pan: [{ time: 1, value: -0.3, curve: 'hold' }],
};
const merged = mergeProject(base, local, remote);
equal(merged.conflicts, []);
equal(merged.project.data.tracks[0].automationLanes, {
  volume: [{ time: 0, value: 0.8 }],
  pan: [{ time: 1, value: -0.3, curve: 'hold' }],
});

const competingLocal = structuredClone(base);
const competingRemote = structuredClone(base);
competingLocal.data.tracks[0].automationLanes = {
  mid: [{ time: 0, value: -2 }],
};
competingRemote.data.tracks[0].automationLanes = {
  mid: [{ time: 0, value: 3 }],
};
const conflict = mergeProject(base, competingLocal, competingRemote);
equal(conflict.conflicts, ['Lead vocal · mid automation']);
equal(conflict.details[0].local, [{ time: 0, value: -2 }]);
equal(conflict.details[0].remote, [{ time: 0, value: 3 }]);

console.log(
  `PASS: ${checks} multi-lane automation engine, validation, recovery and merge assertions.`,
);
