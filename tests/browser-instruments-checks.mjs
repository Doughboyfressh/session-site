import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { loadTS } from './load-ts.mjs';

const instruments = loadTS('lib/browser-instruments.ts');
const {
  defaultBrowserInstrument,
  validateBrowserInstrument,
  playBrowserNote,
  BROWSER_INSTRUMENTS,
  BROWSER_INSTRUMENT_PRESETS,
  BROWSER_PARAMETER_RANGES,
} = instruments;
let checks = 0;
const equal = (a, b, message) => {
  assert.deepEqual(a, b, message);
  checks++;
};
const ok = (value, message) => {
  assert.ok(value, message);
  checks++;
};
const reject = (fn, message) => {
  assert.throws(fn, undefined, message);
  checks++;
};
const near = (a, b, message) => {
  ok(Math.abs(a - b) < 1e-8, message ?? `${a} != ${b}`);
};

equal(
  BROWSER_INSTRUMENTS.map((item) => item.id),
  ['session-wavetable', 'session-fm'],
);
for (const { id } of BROWSER_INSTRUMENTS) {
  const original = defaultBrowserInstrument(id),
    before = structuredClone(original);
  Object.freeze(original.parameters);
  Object.freeze(original);
  const clean = validateBrowserInstrument(original);
  equal(clean, before);
  ok(clean !== original);
  ok(clean.parameters !== original.parameters);
  const fresh = defaultBrowserInstrument(id);
  fresh.parameters.level = 0;
  ok(
    defaultBrowserInstrument(id).parameters.level > 0,
    'Defaults must not share mutable parameters',
  );
  for (const preset of BROWSER_INSTRUMENT_PRESETS[id]) {
    equal(validateBrowserInstrument(preset.instrument), preset.instrument);
    equal(preset.instrument.id, id);
    ok(Object.isFrozen(preset.instrument.parameters));
  }
  for (const key of Object.keys(clean.parameters)) {
    const [min, max] = BROWSER_PARAMETER_RANGES[key];
    for (const value of [min, max]) {
      const state = {
        ...clean,
        parameters: { ...clean.parameters, [key]: value },
      };
      equal(validateBrowserInstrument(state), state);
    }
    for (const value of [
      min - 0.001,
      max + 0.001,
      NaN,
      Infinity,
      -Infinity,
      null,
      '1',
      undefined,
    ]) {
      reject(
        () =>
          validateBrowserInstrument({
            ...clean,
            parameters: { ...clean.parameters, [key]: value },
          }),
        `Reject ${id}/${key}: ${value}`,
      );
    }
    const incomplete = structuredClone(clean);
    delete incomplete.parameters[key];
    reject(() => validateBrowserInstrument(incomplete), `Require ${key}`);
  }
  for (const extra of [{ mystery: 1 }, { __proto__: null, extra: true }])
    reject(() =>
      validateBrowserInstrument({
        ...clean,
        parameters: { ...clean.parameters, ...extra },
      }),
    );
  for (const bad of [
    { ...clean, extra: true },
    { ...clean, version: 2 },
    { ...clean, format: 'vst3' },
    { ...clean, id: 'serum' },
    { ...clean, parameters: [] },
    Object.create(clean),
    { ...clean, parameters: Object.create(clean.parameters) },
  ])
    reject(() => validateBrowserInstrument(bad));
  const symbolState = structuredClone(clean);
  symbolState[Symbol('hidden')] = true;
  reject(() => validateBrowserInstrument(symbolState));
}
for (const input of [null, [], false, 1, 'session-fm', new Date(), undefined])
  reject(() => validateBrowserInstrument(input));
reject(() => defaultBrowserInstrument('unknown'));
reject(() =>
  validateBrowserInstrument({
    ...defaultBrowserInstrument('session-wavetable'),
    parameters: {
      ...defaultBrowserInstrument('session-wavetable').parameters,
      unison: 1.5,
    },
  }),
);

function audioParam() {
  return {
    events: [],
    setValueAtTime(...args) {
      this.events.push(['set', ...args]);
    },
    linearRampToValueAtTime(...args) {
      this.events.push(['ramp', ...args]);
    },
    cancelAndHoldAtTime(...args) {
      this.events.push(['hold', ...args]);
    },
    cancelScheduledValues(...args) {
      this.events.push(['cancel', ...args]);
    },
  };
}
function fakeContext({ failing = false, fallback = false } = {}) {
  const nodes = [],
    sources = [];
  const node = (kind, properties = {}) => {
    const n = {
      kind,
      connections: [],
      disconnected: 0,
      connect(target) {
        if (failing && kind === 'filter') throw Error('Device graph failed');
        this.connections.push(target);
        return target;
      },
      disconnect() {
        this.disconnected++;
      },
      ...properties,
    };
    nodes.push(n);
    return n;
  };
  const c = {
    currentTime: 0,
    sampleRate: 44100,
    createGain() {
      const gain = audioParam();
      if (fallback) delete gain.cancelAndHoldAtTime;
      return node('gain', { gain });
    },
    createBiquadFilter() {
      return node('filter', { frequency: audioParam(), Q: audioParam() });
    },
    createWaveShaper() {
      return node('drive');
    },
    createStereoPanner() {
      return node('panner', { pan: audioParam() });
    },
    createPeriodicWave(real, imaginary, options) {
      return { real, imaginary, options };
    },
    createOscillator() {
      const n = node('oscillator', {
        frequency: audioParam(),
        detune: audioParam(),
        events: [],
        onended: null,
        setPeriodicWave(wave) {
          this.wave = wave;
        },
        start(at) {
          this.events.push(['start', at]);
        },
        stop(at) {
          this.events.push(['stop', at]);
        },
      });
      sources.push(n);
      return n;
    },
  };
  return { c, nodes, sources };
}
for (const id of ['session-wavetable', 'session-fm']) {
  const state = defaultBrowserInstrument(id),
    f = fakeContext();
  const voice = playBrowserNote(f.c, {}, 69, 1, 0.5, 0.8, state);
  const end = 1.5 + state.parameters.release;
  ok(f.sources.length <= 5, 'Bound oscillator count');
  for (const source of f.sources)
    equal(source.events, [
      ['start', 1],
      ['stop', end],
    ]);
  equal(f.sources[0].frequency.events, [['set', 440, 1]]);
  const output = f.nodes[0];
  near(
    output.gain.events.at(-1)[2],
    end,
    'Release must fit within the 0.5 second generated tail',
  );
  ok(end <= 2);
  const curve = f.nodes.find((node) => node.kind === 'drive').curve;
  ok(
    [...curve].every((value) => Number.isFinite(value) && Math.abs(value) <= 1),
  );
  f.c.currentTime = 1.1;
  voice.stop();
  for (const source of f.sources)
    near(
      source.events.at(-1)[1],
      1.105,
      'Stop must include every operator and LFO',
    );
  const stops = f.sources.map((source) => source.events.length);
  voice.stop(1.4);
  equal(
    f.sources.map((source) => source.events.length),
    stops,
    'Repeated stop cannot postpone cancellation',
  );
  voice.disconnect();
  voice.disconnect();
  ok(
    f.nodes.every((node) => node.disconnected === 1),
    'Disconnect must clean every graph node exactly once',
  );
  ok(f.sources.every((source) => source.onended === null));
}
{
  const f = fakeContext(),
    state = defaultBrowserInstrument('session-wavetable');
  state.parameters.unison = 4;
  state.parameters.modulation = 1;
  state.parameters.detune = 30;
  playBrowserNote(f.c, {}, 127, 0, 1, 1, state);
  equal(f.sources.length, 5);
  const sum = f.sources[0].wave.imaginary.reduce(
    (total, value) => total + Math.abs(value),
    0,
  );
  ok(sum <= 1.000001, 'Harmonic amplitude must be normalized');
  const pans = f.nodes
    .filter((node) => node.kind === 'panner')
    .map((node) => node.pan.events[0][1]);
  [-0.65, -0.65 / 3, 0.65 / 3, 0.65].forEach((value, index) =>
    near(pans[index], value),
  );
  for (const source of f.sources) source.onended();
  ok(
    f.nodes.every((node) => node.disconnected === 1),
    'Natural finish must release the graph',
  );
}
{
  const f = fakeContext({ fallback: true }),
    state = defaultBrowserInstrument('session-fm');
  state.parameters.attack = 1;
  state.parameters.release = 0.005;
  const voice = playBrowserNote(f.c, {}, 60, 0, 0.01, 1, state);
  near(
    f.nodes[0].gain.events[1][1],
    0.00144,
    'Short note releases from partial attack level',
  );
  voice.stop(0.005);
  equal(
    f.nodes[0].gain.events.slice(-3).map((event) => event[0]),
    ['cancel', 'ramp', 'ramp'],
  );
  near(f.nodes[0].gain.events.at(-2)[1], 0.00072);
}
{
  const f = fakeContext();
  f.c.currentTime = 2;
  const voice = playBrowserNote(
    f.c,
    {},
    81,
    1,
    1,
    1,
    defaultBrowserInstrument('session-fm'),
  );
  equal(f.sources[0].events[0], ['start', 2]);
  equal(f.sources[0].frequency.events[0], ['set', 880, 2]);
  reject(() => voice.stop(NaN));
  voice.disconnect();
}
{
  const f = fakeContext({ failing: true });
  reject(() =>
    playBrowserNote(
      f.c,
      {},
      60,
      0,
      1,
      1,
      defaultBrowserInstrument('session-fm'),
    ),
  );
  ok(
    f.nodes.every((node) => node.disconnected === 1),
    'Graph setup failure must not leak nodes',
  );
}
for (const [pitch, time, length, velocity] of [
  [-1, 0, 1, 1],
  [128, 0, 1, 1],
  [60.5, 0, 1, 1],
  [60, -1, 1, 1],
  [60, NaN, 1, 1],
  [60, 0, 0, 1],
  [60, 0, 301, 1],
  [60, 0, Infinity, 1],
  [60, 0, 1, -0.1],
  [60, 0, 1, 1.1],
  [60, 0, 1, NaN],
]) {
  const f = fakeContext();
  reject(() =>
    playBrowserNote(
      f.c,
      {},
      pitch,
      time,
      length,
      velocity,
      defaultBrowserInstrument('session-fm'),
    ),
  );
  equal(f.nodes.length, 0, 'Reject invalid playback before allocating nodes');
}
for (const patch of [{ velocity: 0 }, { level: 0 }]) {
  const f = fakeContext(),
    state = defaultBrowserInstrument('session-fm');
  if (patch.level === 0) state.parameters.level = 0;
  const voice = playBrowserNote(f.c, {}, 69, 0, 1, patch.velocity ?? 1, state);
  voice.stop();
  voice.disconnect();
  equal(f.nodes.length, 0, 'Silent notes need no graph');
}

const jsx = (type, props) => ({ type, props });
const exports = {};
const controlCode = ts.transpileModule(
  fs.readFileSync('app/browser-instrument-controls.tsx', 'utf8'),
  {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const renderControls = vm.runInThisContext(
  `(function(exports, require) { ${controlCode}\n})`,
);
renderControls(exports, (id) => {
  if (id === 'react') return { useId: () => 'instrument-test' };
  if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
  if (id === '../lib/browser-instruments') return instruments;
  throw Error('Unexpected control dependency: ' + id);
});
const flatten = (tree) =>
  !tree || typeof tree !== 'object'
    ? []
    : Array.isArray(tree)
      ? tree.flatMap(flatten)
      : [tree, ...flatten(tree.props?.children)];
for (const id of ['session-wavetable', 'session-fm']) {
  const state = defaultBrowserInstrument(id),
    updates = [];
  const tree = exports.BrowserInstrumentControls({
    instrument: state,
    onChange: (next) => updates.push(next),
  });
  const all = flatten(tree),
    sliders = all.filter((node) => node.type === 'input');
  equal(sliders.length, Object.keys(state.parameters).length);
  ok(
    sliders.every(
      (node) => node.props['aria-label'] && node.props['aria-valuetext'],
    ),
  );
  const sustain = sliders.find(
    (node) => node.props['aria-label'] === 'Sustain',
  );
  sustain.props.onChange({ target: { value: '0.3' } });
  near(updates.at(-1).parameters.sustain, 0.3);
  equal(state.parameters.sustain, 0.65);
  all
    .find((node) => node.type === 'select')
    .props.onChange({
      target: { value: BROWSER_INSTRUMENT_PRESETS[id][0].id },
    });
  equal(updates.at(-1), BROWSER_INSTRUMENT_PRESETS[id][0].instrument);
  ok(updates.at(-1) !== BROWSER_INSTRUMENT_PRESETS[id][0].instrument);
  const disabled = flatten(
    exports.BrowserInstrumentControls({
      instrument: state,
      onChange: () => {
        throw Error('Disabled controls changed state');
      },
      disabled: true,
    }),
  );
  equal(disabled.find((node) => node.type === 'fieldset').props.disabled, true);
  disabled
    .find((node) => node.type === 'input')
    .props.onChange({ target: { value: '1' } });
  checks++;
  disabled
    .find((node) => node.type === 'select')
    .props.onChange({
      target: { value: BROWSER_INSTRUMENT_PRESETS[id][0].id },
    });
  checks++;
}
const result = {
  checks,
  passed: true,
  scenarios: [
    'strict versioned state',
    'preset isolation',
    'bounded graph and MIDI tuning',
    'scheduled release',
    'cancellation and cleanup',
    'setup failure cleanup',
    'accessible controlled UI',
  ],
};
fs.mkdirSync('outputs/release-checks', { recursive: true });
fs.writeFileSync(
  path.resolve('outputs/release-checks/browser-instruments-unit.json'),
  JSON.stringify(result, null, 2),
);
console.log(
  `PASS: ${checks} browser instrument state, graph lifecycle and control assertions.`,
);
