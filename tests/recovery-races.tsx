import { useRef, useState } from 'react';
import { DraftStore, type RecoveryDraft } from '../lib/draft-recovery';
import { useDraftRecovery } from '../app/use-draft-recovery';
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release, entered: false };
}
class ControlledStore extends DraftStore {
  records = new Map<string, RecoveryDraft>();
  gates = new Map<string, ReturnType<typeof deferred>>();
  writes: RecoveryDraft[] = [];
  failNext = false;
  async gate(key: string) {
    const gate = this.gates.get(key);
    if (gate) {
      this.gates.delete(key);
      gate.entered = true;
      await gate.promise;
    }
  }
  hold(key: string) {
    const gate = deferred();
    this.gates.set(key, gate);
    return gate;
  }
  async list(account: string) {
    await this.gate('list:' + account);
    return {
      settings: { account, enabled: true, generation: 0 },
      drafts: [...this.records.values()].filter((d) => d.account === account),
      unreadable: 0,
    };
  }
  async put(record: RecoveryDraft, _generation: number) {
    this.writes.push(structuredClone(record));
    await this.gate('put:' + record.title);
    if (this.failNext) {
      this.failNext = false;
      throw new Error('Simulated storage full');
    }
    this.records.set(record.account + record.key, structuredClone(record));
    return true;
  }
  async remove(account: string, key: string) {
    await this.gate('remove:' + key);
    this.records.delete(account + key);
  }
  async close() {}
}
const waitFor = async (fn: () => boolean) => {
  for (let i = 0; i < 300; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('Timed out waiting for the controlled queue');
};
export function HookRaceChecks({
  make,
}: {
  make: (key: string, id?: string) => any;
}) {
  const [store] = useState(() => new ControlledStore()),
    [account, setAccount] = useState('qa-A'),
    [log, setLog] = useState(''),
    [busy, setBusy] = useState(false);
  const recovery = useDraftRecovery(account, () => store),
    current = useRef(recovery),
    renders = useRef<
      { account: string; status: string; drafts: RecoveryDraft[] }[]
    >([]);
  current.current = recovery;
  renders.current.push({
    account,
    status: recovery.status,
    drafts: recovery.drafts,
  });
  async function run() {
    setBusy(true);
    setLog('Checking delayed reads, writes and retry…');
    let checks = 0;
    const check = (v: unknown, m: string) => {
      if (!v) throw new Error(m);
      checks++;
    };
    const switchTo = async (a: string) => {
      setAccount(a);
      await waitFor(
        () => current.current.account === a && current.current.ready,
      );
    };
    try {
      await switchTo('qa-B');
      const read = store.hold('list:qa-A');
      setAccount('qa-A');
      await waitFor(() => read.entered);
      await switchTo('qa-B');
      const start = renders.current.length;
      read.release();
      await new Promise((r) => setTimeout(r, 40));
      check(
        renders.current
          .slice(start)
          .every(
            (v) =>
              v.account !== 'qa-B' ||
              v.drafts.every((d) => d.account === 'qa-B'),
          ),
        'Old account read leaked',
      );
      await switchTo('qa-A');
      const old = store.hold('put:Old account');
      current.current.capture({ ...make('old'), title: 'Old account' });
      await waitFor(() => old.entered);
      await switchTo('qa-B');
      current.current.capture({ ...make('new'), title: 'B newest' });
      await current.current.current('new');
      old.release();
      await new Promise((r) => setTimeout(r, 40));
      check(
        store.writes.every(
          (d) => d.title !== 'B newest' || d.account === 'qa-B',
        ),
        'Old queue consumed new account edits',
      );
      check(
        (await current.current.current('new')).title === 'B newest',
        'New account copy lost',
      );
      const first = store.hold('put:First'),
        second = store.hold('put:Second');
      current.current.capture({ ...make('status'), title: 'First' });
      await waitFor(() => first.entered);
      const statusStart = renders.current.length;
      current.current.capture({ ...make('status'), title: 'Second' });
      first.release();
      await waitFor(() => second.entered);
      await new Promise((r) => setTimeout(r, 20));
      check(
        current.current.status === 'Saving recovery copy…',
        'Earlier commit prematurely reported saved',
      );
      check(
        renders.current
          .slice(statusStart)
          .every(
            (v) =>
              !v.status.includes('saved in this browser') &&
              !v.status.includes('copy cleared'),
          ),
        'Transient premature saved indicator',
      );
      second.release();
      check(
        (await current.current.current('status')).title === 'Second',
        'Newest held write lost',
      );
      const remove = store.hold('remove:status'),
        later = store.hold('put:After save');
      current.current.capture({
        ...make('status'),
        title: 'Second',
        dirty: false,
      });
      await waitFor(() => remove.entered);
      current.current.capture({ ...make('status'), title: 'After save' });
      remove.release();
      await waitFor(() => later.entered);
      check(
        current.current.status === 'Saving recovery copy…',
        'Save acknowledgement prematurely reported cleared',
      );
      later.release();
      check(
        (await current.current.current('status')).title === 'After save',
        'Save acknowledgement erased newer edits',
      );
      store.failNext = true;
      current.current.capture({ ...make('status'), title: 'Newest failed' });
      await waitFor(() => current.current.error.includes('Simulated'));
      let rejected = false;
      try {
        await current.current.current('status');
      } catch {
        rejected = true;
      }
      check(
        rejected,
        'Recovery allowed stale snapshot to replace newer failed edit',
      );
      await current.current.refresh();
      check(
        (await current.current.current('status')).title === 'Newest failed',
        'Explicit refresh did not retry failed newest edit',
      );
      await waitFor(() => !current.current.error);
      check(!current.current.error, 'Retry did not clear storage error');
      const creation = { key: crypto.randomUUID(), checkpoint: true };
      const prepared = {
        ...make('first-save', ''),
        title: 'Prepared A',
        creation,
        baseline: {
          title: 'Prepared A',
          data: make('first-save', '').data,
          revision: 0,
        },
      };
      const preparationRead = store.hold('list:qa-B');
      const preparation = current.current.prepareCreation(prepared);
      await waitFor(() => preparationRead.entered);
      current.current.capture({ ...prepared, title: 'Newer B' });
      preparationRead.release();
      check(await preparation, 'First-save preparation did not persist');
      const savedPreparation = await current.current.current('first-save');
      check(
        savedPreparation.title === 'Newer B',
        'Delayed preparation overwrote newer edits',
      );
      check(
        savedPreparation.creation?.key === creation.key &&
          savedPreparation.baseline.title === 'Prepared A',
        'Preparation lost its stable key or submitted snapshot',
      );
      store.failNext = true;
      let prepareRejected = false;
      try {
        await current.current.prepareCreation({
          ...prepared,
          recoveryId: 'failed-preparation',
        });
      } catch {
        prepareRejected = true;
      }
      check(
        prepareRejected,
        'First save could proceed without its required recovery write',
      );
      setLog(
        'PASS: ' +
          checks +
          ' delayed account, save-order, indicator and failed-write assertions.',
      );
    } catch (e: any) {
      setLog('FAIL: ' + e.message);
    } finally {
      for (const gate of store.gates.values()) gate.release();
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>Controlled interruption tests</h2>
      <button disabled={busy || !recovery.ready} onClick={run}>
        Test interrupted writes
      </button>
      <output aria-label="Interruption results">{log}</output>
    </section>
  );
}
