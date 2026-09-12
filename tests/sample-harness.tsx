import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Studio from '../app/studio';
import {
  bufferFor,
  context,
  defaults,
  sampleBuffer,
  type MixerTrack,
} from '../lib/audio';
import { encodeWave } from '../lib/audio-files';
import { createAudioExport } from '../lib/audio-export';
import { defaultSample, playSample } from '../lib/sample-instrument';
import { MidiRecorder } from '../lib/midi-recording';
import { recoverySnapshot } from '../lib/draft-recovery';
import ConflictValues from '../app/conflict-values';
import '../app/globals.css';
import '../app/advanced.css';

const delay = (ms = 35) => new Promise<void>((r) => setTimeout(r, ms));
async function wait(test: () => boolean) {
  for (let i = 0; i < 600; i++) {
    if (test()) return;
    await delay(10);
  }
  throw Error('Sampler check timed out');
}
const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button,[role="tab"]')].find(
    (b) =>
      b.textContent?.trim() === name || b.getAttribute('aria-label') === name,
  );
async function click(name: string) {
  await wait(() => !!button(name) && !button(name)!.disabled);
  button(name)!.click();
  await delay();
}
function input(name: string, value: string) {
  const el = document.querySelector<HTMLInputElement>(
    `input[aria-label="${name}"]`,
  )!;
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
async function option(name: string, value: string) {
  await click(name);
  const el = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((e) => e.textContent?.trim() === value)!;
  el.click();
  await delay();
}
const fixture = async () => {
  const c = new OfflineAudioContext(1, 88200, 44100),
    b = c.createBuffer(1, 88200, 44100);
  const data = b.getChannelData(0);
  for (let i = 0; i < data.length; i++)
    data[i] = 0.25 * Math.sin((i * 440 * 2 * Math.PI) / 44100);
  return (await encodeWave(b, 32, { channels: 1 })).blob;
};
const audio = fixture();
let revoked = false,
  uploads = 0,
  requests = 0,
  latency = 0;
const originalFetch = window.fetch.bind(window);
window.fetch = async (resource, options) => {
  const url =
    typeof resource === 'string'
      ? resource
      : resource instanceof URL
        ? resource.href
        : resource.url;
  if (url.startsWith('/api/file/sample-fixture')) {
    requests++;
    await delay(latency);
    if (options?.signal?.aborted)
      throw new DOMException('Cancelled', 'AbortError');
    return revoked
      ? new Response('Unavailable', { status: 403 })
      : new Response(await audio, { headers: { 'Content-Type': 'audio/wav' } });
  }
  if (url === '/api/upload') {
    await delay(latency);
    if (options?.signal?.aborted)
      throw new DOMException('Cancelled', 'AbortError');
    uploads++;
    return Response.json({ id: 'sample-fixture-' + uploads });
  }
  if (url.startsWith('/api/'))
    throw Error('Unexpected API request in local sampler fixture');
  return originalFetch(resource, options);
};
const initial = {
  title: 'Sample instrument check',
  canEdit: true,
  canManage: true,
  data: {
    bpm: 120,
    tracks: [
      {
        ...defaults('Sample keys'),
        id: 'keys',
        sound: 'keys' as const,
        notes: [{ id: 'tone', pitch: 69, start: 0, length: 1, velocity: 1 }],
      },
    ],
  },
};
let draft: any;
const current = (): MixerTrack => draft.data.tracks[0];
function frequency(b: AudioBuffer, start = 0.02, end = 0.2) {
  const data = b.getChannelData(0);
  let crossings = 0;
  for (
    let i = Math.ceil(start * b.sampleRate) + 1;
    i < Math.floor(end * b.sampleRate);
    i++
  )
    if (data[i - 1] <= 0 && data[i] > 0) crossings++;
  return crossings / (end - start);
}
function peak(b: AudioBuffer, start = 0, end = b.duration) {
  const data = b.getChannelData(0);
  let max = 0;
  for (
    let i = Math.floor(start * b.sampleRate);
    i < Math.min(data.length, Math.ceil(end * b.sampleRate));
    i++
  )
    max = Math.max(max, Math.abs(data[i]));
  return max;
}
async function load(file: File) {
  const el = document.querySelector<HTMLInputElement>(
      '[aria-label="Choose instrument sample"]',
    )!,
    dt = new DataTransfer();
  dt.items.add(file);
  el.files = dt.files;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await delay();
}
function App() {
  const [show, setShow] = useState(false),
    [version, setVersion] = useState(0),
    [allowed, setAllowed] = useState(true),
    [log, setLog] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  async function reset() {
    setAllowed(true);
    setVersion((v) => v + 1);
    setShow(true);
    await click('Piano roll');
  }
  async function run() {
    let checks = 0;
    const check = (v: unknown, m: string) => {
      if (!v) throw Error(m);
      checks++;
    };
    setBusy(true);
    setLog('Checking sample audio, persistence and Studio controls…');
    try {
      revoked = false;
      latency = 0;
      await reset();
      const file = new File([await audio], '440 Hz source.wav', {
        type: 'audio/wav',
      });
      await load(file);
      await wait(
        () =>
          !!current().sample &&
          !!button('Apply sample settings') &&
          !button('Apply sample settings')!.disabled,
      );
      check(
        current().fileId?.startsWith('sample-fixture') &&
          current().notes?.length === 1,
        'Sample loading lost the melody or file reference',
      );
      check(
        current().sample?.name === '440 Hz source.wav',
        'Sample filename was not preserved',
      );
      const loaded = JSON.stringify(current().sample);
      await option('Sample root note', 'A4');
      input('Sample start (seconds)', '0.1');
      input('Sample end (seconds)', '1.5');
      input('Sample attack (ms)', '10');
      input('Sample release (ms)', '100');
      await delay();
      check(
        JSON.stringify(current().sample) === loaded,
        'Typing sample settings committed early',
      );
      await click('Apply sample settings');
      check(
        current().sample?.rootPitch === 69 &&
          current().sample?.start === 0.1 &&
          current().sample?.attack === 0.01,
        'Sample controls did not apply together',
      );
      await click('Undo');
      check(
        JSON.stringify(current().sample) === loaded,
        'Sample settings were not one Undo step',
      );
      await click('Redo');
      const settings = JSON.stringify(current().sample);
      input('Sample end (seconds)', '9');
      await delay();
      await click('Apply sample settings');
      check(
        JSON.stringify(current().sample) === settings &&
          !!document.querySelector('.sample-controls [role="alert"]'),
        'Invalid source bounds were committed',
      );
      input('Sample end (seconds)', '1.5');
      await delay();
      const restored = recoverySnapshot({
        title: draft.title,
        data: draft.data,
      });
      check(
        JSON.stringify(restored.data.tracks[0].sample) === settings &&
          restored.data.tracks[0].fileId === current().fileId,
        'Browser recovery lost sampler settings or source',
      );
      await click('Arrangement');
      check(
        button('Punch in selected vocal')!.disabled,
        'Sampled instrument was offered as a punch vocal',
      );
      await click('Piano roll');
      await click('Select all notes');
      await click('Pitch up');
      check(
        current().notes![0].pitch === 70,
        'Sample notes could not be edited',
      );
      await click('Undo');
      await option('Instrument', 'Soft keys');
      check(
        !current().sample && !current().fileId && current().notes?.length === 1,
        'Builtin switch retained sample audio or lost notes',
      );
      await click('Undo');
      check(
        !!current().sample && !!current().fileId,
        'Undo did not restore sampled instrument mode',
      );
      const source = {
        ...current(),
        sample: { ...defaultSample(2), rootPitch: 69 },
        notes: [{ id: 'n', pitch: 69, start: 0, length: 1, velocity: 1 }],
      };
      const a = await bufferFor(source, 120, {
        sampleRate: 44100,
        revalidate: true,
      });
      check(
        Math.abs(frequency(a) - 440) < 10 && peak(a) > 0.08,
        'Root note has the wrong frequency or is silent',
      );
      const up = await bufferFor(
        { ...source, notes: [{ ...source.notes[0], pitch: 81 }] },
        120,
        { sampleRate: 44100 },
      );
      const down = await bufferFor(
        { ...source, sample: { ...source.sample, rootPitch: 81 } },
        120,
        { sampleRate: 44100 },
      );
      check(
        Math.abs(frequency(up) - 880) < 12 &&
          Math.abs(frequency(down) - 220) < 10,
        'Shared-file sampler caches lost independent pitch/settings',
      );
      const slow = await bufferFor(
        { ...source, notes: [{ ...source.notes[0], start: 1 }] },
        60,
        { sampleRate: 48000 },
      );
      check(
        slow.sampleRate === 48000 &&
          Math.abs(slow.duration - 8.5) < 1e-4 &&
          peak(slow, 0, 0.9) === 0 &&
          peak(slow, 1.1, 1.2) > 0.05,
        'Tempo/sample-rate render used stale source timing',
      );
      const short = await bufferFor(
        {
          ...source,
          sample: { ...source.sample, end: 0.1 },
          notes: [{ ...source.notes[0], length: 4 }],
        },
        120,
        { sampleRate: 44100 },
      );
      check(
        peak(short, 0, 0.05) > 0.05 && peak(short, 0.11, 2.1) === 0,
        'One-shot sample played beyond its selected region',
      );
      const empty = await bufferFor({ ...source, notes: [] }, 120, {
        sampleRate: 44100,
      });
      check(
        peak(empty) === 0,
        'An empty sampled instrument played raw source audio',
      );
      const raw = await sampleBuffer(source, {
        sampleRate: 44100,
        revalidate: true,
      });
      // Compare scheduled gate versus a live note-off using OfflineAudioContext suspension.
      for (const [length, attack, release] of [
        [0.1, 1, 0.5],
        [0.95, 0.005, 0.08],
        [0.01, 0, 0.5],
      ]) {
        const config = { ...source.sample, end: 1, attack, release };
        const scheduled = new OfflineAudioContext(1, 88200, 44100);
        playSample(
          scheduled,
          scheduled.destination,
          raw,
          config,
          69,
          0,
          length,
          1,
        );
        const rendered = await scheduled.startRendering();
        const live = new OfflineAudioContext(1, 88200, 44100),
          voice = playSample(
            live,
            live.destination,
            raw,
            config,
            69,
            0,
            120,
            1,
          );
        const paused = live.suspend(length);
        const rendering = live.startRendering();
        await paused;
        voice.release();
        await live.resume();
        const heard = await rendering;
        let delta = 0;
        for (let i = 0; i < rendered.length; i++)
          delta = Math.max(
            delta,
            Math.abs(
              rendered.getChannelData(0)[i] - heard.getChannelData(0)[i],
            ),
          );
        check(
          delta < 0.008,
          'Live and rendered attack/release envelopes disagree: ' + delta,
        );
      }
      const beforeRequests = requests;
      await bufferFor(source, 120, { sampleRate: 44100, revalidate: true });
      check(
        requests > beforeRequests,
        'Cached sampler bypassed authorization revalidation',
      );
      revoked = true;
      let rejected = false;
      try {
        await bufferFor(source, 120, { sampleRate: 44100, revalidate: true });
      } catch {
        rejected = true;
      }
      check(rejected, 'Revoked cached sample still rendered');
      revoked = false;
      const exported = await createAudioExport(
        'Sampler test',
        { bpm: 120, tracks: [source] },
        {
          kind: 'mix',
          processing: 'dry',
          sampleRate: 44100,
          depth: 32,
          trackIds: [source.id],
          tail: 0,
          gainDb: 0,
          dither: false,
          includeMix: false,
        },
      );
      check(!!exported, 'Sampler export failed');
      const exportBuffer = await new OfflineAudioContext(
        2,
        1,
        44100,
      ).decodeAudioData(await exported.blob.arrayBuffer());
      check(
        Math.abs(frequency(exportBuffer) - 440) < 10 &&
          peak(exportBuffer) > 0.05,
        'Downloaded WAV lost the sample pitch or audio',
      );
      const auditionContext = context();
      const createAuditionSource =
        auditionContext.createBufferSource.bind(auditionContext);
      let auditions = 0;
      auditionContext.createBufferSource = () => {
        auditions++;
        return createAuditionSource();
      };
      try {
        latency = 100;
        button('Audition A4')!.click();
        button('Audition C4')!.click();
        button('Audition E4')!.click();
        await wait(() => auditions >= 3);
        check(auditions === 3, 'Closely spaced sample auditions dropped notes');
      } finally {
        auditionContext.createBufferSource = createAuditionSource;
        latency = 0;
      }
      check(
        document
          .querySelector('[data-sample-conflict]')
          ?.textContent?.includes('Audio file reference: sample-left') &&
          document
            .querySelector('[data-sample-conflict]')
            ?.textContent?.includes('Audio file reference: sample-right'),
        'Competing same-name sample sources were indistinguishable',
      );
      const midiContext = new AudioContext(),
        events: any[] = [];
      let sourceCount = 0;
      const nativeCreate = midiContext.createBufferSource.bind(midiContext);
      midiContext.createBufferSource = () => {
        sourceCount++;
        return nativeCreate();
      };
      const port: any = {
        id: 'sample-keyboard',
        name: 'Sample test keyboard',
        state: 'connected',
        onmidimessage: null,
        open: async () => port,
        close: async () => port,
      };
      const access: any = {
        inputs: new Map([[port.id, port]]),
        onstatechange: null,
      };
      const recorder = new MidiRecorder(
        {
          state: (p) => events.push(p),
          inputs: () => {},
          progress: () => {},
          activity: () => {},
          take: () => {},
          error: (m) => events.push(m),
        },
        source,
        { context: () => midiContext, access: async () => access },
      );
      await recorder.connect();
      port.onmidimessage({
        data: new Uint8Array([144, 69, 100]),
        timeStamp: performance.now(),
      });
      await delay(40);
      port.onmidimessage({
        data: new Uint8Array([128, 69, 0]),
        timeStamp: performance.now(),
      });
      check(
        sourceCount > 0 && events.includes('ready'),
        'MIDI monitoring did not use sample voices',
      );
      recorder.dispose();
      const originalFile = current().fileId;
      latency = 180;
      await load(file);
      await click('Cancel sample loading');
      await wait(() => !button('Cancel sample loading'));
      check(
        current().fileId === originalFile,
        'Cancelled sample replacement overwrote the source',
      );
      await load(file);
      setAllowed(false);
      await delay(300);
      check(
        current().fileId === originalFile,
        'Sample upload committed after access loss',
      );
      latency = 0;
      setShow(false);
      setLog(
        `PASS: ${checks} sampler upload/settings, Undo, recovery, pitch/cache, envelope, export, MIDI monitor and access assertions.`,
      );
    } catch (e: any) {
      setLog('FAIL: ' + e.message);
    } finally {
      latency = 0;
      revoked = false;
      setBusy(false);
    }
  }
  return (
    <main style={{ padding: 20 }}>
      <h1>SESSION sampler verification</h1>
      <p>
        Generated 440 Hz audio and isolated local API fixtures. No account files
        or hardware.
      </p>
      <div className="actions">
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void run()}
        >
          Run sampler checks
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={async () => {
            await reset();
            await load(
              new File([await audio], '440 Hz source.wav', {
                type: 'audio/wav',
              }),
            );
          }}
        >
          Show sampled instrument
        </button>
      </div>
      <output aria-label="Sampler results">{log}</output>
      <div data-sample-conflict hidden>
        <ConflictValues
          details={[
            {
              label: 'Sample keys · instrument source and notes',
              local: { fileId: 'sample-left', sample: defaultSample(2) },
              remote: { fileId: 'sample-right', sample: defaultSample(2) },
            },
          ]}
        />
      </div>
      <p>{notice}</p>
      {show && (
        <Studio
          key={version}
          initial={structuredClone(initial)}
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
