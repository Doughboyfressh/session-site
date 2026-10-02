import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { loadTS } from './load-ts.mjs';

// Render the whole production component with synthetic hooks and JSX. UI
// primitives preserve their children; every API action is an in-memory stub.
const source = ts.transpileModule(fs.readFileSync('app/forms.tsx', 'utf8'), {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const catalog = loadTS('lib/catalog.ts');
const original = catalog.demos[0];
const community = {
  ...original,
  id: 'fixture-community',
  title: 'Community fixture',
  creator: 'Fixture owner',
  owner: 'owner-id',
  demo: false,
};
let assertions = 0;
const equal = (actual, expected, message) => {
  assert.equal(actual, expected, message);
  assertions++;
};

function fixture(track, user) {
  const hooks = [],
    actions = [],
    callbacks = [];
  let cursor = 0;
  let props = {
    track,
    user,
    saved: false,
    onClose: () => callbacks.push(['close']),
    onPlay: (value) => callbacks.push(['play', value.id]),
    onSave: (value) => callbacks.push(['save', value.id]),
    onUse: (value) => callbacks.push(['use', value.id]),
    onRequest: (value) => callbacks.push(['request', value.id]),
    onRemix: (value) => callbacks.push(['remix', value.id]),
    onRefresh: () => callbacks.push(['refresh']),
    notify: (value) => callbacks.push(['notify', value]),
  };
  const react = {
    useState(initial) {
      const index = cursor++;
      const entry = (hooks[index] ||= { value: initial });
      return [
        entry.value,
        (next) => {
          entry.value = typeof next === 'function' ? next(entry.value) : next;
        },
      ];
    },
    useEffect(create, deps) {
      const entry = (hooks[cursor++] ||= {});
      if (!entry.deps || deps.some((value, i) => value !== entry.deps[i]))
        entry.pending = true;
      entry.create = create;
      entry.deps = deps;
    },
  };
  const exports = {};
  const primitives = (names) =>
    Object.fromEntries(names.map((name) => [name, name]));
  vm.runInNewContext(source, {
    exports,
    require: (id) => {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime')
        return {
          Fragment: 'Fragment',
          jsx: (type, nodeProps) => ({ type, props: nodeProps }),
          jsxs: (type, nodeProps) => ({ type, props: nodeProps }),
        };
      if (id === 'lucide-react')
        return new Proxy(
          {},
          { get: (_target, name) => 'icon:' + String(name) },
        );
      if (id === './workspace-sign-in-link')
        return primitives(['WorkspaceSignInLink']);
      if (id === '@/components/ui/checkbox') return primitives(['Checkbox']);
      if (id === '@/components/ui/switch') return primitives(['Switch']);
      if (id === '@/components/ui/sheet')
        return primitives([
          'Sheet',
          'SheetContent',
          'SheetTitle',
          'SheetDescription',
        ]);
      if (id === '@/components/ui/dialog')
        return primitives([
          'Dialog',
          'DialogContent',
          'DialogTitle',
          'DialogDescription',
        ]);
      if (id === './cover-art') return { default: 'CoverArt' };
      if (id === '@/lib/catalog') return catalog;
      if (id === './helpers')
        return {
          ...primitives(['Pick', 'Avatar', 'Confirm']),
          action: async (request) => {
            actions.push(request);
            return [];
          },
          formatPrice: (value) => '$' + (value / 100).toFixed(2),
        };
      throw Error('Unexpected component dependency: ' + id);
    },
  });
  let tree;
  function render(nextProps = {}) {
    props = { ...props, ...nextProps };
    cursor = 0;
    tree = exports.TrackDetail(props);
    let ran = false;
    for (const entry of hooks)
      if (entry.pending) {
        entry.pending = false;
        entry.create();
        ran = true;
      }
    if (ran) {
      cursor = 0;
      tree = exports.TrackDetail(props);
    }
    return tree;
  }
  function nodes(type, visible = true) {
    const found = [];
    function walk(node) {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object') return;
      if (
        visible &&
        ['Sheet', 'Dialog', 'Confirm'].includes(node.type) &&
        !node.props.open
      )
        return;
      if (node.type === type) found.push(node);
      walk(node.props?.children);
    }
    walk(tree);
    return found;
  }
  function text(node) {
    if (Array.isArray(node)) return node.map(text).join('');
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'object') return text(node.props?.children);
    return String(node);
  }
  const button = (label) =>
    nodes('button').find(
      (node) =>
        node.props['aria-label'] === label || text(node).trim() === label,
    );
  render();
  return { render, nodes, button, actions, callbacks };
}

function permissions(
  name,
  track,
  user,
  { owner = false, use = false, request = false, remix = false } = {},
) {
  const view = fixture(track, user);
  equal(!!view.button('Sharing settings'), owner, name + ': sharing controls');
  equal(!!view.button('Delete track'), owner, name + ': deletion controls');
  equal(
    view.nodes('Confirm', false).length,
    owner ? 1 : 0,
    name + ': deletion action mounted only for owners',
  );
  equal(
    !!view.button(
      track.kind === 'song' ? 'Engineer this song' : 'Record on this beat',
    ),
    use,
    name + ': Studio permission',
  );
  equal(
    !!view.button('Request collaboration'),
    request,
    name + ': collaboration request',
  );
  equal(
    !!view.button('Start a tracked remix'),
    remix,
    name + ': remix permission',
  );
  equal(!!view.button('Play'), true, name + ': playback remains available');
  equal(!!view.button('Save'), true, name + ': saving remains available');
  equal(
    view.actions.some((entry) =>
      ['visibility', 'deleteTrack'].includes(entry.action),
    ),
    false,
    name + ': render does not mutate a track',
  );
  return view;
}

const guestOriginal = permissions('guest ownerless Original', original, null, {
  use: true,
});
const signedOriginal = permissions(
  'signed nonowner Original',
  original,
  { id: 'listener-id' },
  { use: true },
);
permissions(
  'Original with matching owner metadata',
  { ...original, owner: 'owner-id' },
  { id: 'owner-id' },
  { use: true },
);
const guestCollaborator = permissions(
  'guest owned community beat',
  community,
  null,
  { use: true, request: true, remix: true },
);
const signedCollaborator = permissions(
  'signed nonowner community beat',
  community,
  { id: 'listener-id' },
  { use: true, request: true, remix: true },
);
const owner = permissions(
  'owner community beat',
  community,
  { id: 'owner-id' },
  { owner: true, use: true },
);
permissions(
  'owner listen-only beat',
  { ...community, permission: 'listen' },
  { id: 'owner-id' },
  { owner: true, use: true },
);
permissions(
  'nonowner listen-only beat',
  { ...community, permission: 'listen' },
  { id: 'listener-id' },
);
permissions(
  'guest listen-only beat',
  { ...community, permission: 'listen' },
  null,
);
permissions(
  'guest malformed ownerless listen-only beat',
  { ...community, owner: undefined, permission: 'listen' },
  null,
);
permissions(
  'signed malformed ownerless listen-only beat',
  { ...community, owner: undefined, permission: 'listen' },
  {},
);
for (const id of ['', '   ', null, 7])
  permissions(
    'invalid matching owner ID ' + JSON.stringify(id),
    { ...community, owner: id, permission: 'listen' },
    { id },
  );
permissions(
  'community collaboration song',
  { ...community, kind: 'song' },
  { id: 'listener-id' },
  { use: true, request: true },
);

for (const view of [
  guestOriginal,
  signedOriginal,
  guestCollaborator,
  signedCollaborator,
]) {
  view.button('Record on this beat').props.onClick();
  equal(
    view.callbacks[0]?.[0],
    'use',
    'allowed Studio button calls the actual handler',
  );
}
signedCollaborator.button('Request collaboration').props.onClick();
signedCollaborator.button('Start a tracked remix').props.onClick();
equal(
  signedCollaborator.callbacks[1]?.[0],
  'request',
  'collaborator request handler remains available',
);
equal(
  signedCollaborator.callbacks[2]?.[0],
  'remix',
  'collaborator remix handler remains available',
);

// Exercise legitimate sharing with the stub, then remove ownership while the
// dialog is open. Never click a deletion control or contact a deployed backend.
owner.button('Sharing settings').props.onClick();
owner.render();
equal(!!owner.button('Save settings'), true, 'a valid owner can open sharing');
await owner.button('Save settings').props.onClick();
equal(
  owner.actions.filter((entry) => entry.action === 'visibility').length,
  1,
  'a valid owner can save sharing',
);
equal(
  owner.actions.find((entry) => entry.action === 'visibility').id,
  community.id,
  'sharing targets the owned track',
);
owner.render();
owner.button('Sharing settings').props.onClick();
owner.render();
equal(!!owner.button('Save settings'), true, 'sharing can be reopened');
owner.render({ user: null });
equal(
  !!owner.button('Save settings'),
  false,
  'sign-out hides an already open sharing dialog',
);
equal(
  owner.nodes('Confirm', false).length,
  0,
  'sign-out removes the deletion action',
);
owner.render({ user: { id: 'owner-id' }, track: original });
equal(
  !!owner.button('Save settings'),
  false,
  'switching to an Original hides stale sharing state',
);
equal(
  owner.nodes('Confirm', false).length,
  0,
  'switching to an Original removes deletion action',
);

console.log(
  `PASS: ${assertions} actual TrackDetail ownership and collaboration assertions; all actions synthetic and no deletion clicks.`,
);
