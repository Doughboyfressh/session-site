import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Studio from '../app/studio';
import { defaults } from '../lib/audio';
import { encodeWave } from '../lib/audio-files';
import '../app/globals.css';
import '../app/advanced.css';

let wave: Blob,
  draft: any,
  mode = 'ok',
  release: (() => void) | null = null,
  reads = 0,
  uploads = 0;
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith('/api/file/')) {
    reads++;
    if (mode === 'deny') return new Response('Private', { status: 403 });
    if (mode === 'hold-source') await new Promise<void>((r) => (release = r));
    return new Response(wave);
  }
  if (url === '/api/upload') {
    uploads++;
    if (
      !(init?.body instanceof FormData) ||
      init.body.get('purpose') !== 'audio'
    )
      throw Error('Wrong upload purpose');
    if (mode === 'fail')
      return Response.json(
        { error: 'Synthetic upload failure' },
        { status: 500 },
      );
    if (mode === 'hold-upload') await new Promise<void>((r) => (release = r));
    return Response.json({ id: 'new-vocal' });
  }
  if (url.startsWith('/api/'))
    throw Error('Unexpected backend request: ' + url);
  return nativeFetch(input, init);
};
const target = {
  ...defaults('Vocal source'),
  id: 'vocal',
  fileId: 'original-vocal',
  duration: 1,
  offset: 3.5,
  peaks: [0.2],
  volume: 0.6,
  pan: -0.25,
  reverb: 0.1,
  fadeIn: 0.1,
  automation: [{ time: 3.5, value: 0.8 }],
};
const initial = {
  title: 'Punch replacement test',
  canEdit: true,
  data: {
    bpm: 120,
    tracks: [
      target,
      ...Array.from({ length: 31 }, (_, i) => ({
        ...defaults('Channel ' + i),
        id: 'channel-' + i,
        notes: [],
        duration: 1,
        peaks: [],
      })),
    ],
  },
};
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) =>
      b.textContent?.trim() === label || b.getAttribute('aria-label') === label,
  );
async function wait(fn: () => boolean) {
  for (let i = 0; i < 800; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error('Studio test timed out');
}
async function click(label: string) {
  await wait(() => !!button(label) && !button(label)!.disabled);
  button(label)!.click();
  await new Promise((r) => setTimeout(r, 30));
}
function App() {
  const [show, setShow] = useState(false),
    [allowed, setAllowed] = useState(true),
    [key, setKey] = useState(0),
    [busy, setBusy] = useState(false),
    [log, setLog] = useState(''),
    [notice, setNotice] = useState('');
  async function run() {
    setBusy(true);
    setLog('Checking selected vocal replacement…');
    let checks = 0;
    const check = (v: unknown, m: string) => {
      if (!v) throw Error(m);
      checks++;
    };
    const open = async () => {
      setAllowed(true);
      setKey((k) => k + 1);
      setShow(true);
      await wait(
        () =>
          !!button('Punch in selected vocal') &&
          !button('Punch in selected vocal')!.disabled,
      );
    };
    try {
      const pcm = new Float32Array(48000).fill(0.2);
      wave = (
        await encodeWave(
          {
            length: pcm.length,
            sampleRate: 48000,
            numberOfChannels: 1,
            getChannelData: () => pcm,
          },
          24,
          { channels: 1 },
        )
      ).blob;
      mode = 'ok';
      await open();
      await click('Punch in selected vocal');
      await wait(() => !!button('Apply comp to selected clip'));
      check(
        document.body.textContent?.includes('Vocal source · original'),
        'Selected source missing',
      );
      check(
        !!button('Apply comp to selected clip') &&
          draft.data.tracks.length === 32,
        'Capacity blocked replacement',
      );
      check(
        !document.querySelector('meter[aria-label="Microphone input level"]'),
        'Opening saved vocal activated microphone',
      );
      mode = 'fail';
      await click('Apply comp to selected clip');
      await wait(
        () =>
          document.body.textContent?.includes('Synthetic upload failure') ||
          false,
      );
      check(
        draft.data.tracks[0].fileId === target.fileId,
        'Failed upload replaced source',
      );
      mode = 'hold-upload';
      await click('Apply comp to selected clip');
      await wait(() => !!release);
      await click('Cancel upload');
      release!();
      release = null;
      await new Promise((r) => setTimeout(r, 30));
      check(
        draft.data.tracks[0].fileId === target.fileId,
        'Cancelled upload replaced source',
      );
      mode = 'ok';
      await click('Apply comp to selected clip');
      await wait(() => !!button('Done with takes'));
      check(
        draft.data.tracks.length === 32 &&
          draft.data.tracks[0].fileId === 'new-vocal',
        'Replacement did not update same track at capacity',
      );
      const changed = draft.data.tracks[0];
      check(
        changed.id === target.id &&
          changed.offset === target.offset &&
          changed.volume === target.volume &&
          changed.pan === target.pan &&
          JSON.stringify(changed.automation) ===
            JSON.stringify(target.automation),
        'Mixer settings or timing changed',
      );
      await click('Done with takes');
      await click('Close recorder');
      await wait(() => !button('Done with takes'));
      await click('Undo');
      await wait(() => draft.data.tracks[0].fileId === target.fileId);
      check(
        draft.data.tracks[0].fileId === target.fileId,
        'Studio Undo failed to restore original',
      );
      const before = reads;
      mode = 'deny';
      await click('Punch in selected vocal');
      await wait(
        () =>
          document.body.textContent?.includes('no longer available') || false,
      );
      check(
        reads > before && !button('Apply comp to selected clip'),
        'Cached source bypassed private access revalidation',
      );
      mode = 'hold-source';
      await click('Punch in selected vocal');
      await wait(() => !!release);
      setAllowed(false);
      await new Promise((r) => setTimeout(r, 30));
      release!();
      release = null;
      await wait(
        () =>
          document.body.textContent?.includes('editing access ended') || false,
      );
      check(
        !button('Apply comp to selected clip') &&
          draft.data.tracks[0].fileId === target.fileId,
        'Revoked source loading opened recorder',
      );
      check(uploads === 3, 'Unexpected upload count');
      setShow(false);
      setLog(
        'PASS: ' +
          checks +
          ' selected-vocal loading, private access, upload failure/cancellation, 32-track replacement, mixer preservation and Studio Undo assertions.',
      );
    } catch (e) {
      setLog('FAIL: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <h1>Selected vocal integration checks</h1>
      <p>
        Synthetic audio and local mocked requests only. No microphone, account,
        or real uploads.
      </p>
      <button disabled={busy} onClick={() => void run()}>
        Run selected vocal checks
      </button>
      <output aria-label="Studio punch results">{log}</output>
      <p role="status">{notice}</p>
      {show && (
        <Studio
          key={key}
          initial={initial}
          roomAllowed={allowed}
          onDraft={(p) => (draft = p)}
          onSaved={() => {}}
          onBrowse={() => {}}
          notify={setNotice}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
