import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  TakeCapture,
  type CaptureHooks,
  type CapturePhase,
  type RecordedTake,
} from '../lib/recording';
import { defaults } from '../lib/audio';
import { takePCM } from '../lib/take-comp';
import RecordTake from '../app/record-take';
import '../app/globals.css';
import '../app/advanced.css';
const data = {
  bpm: 240,
  tracks: [
    {
      ...defaults('Backing'),
      notes: [{ id: 'note', pitch: 45, start: 0, length: 16, velocity: 0.3 }],
    },
  ],
};
async function microphone(rate = 48000) {
  const c = new AudioContext({ sampleRate: rate });
  const tone = c.createOscillator(),
    gain = c.createGain(),
    out = c.createMediaStreamDestination();
  gain.gain.value = 0.2;
  tone.frequency.value = 440;
  tone.connect(gain).connect(out);
  tone.start();
  await c.resume();
  return {
    stream: out.stream,
    close: () => {
      out.stream.getTracks().forEach((t) => t.stop());
      void c.close();
    },
  };
}
const wait = async (fn: () => boolean) => {
  const end = performance.now() + 8000;
  while (!fn()) {
    if (performance.now() > end) throw Error('Timing test timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};
function App() {
  const [log, setLog] = useState(''),
    [busy, setBusy] = useState(false),
    [factory, setFactory] = useState<((h: CaptureHooks) => TakeCapture) | null>(
      null,
    );
  async function run() {
    setBusy(true);
    setLog('Running synthetic timing checks…');
    let checks = 0;
    const check = (v: boolean, msg: string) => {
      if (!v) throw Error(msg);
      checks++;
    };
    try {
      for (const rate of [44100, 48000]) {
        const mic = await microphone(rate);
        let phase: CapturePhase = 'idle',
          error = '',
          result: RecordedTake | null = null;
        const phases: string[] = [];
        const streams: MediaStream[] = [];
        let release = 0;
        const cap = new TakeCapture(
          {
            state: (p) => {
              phase = p;
              phases.push(p);
            },
            level: () => {},
            progress: () => {},
            error: (e) => {
              error = e;
            },
            take: (t) => {
              result = t;
            },
          },
          {
            context: () => new AudioContext({ sampleRate: rate }),
            media: async () => {
              const s = mic.stream.clone();
              streams.push(s);
              return s;
            },
            output: () => () => {
              release++;
            },
          },
        );
        const reset = async () => {
          result = null;
          error = '';
          phases.length = 0;
          await cap.connect();
          check(String(phase) === 'ready', 'Input failed');
        };
        const completed = async () => {
          await wait(() => !!result || !!error);
          check(!error, error);
          return result as unknown as RecordedTake;
        };
        try {
          await reset();
          await cap.start(
            data,
            0.25,
            1,
            (rate === 44100 ? 5516 : 6000) / rate,
            { frames: rate === 44100 ? 5516 : 6000, sampleRate: rate },
            { preRollBars: 2, correctionMs: 80 },
          );
          const first = await completed();
          check(
            phases.indexOf('counting') < phases.indexOf('preroll') &&
              phases.indexOf('preroll') < phases.indexOf('recording'),
            'Count-in, pre-roll, recording order',
          );
          check(
            first.offset === 0.25 &&
              Math.round(first.seconds * rate) ===
                (rate === 44100 ? 5516 : 6000),
            'Pre-roll moved punch boundaries',
          );
          check(
            Math.abs(first.correctionMs! - 80) < 1000 / rate,
            'Applied correction metadata',
          );
          check(
            (await takePCM(first)).some((v) => Math.abs(v) > 0.1),
            'Input PCM missing',
          );
          check(release === 1, 'Backing output not released once');
          await reset();
          const began = performance.now();
          const exact = rate === 44100 ? 5516 : 6005;
          await cap.start(
            { bpm: 240, tracks: [] },
            12.75,
            0,
            exact / rate,
            { frames: exact, sampleRate: rate },
            { correctionMs: 500 },
          );
          const short = await completed();
          check(
            Math.round(short.seconds * rate) === exact &&
              short.offset === 12.75,
            'Long correction changed short punch',
          );
          check(
            performance.now() - began > 750,
            'Correction tail ended prematurely',
          );
          check(phases.includes('draining'), 'Missing delayed input state');
          await reset();
          await cap.start(data, 1, 0, 2, undefined, { correctionMs: 500 });
          await wait(() => phase === 'recording');
          await new Promise((r) => setTimeout(r, 160));
          const stopped = performance.now();
          cap.finish();
          cap.finish();
          check(
            String(phase) === 'draining',
            'Manual stop did not collect tail',
          );
          const manual = await completed();
          check(
            performance.now() - stopped > 350,
            'Manual stop lost input tail',
          );
          check(
            manual.seconds > 0.15 &&
              manual.seconds < 0.35 &&
              manual.offset === 1,
            'Manual stop changed take duration/offset',
          );
          check(
            (await takePCM(manual)).length ===
              Math.round(manual.seconds * rate),
            'Manual stop WAV mismatch',
          );
          await reset();
          await cap.start(data, 0.5, 0, 1, undefined, {
            preRollBars: 2,
            correctionMs: 500,
          });
          await wait(() => phase === 'preroll');
          cap.cancel();
          await new Promise((r) => setTimeout(r, 250));
          check(
            !result && !error && String(phase) === 'idle',
            'Pre-roll cancellation returned a take',
          );
          await reset();
          await cap.start(data, 0, 0, 1, undefined, { correctionMs: 500 });
          await wait(() => phase === 'recording');
          cap.finish();
          cap.cancel();
          await new Promise((r) => setTimeout(r, 600));
          check(
            !result && !error && String(phase) === 'idle',
            'Tail cancellation returned a take',
          );
          await reset();
          await cap.start(data, 0, 0, 1, undefined, { correctionMs: 500 });
          await wait(() => phase === 'recording');
          cap.finish();
          streams.at(-1)!.getAudioTracks()[0].dispatchEvent(new Event('ended'));
          await new Promise((r) => setTimeout(r, 600));
          check(
            !result &&
              String(phase) === 'error' &&
              error.includes('disconnected'),
            'Tail disconnect produced stale take',
          );
          check(
            mic.stream.getAudioTracks()[0].readyState === 'live',
            'Recorder stopped underlying source',
          );
          await reset();
          await cap.start(data, 299.875, 0, 0.125, undefined, {
            preRollBars: 0,
            correctionMs: 500,
          });
          const edge = await completed();
          check(
            Math.abs(edge.seconds - 0.125) <= 1 / rate &&
              edge.offset === 299.875,
            'Timeline end compensation changed boundaries',
          );
          check(
            streams.every((s) =>
              s.getTracks().every((t) => t.readyState === 'ended'),
            ),
            'Recording input leaked',
          );
        } finally {
          cap.dispose();
          mic.close();
        }
      }
      setLog(
        `PASS: ${checks} real-worklet pre-roll, compensation, punch, stop, cancellation and interruption assertions.`,
      );
    } catch (e) {
      setLog('FAIL: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }
  async function open() {
    const mic = await microphone();
    setFactory(() => (h: CaptureHooks) => {
      const cap = new TakeCapture(h, {
        context: () => new AudioContext({ sampleRate: 48000 }),
        media: async () => mic.stream.clone(),
      });
      const start = cap.start.bind(cap);
      cap.start = (d, o, b, _limit, exact, timing) =>
        start(
          d,
          o,
          b,
          exact ? exact.frames / exact.sampleRate : 0.4,
          exact,
          timing,
        );
      const dispose = cap.dispose.bind(cap);
      cap.dispose = () => {
        dispose();
        mic.close();
      };
      return cap;
    });
  }
  return (
    <main style={{ maxWidth: 900, padding: 24, margin: 'auto' }}>
      <h1>SESSION recording timing verification</h1>
      <p>
        Synthetic microphone and backing only. No camera, hardware microphone,
        account or uploads.
      </p>
      <button disabled={busy || !!factory} onClick={() => void run()}>
        Run timing checks
      </button>
      <button disabled={busy || !!factory} onClick={() => void open()}>
        Open timing controls
      </button>
      <output aria-label="Timing results">{log}</output>
      {factory && (
        <RecordTake
          data={data}
          offset={0.25}
          canEdit
          createCapture={factory}
          onClose={() => setFactory(null)}
          onKeep={async () => {
            throw Error('This synthetic take is not uploaded.');
          }}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
