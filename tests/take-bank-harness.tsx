import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import RecordTake from '../app/record-take';
import SavedTakesPanel from '../app/saved-takes-panel';
import {
  BankWriter,
  bankSignature,
  loadBank,
  type BankSnapshot,
} from '../app/take-bank-client';
import { bankProject, type RestoredBank } from '../lib/take-bank';
import { defaults } from '../lib/audio';
import type { TakeCapture } from '../lib/recording';
import { encodeWave } from '../lib/audio-files';
import { renderComp, takePCM, type LocalTake } from '../lib/take-comp';
import '../app/globals.css';
import '../app/advanced.css';
const bankRecords = new Map<string, any>(),
  fileRecords = new Map<string, Blob>(),
  refs = new Map<string, string>();
let uploads = 0,
  saves = 0,
  mode = '',
  captureStarts = 0,
  plays = 0;
const nativeFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  init?.signal?.throwIfAborted();
  const answer = (body: any, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  if (url === '/api/upload') {
    uploads++;
    const form = init!.body as FormData,
      key = form.get('bankId') + ':' + form.get('takeId');
    if (mode === 'partial' && uploads === 2)
      return answer({ error: 'Simulated interrupted upload' }, 503);
    let id = refs.get(key);
    if (!id) {
      id = crypto.randomUUID();
      refs.set(key, id);
      fileRecords.set(id, form.get('file') as File);
    }
    return answer({ id });
  }
  if (url.startsWith('/api/file/')) {
    if (mode === 'denied') return answer({ error: 'Denied' }, 403);
    const blob = fileRecords.get(url.split('/').at(-1)!);
    return blob
      ? new Response(mode === 'truncated' ? blob.slice(0, 30) : blob)
      : answer({}, 404);
  }
  if (url === '/api/action') {
    const b = JSON.parse(init!.body as string);
    if (mode === 'denied')
      return answer({ error: 'Editing access ended' }, 403);
    if (b.action === 'takeBankSave') {
      saves++;
      if (mode === 'conflict')
        return answer(
          { error: 'The bank changed. Reopen before replacing.' },
          409,
        );
      const old = bankRecords.get(b.id);
      if (old?.saveId === b.saveId) return answer(old);
      if ((old?.revision || 0) !== b.baseRevision)
        return answer({ error: 'Stale revision' }, 409);
      const row = {
        id: b.id,
        revision: b.baseRevision + 1,
        updated: Date.now(),
        saveId: b.saveId,
        data: b.data,
      };
      bankRecords.set(b.id, row);
      if (mode === 'lost') {
        mode = '';
        throw Error('Simulated lost save response');
      }
      return answer(row);
    }
    if (b.action === 'takeBankRead') return answer(bankRecords.get(b.id));
    if (b.action === 'takeBanks')
      return answer(
        [...bankRecords.values()].map((r) => ({
          ...r,
          title: r.data.title,
          takeCount: r.data.takes.length,
          bytes: r.data.takes.reduce((n: number, t: any) => n + t.size, 0),
          deletedAt: null,
        })),
      );
    if (b.action === 'takeBankDelete') {
      bankRecords.delete(b.id);
      return answer({ ok: true });
    }
  }
  return nativeFetch(input, init);
}) as typeof fetch;
document.addEventListener('play', () => plays++, true);
const wait = async (fn: () => boolean) => {
  for (let i = 0; i < 500; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error('Timed out waiting for saved-take UI');
};
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label,
  );
const click = async (label: string) => {
  await wait(() => !!button(label) && !button(label)!.disabled);
  button(label)!.click();
  await new Promise((r) => setTimeout(r, 25));
};
async function original(n: number): Promise<LocalTake> {
  const pcm = new Float32Array(48000).fill(n / 10);
  const { blob, peak } = await encodeWave(
    {
      length: pcm.length,
      sampleRate: 48000,
      numberOfChannels: 1,
      getChannelData: () => pcm,
    },
    24,
    { channels: 1 },
  );
  return {
    id: crypto.randomUUID(),
    name: 'Take ' + n,
    blob,
    peak,
    sampleRate: 48000,
    depth: 24,
    seconds: 1,
    offset: 2,
    url: '',
    correctionMs: 25,
  };
}
function App() {
  const [record, setRecord] = useState<RestoredBank | null>(null),
    [key, setKey] = useState(0),
    [granted, setGranted] = useState(true),
    [panel, setPanel] = useState(false),
    [log, setLog] = useState(''),
    [busy, setBusy] = useState(false);
  const open = async (r: RestoredBank) => {
    setKey((k) => k + 1);
    setRecord(r);
    setGranted(true);
    await wait(() => !!button('Takes & comp saved'));
  };
  async function run() {
    setBusy(true);
    setLog('Checking private saved-take recovery…');
    let checks = 0;
    const check = (v: unknown, m: string) => {
      if (!v) throw Error(m);
      checks++;
    };
    const reject = async (fn: () => Promise<unknown>, message: string) => {
      let caught = false;
      try {
        await fn();
      } catch {
        caught = true;
      }
      check(caught, message);
    };
    try {
      bankRecords.clear();
      fileRecords.clear();
      refs.clear();
      uploads = 0;
      saves = 0;
      captureStarts = 0;
      plays = 0;
      const originals = [await original(1), await original(2)],
        signal = new AbortController().signal;
      const snapshot: BankSnapshot = {
        version: 1,
        title: 'Vocal session',
        projectId: '',
        backing: { bpm: 120, tracks: [] },
        offset: 2,
        takes: originals,
        selected: originals[1].id,
        regions: [
          { takeId: originals[0].id, start: 0, end: 0.5 },
          { takeId: originals[1].id, start: 0.5, end: 1 },
        ],
        applied: false,
      };
      const writer = new BankWriter();
      mode = 'partial';
      await reject(
        () => writer.save(snapshot, signal),
        'Partial upload should fail',
      );
      check(
        writer.revision === 0 && writer.files.size === 1,
        'Partial failure lost staged receipt',
      );
      mode = '';
      await writer.save(snapshot, signal);
      check(
        uploads === 3 && writer.revision === 1,
        'Retry must upload only the missing take',
      );
      check(
        writer.saved === bankSignature(snapshot),
        'Saved indicator did not match',
      );
      const restored = await loadBank(writer.id, signal);
      check(restored.originals.length === 2, 'Originals not restored');
      check(
        JSON.stringify(restored.data.regions) ===
          JSON.stringify(snapshot.regions),
        'Comp regions changed',
      );
      check(
        restored.originals[1].correctionMs === 25,
        'Correction metadata lost',
      );
      const pcm = await takePCM(
        await renderComp(restored.data.regions, restored.originals),
      );
      check(
        Math.abs(pcm[100] - 0.1) < 0.00001 &&
          Math.abs(pcm[47000] - 0.2) < 0.00001,
        'Reopened comp audio changed',
      );
      mode = 'lost';
      const edit = { ...snapshot, selected: originals[0].id };
      await reject(
        () => writer.save(edit, signal),
        'Lost response should retain pending',
      );
      check(
        !!writer.pending && bankRecords.get(writer.id).revision === 2,
        'Pending save not preserved',
      );
      await writer.save(edit, signal);
      check(
        writer.revision === 2 && saves === 3,
        'Lost response created a duplicate revision',
      );
      const stale = new BankWriter(restored);
      await reject(
        () => stale.save({ ...snapshot, title: 'Stale' }, signal),
        'Stale bank overwrote newer save',
      );
      check(
        bankRecords.get(writer.id).data.title === 'Vocal session',
        'Conflict replaced stored data',
      );
      mode = 'truncated';
      await reject(
        () => loadBank(writer.id, signal),
        'Truncated WAV was accepted',
      );
      mode = 'denied';
      await reject(() => loadBank(writer.id, signal), 'Denied bank reopened');
      mode = '';
      const current = await loadBank(writer.id, signal);
      const projectId = crypto.randomUUID(),
        target = {
          ...defaults('Original vocal'),
          fileId: crypto.randomUUID(),
          offset: 2,
        };
      const linked = {
        ...current,
        data: { ...current.data, projectId, target },
      };
      const fresh = {
        id: projectId,
        title: 'Newest title',
        data: { bpm: 98, tracks: [target] },
        revision: 7,
        canEdit: true,
        canManage: false,
      };
      const dirty = {
        ...fresh,
        title: 'Unsaved title',
        dirty: true,
        baseline: { title: 'Older', data: fresh.data, revision: 6 },
        data: { ...fresh.data, bpm: 110 },
      };
      const resumed = bankProject(linked, fresh, dirty);
      check(
        resumed.title === 'Unsaved title' &&
          resumed.data.bpm === 110 &&
          resumed.baseline.revision === 6,
        'Reopening lost dirty working edits or their baseline',
      );
      check(
        resumed.canManage === false && !resumed.restoreWarning,
        'Fresh permissions or unchanged target not retained',
      );
      check(
        !!bankProject(
          linked,
          {
            ...fresh,
            data: {
              ...fresh.data,
              tracks: [{ ...target, fileId: crypto.randomUUID() }],
            },
          },
          dirty,
        ).restoreWarning,
        'Newer saved vocal was not protected',
      );
      check(
        !!bankProject(linked, fresh, {
          ...dirty,
          data: { ...dirty.data, tracks: [{ ...target, volume: 0.1 }] },
        }).restoreWarning,
        'Unsaved vocal edit was not protected',
      );
      await reject(
        async () => bankProject(linked, { ...fresh, canEdit: false }, dirty),
        'Revoked project reopened from an old working draft',
      );
      check(
        bankProject(current).dirty === true,
        'Unlinked bank did not open a separate working arrangement',
      );
      await open(current);
      check(
        captureStarts === 0 && plays === 0,
        'Opening starts capture or playback',
      );
      check(
        document.querySelectorAll('.take-bank-item').length === 2,
        'Recorder omitted restored originals',
      );
      await click('Use Take 1 as full comp');
      check(
        !button('Save takes & comp')?.disabled,
        'Comp edit did not require saving',
      );
      mode = 'conflict';
      await click('Save takes & comp');
      await wait(() =>
        document.body.textContent!.includes('Your local takes are still here'),
      );
      check(
        document.querySelectorAll('.take-bank-item').length === 2,
        'Save failure discarded originals',
      );
      mode = '';
      await click('Save takes & comp');
      await wait(() => !!button('Takes & comp saved'));
      check(
        bankRecords.get(writer.id).data.regions.length === 1,
        'Comp choices not saved from recorder',
      );
      const closeButton =
        document.querySelector<HTMLButtonElement>(
          'button[aria-label="Close"]',
        ) ||
        [...document.querySelectorAll<HTMLButtonElement>('button')].find(
          (b) => b.textContent?.trim() === 'Close',
        );
      if (closeButton) {
        closeButton.click();
        await wait(() => !document.querySelector('.take-workbench'));
      } else {
        setRecord(null);
        await wait(() => !document.querySelector('.take-workbench'));
      }
      await open(await loadBank(writer.id, signal));
      check(
        document.querySelectorAll('.take-bank-item').length === 2,
        'Closed originals could not reopen',
      );
      bankRecords.get(writer.id).revision++;
      const closeAgain = [
        ...document.querySelectorAll<HTMLButtonElement>('button'),
      ].find((b) => b.textContent?.trim() === 'Close')!;
      closeAgain.click();
      await wait(() => !!document.querySelector('[role="alertdialog"]'));
      check(
        document.querySelectorAll('.take-bank-item').length === 2,
        'Changed bank silently discarded local originals on close',
      );
      await click('Keep it');
      setGranted(false);
      await wait(
        () =>
          !!button('Save takes & comp')?.disabled ||
          !!button('Takes & comp saved')?.disabled,
      );
      check(
        !!document.querySelector('a[download="SESSION Take 1.wav"]'),
        'Revocation removed local download',
      );
      setRecord(null);
      await wait(() => !document.querySelector('.take-workbench'));
      setPanel(true);
      await wait(() => !!button('Open takes'));
      check(
        document.body.textContent!.includes('Vocal session'),
        'Saved banks absent from list',
      );
      await click('Delete bank');
      await wait(() => !!document.querySelector('[role="alertdialog"]'));
      const confirm = [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[role="alertdialog"] button',
        ),
      ].find((b) => b.textContent === 'Delete bank')!;
      confirm.click();
      await wait(() => bankRecords.size === 0);
      check(true, 'Bank deletion');
      setPanel(false);
      setLog(
        'PASS: ' +
          checks +
          ' saved-take upload, retry, recovery, audio, conflict, privacy and recorder UI assertions.',
      );
    } catch (e) {
      setLog('FAIL: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      mode = '';
      setBusy(false);
    }
  }
  return (
    <main style={{ padding: 20, maxWidth: 900, margin: '20px auto' }}>
      <h1>SESSION saved takes verification</h1>
      <p>
        Synthetic originals and a simulated private storage service. No account,
        microphone or camera is used.
      </p>
      <button
        className="button primary"
        disabled={busy}
        onClick={() => void run()}
      >
        Run saved-take checks
      </button>
      <output aria-label="Saved-take results">{log}</output>
      <button
        className="button secondary"
        disabled={busy}
        onClick={async () => {
          mode = '';
          const takes = [await original(1), await original(2)];
          const writer = new BankWriter();
          await writer.save(
            {
              version: 1,
              title: 'Evening vocals',
              projectId: '',
              backing: { bpm: 120, tracks: [] },
              offset: 2,
              takes,
              selected: takes[0].id,
              regions: [
                { takeId: takes[0].id, start: 0, end: 0.5 },
                { takeId: takes[1].id, start: 0.5, end: 1 },
              ],
              applied: false,
            },
            new AbortController().signal,
          );
          await open(await loadBank(writer.id, new AbortController().signal));
        }}
      >
        Show saved-take example
      </button>
      {record && (
        <RecordTake
          key={key}
          data={record.data.backing}
          offset={record.data.offset}
          title={record.data.title}
          restored={record}
          canEdit={granted}
          onKeep={async () => {}}
          onClose={() => setRecord(null)}
          createCapture={() =>
            ({
              connect: async () => {
                captureStarts++;
              },
              dispose: () => {},
              cancel: () => {},
            }) as unknown as TakeCapture
          }
        />
      )}
      <SavedTakesPanel
        open={panel}
        onClose={() => setPanel(false)}
        onOpen={async (id, signal) => open(await loadBank(id, signal))}
      />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
