import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { loadTS } from './load-ts.mjs';

// Exercise the production editor across parent score updates without a browser,
// audio device, or network. Hook state survives renders as it does in Studio.
const drums = loadTS('lib/drum-pattern.ts');
const code = ts.transpileModule(
  fs.readFileSync('app/drum-sequencer.tsx', 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;
let checks = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks++;
};

function fixture(initialTrack) {
  const hooks = [];
  let cursor = 0,
    changed = false,
    tree,
    track = initialTrack;
  const react = {
    useMemo(create, deps) {
      const index = cursor++;
      const previous = hooks[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i]))
        hooks[index] = { value: create(), deps };
      return hooks[index].value;
    },
    useState(initial) {
      const index = cursor++;
      const entry = (hooks[index] ||= {
        value: typeof initial === 'function' ? initial() : initial,
      });
      return [
        entry.value,
        (next) => {
          const value = typeof next === 'function' ? next(entry.value) : next;
          if (!Object.is(value, entry.value)) {
            entry.value = value;
            changed = true;
          }
        },
      ];
    },
  };
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  const require = (id) => {
    if (id === 'react') return react;
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (id === 'lucide-react')
      return {
        Play: 'Play',
        RotateCcw: 'RotateCcw',
        Square: 'Square',
        Trash2: 'Trash2',
      };
    if (id === '@/lib/drum-pattern') return drums;
    throw Error('Unexpected drum editor dependency: ' + id);
  };
  vm.runInNewContext(code, { require, exports });
  const render = () => {
    let attempts = 0;
    do {
      assert.ok(
        attempts++ < 10,
        'Editor state must settle after a score update.',
      );
      cursor = 0;
      changed = false;
      tree = exports.default({
        track,
        bpm: 120,
        position: 0,
        disabled: false,
        busy: false,
        playing: false,
        onApply: (current, pattern) => {
          track = {
            ...current,
            drumPattern: structuredClone(pattern),
            sequence: undefined,
          };
        },
        onAdd: (pattern) => {
          track = {
            id: 'new-drums',
            name: 'New drums',
            offset: 0,
            drumPattern: pattern,
          };
        },
        onAudition() {},
        onStop() {},
      });
    } while (changed);
    return tree;
  };
  const nodes = () => {
    const found = [];
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === 'object') {
        found.push(node);
        walk(node.props?.children);
      }
    };
    walk(tree);
    return found;
  };
  const content = (node) => {
    if (Array.isArray(node)) return node.map(content).join('');
    if (node && typeof node === 'object') return content(node.props?.children);
    return typeof node === 'string' || typeof node === 'number'
      ? String(node)
      : '';
  };
  const button = (label) =>
    nodes().find((node) => node.type === 'button' && content(node) === label);
  const control = (label) =>
    nodes().find((node) => node.props?.['aria-label'] === label);
  const change = (label, value) => {
    control(label).props.onChange({ target: { value } });
    render();
  };
  const click = (label) => {
    const node = button(label) || control(label);
    assert.ok(node && !node.props.disabled, 'Action is available: ' + label);
    node.props.onClick();
    render();
  };
  render();
  return {
    button,
    control,
    change,
    click,
    nodes,
    content,
    getTrack: () => track,
    update(next) {
      track = next;
      render();
    },
  };
}

const original = {
  id: 'same-drum-channel',
  name: 'Drums',
  offset: 0,
  drumPattern: drums.defaultDrumPattern(),
};
const editor = fixture(structuredClone(original));
equal(
  editor.control('Drum kit').props.value,
  'studio',
  'Initial committed kit is displayed.',
);
editor.change('Drum kit', 'analog');
editor.change('Pattern swing', '30');
editor.click('Kick step 2 · Off 0%');
equal(
  editor.control('Kick step 2 · Soft 40%').props['aria-pressed'],
  true,
  'A draft step is editable.',
);
editor.update({
  ...editor.getTrack(),
  name: 'Renamed drums',
  volume: 0.4,
  peaks: [0.2, 0.8],
});
equal(
  editor.control('Drum kit').props.value,
  'analog',
  'Mix, name, and waveform updates preserve the draft kit.',
);
equal(
  editor.control('Pattern swing').props.value,
  30,
  'Unrelated updates preserve draft swing.',
);
equal(
  editor.control('Kick step 2 · Soft 40%').props['aria-pressed'],
  true,
  'Unrelated updates preserve draft notes.',
);
editor.update(structuredClone(editor.getTrack()));
equal(
  editor.control('Drum kit').props.value,
  'analog',
  'An identical score delivered as a new object preserves the draft.',
);
editor.click('Apply changes');
const applied = structuredClone(editor.getTrack());
equal(applied.drumPattern.kit, 'analog', 'Apply commits the draft.');
equal(
  editor.button('Apply changes').props.disabled,
  true,
  'The applied draft is no longer dirty.',
);
editor.update(structuredClone(original));
equal(
  editor.control('Drum kit').props.value,
  'studio',
  'Undo updates the displayed kit on the same channel.',
);
equal(
  editor.control('Pattern swing').props.value,
  0,
  'Undo updates displayed swing.',
);
equal(
  editor.control('Kick step 2 · Off 0%').props['aria-pressed'],
  false,
  'Undo updates displayed steps.',
);
equal(
  editor.button('Apply changes').props.disabled,
  true,
  'Undo cannot silently reapply the undone score.',
);
equal(
  editor.button('Cancel draft').props.disabled,
  true,
  'Undo clears the previous draft.',
);
editor.update(applied);
equal(
  editor.control('Drum kit').props.value,
  'analog',
  'Redo updates the displayed kit.',
);
equal(
  editor.control('Pattern swing').props.value,
  30,
  'Redo updates displayed swing.',
);
equal(
  editor.button('Apply changes').props.disabled,
  true,
  'Redo leaves no phantom draft.',
);

editor.change('Pattern length', '64');
editor.click('Kick step 64 · Off 0%');
editor.click('Apply changes');
editor.change('Drum kit', 'dusty');
const remote = {
  ...editor.getTrack(),
  drumPattern: drums.defaultDrumPattern(16, 'acoustic'),
};
editor.update(remote);
equal(
  editor.control('Drum kit').props.value,
  'acoustic',
  'A collaborator score replaces a stale local draft.',
);
equal(
  editor.control('Pattern length').props.value,
  16,
  'Remote score length is displayed.',
);
equal(
  editor.button('Apply changes').props.disabled,
  true,
  'The received score is clean.',
);
equal(
  editor.control('Selected step velocity').props.value,
  0,
  'The selected step remains a valid velocity after shortening.',
);
equal(
  editor
    .nodes()
    .some(
      (node) =>
        node.type === 'span' && editor.content(node).includes('step 16'),
    ),
  true,
  'Shortening a received score clamps the selected step to its last valid index.',
);

const legacy = {
  ...original,
  drumPattern: undefined,
  sequence: [Array(16).fill(0), Array(16).fill(0), Array(16).fill(0)],
};
editor.update(legacy);
editor.change('Drum kit', 'latin');
editor.click('Upgrade & apply');
equal(
  editor.getTrack().drumPattern.kit,
  'latin',
  'A legacy upgrade applies normally.',
);
editor.update(structuredClone(legacy));
equal(
  editor.control('Drum kit').props.value,
  'studio',
  'Undoing a legacy upgrade restores the legacy draft.',
);
equal(
  editor.button('Upgrade & apply').props.disabled,
  false,
  'The legacy score remains explicitly available to upgrade.',
);

const scratch = fixture(undefined);
scratch.change('Drum kit', 'dusty');
scratch.change('Pattern length', '32');
scratch.update(undefined);
equal(
  scratch.control('Drum kit').props.value,
  'dusty',
  'An uncommitted new-track draft survives unrelated rerenders.',
);
equal(
  scratch.control('Pattern length').props.value,
  32,
  'The new-track draft retains its length.',
);

console.log(`Drum editor score synchronization passed (${checks} assertions).`);
