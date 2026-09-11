import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Studio from '../app/studio';
import { bufferFor } from '../lib/audio';
import '../app/globals.css';
import '../app/advanced.css';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function wait(test: () => boolean) {
  for (let i = 0; i < 1000; i++) {
    if (test()) return;
    await delay(10);
  }
  throw Error('Import test timed out');
}
const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) =>
      b.textContent?.trim() === name || b.getAttribute('aria-label') === name,
  );
async function click(name: string) {
  await wait(() => !!button(name) && !button(name)!.disabled);
  button(name)!.click();
  await delay(40);
}
function input(value: string) {
  const el = document.querySelector<HTMLInputElement>(
    'input[aria-label="Insert at (seconds)"]',
  )!;
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
const u32 = (n: number) => [
  (n >>> 24) & 255,
  (n >>> 16) & 255,
  (n >>> 8) & 255,
  n & 255,
];
const chunk = (data: number[]) => [
  77,
  84,
  114,
  107,
  ...u32(data.length),
  ...data,
];
const named = (name: string) => [
  0,
  255,
  3,
  name.length,
  ...Array.from(name).map((c) => c.charCodeAt(0)),
];
const fixture = () =>
  new File(
    [
      new Uint8Array([
        77,
        84,
        104,
        100,
        0,
        0,
        0,
        6,
        0,
        1,
        0,
        3,
        1,
        224,
        ...chunk([
          ...named('Melody'),
          0,
          255,
          81,
          3,
          7,
          161,
          32,
          0,
          144,
          60,
          90,
          131,
          96,
          128,
          60,
          0,
          0,
          255,
          47,
          0,
        ]),
        ...chunk([
          ...named('Harmony'),
          131,
          96,
          145,
          67,
          70,
          131,
          96,
          129,
          67,
          0,
          0,
          255,
          47,
          0,
        ]),
        ...chunk([
          ...named('Drums'),
          0,
          153,
          36,
          90,
          131,
          96,
          137,
          36,
          0,
          0,
          255,
          47,
          0,
        ]),
      ]),
    ],
    'Original melodies.mid',
    { type: 'audio/midi' },
  );
async function choose(file = fixture()) {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const el = document.querySelector<HTMLInputElement>(
    'input[aria-label="Choose MIDI file"]',
  )!;
  el.files = transfer.files;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await delay(60);
}
let draft: any,
  calls = 0;
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  calls++;
  throw Error('Unexpected network access: ' + args[0]);
};
window.addEventListener('pagehide', () => {
  window.fetch = originalFetch;
});
function App() {
  const [show, setShow] = useState(false),
    [key, setKey] = useState(0),
    [allowed, setAllowed] = useState(true),
    [log, setLog] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  async function run() {
    setBusy(true);
    setLog('Checking the actual import and studio workflow…');
    let checks = 0;
    const check = (value: unknown, message: string) => {
      if (!value) throw Error(message);
      checks++;
    };
    try {
      calls = 0;
      draft = null;
      setAllowed(true);
      setKey((k) => k + 1);
      setShow(true);
      await click('Import MIDI file');
      await choose(new File([new Uint8Array([0, 1, 2])], 'broken.mid'));
      check(
        !!document.querySelector('[role="alert"]'),
        'Malformed file did not show an error',
      );
      check(!draft.data.tracks.length, 'Malformed file changed the project');
      await choose();
      const boxes = () => [
        ...document.querySelectorAll<HTMLInputElement>(
          '.midi-import-parts input[type="checkbox"]',
        ),
      ];
      check(
        boxes().length === 3 && boxes()[0].checked && !boxes()[1].checked,
        'Part defaults were wrong',
      );
      check(boxes()[2].disabled, 'Drum part silently available as piano');
      check(!draft.data.tracks.length, 'File selection mutated the project');
      check(
        document.documentElement.scrollWidth <= window.innerWidth + 1,
        'Import layout overflowed horizontally',
      );
      boxes()[1].click();
      await delay(30);
      input('299');
      await delay(30);
      check(
        button('Add 2 parts to project')!.disabled,
        'Beyond-duration import was enabled',
      );
      input('');
      await delay(30);
      check(
        button('Add 2 parts to project')!.disabled,
        'Empty offset was accepted',
      );
      input('2');
      await delay(30);
      const tempo = [
        ...document.querySelectorAll<HTMLInputElement>(
          '.midi-import-settings input[type="checkbox"]',
        ),
      ][0];
      tempo.click();
      await delay(30);
      await click('Preview selected parts');
      check(!!button('Stop preview'), 'Preview did not start');
      await click('Stop preview');
      check(!draft.data.tracks.length, 'Preview changed the project');
      await click('Add 2 parts to project');
      await wait(() => draft.data.tracks.length === 2);
      check(
        !document.querySelector('[role="dialog"]'),
        'Add did not close review',
      );
      check(draft.data.bpm === 120, 'File tempo was not applied');
      check(
        draft.data.tracks.every((t: any) => t.offset === 2),
        'Common insertion offset was lost',
      );
      check(
        draft.data.tracks[0].notes[0].start === 0 &&
          draft.data.tracks[1].notes[0].start === 1,
        'Part alignment was lost',
      );
      const kept = JSON.stringify(draft.data.tracks.map((t: any) => t.notes));
      const b = await bufferFor(draft.data.tracks[0], draft.data.bpm);
      check(
        b.getChannelData(0).some((v) => Math.abs(v) > 0.001),
        'Imported notes rendered silence',
      );
      await click('Undo');
      check(
        draft.data.tracks.length === 0 && draft.data.bpm === 92,
        'Undo did not restore tracks and tempo together',
      );
      await click('Redo');
      check(
        JSON.stringify(draft.data.tracks.map((t: any) => t.notes)) === kept &&
          draft.data.bpm === 120,
        'Redo changed MIDI notes',
      );
      await click('Import MIDI file');
      await choose();
      check(
        !document.body.textContent!.includes(
          'Use file tempo for this empty project',
        ),
        'Nonempty project offered tempo adoption',
      );
      await click('Cancel import');
      check(draft.data.tracks.length === 2, 'Cancel changed existing music');
      await click('Import MIDI file');
      let release!: (b: ArrayBuffer) => void;
      const pending = fixture(),
        bytes = await pending.arrayBuffer();
      pending.arrayBuffer = () =>
        new Promise((r) => {
          release = r;
        });
      await choose(pending);
      await click('Cancel import');
      release(bytes);
      await delay(60);
      check(
        !document.querySelector('[role="dialog"]') &&
          draft.data.tracks.length === 2,
        'Late read reopened or changed the project',
      );
      await click('Import MIDI file');
      await choose();
      const render = OfflineAudioContext.prototype.startRendering;
      let releaseRender!: () => void,
        preparations = 0;
      const renderGate = new Promise<void>((resolve) => {
        releaseRender = resolve;
      });
      OfflineAudioContext.prototype.startRendering = function () {
        preparations++;
        return renderGate.then(() => render.call(this));
      };
      try {
        await click('Preview selected parts');
        await wait(() => preparations > 0);
        await click('Stop preview');
        check(
          button('Preview selected parts')!.disabled &&
            button('Add 1 part to project')!.disabled,
          'Stopped preparation allowed concurrent render or Add',
        );
        await click('Cancel import');
        await click('Import MIDI file');
        await choose();
        check(
          button('Preview selected parts')!.disabled &&
            button('Add 1 part to project')!.disabled,
          'Reopened dialog ignored pending preparation',
        );
        check(preparations === 1, 'More than one pending render started');
        releaseRender();
        await wait(() => !button('Preview selected parts')!.disabled);
        check(
          !button('Stop preview') && !button('Add 1 part to project')!.disabled,
          'Cancelled render restarted playback or left import locked',
        );
        check(
          draft.data.tracks.length === 2,
          'Cancelled preview preparation changed the project',
        );
      } finally {
        releaseRender();
        OfflineAudioContext.prototype.startRendering = render;
      }
      await click('Preview selected parts');
      setAllowed(false);
      await delay(60);
      check(
        button('Add 1 part to project')!.disabled &&
          !!document.querySelector('[role="alert"]'),
        'Access loss allowed import',
      );
      check(!button('Stop preview'), 'Access loss left preview active');
      check(
        draft.data.tracks.length === 2,
        'Access loss changed existing music',
      );
      await click('Cancel import');
      check(calls === 0, 'File review sent a network request');
      setShow(false);
      setLog(
        `PASS: ${checks} MIDI import UI, real rendering, privacy, alignment, Undo/Redo, permission and stale-read assertions.`,
      );
    } catch (e: any) {
      setLog('FAIL: ' + e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main style={{ padding: 20 }}>
      <h1>SESSION MIDI import verification</h1>
      <p>Generated fixtures only. No uploads or account changes.</p>
      <div className="actions">
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void run()}
        >
          Run import checks
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={async () => {
            setAllowed(true);
            setKey((k) => k + 1);
            setShow(true);
            await click('Import MIDI file');
            await choose();
          }}
        >
          Show import studio
        </button>
        <button className="button secondary" onClick={() => void choose()}>
          Load fixture MIDI
        </button>
      </div>
      <output aria-label="Import results">{log}</output>
      <p>{notice}</p>
      {show && (
        <Studio
          key={key}
          initial={{
            title: 'MIDI import test',
            canEdit: true,
            canManage: true,
            data: { bpm: 92, tracks: [] },
          }}
          roomAllowed={allowed}
          onDraft={(p) => {
            draft = p;
          }}
          onSaved={() => {}}
          onBrowse={() => {}}
          notify={setNotice}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
