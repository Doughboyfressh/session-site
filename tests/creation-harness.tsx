import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useProjectSync } from '../app/use-project-sync';
import { creationHash } from '../lib/project-creation';
import { recoveryRecord, recoveredProject } from '../lib/draft-recovery';
import '../app/globals.css';
const empty = (title = 'First save') => ({
  title,
  data: { bpm: 92, tracks: [] },
});
let exposed: any, durable: any;
const requests: any[] = [],
  projects = new Map<string, any>(),
  receipts = new Map<string, any>();
let drop = false,
  deny = 0,
  serial = 0;
function Editor({ initial }: { initial: any }) {
  const [id, setId] = useState(initial?.id || ''),
    [snapshot, setSnapshot] = useState(initial || empty()),
    [dirty, setDirty] = useState(true);
  const sync = useProjectSync({
    initial,
    id,
    snapshot,
    paused: false,
    apply: (p, d) => {
      setSnapshot(p);
      setDirty(d);
    },
    permissionEnded: () => {},
    adoptProject: setId,
    prepareCreation: async (creation, baseline) => {
      durable = {
        ...snapshot,
        id: '',
        recoveryId: 'qa-editor',
        dirty: true,
        creation,
        baseline,
      };
      return true;
    },
  });
  exposed = {
    sync,
    id,
    snapshot,
    dirty,
    edit: (title: string) => {
      setSnapshot({ ...snapshot, title });
      setDirty(true);
    },
    save: async () => {
      const r = await sync.save(true);
      setId(r.id);
      return r;
    },
  };
  return (
    <p>
      Editor: {snapshot.title} · {dirty ? 'unsaved' : 'saved'} ·{' '}
      {sync.conflict?.whole ? 'review required' : sync.status}
    </p>
  );
}
const response = (value: any, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
async function fakeFetch(url: any, options: any = {}) {
  const path = String(url);
  if (path.startsWith('/api/project/')) {
    const id = path.split('/').at(-1)!.split('?')[0],
      p = projects.get(id);
    return response(p || { error: 'Unavailable' }, p ? 200 : 403);
  }
  const b = JSON.parse(options.body);
  requests.push(structuredClone(b));
  if (deny) {
    const status = deny;
    deny = 0;
    return response({ error: 'Simulated rejection' }, status);
  }
  if (b.action === 'projectCreation') {
    const r = receipts.get(b.key);
    return r?.deleted
      ? response({ error: 'Deleted' }, 410)
      : response(
          r
            ? { found: true, receipt: r, project: projects.get(r.project) }
            : { found: false },
        );
  }
  if (b.action !== 'project') throw new Error('Unexpected harness action');
  if (!b.id) {
    const key = b.creation.key,
      hash = await creationHash(b, b.creation.checkpoint);
    let r = receipts.get(key);
    if (r?.deleted) return response({ error: 'Deleted' }, 410);
    if (r && r.requestHash !== hash)
      return response({ error: 'Different first save' }, 409);
    if (!r) {
      const id = 'project-' + ++serial;
      r = { key, project: id, requestHash: hash, revision: 1 };
      receipts.set(key, r);
      projects.set(id, {
        id,
        title: b.title,
        data: b.data,
        revision: 1,
        owner: 'qa',
        canEdit: true,
        canManage: true,
      });
    }
    if (drop) {
      drop = false;
      throw new TypeError('Simulated response lost after commit');
    }
    return response({
      id: r.project,
      revision: 1,
      owner: 'qa',
      canEdit: true,
      canManage: true,
      replayed: true,
    });
  }
  const p = projects.get(b.id);
  if (!p) return response({ error: 'Unavailable' }, 403);
  if (p.revision !== b.baseRevision)
    return response({ error: 'Conflict' }, 409);
  Object.assign(p, { title: b.title, data: b.data, revision: p.revision + 1 });
  return response({
    id: p.id,
    revision: p.revision,
    owner: 'qa',
    canEdit: true,
    canManage: true,
  });
}
const waitFor = async (fn: () => boolean) => {
  for (let i = 0; i < 250; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('Timed out waiting for editor');
};
function App() {
  const [fixture, setFixture] = useState({ key: 0, initial: empty() }),
    [log, setLog] = useState(''),
    [busy, setBusy] = useState(false);
  const next = useRef(0);
  async function reset(initial: any = empty()) {
    const previous = exposed;
    setFixture({ key: ++next.current, initial });
    await waitFor(() => exposed !== previous);
    requests.length = 0;
  }
  async function run() {
    setBusy(true);
    setLog('Checking first-save interruptions…');
    let checks = 0;
    const original = window.fetch;
    window.fetch = fakeFetch as any;
    const check = (v: any, m: string) => {
      if (!v) throw new Error(m);
      checks++;
    };
    const fails = async (fn: () => Promise<any>) => {
      let failed = false;
      try {
        await fn();
      } catch {
        failed = true;
      }
      check(failed, 'Expected failed acknowledgement');
    };
    try {
      await reset();
      drop = true;
      await fails(() => exposed.save());
      const key = exposed.sync.creation?.key || durable.creation.key;
      check(projects.size === 1, 'First save did not commit once');
      exposed.edit('Newer edits');
      await waitFor(() => exposed.snapshot.title === 'Newer edits');
      await exposed.save();
      await waitFor(() => !!exposed.id);
      check(
        exposed.sync.baseline.current.title === 'First save' &&
          exposed.sync.baseline.current.revision === 1,
        'Replay installed wrong baseline',
      );
      check(
        exposed.dirty && exposed.snapshot.title === 'Newer edits',
        'Replay lost newer edits',
      );
      check(
        requests
          .filter((b) => b.creation)
          .every((b) => b.creation.key === key && b.title === 'First save'),
        'Retry changed identity or submitted snapshot',
      );
      await exposed.save();
      check(
        projects.size === 1 && [...projects.values()][0].revision === 2,
        'Saving newer edits created duplicate project',
      );
      await reset(empty('Lost then signed out'));
      const count = projects.size;
      drop = true;
      await fails(() => exposed.save());
      const authKey = durable.creation.key;
      deny = 401;
      await fails(() => exposed.save());
      await waitFor(() => !!exposed.sync.creation?.retryCurrent);
      check(
        exposed.sync.creation.key === authKey,
        'Authentication rejection discarded retry key',
      );
      exposed.edit('Edits after sign-in');
      await waitFor(() => exposed.snapshot.title === 'Edits after sign-in');
      await exposed.save();
      await waitFor(() => !!exposed.id);
      check(
        projects.size === count + 1 && exposed.dirty,
        'Sign-in retry duplicated project or cleared new edits',
      );
      await reset(empty('Before reload'));
      const beforeReload = projects.size;
      drop = true;
      await fails(() => exposed.save());
      const restored = recoveredProject(
        recoveryRecord('qa', { ...durable, title: 'After reload' }),
      );
      check(
        restored.creation?.key === durable.creation.key,
        'Recovery changed first-save identity',
      );
      await reset(restored);
      await exposed.save();
      await waitFor(() => !!exposed.id);
      check(
        projects.size === beforeReload + 1 &&
          exposed.snapshot.title === 'After reload' &&
          exposed.dirty,
        'Reload retry lost work or created duplicate',
      );
      await reset(empty('Rejected source'));
      deny = 403;
      await fails(() => exposed.save());
      await waitFor(() => !!exposed.sync.creation?.retryCurrent);
      const rejectedKey = exposed.sync.creation.key;
      check(exposed.sync.canEdit, 'Source rejection disabled new editor');
      exposed.edit('Corrected source');
      await waitFor(() => exposed.snapshot.title === 'Corrected source');
      await exposed.save();
      await waitFor(() => !!exposed.id);
      check(
        requests
          .filter((b) => b.action === 'project')
          .every((b) => b.creation?.key === rejectedKey),
        'Corrected save rotated its creation key',
      );
      check(
        exposed.sync.baseline.current.title === 'Corrected source',
        'Corrected payload was not saved',
      );
      const collisionKey = crypto.randomUUID(),
        remote = {
          id: 'collision',
          ...empty('Earlier saved project'),
          revision: 1,
          owner: 'qa',
          canEdit: true,
          canManage: true,
        };
      projects.set(remote.id, remote);
      receipts.set(collisionKey, {
        key: collisionKey,
        project: remote.id,
        requestHash: await creationHash(remote, true),
        revision: 1,
      });
      const collision = {
        ...empty('Different current draft'),
        id: '',
        baseline: { ...empty('Different current draft'), revision: 0 },
        creation: { key: collisionKey, checkpoint: true },
      };
      await reset(collision);
      const collisionCount = projects.size;
      const result = await exposed.save();
      await waitFor(() => !!exposed.sync.conflict?.whole);
      check(
        result.needsReview &&
          exposed.snapshot.title === 'Different current draft' &&
          projects.size === collisionCount,
        'Mismatched first save was not preserved for review',
      );
      await fails(() => exposed.save());
      exposed.sync.resolve('remote');
      await waitFor(() => !exposed.sync.conflict);
      check(
        exposed.snapshot.title === 'Earlier saved project' && !exposed.dirty,
        'Saved-project choice failed',
      );
      await reset(collision);
      await exposed.save();
      await waitFor(() => !!exposed.sync.conflict?.whole);
      exposed.sync.resolve('local');
      await waitFor(() => !exposed.sync.conflict);
      check(
        exposed.snapshot.title === 'Different current draft' && exposed.dirty,
        'Current-draft choice failed',
      );
      await exposed.save();
      check(
        projects.get('collision').revision === 2 &&
          projects.size === collisionCount,
        'Review created a duplicate instead of updating',
      );
      await reset(empty('Deleted after lost reply'));
      drop = true;
      await fails(() => exposed.save());
      const deleted = receipts.get(durable.creation.key);
      projects.delete(deleted.project);
      deleted.deleted = true;
      const beforeDeleteRetry = projects.size;
      await fails(() => exposed.save());
      check(
        projects.size === beforeDeleteRetry && !!exposed.sync.creation,
        'Deleted project was recreated or retry identity discarded',
      );
      setLog(
        'PASS: ' +
          checks +
          ' first-save, lost-response, authentication, reload, newer-edit and review assertions.',
      );
    } catch (e: any) {
      setLog('FAIL: ' + e.message);
    } finally {
      await reset();
      window.fetch = original;
      setBusy(false);
    }
  }
  return (
    <main style={{ padding: 32, maxWidth: 900 }}>
      <h1>SESSION first-save interruption checks</h1>
      <p>
        Synthetic arrangements and simulated requests. No live accounts or
        media.
      </p>
      <button disabled={busy} onClick={run}>
        Run first-save checks
      </button>
      <Editor key={fixture.key} initial={fixture.initial} />
      <output aria-label="Save results">{log}</output>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
