import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { loadTS } from './load-ts.mjs';

const automation = loadTS('lib/automation.ts');
const source = ts.transpileModule(
  fs.readFileSync('app/automation-editor.tsx', 'utf8'),
  {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
let checks = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks++;
};
const original = {
  id: 'track-a',
  name: 'Track A',
  volume: 0.8,
  pan: 0,
  automationLanes: {
    volume: [
      { time: 1, value: 0.8 },
      { time: 6, value: 1.2 },
    ],
    pan: [{ time: 1, value: 0 }],
  },
};

class Target {
  listeners = new Map();
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(callback);
  }
  removeEventListener(name, callback) {
    this.listeners.get(name)?.delete(callback);
  }
  dispatch(name) {
    for (const callback of this.listeners.get(name) || []) callback();
  }
  count() {
    return [...this.listeners.values()].reduce(
      (sum, callbacks) => sum + callbacks.size,
      0,
    );
  }
}

function fixture({ captureFailure = false, synchronousLoss = false } = {}) {
  const hooks = [],
    activity = [],
    patches = [];
  let cursor = 0,
    tree,
    dirty = false,
    mounted = true,
    lateWrites = 0;
  let options = {
    track: structuredClone(original),
    length: 8,
    bpm: 120,
    position: 0,
    disabled: false,
  };
  const window = new Target();
  const document = Object.assign(new Target(), { hidden: false });
  const graph = {
    captured: new Set(),
    releases: 0,
    setPointerCapture(id) {
      if (captureFailure) throw Error('Inactive pointer');
      this.captured.add(id);
    },
    hasPointerCapture(id) {
      return this.captured.has(id);
    },
    releasePointerCapture(id) {
      this.captured.delete(id);
      this.releases++;
      if (synchronousLoss) svg().props.onLostPointerCapture(event(id));
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 230 };
    },
  };
  const sameDeps = (a, b) =>
    a && a.length === b.length && b.every((value, i) => Object.is(value, a[i]));
  const react = {
    useRef(value) {
      return (hooks[cursor++] ||= { ref: { current: value } }).ref;
    },
    useState(initial) {
      const entry = (hooks[cursor++] ||= {
        value: typeof initial === 'function' ? initial() : initial,
      });
      return [
        entry.value,
        (next) => {
          if (!mounted) lateWrites++;
          const value = typeof next === 'function' ? next(entry.value) : next;
          if (!Object.is(value, entry.value)) {
            entry.value = value;
            dirty = true;
          }
        },
      ];
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!sameDeps(hooks[index]?.deps, deps))
        hooks[index] = { callback, deps };
      return hooks[index].callback;
    },
    useEffect(create, deps) {
      const entry = (hooks[cursor++] ||= {});
      if (!sameDeps(entry.deps, deps)) {
        entry.pending = true;
        entry.create = create;
        entry.deps = deps;
      }
    },
  };
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(source, {
    exports,
    window,
    document,
    require(id) {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (id === '@/lib/automation') return automation;
      if (id === './helpers') return { Pick: 'Pick' };
      if (id === 'lucide-react')
        return {
          ClipboardPaste: 'ClipboardPaste',
          Copy: 'Copy',
          Plus: 'Plus',
          Trash2: 'Trash2',
        };
      throw Error('Unexpected editor dependency: ' + id);
    },
  });
  const nodes = () => {
    const result = [];
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === 'object') {
        result.push(node);
        walk(node.props?.children);
      }
    };
    walk(tree);
    return result;
  };
  const svg = () => nodes().find((node) => node.type === 'svg');
  const render = () => {
    let attempts = 0;
    do {
      assert.ok(attempts++ < 10, 'Gesture state settles.');
      cursor = 0;
      dirty = false;
      tree = exports.default({
        ...options,
        onGestureActivity: (active) => activity.push(active),
        onChange: (patch) => patches.push(patch),
      });
      if (svg()) svg().props.ref.current = graph;
      else
        for (const entry of hooks)
          if (entry.ref?.current === graph) entry.ref.current = null;
      for (const entry of hooks)
        if (entry.pending) {
          entry.pending = false;
          entry.cleanup?.();
          entry.cleanup = entry.create();
        }
    } while (dirty);
  };
  const event = (pointerId = 1, extra = {}) => ({
    pointerId,
    button: 0,
    isPrimary: true,
    clientX: 261,
    clientY: 135,
    preventDefault() {},
    stopPropagation() {},
    ...extra,
  });
  const start = (id = 1, extra = {}) => {
    nodes()
      .find((node) => node.type === 'circle')
      .props.onPointerDown(event(id, extra));
    render();
  };
  const move = (id = 1) => {
    svg().props.onPointerMove(event(id));
    render();
  };
  const finish = (name, id = 1) => {
    svg().props[name](event(id));
    render();
  };
  const unmount = () => {
    mounted = false;
    for (const entry of hooks) entry.cleanup?.();
  };
  render();
  return {
    activity,
    patches,
    graph,
    window,
    document,
    nodes,
    svg,
    start,
    move,
    finish,
    unmount,
    event,
    render,
    precision() {
      const numbers = nodes().filter(
        (node) => node.type === 'input' && node.props.type === 'number',
      );
      const action = nodes().find(
        (node) =>
          node.type === 'button' && node.props.className === 'button primary',
      );
      return {
        time: numbers[0]?.props.value,
        value: numbers[1]?.props.value,
        curve: nodes().find(
          (node) =>
            node.type === 'Pick' && node.props.label === 'Curve to next point',
        )?.props.value,
        action: action?.props.children?.[2],
      };
    },
    replayEffects() {
      for (const entry of hooks) entry.cleanup?.();
      for (const entry of hooks)
        if (entry.create) entry.cleanup = entry.create();
      render();
    },
    lateWrites: () => lateWrites,
    update(patch) {
      options = { ...options, ...patch };
      render();
    },
    selectTarget(target) {
      nodes()
        .find(
          (node) =>
            node.type === 'Pick' && node.props.label === 'Automation target',
        )
        .props.onChange(target);
      render();
    },
  };
}

const completed = fixture({ synchronousLoss: true });
equal(
  completed.window.count() + completed.document.count(),
  3,
  'The mounted editor owns three cancellation listeners.',
);
completed.replayEffects();
equal(
  completed.window.count() + completed.document.count(),
  3,
  'StrictMode effect replay does not duplicate listeners.',
);
equal(
  completed.activity,
  [],
  'StrictMode effect replay does not announce a phantom gesture.',
);
completed.start();
completed.move();
completed.move();
equal(completed.patches.length, 0, 'Moving only previews the lane.');
completed.finish('onPointerUp');
equal(completed.patches.length, 1, 'A completed drag commits exactly once.');
equal(
  completed.activity,
  [true, false],
  'Completion reports inactive exactly once, including reentrant capture loss.',
);
equal(completed.graph.releases, 1, 'Completion releases capture once.');
equal(
  completed.patches[0].automationLanes.volume[0].time,
  2,
  'A completed drag commits its moved time.',
);
equal(
  completed.patches[0].automationLanes.pan[0].value,
  0,
  'Completion preserves unrelated automation lanes.',
);
completed.finish('onPointerUp');
completed.finish('onPointerCancel');
completed.finish('onLostPointerCapture');
equal(
  completed.patches.length,
  1,
  'Duplicate finish events cannot commit again.',
);
equal(
  completed.activity,
  [true, false],
  'Duplicate finish events cannot notify again.',
);

for (const reason of ['onPointerCancel', 'onLostPointerCapture']) {
  const f = fixture();
  f.start();
  f.move();
  if (reason === 'onLostPointerCapture') f.graph.captured.clear();
  f.finish(reason);
  equal(f.patches.length, 0, `${reason} cancels without a patch.`);
  equal(f.precision().time, 1, `${reason} restores the source point time.`);
  equal(f.precision().value, 0.8, `${reason} restores the source point value.`);
  equal(
    f.precision().action,
    'Update point',
    `${reason} restores the source point selection.`,
  );
  equal(f.activity, [true, false], `${reason} clears gesture activity once.`);
  equal(f.graph.captured.size, 0, `${reason} leaves no capture.`);
  f.finish('onPointerUp');
  equal(f.patches.length, 0, `${reason} ignores a later pointerup.`);
}

const tabSwitch = fixture();
tabSwitch.start();
tabSwitch.move();
tabSwitch.unmount();
equal(
  tabSwitch.activity,
  [true, false],
  'Unmounting during a gesture unblocks the parent.',
);
equal(
  tabSwitch.patches.length,
  0,
  'A tab switch never commits a partial gesture.',
);
equal(
  tabSwitch.graph.captured.size,
  0,
  'Unmounting releases the retained graph capture.',
);
equal(
  tabSwitch.window.count() + tabSwitch.document.count(),
  0,
  'Unmounting removes all cancellation listeners.',
);
equal(
  tabSwitch.lateWrites(),
  0,
  'Unmount cleanup does not write local component state.',
);
tabSwitch.unmount();
equal(
  tabSwitch.activity,
  [true, false],
  'Repeated cleanup remains idempotent.',
);

const pendingLoss = fixture();
pendingLoss.start();
pendingLoss.move();
pendingLoss.graph.captured.clear();
pendingLoss.finish('onPointerUp');
equal(
  pendingLoss.patches.length,
  0,
  'Capture loss cancels even before its event is delivered.',
);
equal(
  pendingLoss.activity,
  [true, false],
  'Pending capture loss reliably clears activity.',
);

const sameTurn = fixture();
sameTurn.start();
sameTurn.svg().props.onPointerMove(sameTurn.event());
sameTurn.svg().props.onPointerUp(sameTurn.event());
equal(
  sameTurn.patches.length,
  1,
  'Move and release in one render still commit once.',
);
equal(
  sameTurn.patches[0].automationLanes.volume[0].time,
  2,
  'Same-turn release commits the latest preview.',
);
equal(
  sameTurn.activity,
  [true, false],
  'Same-turn completion clears activity once.',
);

for (const { label, patch } of [
  { label: 'disabled/busy', patch: { disabled: true } },
  {
    label: 'track change',
    patch: { track: { ...structuredClone(original), id: 'track-b' } },
  },
  { label: 'track removal', patch: { track: undefined } },
  {
    label: 'received lane update',
    patch: {
      track: {
        ...original,
        automationLanes: {
          ...original.automationLanes,
          volume: [{ time: 1, value: 0.1 }],
        },
      },
    },
  },
  { label: 'tempo change', patch: { bpm: 90 } },
  { label: 'length change', patch: { length: 6 } },
]) {
  const f = fixture();
  f.start();
  f.move();
  f.update(patch);
  equal(f.activity, [true, false], `${label} clears gesture activity.`);
  equal(f.graph.captured.size, 0, `${label} releases capture.`);
  equal(f.patches.length, 0, `${label} never patches a stale lane.`);
  if (f.svg()) {
    const unchangedSource = label === 'disabled/busy';
    equal(
      f.precision().time,
      unchangedSource ? 1 : 0,
      `${label} clears the canceled preview time.`,
    );
    equal(
      f.precision().value,
      unchangedSource ? 0.8 : 1,
      `${label} clears the canceled preview value.`,
    );
    equal(
      f.precision().action,
      unchangedSource ? 'Update point' : 'Add point',
      `${label} restores or clears the point selection.`,
    );
    f.finish('onPointerUp');
  }
  equal(f.patches.length, 0, `${label} ignores a later completion.`);
}

const target = fixture();
target.start();
target.move();
target.selectTarget('pan');
equal(
  target.activity,
  [true, false],
  'Changing lanes cancels the active gesture.',
);
equal(
  target.precision().time,
  0,
  'Changing lanes clears the canceled point time.',
);
equal(
  target.precision().value,
  0,
  'Changing lanes uses the new lane default value.',
);
equal(
  target.precision().action,
  'Add point',
  'Changing lanes clears the old selection.',
);
target.finish('onPointerUp');
equal(
  target.patches.length,
  0,
  'Changing lanes cannot patch the old lane into the new target.',
);

for (const name of ['blur', 'resize', 'visibilitychange']) {
  const f = fixture();
  f.start();
  f.move();
  if (name === 'visibilitychange') {
    f.document.hidden = true;
    f.document.dispatch(name);
  } else f.window.dispatch(name);
  f.render();
  equal(f.activity, [true, false], `${name} cancels activity.`);
  equal(f.graph.captured.size, 0, `${name} releases capture.`);
  equal(f.precision().time, 1, `${name} restores the source time.`);
  equal(f.precision().value, 0.8, `${name} restores the source value.`);
  equal(
    f.precision().action,
    'Update point',
    `${name} restores the source selection.`,
  );
  f.finish('onPointerUp');
  equal(f.patches.length, 0, `${name} cannot commit later.`);
}

const wrongPointer = fixture();
const hold = fixture();
hold.update({
  track: {
    ...original,
    automationLanes: {
      ...original.automationLanes,
      volume: [{ time: 1, value: 0.8, curve: 'hold' }],
    },
  },
});
hold.start();
hold.move();
hold.finish('onPointerCancel');
equal(
  hold.precision().curve,
  'hold',
  'Cancellation restores the source curve setting.',
);
const panDefault = fixture();
panDefault.selectTarget('pan');
panDefault.start();
panDefault.move();
panDefault.update({
  track: {
    ...original,
    pan: 0.4,
    automationLanes: {
      ...original.automationLanes,
      pan: [{ time: 1, value: -0.5 }],
    },
  },
});
equal(
  panDefault.precision().value,
  0.4,
  'A received non-volume lane update resets to the new channel default.',
);
equal(
  panDefault.precision().curve,
  'linear',
  'A changed source clears the canceled curve setting.',
);
equal(
  panDefault.precision().action,
  'Add point',
  'A changed non-volume source clears the canceled selection.',
);

wrongPointer.start();
wrongPointer.move(2);
wrongPointer.finish('onPointerCancel', 2);
equal(
  wrongPointer.activity,
  [true],
  'An unrelated pointer cannot end the owner gesture.',
);
equal(
  wrongPointer.graph.captured.has(1),
  true,
  'An unrelated pointer cannot release owned capture.',
);
wrongPointer.start(2);
wrongPointer.move();
wrongPointer.finish('onPointerUp');
equal(
  wrongPointer.activity,
  [true, false],
  'Overlapping pointers retain one gesture owner.',
);
equal(
  wrongPointer.patches.length,
  1,
  'The original pointer still completes once.',
);

const preserved = fixture();
preserved.start();
preserved.move();
preserved.update({
  track: {
    ...structuredClone(original),
    name: 'Renamed',
    volume: 0.4,
    peaks: [0.2],
  },
});
equal(
  preserved.activity,
  [true],
  'Unrelated name, mixer, and waveform updates preserve a live drag.',
);
preserved.finish('onPointerUp');
equal(
  preserved.patches.length,
  1,
  'An unchanged source can still complete after an unrelated update.',
);
const untouched = fixture();
untouched.document.dispatch('visibilitychange');
equal(
  untouched.activity,
  [],
  'A visible document does not announce a gesture.',
);
untouched.update({ disabled: true });
untouched.start();
equal(untouched.activity, [], 'Disabled controls cannot begin a gesture.');
const failure = fixture({ captureFailure: true });
failure.start();
equal(failure.activity, [], 'Failed capture does not leave the parent busy.');
equal(
  failure.patches.length,
  0,
  'Failed capture does not create a lane patch.',
);
const secondary = fixture();
secondary.start(1, { button: 2 });
secondary.start(2, { isPrimary: false });
equal(
  secondary.activity,
  [],
  'Secondary buttons and nonprimary pointers cannot begin a gesture.',
);

console.log(
  `Automation editor interruption checks passed (${checks} assertions).`,
);
