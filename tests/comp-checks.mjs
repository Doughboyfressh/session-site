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
console.log(
  'PASS: ' +
    checks +
    ' comp timing, PCM, joins, validation, cancellation and capacity assertions.',
);
