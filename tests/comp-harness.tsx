import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import RecordTake from '../app/record-take';
import type { CaptureHooks, TakeCapture, RecordedTake } from '../lib/recording';
import { encodeWave } from '../lib/audio-files';
import { takePCM } from '../lib/take-comp';
import '../app/globals.css';
import '../app/advanced.css';
const data = { bpm: 120, tracks: [] };
let count = 0,
  cancelled = 0,
  kept: RecordedTake[] = [],
  mode = 'ok',
  hold: (() => void) | null = null;
let captureMode = 'full';
function factory(h: CaptureHooks): TakeCapture {
  let epoch = 0;
  let length = 48000,
    start = 12.5;
  return {
    connect: async () => {
      h.state('ready');
    },
    start: async (
      _data: unknown,
      offset: number,
      _bars: number,
      _limit: number,
      exact?: { frames: number; sampleRate: number },
    ) => {
      start = offset;
      length = exact?.frames || 48000;
      if (captureMode === 'disconnect') {
        h.state('error');
        h.error('Simulated microphone disconnect. Current vocal unchanged.');
        return;
      }
      h.state('recording');
    },
    finish: () => {
      const token = epoch;
      h.state('finishing');
      const samples = new Float32Array(
        captureMode === 'short' ? Math.floor(length / 2) : length,
      ).fill(++count % 2 ? 0.2 : 0.7);
      void encodeWave(
        {
          length: samples.length,
          sampleRate: 48000,
          numberOfChannels: 1,
          getChannelData: () => samples,
        },
        24,
        { channels: 1 },
      ).then(({ blob, peak }) => {
        if (token !== epoch) return;
        h.state('review');
        h.take({
          blob,
          peak,
          sampleRate: 48000,
          depth: 24,
          seconds: samples.length / 48000,
          offset: start,
        });
      });
    },
    cancel: () => {
      epoch++;
      cancelled++;
      h.state('idle');
    },
    dispose: () => {
      epoch++;
      cancelled++;
    },
  } as unknown as TakeCapture;
}
const wait = async (fn: () => boolean) => {
  for (let i = 0; i < 500; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error('Timed out waiting for comp UI');
};
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  );
async function click(text: string) {
  await wait(() => !!button(text) && !button(text)!.disabled);
  button(text)!.click();
  await new Promise((r) => setTimeout(r, 20));
}
function input(label: string, value: string) {
  const el = document.querySelector<HTMLInputElement>(
    'input[aria-label="' + label + '"]',
  )!;
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function App() {
  const [show, setShow] = useState(false),
    [seed, setSeed] = useState<(RecordedTake & { name: string }) | undefined>(),
    [granted, setGranted] = useState(true),
    [key, setKey] = useState(0),
    [log, setLog] = useState(''),
    [busy, setBusy] = useState(false);
  async function open(withSeed?: RecordedTake & { name: string }) {
    setSeed(withSeed);
    setGranted(true);
    setKey((k) => k + 1);
    setShow(true);
    await wait(
      () =>
        !!button(
          withSeed ? 'Apply comp to selected clip' : 'Enable microphone',
        ),
    );
  }
  async function record() {
    await click('Enable microphone');
    await click('Start recording');
    await click('Stop and review');
    await wait(() => !!button('Record another take'));
  }
  async function run() {
    captureMode = 'full';
    setBusy(true);
    setLog('Checking comp workflow…');
    let checks = 0;
    const check = (v: unknown, m: string) => {
      if (!v) throw Error(m);
      checks++;
    };
    const text = () => document.body.textContent || '';
    try {
      count = 0;
      kept = [];
      mode = 'fail';
      await open();
      await record();
      const firstURL = document.querySelector<HTMLAnchorElement>(
        'a[download="SESSION Take 1.wav"]',
      )!.href;
      await click('Record another take');
      await record();
      check(
        text().includes('Take 1') && text().includes('Take 2'),
        'Another take erased originals',
      );
      check((await fetch(firstURL)).ok, 'Retained URL was revoked');
      input('Comp range start', '0.25');
      input('Comp range end', '0.75');
      await new Promise((r) => setTimeout(r, 20));
      await click('Use Take 2 for this section');
      check(text().includes('3 sections'), 'Replacement regions missing');
      const choose = [
        ...document.querySelectorAll<HTMLButtonElement>('.take-bank-item'),
      ];
      choose[0].click();
      await new Promise((r) => setTimeout(r, 20));
      const section = document.querySelector<HTMLButtonElement>(
        '.comp-timeline button:nth-child(2)',
      )!;
      section.click();
      await new Promise((r) => setTimeout(r, 20));
      check(
        document.querySelector<HTMLInputElement>(
          '[aria-label="Comp range start"]',
        )!.value === '0.25' &&
          document.querySelector<HTMLInputElement>(
            '[aria-label="Comp range end"]',
          )!.value === '0.75',
        'Section selection reset its range',
      );
      await click('Prepare comp preview');
      await wait(
        () => !!document.querySelector('a[download="SESSION vocal comp.wav"]'),
      );
      const preview = document.querySelector<HTMLAnchorElement>(
        'a[download="SESSION vocal comp.wav"]',
      )!.href;
      const blob = await (await fetch(preview)).blob();
      const pcm = await takePCM({
        blob,
        seconds: 1,
        offset: 12.5,
        peak: 0.7,
        sampleRate: 48000,
        depth: 24,
      });
      check(
        Math.abs(pcm[1000] - 0.2) < 1e-6 &&
          Math.abs(pcm[24000] - 0.7) < 1e-6 &&
          Math.abs(pcm[47000] - 0.2) < 1e-6,
        'Comp preview has wrong source samples',
      );
      await click('Add comp to project');
      await wait(() => text().includes('Simulated upload failure'));
      check(
        kept.length === 0 &&
          !!document.querySelector('a[download="SESSION Take 2.wav"]'),
        'Upload failure lost takes',
      );
      await click('Undo comp edit');
      check(
        !document.querySelector('a[download="SESSION vocal comp.wav"]'),
        'Old preview survived comp edit',
      );
      await click('Redo');
      check(text().includes('3 sections'), 'Redo lost range');
      mode = 'slow';
      await click('Add comp to project');
      await wait(() => !!hold);
      await click('Cancel upload');
      hold!();
      hold = null;
      await new Promise((r) => setTimeout(r, 30));
      check(
        !text().includes('Added to your arrangement') && kept.length === 0,
        'Cancelled upload was installed',
      );
      mode = 'ok';
      await click('Add comp to project');
      await wait(() => text().includes('Added to your arrangement'));
      check(
        kept.length === 1 && kept[0].kind === 'comp' && kept[0].offset === 12.5,
        'Wrong comp uploaded',
      );
      check(
        !!button('Done with takes') &&
          !!document.querySelector('a[download="SESSION Take 2.wav"]'),
        'Success closed bank',
      );
      await click('Done with takes');
      await wait(() => text().includes('Close recorder with unsaved changes?'));
      check(
        text().includes(
          'Closing discards unsaved local takes and comp choices',
        ),
        'Close disclosure missing',
      );
      await click('Keep it');
      check(!!button('Done with takes'), 'Cancel close lost originals');
      await click('Done with takes');
      await click('Close recorder');
      await wait(() => !button('Done with takes'));
      let gone = false;
      try {
        await fetch(firstURL);
      } catch {
        gone = true;
      }
      check(gone, 'Unmount left original URL live');
      await open();
      await record();
      for (let i = 1; i < 8; i++) {
        await click('Record another take');
        await record();
      }
      check(button('Record another take')?.disabled, 'Ninth take enabled');
      check(
        document.querySelectorAll('.take-bank-item').length === 8,
        'Capacity evicted originals',
      );
      setGranted(false);
      await new Promise((r) => setTimeout(r, 30));
      check(
        button('Add comp to project')?.disabled &&
          !!document.querySelector('a[download]'),
        'Revocation lost downloads or allowed upload',
      );
      check(
        text().includes('Editing access has ended'),
        'Permission message missing',
      );
      setShow(false);
      await wait(() => !button('Add comp to project'));
      check(cancelled > 0, 'Capture was not cleaned up');
      setLog(
        'PASS: ' +
          checks +
          ' take-bank, comp-selection, PCM-preview, undo, upload, access, capacity and URL lifecycle assertions.',
      );
    } catch (e) {
      setLog('FAIL: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }
  async function runPunch() {
    setBusy(true);
    setLog('Checking punch-in workflow…');
    let checks = 0;
    const check = (v: unknown, message: string) => {
      if (!v) throw Error(message);
      checks++;
    };
    const timeline = () =>
      document.querySelector('.comp-timeline')?.textContent || '';
    const text = () => document.body.textContent || '';
    const range = async () => {
      input('Comp range start', '.25');
      input('Comp range end', '.75');
      await new Promise((r) => setTimeout(r, 25));
    };
    const previewURL = () =>
      document.querySelector<HTMLAnchorElement>(
        'a[download="SESSION vocal comp.wav"]',
      )?.href;
    try {
      captureMode = 'full';
      mode = 'ok';
      count = 0;
      kept = [];
      await open();
      await record();
      await range();
      const original = timeline();
      await click('Record this section');
      check(
        text().includes('0.25–0.75s') && text().includes('12.75s'),
        'Punch position missing',
      );
      await record();
      check(
        timeline().includes('Punch 2') &&
          document.querySelectorAll('.comp-timeline button').length === 3,
        'Completed punch not applied',
      );
      check(
        button('Use Punch 2 as full comp')?.disabled,
        'Partial take can become full comp',
      );
      const punched = timeline();
      await click('Undo comp edit');
      check(
        timeline() === original,
        'Auto-punch Undo did not restore previous vocal',
      );
      await click('Redo');
      check(timeline() === punched, 'Auto-punch Redo lost edit');
      await click('Prepare comp preview');
      await wait(() => !!previewURL());
      const prepared = previewURL()!;
      await range();
      await click('Record this section');
      captureMode = 'short';
      await record();
      check(
        timeline() === punched && previewURL() === prepared,
        'Short punch replaced vocal or discarded valid preview',
      );
      check(
        text().includes('ended early') &&
          text().includes('Recorded range: 0.25–0.50s'),
        'Short punch missing coverage/warning',
      );
      check(
        !!document.querySelector('a[download="SESSION Punch 3.wav"]'),
        'Short recording not downloadable',
      );
      await range();
      await click('Use Punch 3 for this section');
      check(
        timeline() === punched && text().includes('continuous sections'),
        'Uncovered short donor accepted',
      );
      captureMode = 'disconnect';
      await range();
      await click('Record this section');
      await click('Enable microphone');
      await click('Start recording');
      check(
        text().includes('Simulated microphone disconnect'),
        'Disconnect not reported',
      );
      await click('Back to takes');
      check(
        timeline() === punched && previewURL() === prepared,
        'Disconnect changed comp',
      );
      await range();
      await click('Record this section');
      await click('Back to takes');
      check(timeline() === punched, 'Cancel punch changed comp');
      setGranted(false);
      await new Promise((r) => setTimeout(r, 30));
      check(
        button('Record this section')?.disabled && !!previewURL(),
        'Revocation allowed punch or lost prepared audio',
      );
      setShow(false);
      await wait(() => !button('Add comp to project'));
      const seedSamples = new Float32Array(48000).fill(0.2);
      const encoded = await encodeWave(
        {
          length: 48000,
          sampleRate: 48000,
          numberOfChannels: 1,
          getChannelData: () => seedSamples,
        },
        32,
        { channels: 1 },
      );
      await open({
        blob: encoded.blob,
        seconds: 1,
        offset: 12.5,
        peak: 0.2,
        sampleRate: 48000,
        depth: 32,
        name: 'Saved vocal',
      });
      check(
        button('Discard selected take')?.disabled &&
          !button('Record another take'),
        'Seed can be discarded or replaced with arbitrary length',
      );
      captureMode = 'full';
      await range();
      await click('Record this section');
      await click('Enable microphone');
      await click('Start recording');
      await click('Stop and review');
      await wait(() => !!button('Apply comp to selected clip'));
      await click('Apply comp to selected clip');
      await wait(() => kept.length === 1);
      check(
        kept[0].seconds === 1 && kept[0].offset === 12.5,
        'Seed replacement changed vocal boundaries',
      );
      const pcm = await takePCM(kept[0]);
      check(
        Math.abs(pcm[1000] - 0.2) < 1e-6 && Math.abs(pcm[47000] - 0.2) < 1e-6,
        'Seed punch changed surrounding audio',
      );
      setShow(false);
      await wait(() => !button('Done with takes'));
      setLog(
        'PASS: ' +
          checks +
          ' punch, exact-range, Undo/Redo, partial-retention, cancellation, permission and selected-clip UI assertions.',
      );
    } catch (e) {
      setLog('FAIL: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      captureMode = 'full';
      setBusy(false);
    }
  }
  return (
    <main style={{ maxWidth: 880, margin: '30px auto', padding: 20 }}>
      <h1>SESSION multiple takes verification</h1>
      <p>
        Synthetic WAV signals only. No hardware microphone, camera, account or
        uploaded music.
      </p>
      <div className="actions">
        <button
          disabled={busy}
          className="button primary"
          onClick={() => void runPunch()}
        >
          Run punch workflow checks
        </button>
        <button
          disabled={busy}
          onClick={() => void run()}
          className="button primary"
        >
          Run comp workflow checks
        </button>
        <button
          disabled={busy}
          onClick={() => {
            mode = 'ok';
            count = 0;
            void open();
          }}
          className="button secondary"
        >
          Open comp recorder
        </button>
      </div>
      <button
        className="button secondary"
        disabled={busy}
        onClick={async () => {
          mode = 'ok';
          count = 0;
          await open();
          await record();
          await click('Record another take');
          await record();
          input('Comp range start', '0.25');
          input('Comp range end', '0.75');
          await new Promise((r) => setTimeout(r, 20));
          await click('Use Take 2 for this section');
        }}
      >
        Show comp example
      </button>
      <output aria-label="Comp results">{log}</output>
      {show && (
        <RecordTake
          key={key}
          data={data}
          seed={seed}
          offset={12.5}
          canEdit={granted}
          createCapture={factory}
          onClose={() => setShow(false)}
          onKeep={async (t, signal) => {
            if (mode === 'fail')
              throw Error('Simulated upload failure. Originals stay here.');
            if (mode === 'slow') await new Promise<void>((r) => (hold = r));
            if (signal.aborted)
              throw new DOMException('Cancelled', 'AbortError');
            kept.push(t);
          }}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
