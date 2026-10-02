import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Run the actual inbox component and its event handlers with synthetic React
// hooks, visibility/focus events, timers, and deferred local-only API responses.
// Fetch deliberately ignores aborts to prove obsolete results cannot publish.
const source = ts.transpileModule(fs.readFileSync('app/social.tsx', 'utf8'), {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const flush = () => new Promise((resolve) => setImmediate(resolve));
const clone = (value) => JSON.parse(JSON.stringify(value));
const request = (id, sender, recipient, name, status = 'accepted') => ({
  id,
  sender,
  recipient,
  senderName: name,
  recipientName: name,
  senderUsername: name.toLowerCase(),
  recipientUsername: name.toLowerCase(),
  role: 'Producer',
  message: 'A private fixture request for ' + name,
  status,
  created: 10,
  updated: 20,
});
const incoming = request('incoming-new', 'peer-new', 'member', 'Newest');
const older = request('incoming-old', 'peer-old', 'member', 'Older');
const sent = request('sent', 'member', 'peer-sent', 'Sent peer');
const outsider = request('outsider', 'another', 'someone-else', 'Outsider');
const message = (id, body, sender = 'peer-old') => ({
  id,
  body,
  sender,
  senderName: 'Peer',
  created: 100,
});
let assertions = 0;
function equal(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  assertions++;
}
function check(value, label) {
  assert.ok(value, label);
  assertions++;
}
function children(node) {
  if (Array.isArray(node)) return node.flatMap(children);
  if (!node || typeof node !== 'object') return [];
  return [node, ...children(node.props?.children)];
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return node?.props ? text(node.props.children) : '';
}

function fixture(props = {}) {
  const hooks = [],
    calls = [],
    timers = new Map(),
    callbacks = [];
  const records = new Map(
    [incoming, older, sent].map((item) => [item.id, item]),
  );
  let cursor = 0,
    dirty = false,
    mounted = false,
    lateWrites = 0,
    tree,
    timerId = 0;
  let currentProps = {
    userId: 'member',
    notify: (v) => callbacks.push(v),
    onChanged: () => callbacks.push('changed'),
    ...props,
  };
  const same = (a, b) =>
    a && b && a.length === b.length && a.every((v, i) => v === b[i]);
  const react = {
    useState(initial) {
      const entry = (hooks[cursor++] ||= {
        value: typeof initial === 'function' ? initial() : initial,
      });
      entry.setter ||= (next) => {
        if (!mounted) lateWrites++;
        const value = typeof next === 'function' ? next(entry.value) : next;
        if (!Object.is(entry.value, value)) {
          entry.value = value;
          dirty = true;
        }
      };
      return [entry.value, entry.setter];
    },
    useRef(value) {
      return (hooks[cursor++] ||= { ref: { current: value } }).ref;
    },
    useMemo(create, deps) {
      const entry = (hooks[cursor++] ||= {});
      if (!same(entry.deps, deps)) {
        entry.value = create();
        entry.deps = deps;
      }
      return entry.value;
    },
    useCallback(fn, deps) {
      return react.useMemo(() => fn, deps);
    },
    useEffect(create, deps) {
      const entry = (hooks[cursor++] ||= {});
      if (!same(entry.deps, deps)) entry.pending = true;
      entry.create = create;
      entry.deps = deps;
    },
  };
  class Target {
    listeners = new Map();
    addEventListener(name, fn) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(fn);
    }
    removeEventListener(name, fn) {
      this.listeners.get(name)?.delete(fn);
    }
    dispatch(name) {
      for (const fn of this.listeners.get(name) || []) fn();
    }
    get listenerCount() {
      return [...this.listeners.values()].reduce((n, list) => n + list.size, 0);
    }
  }
  const document = new Target();
  document.visibilityState = 'visible';
  const window = new Target();
  window.confirm = () => true;
  const exports = {};
  const jsx = (type, props, key) => ({ type, props, key });
  vm.runInNewContext(source, {
    exports,
    document,
    window,
    AbortController,
    crypto,
    setInterval: (fn, ms) => {
      timers.set(++timerId, { fn, ms });
      return timerId;
    },
    clearInterval: (id) => timers.delete(id),
    fetch: (url, init = {}) =>
      new Promise((resolve) => {
        const call = { url, init, resolve, done: false };
        call.kind =
          init.method === 'POST'
            ? 'action'
            : url.includes('view=inbox')
              ? 'inbox'
              : 'thread';
        calls.push(call);
      }),
    require: (id) => {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (id.endsWith('.css')) return {};
      if (
        id === 'lucide-react' ||
        id === '@/components/ui/dialog' ||
        id === './helpers'
      )
        return new Proxy({}, { get: (_target, name) => String(name) });
      throw Error('Unexpected component dependency ' + id);
    },
  });
  function render() {
    cursor = 0;
    dirty = false;
    const wrapper = exports.CollaborationInbox(currentProps);
    tree = wrapper.type(wrapper.props);
    return tree;
  }
  function effects() {
    const pending = hooks.filter((entry) => entry.pending);
    for (const entry of pending) entry.cleanup?.();
    for (const entry of pending) {
      entry.pending = false;
      entry.cleanup = entry.create();
    }
  }
  const f = {
    calls,
    timers,
    callbacks,
    document,
    window,
    get tree() {
      return tree;
    },
    get lateWrites() {
      return lateWrites;
    },
    mount() {
      mounted = true;
      render();
      effects();
    },
    replay() {
      for (const entry of hooks) entry.cleanup?.();
      for (const entry of hooks) if (entry.create) entry.pending = true;
      effects();
    },
    unmount() {
      for (const entry of hooks) entry.cleanup?.();
      mounted = false;
    },
    update(next) {
      currentProps = { ...currentProps, ...next };
      render();
      effects();
    },
    key(userId) {
      return exports.CollaborationInbox({ ...currentProps, userId }).key;
    },
    async drain() {
      for (let i = 0; i < 10; i++) {
        await flush();
        if (dirty) {
          render();
          effects();
        } else {
          await flush();
          if (!dirty) break;
        }
      }
    },
    pending(kind) {
      return calls.filter((call) => call.kind === kind && !call.done);
    },
    respond(call, data, status = 200) {
      check(
        call && !call.done,
        'response belongs to a pending synthetic request',
      );
      call.done = true;
      if (call.kind === 'inbox' && status < 400)
        for (const item of data.requests) records.set(item.id, clone(item));
      const id = new URL(call.url, 'http://fixture').searchParams.get('id');
      const snapshot = clone(
        call.kind === 'thread' && status < 400 && !('request' in data)
          ? {
              request: records.get(id),
              ...data,
            }
          : data,
      );
      call.resolve({ ok: status < 400, status, json: async () => snapshot });
    },
    node(predicate) {
      return children(tree).find(predicate);
    },
    button(label) {
      return f.node(
        (node) => node.type === 'button' && text(node).trim() === label,
      );
    },
    card(name) {
      return f.node(
        (node) =>
          node.props?.className?.startsWith('request-card') &&
          text(node).includes(name),
      );
    },
    selected() {
      return text(f.node((node) => node.type === 'h3'));
    },
    draft() {
      return f.node((node) => node.type === 'textarea')?.props.value;
    },
    type(value) {
      f.node((node) => node.type === 'textarea').props.onChange({
        target: { value },
      });
    },
    tick() {
      for (const { fn } of timers.values()) fn();
    },
    async ready(requests = [incoming, older, sent]) {
      f.mount();
      await f.drain();
      f.respond(f.pending('inbox')[0], { requests, blocks: [] });
      await f.drain();
      const thread = f.pending('thread')[0];
      if (thread) {
        const id = new URL(thread.url, 'http://fixture').searchParams.get('id');
        const request = [incoming, older, sent].find((item) => item.id === id);
        f.respond(
          thread,
          request
            ? { request, messages: [] }
            : { error: 'This collaboration is no longer available.' },
          request ? 200 : 404,
        );
        await f.drain();
      }
    },
  };
  return f;
}

// Alert selection is authorized and chooses the proper folder, including older
// incoming requests and requests sent by the current member.
for (const [id, name, folder] of [
  ['incoming-old', 'Older', 'Incoming'],
  ['sent', 'Sent peer', 'Sent'],
]) {
  const f = fixture({ requestedCollaborationId: id });
  await f.ready();
  equal(
    f.selected(),
    name,
    'alert opens its request instead of newest incoming',
  );
  equal(
    f.button(folder).props.className,
    'active',
    'alert opens correct folder',
  );
  equal(
    new URL(
      f.calls.find((call) => call.kind === 'thread').url,
      'http://fixture',
    ).searchParams.get('id'),
    id,
    'only target thread is read',
  );
  f.unmount();
}
{
  const f = fixture({ requestedCollaborationId: 'outsider' });
  await f.ready([incoming, outsider]);
  equal(
    f.pending('thread').length,
    0,
    'unauthorized alert never keeps a thread read active',
  );
  equal(
    f.calls.filter((call) => call.kind === 'thread').length,
    1,
    'page-missing target is resolved through the authorized thread endpoint',
  );
  check(
    text(f.tree).includes('no longer available'),
    'unavailable alert has a readable error',
  );
  equal(
    f.selected(),
    'Select a request.',
    'unknown alert does not select an unrelated request',
  );
  f.tick();
  f.respond(f.pending('inbox')[0], { requests: [incoming], blocks: [] });
  await f.drain();
  equal(
    f.selected(),
    'Select a request.',
    'subsequent refresh does not replace a missing target',
  );
  f.card('Newest').props.onClick();
  await f.drain();
  equal(f.selected(), 'Newest', 'reader can recover with a manual selection');
  f.unmount();
}

// Alerts older than the newest inbox page resolve their authorized request and
// messages together. Polls retain only the active extra record and its draft.
{
  const f = fixture({ requestedCollaborationId: 'incoming-old' });
  f.mount();
  await f.drain();
  f.respond(f.pending('inbox')[0], { requests: [incoming, sent], blocks: [] });
  await f.drain();
  const lookup = f.pending('thread')[0];
  equal(
    new URL(lookup.url, 'http://fixture').searchParams.get('id'),
    older.id,
    'older alert resolves the exact out-of-page request',
  );
  f.respond(lookup, {
    request: older,
    messages: [message('older-history', 'History outside the inbox page')],
  });
  await f.drain();
  equal(
    f.selected(),
    'Older',
    'out-of-page alert selects its hydrated request',
  );
  equal(
    f.button('Incoming').props.className,
    'active',
    'hydrated target selects its folder',
  );
  check(
    text(f.tree).includes('History outside the inbox page'),
    'target hydration displays its messages',
  );
  equal(
    f.pending('thread').length,
    0,
    'target hydration does not duplicate its initial thread read',
  );
  f.type('Draft outside the newest page');
  await f.drain();
  f.tick();
  f.respond(f.pending('inbox')[0], { requests: [incoming, sent], blocks: [] });
  f.respond(f.pending('thread')[0], {
    request: { ...older, status: 'closed', updated: 30 },
    messages: [message('older-update', 'Updated older history')],
  });
  await f.drain();
  equal(f.selected(), 'Older', 'inbox polling retains out-of-page selection');
  check(
    text(f.tree).includes('This conversation is closed'),
    'thread polling refreshes out-of-page status',
  );
  check(
    text(f.tree).includes('Updated older history'),
    'thread polling refreshes out-of-page messages',
  );
  f.tick();
  f.respond(f.pending('inbox')[0], { requests: [incoming, sent], blocks: [] });
  f.respond(f.pending('thread')[0], {
    request: { ...older, updated: 40 },
    messages: [],
  });
  await f.drain();
  equal(
    f.draft(),
    'Draft outside the newest page',
    'out-of-page status refresh preserves its draft',
  );
  f.card('Newest').props.onClick();
  await f.drain();
  check(!f.card('Older'), 'leaving older conversation prunes the extra record');
  f.respond(f.pending('thread')[0], { messages: [] });
  await f.drain();
  f.update({ requestedCollaborationId: 'sent' });
  await f.drain();
  f.respond(f.pending('inbox')[0], { requests: [incoming], blocks: [] });
  await f.drain();
  f.respond(f.pending('thread')[0], { request: sent, messages: [] });
  await f.drain();
  equal(
    f.selected(),
    'Sent peer',
    'out-of-page sent alert resolves its request',
  );
  equal(
    f.button('Sent').props.className,
    'active',
    'out-of-page sent target chooses sent folder',
  );
  f.update({ requestedCollaborationId: older.id });
  await f.drain();
  f.respond(f.pending('inbox')[0], { requests: [incoming], blocks: [] });
  await f.drain();
  f.respond(f.pending('thread')[0], { request: older, messages: [] });
  await f.drain();
  equal(
    f.draft(),
    'Draft outside the newest page',
    'rehydrated older target recovers its own draft',
  );
  check(
    !f.card('Sent peer'),
    'hydrated records stay bounded to the current selection',
  );
  f.unmount();
}

// An existing selection can leave the newest page without a new alert. Thread
// permission loss then clears unavailable details without exposing its draft.
{
  const f = fixture({ requestedCollaborationId: older.id });
  await f.ready();
  f.type('Retain locally after permission loss');
  await f.drain();
  f.tick();
  f.respond(f.pending('inbox')[0], { requests: [incoming, sent], blocks: [] });
  f.respond(f.pending('thread')[0], { request: older, messages: [] });
  await f.drain();
  equal(
    f.selected(),
    'Older',
    'page eviction keeps the current authorized selection',
  );
  equal(
    f.draft(),
    'Retain locally after permission loss',
    'page eviction keeps the current draft',
  );
  f.tick();
  f.respond(f.pending('inbox')[0], { requests: [incoming, sent], blocks: [] });
  f.respond(
    f.pending('thread')[0],
    { error: 'Conversation access is unavailable.' },
    403,
  );
  await f.drain();
  equal(
    f.selected(),
    'Select a request.',
    'permission loss clears selected conversation details',
  );
  check(
    !f.card('Older') && !f.draft(),
    'permission loss removes the extra record and hides its draft',
  );
  check(
    text(f.tree).includes('Conversation access is unavailable.'),
    'permission loss shows the API error',
  );
  f.unmount();
}

// Inbox and thread polls run together. Their completion order cannot roll back
// newer request metadata, and the newest message preview advances independently.
for (const newer of ['inbox', 'thread']) {
  for (const first of ['inbox', 'thread']) {
    const f = fixture({ requestedCollaborationId: older.id });
    await f.ready();
    f.type('Draft during concurrent metadata refresh');
    await f.drain();
    f.tick();
    const inbox = f.pending('inbox')[0];
    const thread = f.pending('thread')[0];
    const inboxRequest = {
      ...older,
      status: newer === 'inbox' ? 'closed' : 'accepted',
      updated: newer === 'inbox' ? '30' : '20',
      lastMessage: 'Newest inbox preview',
      lastMessageAt: '200',
    };
    const threadRequest = {
      ...older,
      status: newer === 'thread' ? 'closed' : 'accepted',
      updated: newer === 'thread' ? '30' : '20',
    };
    const respond = (kind) =>
      kind === 'inbox'
        ? f.respond(inbox, {
            requests: [incoming, inboxRequest, sent],
            blocks: [],
          })
        : f.respond(thread, {
            request: threadRequest,
            messages: [message('prior-preview', 'Earlier thread preview')],
          });
    respond(first);
    await f.drain();
    respond(first === 'inbox' ? 'thread' : 'inbox');
    await f.drain();
    check(
      text(f.tree).includes('This conversation is closed'),
      `${newer} metadata survives ${first}-first completion`,
    );
    check(
      text(f.card('Older')).includes('Newest inbox preview'),
      'newest message preview survives an older thread history response',
    );
    f.tick();
    f.respond(f.pending('inbox')[0], {
      requests: [incoming, sent],
      blocks: [],
    });
    f.respond(f.pending('thread')[0], {
      request: { ...older, status: 'accepted', updated: '40' },
      messages: [],
    });
    await f.drain();
    equal(
      f.draft(),
      'Draft during concurrent metadata refresh',
      'monotonic metadata merge preserves selected draft through page eviction',
    );
    f.unmount();
  }
}

// Retry belongs to the failed manual selection even when an older alert target
// remains in props. Its original draft stays attached to the failed request.
{
  const f = fixture({ requestedCollaborationId: older.id });
  await f.ready();
  f.card('Newest').props.onClick();
  await f.drain();
  f.respond(f.pending('thread')[0], { messages: [] });
  await f.drain();
  f.type('Draft for the manually selected request');
  await f.drain();
  f.tick();
  f.respond(f.pending('inbox')[0], { requests: [older, sent], blocks: [] });
  f.respond(
    f.pending('thread')[0],
    { error: 'The selected request is unavailable.' },
    404,
  );
  await f.drain();
  equal(
    f.selected(),
    'Select a request.',
    'failed manual selection hides unavailable details',
  );
  f.button('Try again').props.onClick();
  await f.drain();
  f.respond(f.pending('inbox')[0], { requests: [older, sent], blocks: [] });
  await f.drain();
  const retry = f.pending('thread')[0];
  equal(
    new URL(retry.url, 'http://fixture').searchParams.get('id'),
    incoming.id,
    'retry resolves the failed manual request rather than the handled alert',
  );
  f.respond(retry, { request: incoming, messages: [] });
  await f.drain();
  equal(f.selected(), 'Newest', 'retry restores the actual failed selection');
  equal(
    f.draft(),
    'Draft for the manually selected request',
    'retry restores the failed selection draft',
  );
  f.unmount();
}

// Unauthorized, missing, and malformed target responses do not display an
// unrelated request or its messages. Transient lookup failures remain retryable.
for (const [payload, status, expected] of [
  [{ error: 'You cannot open this conversation.' }, 403, 'You cannot open'],
  [{ error: 'Collaboration request unavailable.' }, 404, 'request unavailable'],
  [
    {
      request: outsider,
      messages: [message('private', 'Private outsider history')],
    },
    200,
    'no longer available',
  ],
  [
    { request: sent, messages: [message('wrong-id', 'Wrong target history')] },
    200,
    'no longer available',
  ],
  [{ error: 'Please retry this connection.' }, 503, 'Please retry'],
]) {
  const f = fixture({ requestedCollaborationId: 'outside-page' });
  f.mount();
  await f.drain();
  f.respond(f.pending('inbox')[0], { requests: [incoming], blocks: [] });
  await f.drain();
  f.respond(f.pending('thread')[0], payload, status);
  await f.drain();
  equal(
    f.selected(),
    'Select a request.',
    'failed target does not select an unrelated conversation',
  );
  check(
    text(f.tree).includes(expected),
    'failed target shows an honest readable error',
  );
  check(
    !text(f.tree).includes('Private outsider history') &&
      !text(f.tree).includes('Wrong target history'),
    'unauthorized or mismatched lookup messages are never published',
  );
  f.button('Try again').props.onClick();
  await f.drain();
  f.respond(f.pending('inbox')[0], { requests: [incoming], blocks: [] });
  await f.drain();
  const restored = { ...older, id: 'outside-page' };
  f.respond(f.pending('thread')[0], { request: restored, messages: [] });
  await f.drain();
  equal(f.selected(), 'Older', 'failed target can recover with a retry');
  f.unmount();
}

// Late target lookups cannot replace a newer target, a manual choice, or a new
// authenticated instance, even when the synthetic transport ignores abort.
for (const [replacement, completion] of [
  'target',
  'manual',
  'unmount',
  'user',
].flatMap((replacement) =>
  ['success', 'failure'].map((completion) => [replacement, completion]),
)) {
  const f = fixture({ requestedCollaborationId: older.id });
  if (replacement === 'manual') await f.ready();
  else f.mount();
  await f.drain();
  if (replacement === 'manual') {
    f.update({ requestedCollaborationId: 'outside-page' });
    await f.drain();
  }
  f.respond(f.pending('inbox')[0], { requests: [incoming, sent], blocks: [] });
  await f.drain();
  const obsolete = f.pending('thread')[0];
  if (replacement === 'target') {
    f.update({ requestedCollaborationId: sent.id });
    await f.drain();
    f.respond(f.pending('inbox')[0], {
      requests: [incoming, sent],
      blocks: [],
    });
    await f.drain();
    f.respond(f.pending('thread').at(-1), { request: sent, messages: [] });
    await f.drain();
  } else if (replacement === 'manual') {
    f.card('Newest').props.onClick();
    await f.drain();
    f.respond(f.pending('thread').at(-1), { messages: [] });
    await f.drain();
  } else {
    f.unmount();
    if (replacement === 'user') {
      const next = fixture({
        userId: 'new-member',
        requestedCollaborationId: older.id,
      });
      next.mount();
      await next.drain();
      next.respond(next.pending('inbox')[0], { requests: [], blocks: [] });
      await next.drain();
      next.respond(
        next.pending('thread')[0],
        { error: 'Collaboration request unavailable.' },
        404,
      );
      await next.drain();
      check(
        !text(next.tree).includes('Older') && !next.draft(),
        'new user cannot inherit old target details or drafts',
      );
      next.unmount();
    }
  }
  check(
    obsolete.init.signal.aborted,
    'replacement aborts its obsolete target lookup',
  );
  f.respond(
    obsolete,
    completion === 'success'
      ? {
          request: {
            ...older,
            id: replacement === 'manual' ? 'outside-page' : older.id,
          },
          messages: [message('stale-target', 'Obsolete target history')],
        }
      : { error: 'Obsolete target failure' },
    completion === 'success' ? 200 : 403,
  );
  await f.drain();
  if (replacement === 'target' || replacement === 'manual') {
    equal(
      f.selected(),
      replacement === 'target' ? 'Sent peer' : 'Newest',
      'late lookup cannot override current choice',
    );
    check(
      !text(f.tree).includes('Obsolete target history') &&
        !text(f.tree).includes('Obsolete target failure'),
      'late lookup data and errors are ignored',
    );
    f.unmount();
  }
  equal(
    f.lateWrites,
    0,
    'obsolete target cannot publish state after unmount or identity change',
  );
}
{
  const f = fixture();
  await f.ready([sent]);
  equal(
    f.button('Sent').props.className,
    'active',
    'sent-only inbox defaults to its visible folder',
  );
  f.unmount();
}

// Peer updates become visible without remounting, selecting another request, or
// erasing any draft. Background reorder preserves the manually chosen request.
{
  const f = fixture({ requestedCollaborationId: 'incoming-old' });
  await f.ready();
  equal([...f.timers.values()][0].ms, 10000, 'visible inbox refresh interval');
  f.type('Keep this unsent draft');
  await f.drain();
  f.tick();
  f.respond(f.pending('inbox')[0], {
    requests: [
      { ...sent, status: 'closed', updated: 30 },
      incoming,
      { ...older, lastMessage: 'Peer replied' },
    ],
    blocks: [],
  });
  f.respond(f.pending('thread')[0], {
    messages: [message('reply', 'Peer replied')],
  });
  await f.drain();
  equal(f.selected(), 'Older', 'peer reorder preserves selected conversation');
  equal(f.draft(), 'Keep this unsent draft', 'poll preserves typed draft');
  check(text(f.tree).includes('Peer replied'), 'selected peer reply appears');
  f.card('Newest').props.onClick();
  await f.drain();
  f.respond(f.pending('thread')[0], { messages: [] });
  await f.drain();
  f.type('Draft for another thread');
  await f.drain();
  f.tick();
  f.respond(f.pending('inbox')[0], {
    requests: [older, incoming, sent],
    blocks: [],
  });
  f.respond(f.pending('thread')[0], { messages: [] });
  await f.drain();
  equal(
    f.selected(),
    'Newest',
    'handled alert does not override later manual selection',
  );
  f.card('Older').props.onClick();
  await f.drain();
  equal(
    f.draft(),
    'Keep this unsent draft',
    'draft remains attached to its conversation',
  );
  f.respond(f.pending('thread')[0], { messages: [] });
  await f.drain();
  f.tick();
  f.respond(f.pending('inbox')[0], {
    requests: [incoming, { ...older, status: 'closed', updated: 30 }, sent],
    blocks: [],
  });
  f.respond(f.pending('thread')[0], { messages: [] });
  await f.drain();
  check(
    text(f.tree).includes('This conversation is closed'),
    'peer status updates appear while reading',
  );
  f.tick();
  f.respond(f.pending('inbox')[0], {
    requests: [incoming, { ...older, updated: 40 }, sent],
    blocks: [],
  });
  f.respond(f.pending('thread')[0], { messages: [] });
  await f.drain();
  equal(
    f.draft(),
    'Keep this unsent draft',
    'status refresh retains draft for reopened thread',
  );
  f.unmount();
}

// Hidden tabs do no periodic work; focus and visibility return refresh at once.
{
  const f = fixture();
  await f.ready();
  const count = f.calls.length;
  f.document.visibilityState = 'hidden';
  f.tick();
  f.window.dispatch('focus');
  equal(f.calls.length, count, 'hidden tabs skip polling and focus reads');
  f.document.visibilityState = 'visible';
  f.document.dispatch('visibilitychange');
  equal(
    f.calls.length,
    count + 2,
    'visible return immediately refreshes inbox and selected thread',
  );
  f.tick();
  f.window.dispatch('focus');
  equal(
    f.calls.length,
    count + 2,
    'slow reads are not overlapped by timer or focus',
  );
  f.unmount();
  equal(f.timers.size, 0, 'unmount removes polling timer');
  equal(
    f.document.listenerCount + f.window.listenerCount,
    0,
    'unmount removes event subscriptions',
  );
  for (const call of f.pending('inbox'))
    f.respond(call, { requests: [older], blocks: [] });
  for (const call of f.pending('thread'))
    f.respond(call, { messages: [message('late', 'Late response')] });
  await f.drain();
  equal(f.lateWrites, 0, 'unmount ignores APIs that resolve after abort');
}

// Replaced alert targets and manual thread switches invalidate their old reads,
// including failed reads. StrictMode effect replay also cancels initialization.
{
  const f = fixture({ requestedCollaborationId: 'incoming-old' });
  f.mount();
  await f.drain();
  const original = f.pending('inbox')[0];
  f.replay();
  await f.drain();
  const replay = f.pending('inbox').at(-1);
  check(
    original.init.signal.aborted,
    'StrictMode replay aborts its first inbox read',
  );
  f.respond(replay, { requests: [incoming, older, sent], blocks: [] });
  await f.drain();
  f.respond(f.pending('thread')[0], {
    messages: [message('initial', 'Current history')],
  });
  await f.drain();
  f.respond(original, { requests: [incoming], blocks: [] });
  await f.drain();
  equal(
    f.selected(),
    'Older',
    'obsolete initial result cannot replace replayed target',
  );
  f.update({ requestedCollaborationId: 'sent' });
  await f.drain();
  const oldTargetRead = f.pending('inbox')[0];
  f.update({ requestedCollaborationId: 'incoming-new' });
  await f.drain();
  const nextTargetRead = f.pending('inbox').at(-1);
  check(
    oldTargetRead.init.signal.aborted,
    'new target cancels obsolete target read',
  );
  f.respond(nextTargetRead, { requests: [incoming, older, sent], blocks: [] });
  await f.drain();
  const oldThread = f.pending('thread')[0];
  f.card('Older').props.onClick();
  await f.drain();
  const currentThread = f.pending('thread').at(-1);
  f.respond(currentThread, {
    messages: [message('current', 'Manual history')],
  });
  f.respond(oldThread, { error: 'Stale thread error' }, 500);
  f.respond(oldTargetRead, { requests: [sent], blocks: [] });
  await f.drain();
  equal(
    f.selected(),
    'Older',
    'obsolete target cannot override manual selection',
  );
  check(
    text(f.tree).includes('Manual history') &&
      !text(f.tree).includes('Stale thread error'),
    'obsolete thread errors and data are ignored',
  );
  equal(
    f.key('member'),
    'member',
    'inbox state is keyed to authenticated identity',
  );
  equal(
    f.key('another-member'),
    'another-member',
    'changing user creates an isolated component instance',
  );
  f.unmount();
}

// Sending invalidates reads that began before the write. Only the submitted
// draft is cleared; a draft created in a different conversation survives.
{
  const f = fixture({ requestedCollaborationId: 'incoming-old' });
  await f.ready();
  f.type('Outgoing fixture message');
  await f.drain();
  f.tick();
  const staleInbox = f.pending('inbox')[0],
    staleThread = f.pending('thread')[0];
  const submit = f
    .node((node) => node.type === 'form')
    .props.onSubmit({ preventDefault() {} });
  const action = f.pending('action')[0];
  equal(
    JSON.parse(action.init.body).id,
    'incoming-old',
    'send belongs to selected authorized conversation',
  );
  check(
    staleInbox.init.signal.aborted && staleThread.init.signal.aborted,
    'send cancels pre-write reads',
  );
  const count = f.calls.length;
  f.tick();
  equal(f.calls.length, count, 'poll pauses during own mutation');
  f.respond(action, { ok: true });
  await f.drain();
  const freshInbox = f.pending('inbox').at(-1);
  f.respond(freshInbox, {
    requests: [
      incoming,
      { ...older, lastMessage: 'Outgoing fixture message' },
      sent,
    ],
    blocks: [],
  });
  await f.drain();
  const freshThread = f.pending('thread').at(-1);
  f.respond(freshThread, {
    messages: [message('own', 'Outgoing fixture message', 'member')],
  });
  await f.drain();
  await submit;
  f.respond(staleInbox, {
    requests: [incoming, { ...older, status: 'closed' }, sent],
    blocks: [],
  });
  f.respond(staleThread, { messages: [] });
  await f.drain();
  equal(f.draft(), '', 'successful send clears only submitted draft');
  check(
    text(f.tree).includes('Outgoing fixture message') &&
      !text(f.tree).includes('This conversation is closed'),
    'pre-write data cannot roll back successful send',
  );
  equal(
    f.callbacks.filter((v) => v === 'changed').length,
    1,
    'active write publishes one change callback',
  );
  f.type('Unfinished after send');
  await f.drain();
  const lateSubmit = f
    .node((node) => node.type === 'form')
    .props.onSubmit({ preventDefault() {} });
  const lateAction = f.pending('action')[0];
  f.unmount();
  check(lateAction.init.signal.aborted, 'unmount aborts own in-flight action');
  f.respond(lateAction, { ok: true });
  await lateSubmit;
  await f.drain();
  equal(
    f.lateWrites,
    0,
    'late write completion cannot erase state after unmount or user change',
  );
  equal(
    f.callbacks.filter((v) => v === 'changed').length,
    1,
    'late action cannot publish user callbacks',
  );
}

// A manual switch made while an inbox read or send is pending remains selected.
// Send failure keeps its exact draft/client ID for an idempotent retry.
{
  const f = fixture({ requestedCollaborationId: 'incoming-old' });
  await f.ready();
  f.type('Original draft');
  await f.drain();
  f.tick();
  const pendingInbox = f.pending('inbox')[0];
  const pendingThread = f.pending('thread')[0];
  f.card('Newest').props.onClick();
  await f.drain();
  f.respond(f.pending('thread').at(-1), { messages: [] });
  f.respond(pendingInbox, { requests: [older, incoming, sent], blocks: [] });
  f.respond(pendingThread, {
    messages: [message('late-old', 'Old conversation')],
  });
  await f.drain();
  equal(
    f.selected(),
    'Newest',
    'inbox completion respects a switch made during its read',
  );
  f.type('Another draft');
  await f.drain();
  f.card('Older').props.onClick();
  await f.drain();
  f.respond(f.pending('thread')[0], { messages: [] });
  await f.drain();
  let submit = f
    .node((node) => node.type === 'form')
    .props.onSubmit({ preventDefault() {} });
  const failedAction = f.pending('action')[0];
  f.respond(failedAction, { error: 'Fixture delivery failed' }, 503);
  await submit;
  await f.drain();
  equal(f.draft(), 'Original draft', 'failed send preserves submitted draft');
  check(
    text(f.tree).includes('Fixture delivery failed'),
    'failed send remains recoverable',
  );
  submit = f
    .node((node) => node.type === 'form')
    .props.onSubmit({ preventDefault() {} });
  const retry = f.pending('action')[0];
  equal(
    JSON.parse(retry.init.body).clientId,
    JSON.parse(failedAction.init.body).clientId,
    'retry keeps original idempotency key',
  );
  f.card('Newest').props.onClick();
  await f.drain();
  f.respond(f.pending('thread')[0], { messages: [] });
  await f.drain();
  f.respond(retry, { ok: true });
  await f.drain();
  f.respond(f.pending('inbox')[0], {
    requests: [older, incoming, sent],
    blocks: [],
  });
  await f.drain();
  f.respond(f.pending('thread')[0], { messages: [] });
  await f.drain();
  await submit;
  equal(
    f.selected(),
    'Newest',
    'send completion preserves conversation chosen during send',
  );
  equal(
    f.draft(),
    'Another draft',
    'send completion retains another conversation draft',
  );
  f.unmount();
}

console.log(
  `Collaboration alert targeting, live refresh, drafts, and async isolation passed (${assertions} assertions).`,
);
