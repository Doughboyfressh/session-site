import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const exports = {};
  modules.set(file, exports);
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports,
      require: () => load('lib/audio-files.ts'),
      Blob,
      Float32Array,
      Uint8Array,
      Uint32Array,
      ArrayBuffer,
      DataView,
      TextEncoder,
      DOMException,
      setTimeout,
      clearTimeout,
      console,
      structuredClone,
    },
  );
  return exports;
}
const { encodeWave } = load('lib/audio-files.ts');
const {
  fullTake,
  replaceCompRange,
  compFrames,
  takePCM,
  renderComp,
  takeBudget,
  MAX_TAKE_BYTES,
  planPunch,
} = load('lib/take-comp.ts');
let checks = 0;
function check(v, m) {
  assert.ok(v, m);
  checks++;
}
async function rejects(fn) {
  await assert.rejects(async () => fn());
  checks++;
}
async function take(id, value, seconds = 1, rate = 48000, offset = 12.5) {
  const samples = Float32Array.from(
    { length: Math.round(seconds * rate) },
    (_, i) => (typeof value === 'function' ? value(i) : value),
  );
  let peak = 0;
  for (const n of samples) peak = Math.max(peak, Math.abs(n));
  const depth = peak > 1 ? 32 : 24;
  const { blob } = await encodeWave(
    {
      length: samples.length,
      sampleRate: rate,
      numberOfChannels: 1,
      getChannelData: () => samples,
    },
    depth,
    { channels: 1 },
  );
  return {
    id,
    name: id,
    url: '',
    blob,
    sampleRate: rate,
    depth,
    peak,
    seconds: samples.length / rate,
    offset,
  };
}
for (const rate of [44100, 48000]) {
  const a = await take('A', (i) => (i % 2 ? 0.2 : -0.2), 1, rate),
    b = await take('B', 0.7, 1.5, rate),
    short = await take('short', -0.4, 0.4, rate);
  const takes = [a, b, short];
  const original = await a.blob.arrayBuffer(),
    base = fullTake(a),
    single = await renderComp(base, takes),
    raw = await takePCM(single);
  check(raw.length === rate, 'Full take frame count');
  check(
    raw.every((v, i) => Math.abs(v - (i % 2 ? 0.2 : -0.2)) < 4e-7),
    'Full take PCM changed',
  );
  check(
    single.offset === 12.5 && single.sampleRate === rate,
    'Offset or rate changed',
  );
  let regions = replaceCompRange(base, takes, 'B', 0.25, 0.5);
  const info = compFrames(regions, takes);
  check(
    info.frames.length === 3 && info.length === rate,
    'Middle range changed length',
  );
  const output = await takePCM(await renderComp(regions, takes));
  check(
    Math.abs(output[Math.round(rate * 0.3)] - 0.7) < 4e-7,
    'Donor came from wrong range',
  );
  check(
    Math.abs(Math.abs(output[20]) - 0.2) < 4e-7 &&
      Math.abs(Math.abs(output.at(-20)) - 0.2) < 4e-7,
    'Surroundings changed',
  );
  check(
    Math.abs(output[Math.round(rate * 0.25)]) < 4e-7 &&
      Math.abs(output[Math.round(rate * 0.5) - 1]) < 4e-7,
    'Join ramp missing',
  );
  check(
    output.every((v) => Math.abs(v) <= 0.700001),
    'Join increased peak',
  );
  regions = replaceCompRange(regions, takes, 'B', 0.5, 0.75);
  check(
    regions.length === 3 && regions[1].end === 0.75,
    'Adjacent donor regions not coalesced',
  );
  regions = replaceCompRange(regions, takes, 'A', 0.3, 0.6);
  check(
    regions.length === 5 && regions[2].takeId === 'A',
    'Replacement over previous replacement failed',
  );
  check(
    compFrames(regions, takes).length === rate,
    'Overlapping edits moved audio',
  );
  check(
    replaceCompRange(base, takes, 'short', 0.1, 0.3).length === 3,
    'Short donor covered valid range',
  );
  await rejects(() => replaceCompRange(base, takes, 'short', 0.3, 0.5));
  check(
    replaceCompRange(base, takes, 'B', 0, 1).length === 1,
    'Full replacement failed',
  );
  const last = replaceCompRange(base, takes, 'B', (rate - 1) / rate, 1);
  check(compFrames(last, takes).frames.at(-1).end === rate, 'Last frame lost');
  const rounded = replaceCompRange(
    base,
    takes,
    'B',
    10.49 / rate,
    20.49 / rate,
  );
  check(
    compFrames(rounded, takes).frames[1].start === 10 &&
      compFrames(rounded, takes).frames[1].end === 20,
    'Fractional samples not rounded once',
  );
  for (const [from, to] of [
    [-1, 0.2],
    [0.2, 0.1],
    [0.2, 0.2],
    [NaN, 0.3],
    [0, Infinity],
    [0, 1.1],
  ])
    await rejects(() => replaceCompRange(base, takes, 'B', from, to));
  await rejects(() =>
    compFrames([{ takeId: 'missing', start: 0, end: 1 }], takes),
  );
  await rejects(() => compFrames([{ takeId: 'A', start: 0.1, end: 1 }], takes));
  await rejects(() =>
    compFrames(
      [
        { takeId: 'A', start: 0, end: 0.5 },
        { takeId: 'B', start: 0.5, end: 1 },
      ],
      [a, { ...b, sampleRate: rate === 48000 ? 44100 : 48000 }],
    ),
  );
  await rejects(() =>
    compFrames([{ takeId: 'A', start: 0, end: 1 }], [{ ...a, offset: 299.5 }]),
  );
  const same = await takePCM(
    await renderComp(
      [
        { takeId: 'A', start: 0, end: 0.5 },
        { takeId: 'A', start: 0.5, end: 1 },
      ],
      takes,
    ),
  );
  check(
    Math.abs(Math.abs(same[Math.round(rate / 2)]) - 0.2) < 4e-7,
    'Same-take boundary introduced dip',
  );
  check(
    Buffer.compare(
      Buffer.from(original),
      Buffer.from(await a.blob.arrayBuffer()),
    ) === 0,
    'Original WAV was changed',
  );
  const loud = await take('loud', 1.15, 0.1, rate),
    float = await renderComp(fullTake(loud), [loud]);
  check(float.depth === 32 && float.peak > 1, 'Float headroom was clipped');
  check(
    (await takePCM(float)).every((v) => Math.abs(v - 1.15) < 1e-6),
    'Float output changed',
  );
  const stopped = new AbortController();
  stopped.abort();
  await rejects(() => renderComp(base, takes, stopped.signal));
  const delayed = new AbortController();
  const work = renderComp(base, takes, delayed.signal);
  setTimeout(() => delayed.abort(), 0);
  await rejects(() => work);
  const malformed = new Uint8Array(await a.blob.arrayBuffer());
  new DataView(malformed.buffer).setUint16(22, 2, true);
  await rejects(() => takePCM({ ...a, blob: new Blob([malformed]) }));
  await rejects(() => takePCM({ ...a, seconds: 0.9 }));
}
const meta = { seconds: 30, blob: { size: 1024 } };
check(takeBudget([], 0).limit === 120, 'Initial limit');
check(
  takeBudget(Array(8).fill(meta), 0).available === false,
  'Ninth take allowed',
);
check(
  takeBudget([{ ...meta, seconds: 239.95 }], 0).available === false,
  'Duration cap ignored',
);
check(
  takeBudget([{ ...meta, blob: { size: MAX_TAKE_BYTES - 100 } }], 0)
    .available === false,
  'Byte cap ignored',
);
check(
  Math.abs(takeBudget([], 299.9).limit - 0.1) < 1e-9,
  'Timeline cap ignored',
);
check(
  takeBudget([{ ...meta, seconds: 210 }], 0).limit === 30,
  'Remaining recording allowance lost',
);
for (const rate of [44100, 48000]) {
  const base = await take('base', 0.2, 1, rate);
  const original = new Uint8Array(await base.blob.arrayBuffer());
  const from = 0.25,
    to = 0.75;
  const spec = planPunch(fullTake(base), [base], from, to);
  check(
    spec.frames === rate / 2 && spec.offset === 12.75,
    'Punch plan not aligned',
  );
  const donor = {
    ...(await take(
      'punch',
      (i) => (i < rate / 4 ? 0.6 : -0.4),
      0.5,
      rate,
      spec.offset,
    )),
    coverageStart: spec.start,
    compOrigin: spec.origin,
  };
  const list = [base, donor];
  const plan = replaceCompRange(fullTake(base), list, donor.id, from, to);
  const pcm = await takePCM(await renderComp(plan, list));
  check(
    pcm.length === rate &&
      Math.abs(pcm[1000] - 0.2) < 1e-6 &&
      Math.abs(pcm[rate - 1000] - 0.2) < 1e-6,
    'Punch changed surrounding vocal',
  );
  check(
    Math.abs(pcm[Math.round(rate * 0.3)] - 0.6) < 1e-6 &&
      Math.abs(pcm[Math.round(rate * 0.65)] + 0.4) < 1e-6,
    'Partial PCM source offset is wrong',
  );
  check(
    Buffer.from(original).equals(Buffer.from(await base.blob.arrayBuffer())),
    'Punch mutated original source',
  );
  await rejects(() => fullTake(donor));
  await rejects(() =>
    replaceCompRange(fullTake(base), list, donor.id, 0.2, 0.75),
  );
  await rejects(() =>
    replaceCompRange(fullTake(base), list, donor.id, 0.25, 0.8),
  );
  await rejects(() => planPunch(fullTake(base), [base], 0, 0.05));
  await rejects(() => planPunch(fullTake(base), [base], NaN, 1));
  await rejects(() => planPunch(fullTake(base), [base], 0, 1.1));
  await rejects(() => planPunch(fullTake(base), Array(8).fill(base), 0, 1));
  for (const [a, b] of [
    [0, 0.25],
    [0.75, 1],
  ]) {
    const p = planPunch(fullTake(base), [base], a, b);
    const edge = {
      ...(await take('edge', 0.8, b - a, rate, p.offset)),
      coverageStart: p.start,
      compOrigin: p.origin,
    };
    const next = replaceCompRange(fullTake(base), [base, edge], edge.id, a, b);
    const output = await renderComp(next, [base, edge]);
    check(
      output.offset === base.offset && output.seconds === 1,
      'Edge punch moved the comp origin',
    );
    const samples = await takePCM(output);
    check(
      Math.abs(samples[Math.round(((a + b) / 2) * rate)] - 0.8) < 1e-6,
      'Edge punch samples missing',
    );
    await rejects(() => fullTake(edge));
  }
  const short = {
    ...donor,
    ...(await take('short-punch', 0.4, 0.2, rate, spec.offset)),
  };
  await rejects(() =>
    replaceCompRange(fullTake(base), [base, short], short.id, from, to),
  );
  check(
    compFrames(
      replaceCompRange(fullTake(base), [base, short], short.id, from, 0.45),
      [base, short],
    ).length === rate,
    'Covered short punch range rejected',
  );
}
const { punchSeed, punchBacking, checkPunchTarget, applyPunchClip } =
  load('lib/punch-clip.ts');
const target = {
  id: 'vocal',
  name: 'Vocal',
  fileId: 'original',
  offset: 12.5,
  trimStart: 0,
  trimEnd: 0,
  duration: 1,
  volume: 0.6,
  pan: -0.3,
  solo: true,
  muted: false,
  low: 2,
  fadeIn: 0.1,
  fadeStart: 0,
  fadeEnd: 1,
  automation: [{ time: 13, value: 0.2 }],
};
const arrangement = {
  bpm: 120,
  tracks: Array.from({ length: 32 }, (_, i) =>
    i === 0 ? target : { ...target, id: 'other' + i, solo: false },
  ),
};
const signal = new Float32Array(48000).fill(1.1);
const samples = {
  length: 48000,
  sampleRate: 48000,
  numberOfChannels: 1,
  getChannelData: () => signal,
};
const seed = await punchSeed(target, samples);
check(seed.depth === 32 && seed.peak > 1, 'Seed clipped source headroom');
const backing = punchBacking(arrangement, target);
check(
  backing.tracks[0].muted &&
    backing.tracks[0].solo &&
    !arrangement.tracks[0].muted &&
    backing.tracks.length === 32,
  'Backing changed solo or original data',
);
const replaced = applyPunchClip(
  arrangement,
  target,
  seed,
  seed,
  'new-file',
  [1],
);
check(
  replaced.tracks.length === 32 &&
    replaced.tracks[0].fileId === 'new-file' &&
    arrangement.tracks[0].fileId === 'original',
  'Replacement lost original or added channel at capacity',
);
check(
  JSON.stringify({
    ...replaced.tracks[0],
    fileId: target.fileId,
    peaks: undefined,
  }) === JSON.stringify(target),
  'Replacement changed mixer/timing settings',
);
await rejects(() => checkPunchTarget({ ...arrangement, tracks: [] }, target));
await rejects(() =>
  checkPunchTarget(
    { ...arrangement, tracks: [{ ...target, volume: 1 }] },
    target,
  ),
);
await rejects(() =>
  applyPunchClip(
    arrangement,
    target,
    seed,
    { ...seed, seconds: 0.9 },
    'new',
    [],
  ),
);
await rejects(() =>
  applyPunchClip(arrangement, target, seed, { ...seed, offset: 13 }, 'new', []),
);
await rejects(() =>
  applyPunchClip(
    arrangement,
    target,
    seed,
    { ...seed, sampleRate: 44100 },
    'new',
    [],
  ),
);
await rejects(() => punchSeed(target, { ...samples, numberOfChannels: 2 }));
await rejects(() => punchSeed({ ...target, trimStart: 0.1 }, samples));
await rejects(() => punchSeed({ ...target, trimEnd: 0.1 }, samples));
await rejects(() => punchSeed(target, { ...samples, length: 121 * 48000 }));
await rejects(() => punchSeed(target, samples, AbortSignal.abort()));
console.log(
  'PASS: ' +
    checks +
    ' comp timing, PCM, joins, validation, cancellation and capacity assertions.',
);
