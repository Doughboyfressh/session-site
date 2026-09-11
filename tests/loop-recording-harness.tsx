import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  TakeCapture,
  type CaptureHooks,
  type CapturePhase,
  type RecordedTake,
} from '../lib/recording';
import { defaults } from '../lib/audio';
import { encodeWave } from '../lib/audio-files';
import { takePCM } from '../lib/take-comp';
import RecordTake from '../app/record-take';
import '../app/globals.css';
import '../app/advanced.css';
const wait = async (fn: () => boolean) => {
  for (let i = 0; i < 1400; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error('Loop check timed out');
};
const button = (name: string) =>
  [
    ...document.querySelectorAll<HTMLButtonElement>('button, [role="option"]'),
  ].find(
    (b) =>
      b.textContent?.trim() === name || b.getAttribute('aria-label') === name,
  );
const click = async (name: string) => {
  await wait(() => !!button(name) && !button(name)!.disabled);
  button(name)!.click();
  await new Promise((r) => setTimeout(r, 25));
};
const input = (name: string, value: string) => {
  const e = document.querySelector<HTMLInputElement>(
    `input[aria-label="${name}"]`,
  )!;
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )!.set!.call(e, value);
  e.dispatchEvent(new Event('input', { bubbles: true }));
};
async function pcmTake(length: number, offset = 2, loopPass?: number) {
  const pcm = new Float32Array(length).fill(0.2);
  const encoded = await encodeWave(
    {
      length,
      sampleRate: 48000,
      numberOfChannels: 1,
      getChannelData: () => pcm,
    },
    24,
    { channels: 1 },
  );
  return {
    ...encoded,
    seconds: length / 48000,
    offset,
    sampleRate: 48000,
    depth: 24 as const,
    loopPass,
  };
}
let factoryHooks: CaptureHooks | null = null,
  requests: any[] = [],
  finishMode = false;
function fake(h: CaptureHooks): TakeCapture {
  factoryHooks = h;
  return {
    sampleRate: 48000,
    connect: async () => h.state('ready'),
    start: async (
      data: any,
      offset: number,
      bars: number,
      limit: number,
      exact: any,
    ) => {
      requests.push({ data, offset, bars, limit, exact });
      finishMode = false;
      h.state('recording');
    },
    finish: () => {
      finishMode = true;
      h.state('finishing');
    },
    cancel: () => h.state('idle'),
    interrupt: () => {
      h.state('finishing');
    },
    dispose: () => {},
  } as unknown as TakeCapture;
}
function App() {
  const [log, setLog] = useState(''),
    [busy, setBusy] = useState(false),
    [show, setShow] = useState(false),
    [seed, setSeed] = useState<any>(),
    [granted, setGranted] = useState(true),
    [key, setKey] = useState(0);
  async function engine() {
    setBusy(true);
    setLog('Checking the actual audio clock and continuous capture…');
    let checks = 0;
    const check = (v: unknown, m: string) => {
      if (!v) throw Error(m);
      checks++;
    };
    const resources: (() => void)[] = [];
    try {
      for (const rate of [44100, 48000]) {
        const microphone = new AudioContext({ sampleRate: rate });
        resources.push(() => void microphone.close());
        const tone = microphone.createOscillator(),
          gain = microphone.createGain(),
          out = microphone.createMediaStreamDestination();
        gain.gain.value = 0.2;
        tone.connect(gain).connect(out);
        tone.start();
        await microphone.resume();
        const startCalls: { when: number; duration: number }[] = [];
        let phase: CapturePhase = 'idle',
          error = '',
          closed = 0;
        const takes: RecordedTake[] = [];
        const cap = new TakeCapture(
          {
            state: (p) => (phase = p),
            level: () => {},
            progress: () => {},
            error: (m) => (error = m),
            take: (t) => takes.push(t),
          },
          {
            media: async () => out.stream.clone(),
            context: () => {
              const c = new AudioContext({ sampleRate: rate });
              const make = c.createBufferSource.bind(c);
              c.createBufferSource = () => {
                const n = make(),
                  start = n.start.bind(n);
                n.start = (when = 0, offset = 0, duration?: number) => {
                  startCalls.push({ when, duration: duration || 0 });
                  start(when, offset, duration);
                };
                return n;
              };
              return c;
            },
            output: () => () => {
              closed++;
            },
          },
        );
        resources.push(() => cap.dispose());
        await cap.connect();
        check(String(phase) === 'ready', 'Microphone did not connect');
        const frames = Math.round(rate * 0.113) + 3,
          seconds = frames / rate;
        await cap.start(
          {
            bpm: 240,
            tracks: [
              {
                ...defaults('Backing'),
                notes: [
                  { id: 'one', pitch: 60, start: 0, length: 8, velocity: 0.2 },
                ],
              },
            ],
          },
          1.1,
          0,
          seconds,
          { frames, sampleRate: rate, passes: 3 },
          { preRollBars: 1, correctionMs: 500 },
        );
        await wait(() => phase === 'review' || phase === 'error');
        check(!error, error);
        check(takes.length === 3, 'Expected three complete passes');
        for (const [i, take] of takes.entries()) {
          check(
            take.loopPass === i + 1 && take.offset === 1.1,
            'Pass order/offset changed',
          );
          check(
            (await takePCM(take)).length === frames,
            'Pass PCM length changed',
          );
          check(
            take.sampleRate === rate && take.correctionMs === 500,
            'Rate or correction changed',
          );
        }
        check(startCalls.length === 3, 'Backing passes were not all scheduled');
        check(
          Math.round((startCalls[1].when - startCalls[0].when) * rate) ===
            rate + frames,
          'First pass ignored one-time pre-roll',
        );
        check(
          Math.round((startCalls[2].when - startCalls[1].when) * rate) ===
            frames,
          'Loop backing drifted between passes',
        );
        check(closed === 1, 'Output route leaked');
        cap.dispose();
        await microphone.close();
        resources.splice(resources.length - 2, 2);
      }
      // Stop partway through pass two. Only pass one belongs in the bank.
      {
        const mic = new AudioContext({ sampleRate: 48000 }),
          osc = mic.createOscillator(),
          out = mic.createMediaStreamDestination();
        resources.push(() => void mic.close());
        osc.connect(out);
        osc.start();
        await mic.resume();
        let phase: CapturePhase = 'idle',
          issue = '',
          stopped = false;
        const takes: RecordedTake[] = [];
        let cap: TakeCapture;
        cap = new TakeCapture(
          {
            state: (p) => (phase = p),
            level: () => {},
            progress: (_s, _b, pass) => {
              if (pass === 2 && !stopped) {
                stopped = true;
                cap.finish();
              }
            },
            error: (m) => (issue = m),
            take: (t) => takes.push(t),
          },
          {
            media: async () => out.stream.clone(),
            context: () => new AudioContext({ sampleRate: 48000 }),
          },
        );
        resources.push(() => cap.dispose());
        await cap.connect();
        await cap.start(
          { bpm: 120, tracks: [] },
          3,
          0,
          0.3,
          { frames: 14400, sampleRate: 48000, passes: 3 },
          { correctionMs: 80 },
        );
        await wait(() => phase === 'review' || phase === 'error');
        check(takes.length === 1, 'Early stop kept an unfinished pass');
        check(issue.includes('unfinished'), 'Early stop omitted explanation');
        check(takes[0].offset === 3, 'Silent backing changed loop offset');
        cap.dispose();
        await mic.close();
        resources.splice(resources.length - 2, 2);
      }
      // Delay completed-pass encoding and interrupt twice. Completed PCM must survive.
      {
        const mic = new AudioContext({ sampleRate: 48000 }),
          osc = mic.createOscillator(),
          out = mic.createMediaStreamDestination();
        resources.push(() => void mic.close());
        osc.connect(out);
        osc.start();
        await mic.resume();
        let phase: CapturePhase = 'idle',
          release: (() => void) | null = null;
        const takes: RecordedTake[] = [];
        const cap = new TakeCapture(
          {
            state: (p) => (phase = p),
            level: () => {},
            progress: () => {},
            error: () => {},
            take: (t) => takes.push(t),
          },
          {
            media: async () => out.stream.clone(),
            context: () => new AudioContext({ sampleRate: 48000 }),
          },
        );
        resources.push(() => cap.dispose());
        const encode = (cap as any).encodeTake.bind(cap);
        (cap as any).encodeTake = async (...args: any[]) => {
          await new Promise<void>((r) => (release = r));
          return encode(...args);
        };
        await cap.connect();
        await cap.start({ bpm: 120, tracks: [] }, 2, 0, 0.2, {
          frames: 9600,
          sampleRate: 48000,
          passes: 3,
        });
        await wait(() => !!release);
        cap.interrupt('Synthetic disconnect');
        cap.interrupt('Editing access ended');
        release!();
        await wait(() => phase === 'review' || phase === 'error');
        check(
          takes.length === 1,
          'Second interrupt discarded completed encoding',
        );
        cap.dispose();
        await mic.close();
        resources.splice(resources.length - 2, 2);
      }
      // Deliver a complete pass only after interruption, preserving port order.
      // Also delay a normal stop command beyond the next pass boundary.
      for (const queuedInterruption of [true, false]) {
        const mic = new AudioContext({ sampleRate: 48000 }),
          osc = mic.createOscillator(),
          out = mic.createMediaStreamDestination();
        resources.push(() => void mic.close());
        osc.connect(out);
        osc.start();
        await mic.resume();
        let phase: CapturePhase = 'idle',
          stopped = false,
          issue = '';
        const takes: RecordedTake[] = [];
        const cap = new TakeCapture(
          {
            state: (p) => (phase = p),
            level: () => {},
            progress: (_s, _b, pass) => {
              if (!queuedInterruption && pass === 2 && !stopped) {
                stopped = true;
                cap.finish();
              }
            },
            error: (m) => (issue = m),
            take: (t) => takes.push(t),
          },
          {
            media: async () => out.stream.clone(),
            context: () => new AudioContext({ sampleRate: 48000 }),
          },
        );
        resources.push(() => cap.dispose());
        await cap.connect();
        const port = (cap as any).node.port as MessagePort;
        if (queuedInterruption) {
          const deliver = port.onmessage!;
          const held: MessageEvent[] = [];
          let holding = true;
          port.onmessage = (event) => {
            if (!holding) return deliver.call(port, event);
            held.push(event);
            if (event.data.type === 'pass' && event.data.index === 1) {
              cap.interrupt('Interrupted before queued pass delivery');
              holding = false;
              for (const pending of held) deliver.call(port, pending);
            }
          };
        } else {
          const post = port.postMessage.bind(port);
          port.postMessage = (message: any) => {
            if (message.type === 'finish') setTimeout(() => post(message), 250);
            else post(message);
          };
        }
        await cap.start({ bpm: 120, tracks: [] }, 2, 0, 0.2, {
          frames: 9600,
          sampleRate: 48000,
          passes: 3,
        });
        await wait(() => phase === 'review' || phase === 'error');
        check(
          takes.length === 1,
          queuedInterruption
            ? 'Queued complete pass was lost during interruption'
            : 'Delayed stop retained a pass recorded after the stop boundary',
        );
        check(
          (await takePCM(takes[0])).length === 9600,
          'Recovered pass was shortened',
        );
        check(
          issue.includes('completed'),
          'Partial loop recovery omitted its result',
        );
        cap.dispose();
        await mic.close();
        resources.splice(resources.length - 2, 2);
      }
      // An interruption while backing is loading must cancel the pending start.
      {
        const mic = new AudioContext({ sampleRate: 48000 }),
          out = mic.createMediaStreamDestination();
        resources.push(() => void mic.close());
        await mic.resume();
        let phase: CapturePhase = 'idle',
          routes = 0;
        const cap = new TakeCapture(
          {
            state: (p) => (phase = p),
            level: () => {},
            progress: () => {},
            error: () => {},
            take: () => {
              throw Error('Unarmed loop emitted a take');
            },
          },
          {
            media: async () => out.stream.clone(),
            context: () => new AudioContext({ sampleRate: 48000 }),
            output: () => {
              routes++;
              return () => {
                routes--;
              };
            },
          },
        );
        resources.push(() => cap.dispose());
        const originalFetch = window.fetch;
        let release: ((response: Response) => void) | null = null;
        const wave = await pcmTake(48000);
        window.fetch = (input, init) =>
          String(input) === '/api/file/loop-preparing-fixture'
            ? new Promise<Response>((resolve) => (release = resolve))
            : originalFetch(input, init);
        try {
          await cap.connect();
          const pending = cap.start(
            {
              bpm: 120,
              tracks: [
                {
                  ...defaults('Deferred backing'),
                  fileId: 'loop-preparing-fixture',
                },
              ],
            },
            0,
            0,
            0.2,
            { frames: 9600, sampleRate: 48000, passes: 3 },
          );
          await wait(() => !!release);
          cap.interrupt('Disconnected during preparation');
          release!(new Response(wave.blob));
          await pending;
          check(
            String(phase) === 'error',
            'Interrupted preparation resumed recording',
          );
          check(
            (cap as any).control.signal.aborted,
            'Interrupted preparation left loading active',
          );
          check(
            !(cap as any).backing && !(cap as any).node && !(cap as any).c,
            'Interrupted preparation retained audio resources',
          );
          check(
            routes === 0,
            'Interrupted preparation retained an output route',
          );
        } finally {
          window.fetch = originalFetch;
          cap.dispose();
          await mic.close();
          resources.splice(resources.length - 2, 2);
        }
      }
      setLog(
        `PASS: ${checks} real audio-clock, PCM, pre-roll, correction, stop and interruption assertions.`,
      );
    } catch (e) {
      setLog('FAIL: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      for (const close of resources) close();
      setBusy(false);
    }
  }
  async function ui() {
    setBusy(true);
    setLog('Checking loop controls and punch comp choices…');
    let checks = 0;
    const check = (v: unknown, m: string) => {
      if (!v) throw Error(m);
      checks++;
    };
    try {
      requests = [];
      setSeed(undefined);
      setGranted(true);
      setKey((k) => k + 1);
      setShow(true);
      await click('Enable microphone');
      await click('Recording passes');
      await click('3 loop passes');
      input('Loop length (seconds)', '0.2');
      await new Promise((r) => setTimeout(r, 25));
      await click('Start recording');
      check(
        requests[0].exact.passes === 3 && requests[0].exact.frames === 9600,
        'Wrong loop request',
      );
      for (let n = 1; n <= 3; n++) {
        factoryHooks!.take(await pcmTake(9600, 2, n));
        factoryHooks!.progress(0, 0, n, 3);
        await new Promise((r) => setTimeout(r, 25));
        check(
          !button('Save takes & comp'),
          'Recorder exposed editing while looping',
        );
      }
      factoryHooks!.state('review');
      await wait(() => !!button('Save takes & comp'));
      check(
        document.querySelectorAll('.take-bank-item').length === 3,
        'Loop originals missing',
      );
      check(
        !!document.querySelector('a[download="SESSION Loop take 3.wav"]'),
        'Loop original download missing',
      );
      check(
        document.body.textContent!.includes('1 section'),
        'First full pass did not seed comp',
      );
      setShow(false);
      await new Promise((r) => setTimeout(r, 30));
      setSeed({ ...(await pcmTake(48000, 2)), name: 'Vocal original' });
      setKey((k) => k + 1);
      setShow(true);
      await wait(() => !!button('Record this section'));
      input('Comp range start', '0.25');
      input('Comp range end', '0.5');
      await new Promise((r) => setTimeout(r, 25));
      await click('Record this section');
      await click('Recording passes');
      await click('2 loop passes');
      await click('Enable microphone');
      await click('Start recording');
      check(
        requests.at(-1).exact.frames === 12000,
        'Punch loop length changed',
      );
      factoryHooks!.take(await pcmTake(12000, 2.25, 1));
      factoryHooks!.take(await pcmTake(12000, 2.25, 2));
      factoryHooks!.state('review');
      await wait(() => !!button('Save takes & comp'));
      check(
        document.body.textContent!.includes('1.00s · 1 section'),
        'Loop punch replaced the comp automatically',
      );
      check(
        document.body.textContent!.includes('0.25–0.50'),
        'Punch coverage lost on a later pass',
      );
      input('Comp range start', '0.25');
      input('Comp range end', '0.5');
      await new Promise((r) => setTimeout(r, 25));
      await click('Use Loop take 2 for this section');
      check(
        document.body.textContent!.includes('3 sections'),
        'Loop donor could not replace selected section',
      );
      setShow(false);
      setLog(
        `PASS: ${checks} loop controls, separate originals, busy locks, punch coverage and comp-choice assertions.`,
      );
    } catch (e) {
      setLog('FAIL: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main style={{ padding: 20, maxWidth: 900, margin: '20px auto' }}>
      <h1>SESSION loop recording verification</h1>
      <p>
        Synthetic microphone tones and local fixtures only. No camera, hardware
        microphone or account.
      </p>
      <div className="actions">
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void engine()}
        >
          Run loop engine checks
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void ui()}
        >
          Run loop UI checks
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => {
            setSeed(undefined);
            setGranted(true);
            setKey((k) => k + 1);
            setShow(true);
          }}
        >
          Show loop recorder
        </button>
      </div>
      <output aria-label="Loop results">{log}</output>
      {show && (
        <RecordTake
          key={key}
          data={{ bpm: 120, tracks: [] }}
          offset={2}
          canEdit={granted}
          seed={seed}
          createCapture={fake}
          onKeep={async () => {}}
          onClose={() => setShow(false)}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
