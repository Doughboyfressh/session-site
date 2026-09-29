import assert from 'node:assert/strict';
import { loadTS } from './load-ts.mjs';

const {
  DRUM_KITS,
  DRUM_LANES,
  DRUM_STEP_COUNTS,
  DRUM_STEP_LEVELS,
  cleanDrumPattern,
  cycleDrumStep,
  defaultDrumPattern,
  drumPatternSeconds,
  drumStepSeconds,
  emptyDrumPattern,
  resizeDrumPattern,
  setDrumStep,
  upgradeLegacyPattern,
  validateDrumPattern,
  applyDrumPattern,
} = loadTS('lib/drum-pattern.ts');
const { validateArrangement } = loadTS('lib/arrangement-validation.ts');
const { recoverySnapshot } = loadTS('lib/draft-recovery.ts');

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
const passes = (fn) => {
  assert.doesNotThrow(fn);
  checks++;
};

const laneIds = DRUM_LANES.map((lane) => lane.id);
const drumTrack = (patch = {}) => ({
  id: 'drums-a',
  name: 'Drums',
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
const arrangement = (source = drumTrack()) => ({ bpm: 120, tracks: [source] });

equal(laneIds.length, 6, 'The editor exposes six drum lanes.');
equal(
  DRUM_STEP_COUNTS,
  [16, 32, 64],
  'Patterns support one, two, or four bars.',
);
equal(
  DRUM_STEP_LEVELS,
  [0, 0.4, 0.7, 1],
  'Click-cycling uses four velocity levels.',
);

const empty = emptyDrumPattern();
equal(Object.keys(empty).sort(), ['kit', 'lanes', 'steps', 'swing', 'version']);
equal(empty.steps, 16);
equal(empty.kit, 'studio');
equal(empty.swing, 0);
for (const lane of laneIds)
  equal(empty.lanes[lane], Array(16).fill(0), `${lane} starts silent.`);
equal(
  validateDrumPattern(empty),
  empty,
  'A fresh empty pattern validates as-is.',
);

const groove = defaultDrumPattern();
ok(
  groove.lanes.kick.some((v) => v > 0),
  'The starter groove has a kick.',
);
ok(
  groove.lanes.snare.some((v) => v > 0),
  'The starter groove has a snare.',
);
ok(
  groove.lanes.closedHat.filter((v) => v > 0).length >= 6,
  'The starter groove has hats.',
);
ok(
  groove.lanes.openHat.every((v) => v === 0),
  'Open hat starts silent.',
);

for (const kit of DRUM_KITS)
  ok(validateDrumPattern(emptyDrumPattern(16, kit.id)));
for (const steps of DRUM_STEP_COUNTS)
  equal(emptyDrumPattern(steps).steps, steps);

fails(() => validateDrumPattern(null));
fails(() => validateDrumPattern([]));
fails(
  () => validateDrumPattern({ ...empty, version: 2 }),
  /invalid drum pattern/i,
);
fails(() => validateDrumPattern({ ...empty, kit: 'orchestra' }), /invalid/i);
fails(() => validateDrumPattern({ ...empty, steps: 24 }), /invalid/i);
fails(() => validateDrumPattern({ ...empty, swing: 61 }), /invalid/i);
fails(() => validateDrumPattern({ ...empty, swing: -1 }), /invalid/i);
fails(() => validateDrumPattern({ ...empty, extra: 1 }), /invalid/i);
fails(
  () => validateDrumPattern({ ...empty, lanes: { ...empty.lanes, tom: [] } }),
  /invalid/i,
);
fails(
  () =>
    validateDrumPattern({
      ...empty,
      lanes: { ...empty.lanes, kick: Array(15).fill(0) },
    }),
  /valid velocity/i,
);
fails(
  () =>
    validateDrumPattern({
      ...empty,
      lanes: { ...empty.lanes, kick: Array(16).fill(1.5) },
    }),
  /valid velocity/i,
);

const cleaned = cleanDrumPattern(groove);
ok(
  cleaned !== groove && cleaned.lanes.kick !== groove.lanes.kick,
  'Clean clones lane arrays.',
);
equal(
  JSON.stringify(cleaned),
  JSON.stringify(groove),
  'Clean preserves values.',
);

const legacy = [
  [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
];
const upgraded = upgradeLegacyPattern(legacy);
equal(upgraded.lanes.kick, legacy[0], 'Legacy kick row maps to the kick lane.');
equal(
  upgraded.lanes.snare,
  legacy[1],
  'Legacy snare row maps to the snare lane.',
);
equal(
  upgraded.lanes.closedHat,
  legacy[2],
  'Legacy hat row maps to the closed-hat lane.',
);
equal(
  upgraded.lanes.clap,
  Array(16).fill(0),
  'Legacy rows leave new lanes silent.',
);
ok(validateDrumPattern(upgraded), 'Upgraded legacy patterns validate.');
fails(() => upgradeLegacyPattern([[1], [0], [0]]), /legacy/i);
fails(
  () =>
    upgradeLegacyPattern([
      [0.5],
      ...Array(2).fill(Array(16).fill(0)).slice(0, 2),
    ]),
  /legacy/i,
);

const doubled = resizeDrumPattern(groove, 32);
equal(doubled.steps, 32);
for (const lane of laneIds) {
  equal(doubled.lanes[lane].length, 32);
  equal(
    doubled.lanes[lane].slice(0, 16),
    groove.lanes[lane],
    'Resize keeps steps.',
  );
  equal(
    doubled.lanes[lane].slice(16),
    Array(16).fill(0),
    'Resize pads with silence.',
  );
}
const shortened = resizeDrumPattern(doubled, 16);
equal(shortened.steps, 16);
equal(shortened.lanes.kick, groove.lanes.kick, 'Shrinking truncates the tail.');
fails(() => resizeDrumPattern(groove, 48));

equal(setDrumStep(groove, 'clap', 3, 0.55).lanes.clap[3], 0.55);
fails(() => setDrumStep(groove, 'tom', 0, 1), /valid drum step/i);
fails(() => setDrumStep(groove, 'kick', 16, 1), /valid drum step/i);
fails(() => setDrumStep(groove, 'kick', -1, 1), /valid drum step/i);
fails(() => setDrumStep(groove, 'kick', 0, 1.2), /valid drum step/i);

let cycling = emptyDrumPattern();
for (const level of [...DRUM_STEP_LEVELS.slice(1), 0]) {
  cycling = cycleDrumStep(cycling, 'kick', 0);
  near(cycling.lanes.kick[0], level, `Cycling reaches velocity ${level}.`);
}

near(
  drumPatternSeconds(emptyDrumPattern(16), 120),
  2,
  'One bar at 120 BPM is two seconds.',
);
near(
  drumPatternSeconds(emptyDrumPattern(32), 120),
  4,
  'Two bars at 120 BPM is four seconds.',
);
near(
  drumPatternSeconds(emptyDrumPattern(64), 90),
  (64 * 60) / 90 / 4,
  'Four bars derive from step math.',
);
for (const bpm of [39, 241, NaN])
  fails(() => drumPatternSeconds(groove, bpm), /tempo/i);

near(drumStepSeconds(groove, 0, 120), 0);
near(drumStepSeconds(groove, 4, 120), 0.5);
const swung = { ...groove, swing: 50 };
near(
  drumStepSeconds(swung, 1, 120),
  0.125 + 0.03125,
  'Swing delays odd steps by half a step.',
);
near(drumStepSeconds(swung, 2, 120), 0.25, 'Swing leaves even steps in place.');
fails(() => drumStepSeconds(groove, 16, 120));

const legacyTrack = drumTrack({ sequence: legacy, duration: 16 });
const applied = applyDrumPattern(arrangement(legacyTrack), 'drums-a', groove);
const appliedTrack = applied.tracks[0];
ok(
  appliedTrack.drumPattern && validateDrumPattern(appliedTrack.drumPattern),
  'Apply stores a validated pattern.',
);
ok(appliedTrack.sequence === undefined, 'Apply retires the legacy array.');
ok(appliedTrack.peaks === undefined, 'Apply invalidates stale peaks.');
near(
  appliedTrack.duration,
  drumPatternSeconds(groove, 120),
  'Apply derives channel duration.',
);
equal(
  JSON.stringify(legacyTrack.sequence),
  JSON.stringify(legacy),
  'Apply must not mutate its input.',
);

const modern = applyDrumPattern(
  arrangement(drumTrack({ drumPattern: groove, duration: 2 })),
  'drums-a',
  groove,
);
equal(
  JSON.stringify(modern),
  JSON.stringify(arrangement(drumTrack({ drumPattern: groove, duration: 2 }))),
  'Re-applying the same pattern is a no-op.',
);

fails(
  () => applyDrumPattern(arrangement(drumTrack()), 'drums-a', groove),
  /available drum channel/i,
);
fails(
  () =>
    applyDrumPattern(
      arrangement(
        drumTrack({
          notes: [{ id: 'n', pitch: 60, start: 0, length: 1, velocity: 0.8 }],
        }),
      ),
      'drums-a',
      groove,
    ),
  /available drum channel/i,
);
fails(
  () =>
    applyDrumPattern(
      {
        ...arrangement(legacyTrack),
        tracks: arrangement(legacyTrack).tracks.map(() => drumTrack()),
      },
      'missing',
      groove,
    ),
  /available drum channel/i,
);

const trimmedLegacy = drumTrack({
  sequence: legacy,
  duration: 16,
  trimStart: 0.5,
});
fails(
  () => applyDrumPattern(arrangement(trimmedLegacy), 'drums-a', groove),
  /untrimmed, unsplit/i,
);
const sameLengthLegacy = drumTrack({
  sequence: legacy,
  duration: 2,
  trimStart: 0.5,
});
ok(
  applyDrumPattern(arrangement(sameLengthLegacy), 'drums-a', groove).tracks[0]
    .trimStart === 0.5,
  'Keeping the duration preserves trims.',
);

passes(
  () => validateArrangement(arrangement(drumTrack({ drumPattern: groove }))),
  'Drum channels validate in arrangements.',
);
passes(
  () => validateArrangement(arrangement(legacyTrack)),
  'Legacy sequence channels keep validating unchanged.',
);
fails(
  () =>
    validateArrangement(
      arrangement(drumTrack({ sequence: [[0.5], [0], [0]] })),
    ),
  /invalid drum pattern/i,
);
fails(
  () =>
    validateArrangement(
      arrangement(drumTrack({ drumPattern: groove, sound: 'keys' })),
    ),
  /one source/i,
);
fails(
  () =>
    validateArrangement(
      arrangement(drumTrack({ drumPattern: { ...groove, steps: 24 } })),
    ),
  /invalid/i,
);

const snapshot = recoverySnapshot({
  title: 'Drums',
  data: arrangement(drumTrack({ drumPattern: groove })),
});
equal(
  JSON.stringify(snapshot.data.tracks[0].drumPattern),
  JSON.stringify(cleanDrumPattern(groove)),
  'Recovery snapshots preserve drum patterns.',
);

console.log(`PASS: ${checks} drum pattern sequencer assertions.`);
