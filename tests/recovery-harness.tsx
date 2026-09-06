import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DraftStore,
  recoveryRecord,
  validateRecovery,
  recoveredProject,
} from '../lib/draft-recovery';
import { defaults } from '../lib/audio';
import { mergeProject } from '../lib/project-merge';
import { useDraftRecovery } from '../app/use-draft-recovery';
import { HookRaceChecks } from './recovery-races';
import '../app/globals.css';
import '../app/advanced.css';

const track = {
  ...defaults('Synth'),
  id: 'track',
  fileId: 'private-file',
  duration: 3,
  peaks: [0.1, 0.5],
  notes: [{ id: 'n', pitch: 60, start: 0, length: 1, velocity: 0.5 }],
};
const baseline = {
  title: 'Session',
  data: { bpm: 120, tracks: [track] },
  revision: 4,
};
const make = (key = 'draft', id = 'project') => ({
  id,
  recoveryId: key,
  title: 'Unshared edits',
  data: { bpm: 120, tracks: [{ ...track, volume: 0.4 }] },
  baseline,
  dirty: true,
  canEdit: true,
  canManage: true,
});
function HookChecks() {
  const r = useDraftRecovery('qa-recovery-hook');
  const [log, setLog] = useState('');
  async function rapid() {
    setLog('Writing rapid edits…');
    for (let i = 0; i < 40; i++)
      r.capture({ ...make('rapid'), title: 'Edit ' + i });
    const record = await r.current('rapid');
    setLog(
      record.title === 'Edit 39'
        ? 'PASS: newest of 40 edits committed'
        : 'FAIL: stale write won',
    );
  }
  async function acknowledge() {
    r.capture({ ...make('ack'), title: 'First save', dirty: true });
    r.capture({ ...make('ack'), title: 'First save', dirty: false });
    r.capture({ ...make('ack'), title: 'Later edits', dirty: true });
    const record = await r.current('ack');
    setLog(
      record.title === 'Later edits'
        ? 'PASS: edits after save acknowledgement survived'
        : 'FAIL: acknowledgement erased later edits',
    );
  }
  return (
    <section>
      <h2>Live write queue</h2>
      <p>
        {r.status} {r.error}
      </p>
      <button disabled={!r.ready} onClick={rapid}>
        Test rapid edits
      </button>
      <button disabled={!r.ready} onClick={acknowledge}>
        Test save race
      </button>
      <button
        disabled={!r.ready}
        onClick={async () => {
          for (const copy of r.drafts) await r.remove(copy);
          await r.configure(false);
          await r.configure(true);
          setLog('Test account copies cleared.');
        }}
      >
        Clear hook fixtures
      </button>
      <output aria-label="Queue result">{log}</output>
    </section>
  );
}
function App() {
  const [lines, setLines] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    setLines([]);
    let checks = 0;
    const name = 'qa-session-recovery-' + crypto.randomUUID(),
      a = new DraftStore(name),
      b = new DraftStore(name);
    const log = (text: string) => setLines((lines) => [...lines, text]);
    const check = (value: unknown, message: string) => {
      if (!value) throw new Error(message);
      checks++;
    };
    const fails = async (fn: () => unknown) => {
      let failed = false;
      try {
        await fn();
      } catch {
        failed = true;
      }
      check(failed, 'Operation should have failed');
    };
    try {
      const original = make();
      const rec = recoveryRecord('A', {
        ...original,
        secret: 'DO-NOT-KEEP',
        stream: new Blob(['audio']),
      });
      check(!JSON.stringify(rec).includes('DO-NOT-KEEP'), 'Extra data leaked');
      check(
        !JSON.stringify(rec).includes('peaks') &&
          !JSON.stringify(rec).includes('duration'),
        'Waveform cache persisted',
      );
      check(
        !('canEdit' in rec) && !('stream' in rec),
        'Runtime authority or media persisted',
      );
      check(
        rec.data.tracks[0].fileId === 'private-file',
        'Audio reference lost',
      );
      check(
        rec.baseline.revision === 4 &&
          rec.baseline.data.tracks[0].volume === 0.8,
        'Baseline lost',
      );
      rec.data.tracks[0].volume = 0.2;
      check(original.data.tracks[0].volume === 0.4, 'Capture mutated editor');
      check(await a.put(rec, 0), 'Initial commit failed');
      await a.close();
      check(
        (await a.list('A')).drafts[0].data.tracks[0].volume === 0.2,
        'Reopen lost data',
      );
      check(
        (await a.list('B')).drafts.length === 0,
        'Account isolation failed',
      );
      await b.put(recoveryRecord('A', make('other-tab')), 0);
      check(
        (await a.list('A')).drafts.length === 2,
        'Concurrent tabs overwrote each other',
      );
      await a.remove('A', rec.key);
      check(
        (await b.list('A')).drafts[0].key === 'other-tab',
        'Saving one branch removed another',
      );
      const old = (await a.list('A')).drafts[0];
      await b.put(
        { ...old, title: 'Newer edit', stamp: crypto.randomUUID() },
        0,
      );
      await fails(() => a.fork(old, 0));
      await fails(() => a.remove('A', old.key, old.stamp));
      const current = (await a.list('A')).drafts[0],
        forked = await a.fork(current, 0);
      check(
        forked.key !== current.key,
        'Recovered branch reused writer identity',
      );
      check(
        (await a.list('A')).drafts.length === 1,
        'Recovery duplicated its source record',
      );
      const restored = recoveredProject(forked, {
        id: 'project',
        revision: 4,
        canEdit: true,
        canManage: false,
        owner: 'owner',
      });
      check(
        restored.canManage === false && restored.owner === 'owner',
        'Cached authority restored',
      );
      check(
        restored.baseline.revision === 4,
        'Recovery replaced original baseline',
      );
      await fails(() =>
        recoveredProject(forked, { id: 'project', revision: 3, canEdit: true }),
      );
      const sequence: any = Array.from({ length: 3 }, () => Array(16).fill(0));
      sequence.audio = new Blob(['hidden']);
      sequence[0].audio = new Blob(['hidden']);
      const pattern = recoveryRecord('A', {
        ...make(),
        data: { bpm: 120, tracks: [{ ...track, sequence }] },
      });
      check(
        !('audio' in pattern.data.tracks[0].sequence!) &&
          !('audio' in pattern.data.tracks[0].sequence![0]),
        'Drum array persisted hidden audio',
      );
      delete sequence[0][1];
      await fails(() =>
        recoveryRecord('A', {
          ...make(),
          data: { bpm: 120, tracks: [{ ...track, sequence }] },
        }),
      );
      await fails(() =>
        validateRecovery({ ...rec, updated: Number.MAX_VALUE }, 'A'),
      );
      await fails(() =>
        recoveredProject(forked, { id: 'project', canEdit: false }),
      );
      await fails(() => recoveredProject(forked));
      const fresh = {
        ...baseline,
        data: { ...baseline.data, tracks: [{ ...track, pan: 0.5 }] },
      };
      const merged = mergeProject(restored.baseline, restored, fresh);
      check(
        !merged.conflicts.length &&
          merged.project.data.tracks[0].pan === 0.5 &&
          merged.project.data.tracks[0].volume === 0.4,
        'Recovery lost independent remote edits',
      );
      const conflict = mergeProject(restored.baseline, restored, {
        ...baseline,
        data: { ...baseline.data, tracks: [{ ...track, volume: 0.7 }] },
      });
      check(conflict.conflicts.length > 0, 'Recovery bypassed competing edits');
      const local = recoveryRecord('A', make('new', ''));
      check(
        recoveredProject(local).id === '' && recoveredProject(local).dirty,
        'New draft could not recover',
      );
      await a.put(local, 0);
      await a.put({ ...local, projectId: 'first-save' }, 0);
      check(
        (await a.list('A')).drafts.filter((d) => d.key === 'new').length === 1,
        'First save duplicated device copy',
      );
      await b.put(recoveryRecord('B', make('b')), 0);
      const off = await a.configure('A', false);
      check(
        !(await b.put(recoveryRecord('A', make('late')), 0)),
        'Late write recreated disabled copies',
      );
      check(
        (await a.list('A')).drafts.length === 0,
        'Disabling did not clear account',
      );
      check(
        (await a.list('B')).drafts.length === 1,
        'Disabling erased another account',
      );
      const on = await a.configure('A', true);
      check(
        on.generation > off.generation,
        'Settings generation did not advance',
      );
      check(
        !(await b.put(recoveryRecord('A', make('stale')), 0)),
        'Old consent generation wrote after re-enable',
      );
      await a.put(recoveryRecord('A', make('delete-project')), on.generation);
      await a.deleteProject('A', 'project');
      check(
        (await a.list('A')).drafts.length === 0,
        'Project deletion left copies',
      );
      check(
        !(await b.put(recoveryRecord('A', make('resurrect')), on.generation)),
        'Queued write resurrected deleted project',
      );
      for (let i = 0; i < 20; i++)
        await a.put(recoveryRecord('A', make('cap-' + i, '')), on.generation);
      await fails(() =>
        a.put(recoveryRecord('A', make('overflow', '')), on.generation),
      );
      check(
        (await a.list('A')).drafts.length === 20,
        'Full store evicted existing work',
      );
      check(
        await a.put(
          recoveryRecord('A', {
            ...make('cap-0', ''),
            title: 'Still editable',
          }),
          on.generation,
        ),
        'Full store blocked an existing draft update',
      );
      await fails(() => validateRecovery({ ...rec, version: 2 }, 'A'));
      await fails(() => validateRecovery(rec, 'B'));
      await fails(() =>
        recoveryRecord('A', { ...make(), baseline: undefined }),
      );
      await fails(() =>
        recoveryRecord('A', { ...make(), data: { bpm: NaN, tracks: [] } }),
      );
      await fails(() =>
        recoveryRecord('A', { ...make(), title: 'x'.repeat(121) }),
      );
      await a.transaction(['drafts'], 'readwrite', async (tx) => {
        await new Promise<void>((resolve, reject) => {
          const r = tx
            .objectStore('drafts')
            .put({ account: 'A', key: 'corrupt', version: 99 });
          r.onsuccess = () => resolve();
          r.onerror = () => reject(r.error);
        });
      });
      const mixed = await a.list('A');
      check(
        mixed.drafts.length === 20 && mixed.unreadable === 1,
        'Corrupt copy blocked other drafts',
      );
      check(
        await a.put(
          recoveryRecord('A', {
            ...make('cap-0', ''),
            title: 'Healthy update',
          }),
          on.generation,
        ),
        'Corrupt entry blocked healthy update',
      );
      await a.transaction(['drafts'], 'readwrite', async (tx) => {
        const raw: any = { account: 'A', key: 'cycle' };
        raw.cycle = raw;
        tx.objectStore('drafts').put(raw);
      });
      check(
        await a.put(
          recoveryRecord('A', {
            ...make('cap-0', ''),
            title: 'Healthy update',
          }),
          on.generation,
        ),
        'Cyclic corrupt entry blocked healthy update',
      );
      await a.removeUnreadable('A');
      check(
        (await a.list('A')).drafts.length === 20 &&
          (await a.list('A')).unreadable === 0,
        'Damaged entry removal harmed good copies',
      );
      await a.transaction(['settings'], 'readwrite', async (tx) => {
        tx.objectStore('settings').put({
          account: 'bad-settings',
          enabled: true,
          generation: NaN,
        });
      });
      await fails(() => a.list('bad-settings'));
      await fails(() => a.put(recoveryRecord('bad-settings', make()), 0));
      const copy = (await a.list('A')).drafts[0];
      await fails(() =>
        a.transaction(['drafts'], 'readwrite', async (tx) => {
          tx.objectStore('drafts').put({ ...copy, title: 'Uncommitted' });
          tx.abort();
        }),
      );
      check(
        (await a.list('A')).drafts.find((d) => d.key === copy.key)?.title ===
          copy.title,
        'Aborted transaction replaced committed copy',
      );
      const closing = a.close();
      check(
        (await a.list('A')).drafts.length === 20,
        'Close interrupted a new connection',
      );
      await closing;
      await a.close();
      const opening = a.open(),
        pendingClose = a.close();
      check(
        (await a.list('A')).drafts.length === 20,
        'Closing a pending open interrupted its replacement',
      );
      await opening;
      await pendingClose;
      const forced = await a.open();
      forced.close();
      forced.dispatchEvent(new Event('close'));
      check(
        (await a.list('A')).drafts.length === 20,
        'Unexpected closure could not reopen',
      );
      const large = {
        bpm: 120,
        tracks: Array.from({ length: 32 }, (_, i) => ({
          ...track,
          id: 'large-' + i,
          notes: Array.from({ length: 256 }, (_, n) => ({
            id: 'n'.repeat(120) + n,
            pitch: 60,
            start: n,
            length: 1,
            velocity: 0.5,
          })),
        })),
      };
      await fails(() => recoveryRecord('A', { ...make(), data: large }));
      log(
        `PASS: ${checks} browser storage, recovery, access and collaboration assertions.`,
      );
    } catch (error: any) {
      log('FAIL: ' + error.message);
    } finally {
      await a.close();
      await b.close();
      await new Promise<void>((resolve) => {
        const r = indexedDB.deleteDatabase(name);
        r.onsuccess = r.onerror = r.onblocked = () => resolve();
      });
      setBusy(false);
    }
  }
  return (
    <main style={{ maxWidth: 960, margin: '30px auto', padding: 24 }}>
      <h1>SESSION arrangement recovery verification</h1>
      <p>
        Synthetic project settings only. No microphone, camera, or real account
        data.
      </p>
      <button className="button primary" disabled={busy} onClick={run}>
        {busy ? 'Checking…' : 'Run recovery checks'}
      </button>
      <ol aria-label="Verification results">
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ol>
      <HookChecks />
      <HookRaceChecks make={make} />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
