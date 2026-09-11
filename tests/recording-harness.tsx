import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  TakeCapture,
  type CaptureHooks,
  type CapturePhase,
  type RecordedTake,
} from '../lib/recording';
import RecordTake from '../app/record-take';
import { defaults } from '../lib/audio';
import '../app/globals.css';
import '../app/advanced.css';
const arrangement = { bpm: 240, tracks: [] };
async function virtualMic() {
  const c = new AudioContext({ sampleRate: 48000 }),
    o = c.createOscillator(),
    g = c.createGain(),
    dest = c.createMediaStreamDestination();
  g.gain.value = 0.15;
  o.frequency.value = 440;
  o.connect(g).connect(dest);
  o.start();
  await c.resume();
  return {
    stream: dest.stream,
    gain: g,
    close: () => {
      o.stop();
      dest.stream.getTracks().forEach((t) => t.stop());
      void c.close();
    },
  };
}
function App() {
  const [lines, setLines] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [show, setShow] = useState(false),
    [granted, setGranted] = useState(true),
    [scenario, setScenario] = useState('normal');
  const [factory, setFactory] = useState<
    ((h: CaptureHooks) => TakeCapture) | null
  >(null);
  const log = (text: string) => setLines((l) => [...l, text]);
  async function run() {
    setBusy(true);
    setLines([]);
    let count = 0;
    const check = (v: boolean, m: string) => {
      if (!v) throw Error(m);
      count++;
    };
    const mic = await virtualMic();
    let capture: TakeCapture | null = null;
    const streams: MediaStream[] = [];
    const wait = async (f: () => boolean) => {
      const until = performance.now() + 8000;
      while (!f()) {
        if (performance.now() > until)
          throw Error('Timed out waiting for recorder state');
        await new Promise((r) => setTimeout(r, 20));
      }
    };
    try {
      let phase: CapturePhase = 'idle',
        take: RecordedTake | null = null,
        error = '',
        peak = 0;
      const phases: string[] = [];
      const hooks: CaptureHooks = {
        state: (p) => {
          phase = p;
          phases.push(p);
        },
        level: (p) => {
          peak = Math.max(peak, p);
        },
        progress: () => {},
        take: (t) => {
          take = t;
        },
        error: (e) => {
          error = e;
        },
      };
      const deps = {
        context: () => new AudioContext({ sampleRate: 48000 }),
        media: async () => {
          const stream = mic.stream.clone();
          streams.push(stream);
          return stream;
        },
      };
      capture = new TakeCapture(hooks, deps);
      await capture.connect();
      check(String(phase) === 'ready', 'Microphone did not become ready');
      await wait(() => peak > 0.01);
      check(peak < 0.3, 'Meter peak invalid');
      await capture.start(
        {
          bpm: 240,
          tracks: [
            {
              ...defaults('Backing'),
              notes: [
                {
                  id: 'backing',
                  pitch: 57,
                  start: 0,
                  length: 8,
                  velocity: 0.2,
                },
              ],
            },
          ],
        },
        1.25,
        1,
      );
      await wait(() => phase === 'recording');
      await new Promise((r) => setTimeout(r, 220));
      capture.finish();
      capture.finish();
      await wait(() => !!take || !!error);
      check(!error, error);
      const result = take as unknown as RecordedTake;
      check(result.blob.type === 'audio/wav', 'Take is not a WAV');
      check(result.offset === 1.25, 'Insertion offset changed');
      check(
        result.seconds > 0.15 && result.seconds < 0.5,
        'Count-in was included in take',
      );
      const bytes = await result.blob.arrayBuffer(),
        v = new DataView(bytes);
      check(
        v.getUint16(22, true) === 1 && v.getUint16(34, true) === 24,
        'Expected mono24-bit',
      );
      const decoded = await new OfflineAudioContext(
        1,
        1,
        48000,
      ).decodeAudioData(bytes.slice(0));
      const audio = decoded.getChannelData(0);
      let crossings = 0;
      for (let i = 1; i < audio.length; i++)
        if (audio[i] > 0 && audio[i - 1] <= 0) crossings++;
      check(
        Math.abs(crossings / decoded.duration - 440) < 8,
        'Recorded microphone frequency changed',
      );
      const amplitude = (hz: number) => {
        let re = 0,
          im = 0;
        for (let i = 0; i < audio.length; i++) {
          re += audio[i] * Math.cos((2 * Math.PI * hz * i) / 48000);
          im += audio[i] * Math.sin((2 * Math.PI * hz * i) / 48000);
        }
        return (2 * Math.hypot(re, im)) / audio.length;
      };
      check(
        amplitude(440) > 0.1 && amplitude(220) < 0.01,
        'Backing audio leaked into captured PCM',
      );
      check(
        streams.every((s) =>
          s.getTracks().every((t) => t.readyState === 'ended'),
        ),
        'Microphone still active in review',
      );
      check(
        phases.includes('counting') &&
          phases.includes('finishing') &&
          phases.includes('review'),
        'Lifecycle states missing',
      );
      log(
        'Real worklet: input meter, one-bar count-in, local mono WAV, offset and microphone release passed.',
      );
      take = null;
      error = '';
      await capture.connect();
      await capture.start(arrangement, 0, 2);
      capture.cancel();
      await new Promise((r) => setTimeout(r, 300));
      check(
        take === null && phase === 'idle',
        'Cancelled count-in returned a take',
      );
      check(
        streams
          .at(-1)!
          .getTracks()
          .every((t) => t.readyState === 'ended'),
        'Cancel retained microphone',
      );
      await capture.connect();
      const ending = streams.at(-1)!.getAudioTracks()[0];
      ending.dispatchEvent(new Event('ended'));
      check(
        String(phase) === 'error' && error.includes('disconnected'),
        'Device interruption was not surfaced',
      );
      const pendingStreams: MediaStream[] = [];
      let resolveMedia!: (s: MediaStream) => void;
      const delayed = new TakeCapture(hooks, {
        ...deps,
        media: () =>
          new Promise((r) => {
            resolveMedia = r;
          }),
      });
      const opening = delayed.connect();
      await wait(() => !!resolveMedia);
      delayed.cancel();
      const late = mic.stream.clone();
      pendingStreams.push(late);
      resolveMedia(late);
      await opening;
      check(
        late.getTracks().every((t) => t.readyState === 'ended'),
        'Late permission result leaked microphone',
      );
      delayed.dispose();
      error = '';
      take = null;
      await capture.connect();
      streams.at(-1)!.getAudioTracks()[0].dispatchEvent(new Event('mute'));
      check(
        String(phase) === 'error' && error.includes('interrupted'),
        'Muted input was not surfaced',
      );
      error = '';
      take = null;
      mic.gain.gain.value = 1.15;
      await capture.connect();
      await capture.start(arrangement, 299.85, 0);
      await wait(() => !!take || !!error);
      check(!error, error);
      check(
        (take as unknown as RecordedTake).depth === 32 &&
          (take as unknown as RecordedTake).peak > 1,
        'Over-range recording was not preserved as float',
      );
      mic.gain.gain.value = 0.15;
      error = '';
      take = null;
      await capture.connect();
      const notes = {
        ...defaults('Synthetic backing'),
        notes: [{ id: 'test', pitch: 60, start: 0, length: 1, velocity: 0.1 }],
      };
      await capture.start({ bpm: 240, tracks: [notes] }, 299.85, 0);
      await wait(() => !!take || !!error);
      check(!error, error);
      check(
        Math.abs((take as unknown as RecordedTake).seconds - 0.15) <=
          1 / 48000 + 1e-6,
        'Timeline limit not exact',
      );
      log(
        'Cancel, device interruption, late microphone permission, recording past backing end and automatic timeline limit passed.',
      );
      for (const rate of [44100, 48000]) {
        take = null;
        error = '';
        const limited = new TakeCapture(hooks, {
          ...deps,
          context: () => new AudioContext({ sampleRate: rate }),
        });
        try {
          await limited.connect();
          await limited.start(arrangement, 0, 0, 0.1);
          await wait(() => !!take || !!error);
          check(!error, error);
          const short = take as unknown as RecordedTake;
          check(short.sampleRate === rate, 'Take-bank limit changed rate');
          check(
            short.offset === 0 && Math.abs(short.seconds - 0.1) <= 1 / rate,
            'Take-bank automatic limit inaccurate',
          );
          take = null;
          const frames = rate === 44100 ? 5516 : 6005;
          await limited.connect();
          await limited.start(arrangement, 12.75, 0, frames / rate, {
            frames,
            sampleRate: rate,
          });
          await wait(() => !!take || !!error);
          check(!error, error);
          const punched = take as unknown as RecordedTake;
          check(
            Math.round(punched.seconds * rate) === frames &&
              punched.offset === 12.75,
            'Punch lost exact frame boundary',
          );
          take = null;
          await limited.connect();
          await limited.start(arrangement, 12.75, 0, 0.2, {
            frames,
            sampleRate: rate === 44100 ? 48000 : 44100,
          });
          check(
            !!error && !take && String(phase) === 'error',
            'Mismatched sample rate was armed',
          );
          error = '';
          await limited.connect();
          await limited.start(arrangement, 299.9, 0, 0.2, {
            frames: Math.round(rate * 0.2),
            sampleRate: rate,
          });
          check(!!error && !take, 'Punch past timeline end was armed');
          error = '';
        } finally {
          limited.dispose();
        }
      }
      log(`PASS: ${count} browser recording assertions.`);
    } catch (e) {
      log('FAIL: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      capture?.dispose();
      mic.close();
      setBusy(false);
    }
  }
  async function open(mode: string) {
    const mic = await virtualMic();
    setScenario(mode);
    setGranted(true);
    setFactory(() => (hooks: CaptureHooks) => {
      const cap = new TakeCapture(
        {
          ...hooks,
          take: (t) => {
            hooks.take(t);
            if (mode === 'revoke') setGranted(false);
          },
        },
        {
          context: () => new AudioContext({ sampleRate: 48000 }),
          media: async () => mic.stream.clone(),
        },
      );
      const dispose = cap.dispose.bind(cap);
      cap.dispose = () => {
        dispose();
        mic.close();
      };
      return cap;
    });
    setShow(true);
  }
  return (
    <main style={{ maxWidth: 880, margin: '30px auto', padding: 24 }}>
      <h1>SESSION recording verification</h1>
      <p>
        Synthetic signal only. No hardware microphone, camera or real music.
      </p>
      <div className="actions">
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void run()}
        >
          {busy ? 'Checking…' : 'Run recording checks'}
        </button>
        <button
          className="button secondary"
          onClick={() => void open('normal')}
        >
          Open recording panel
        </button>
        <button
          className="button secondary"
          onClick={() => void open('revoke')}
        >
          Test review after access ends
        </button>
      </div>
      <ol>
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ol>
      {show && factory && (
        <RecordTake
          data={arrangement}
          offset={0}
          canEdit={granted}
          createCapture={factory}
          onClose={() => setShow(false)}
          onKeep={async () => {
            throw Error(
              'Simulated upload failure. Your take is still available. ' +
                scenario,
            );
          }}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
