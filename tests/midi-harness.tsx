import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Studio from '../app/studio';
import { defaults, bufferFor, type Note } from '../lib/audio';
import {
  MidiRecorder,
  type MidiHooks,
  type MidiPhase,
} from '../lib/midi-recording';
import { midiPlan } from '../lib/midi-notes';
import '../app/globals.css';
import '../app/advanced.css';

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
async function wait(test: () => boolean) {
  for (let n = 0; n < 1000; n++) {
    if (test()) return;
    await delay(10);
  }
  throw Error('MIDI check timed out');
}
class Port {
  state = 'connected';
  connection = 'closed';
  name = 'Fixture MIDI keyboard';
  manufacturer = 'SESSION test';
  onmidimessage: ((event: any) => void) | null = null;
  opens = 0;
  closes = 0;
  gate: Promise<void> | null = null;
  constructor(readonly id: string) {}
  async open() {
    this.opens++;
    if (this.gate) await this.gate;
    this.connection = 'open';
    return this;
  }
  async close() {
    this.closes++;
    this.connection = 'closed';
    return this;
  }
  emit(data: number[], stamp = performance.now()) {
    this.onmidimessage?.({ data: new Uint8Array(data), timeStamp: stamp });
  }
}
function fixture(empty = false) {
  const port = new Port('keyboard-a');
  const access = {
    inputs: new Map(empty ? [] : [[port.id, port]]),
    onstatechange: null as ((event?: unknown) => void) | null,
  };
  return { port, access, asAccess: access as unknown as MIDIAccess };
}
let hardware = fixture(),
  requestCount = 0,
  deny = false,
  draft: any;
Object.defineProperty(navigator, 'requestMIDIAccess', {
  configurable: true,
  value: async (options: any) => {
    requestCount++;
    if (options.sysex !== false || options.software !== false)
      throw Error('Unexpected MIDI permissions');
    if (deny) throw new DOMException('Fixture refusal', 'NotAllowedError');
    return hardware.asAccess;
  },
});
const button = (name: string) =>
  [
    ...document.querySelectorAll<HTMLButtonElement>('button,[role="option"]'),
  ].find(
    (b) =>
      b.textContent?.trim() === name || b.getAttribute('aria-label') === name,
  );
async function click(name: string) {
  await wait(() => !!button(name) && !button(name)!.disabled);
  button(name)!.click();
  await delay(30);
}
function input(name: string, value: string) {
  const e = document.querySelector<HTMLInputElement>(
    `input[aria-label="${name}"]`,
  )!;
  if (!e) throw Error('Missing ' + name);
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )!.set!.call(e, value);
  e.dispatchEvent(new Event('input', { bubbles: true }));
}
const target = {
  ...defaults('MIDI test keys'),
  id: 'keys',
  sound: 'keys' as const,
  offset: 0.5,
  notes: [{ id: 'original', pitch: 60, start: 0, length: 0.25, velocity: 0.4 }],
};
const initial = {
  title: 'MIDI workflow test',
  canEdit: true,
  canManage: true,
  data: { bpm: 120, tracks: [target] },
};

function App() {
  const [busy, setBusy] = useState(false),
    [log, setLog] = useState(''),
    [show, setShow] = useState(false),
    [key, setKey] = useState(0),
    [allowed, setAllowed] = useState(true),
    [notice, setNotice] = useState('');
  async function engine() {
    setBusy(true);
    setLog('Checking MIDI input lifecycle and actual audio timing…');
    let checks = 0;
    const check = (value: unknown, message: string) => {
      if (!value) throw Error(message);
      checks++;
    };
    const resources: (() => void)[] = [];
    try {
      let phase: MidiPhase = 'idle',
        selected = '',
        issue = '',
        outputRoutes = 0;
      let recorded: Note[] = [];
      const f = fixture();
      const states: MidiPhase[] = [];
      const hooks: MidiHooks = {
        state: (p) => {
          phase = p;
          states.push(p);
        },
        inputs: (_ports, id) => (selected = id),
        progress: () => {},
        activity: () => {},
        take: (notes) => (recorded = notes),
        error: (m) => (issue = m),
      };
      const c = new AudioContext({ sampleRate: 48000 });
      const recorder = new MidiRecorder(hooks, target, {
        access: async () => f.asAccess,
        context: () => c,
        output: () => {
          outputRoutes++;
          return () => {
            outputRoutes--;
          };
        },
      });
      resources.push(() => recorder.dispose());
      await recorder.connect();
      check(
        selected === f.port.id && String(phase) === 'ready',
        'Keyboard was not selected',
      );
      f.port.emit([0x90, 36, 100]);
      check(
        (recorder as any).voices.size === 1,
        'Live key did not start a voice',
      );
      f.port.emit([0xb0, 64, 127]);
      f.port.emit([0x80, 36, 0]);
      check((recorder as any).voices.size === 1, 'Sustain released too soon');
      f.port.emit([0xb0, 64, 0]);
      check(
        (recorder as any).voices.size === 0,
        'Pedal release left a held voice',
      );
      const plan = midiPlan(target, 240, 2, 2);
      f.port.emit([0xb1, 64, 127]);
      await recorder.start({ bpm: 240, tracks: [target] }, plan, 1);
      f.port.emit([0x90, 50, 100]);
      f.port.emit([0x80, 50, 0]);
      await wait(() => phase === 'recording');
      f.port.emit([0x90, 24, 127]);
      f.port.emit([0x91, 127, 64]);
      await delay(80);
      f.port.emit([0x90, 24, 0]);
      f.port.emit([0x81, 127, 0]);
      await delay(80);
      f.port.emit([0xb1, 64, 0]);
      recorder.finish();
      check(
        String(phase) === 'review' && !issue,
        'Recording did not reach review',
      );
      check(
        recorded.length === 2,
        'Count-in notes were retained or recorded notes lost',
      );
      check(
        recorded[0].pitch === 24 && recorded[1].pitch === 127,
        'Full MIDI pitch range changed',
      );
      check(
        recorded.every((n) => n.start >= 2 && n.start + n.length <= 4),
        'Capture ignored source-local range',
      );
      check(
        recorded[1].length > recorded[0].length,
        'Sustain length was not captured',
      );
      check(
        recorded[0].velocity === 1 &&
          Math.abs(recorded[1].velocity - 64 / 127) < 1e-6,
        'Velocity changed',
      );
      check(
        states.includes('counting') && states.includes('recording'),
        'Count-in did not transition',
      );
      check(
        outputRoutes === 0 && !f.port.onmidimessage && c.state === 'closed',
        'Recording resources survived Stop',
      );
      const fixed = JSON.stringify(recorded);
      f.port.emit([0x90, 60, 127]);
      recorder.interrupt('Late access revocation');
      check(
        String(phase) === 'review' && JSON.stringify(recorded) === fixed,
        'Later interruption hid or replaced review',
      );
      const audio = await bufferFor({ ...target, notes: recorded }, 240, {
        sampleRate: 48000,
      });
      check(
        audio.length > 0 &&
          audio.getChannelData(0).some((v) => Math.abs(v) > 0.0001),
        'Captured notes did not render',
      );
      // A late permission grant must not open a port after cancellation.
      const late = fixture();
      let resolveAccess: ((a: MIDIAccess) => void) | null = null;
      const lateContext = new AudioContext();
      const delayed = new MidiRecorder(
        { ...hooks, state: () => {}, inputs: () => {} },
        target,
        {
          context: () => lateContext,
          access: () => new Promise((resolve) => (resolveAccess = resolve)),
        },
      );
      resources.push(() => delayed.dispose());
      const connecting = delayed.connect();
      await wait(() => !!resolveAccess);
      delayed.dispose();
      resolveAccess!(late.asAccess);
      await connecting;
      check(
        late.port.opens === 0 && lateContext.state === 'closed',
        'Late permission grant revived input',
      );
      // Switching back to a port while its old open is pending must not close it.
      const race = fixture(true),
        a = new Port('a'),
        b = new Port('b');
      race.access.inputs.set('a', a);
      race.access.inputs.set('b', b);
      let unlock: (() => void) | null = null;
      a.gate = new Promise((resolve) => (unlock = resolve));
      let selectedRace = '';
      const raced = new MidiRecorder(
        { ...hooks, state: () => {}, inputs: (_p, id) => (selectedRace = id) },
        target,
        { access: async () => race.asAccess },
      );
      resources.push(() => raced.dispose());
      const opening = raced.connect();
      await wait(() => a.opens === 1);
      await raced.select('b');
      const again = raced.select('a');
      unlock!();
      await opening;
      await again;
      check(
        selectedRace === 'a' && a.connection === 'open' && !!a.onmidimessage,
        'Late port open closed the current selection',
      );
      raced.dispose();
      check(!a.onmidimessage, 'Port handler remained after disposal');
      // Permission refusal and empty/hot-plug input lists.
      let deniedPhase = '';
      const denied = new MidiRecorder(
        { ...hooks, state: (p) => (deniedPhase = p) },
        target,
        {
          access: async () => {
            throw new DOMException('No', 'NotAllowedError');
          },
        },
      );
      resources.push(() => denied.dispose());
      await denied.connect();
      check(
        deniedPhase === 'error' && issue.includes('declined'),
        'Permission refusal was not explained',
      );
      const plug = fixture(true);
      let listed = 0,
        plugPhase = '';
      const plugged = new MidiRecorder(
        {
          ...hooks,
          state: (p) => (plugPhase = p),
          inputs: (ports) => (listed = ports.length),
        },
        target,
        { access: async () => plug.asAccess },
      );
      resources.push(() => plugged.dispose());
      await plugged.connect();
      check(listed === 0, 'Empty input list was incorrect');
      plug.access.inputs.set(plug.port.id, plug.port);
      plug.access.onstatechange?.();
      check(Number(listed) === 1, 'Hot-plug list did not update');
      await plugged.select(plug.port.id);
      plug.port.state = 'disconnected';
      plug.access.onstatechange?.();
      check(
        plugPhase === 'error' && !plug.port.onmidimessage,
        'Unplug left input active',
      );
      setLog(
        `PASS: ${checks} MIDI lifecycle, audio timing, rendering, sustain, full-range, permissions, hot-plug and stale-callback assertions.`,
      );
    } catch (e) {
      setLog('FAIL: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      resources.forEach((close) => close());
      setBusy(false);
    }
  }
  async function ui() {
    setBusy(true);
    setLog('Checking the MIDI studio workflow…');
    let checks = 0;
    const check = (v: unknown, m: string) => {
      if (!v) throw Error(m);
      checks++;
    };
    try {
      setShow(false);
      await delay(30);
      hardware = fixture();
      deny = false;
      requestCount = 0;
      setAllowed(true);
      setKey((k) => k + 1);
      setShow(true);
      await click('Piano roll');
      await click('Record MIDI keyboard');
      check(requestCount === 0, 'MIDI permission was requested before Connect');
      input('MIDI recording length', '2');
      await click('MIDI count-in');
      await click('No count-in');
      await click('Connect MIDI keyboard');
      await click('Start MIDI recording');
      await wait(() => document.body.textContent!.includes('Recording · beat'));
      hardware.port.emit([0x90, 36, 100]);
      hardware.port.emit([0x90, 127, 70]);
      await delay(90);
      hardware.port.emit([0x80, 36, 0]);
      hardware.port.emit([0x80, 127, 0]);
      await click('Stop MIDI recording');
      check(
        draft.data.tracks[0].notes.length === 1,
        'Recording edited the project before Keep',
      );
      check(
        document.body.textContent!.includes('2 notes ready to review'),
        'Review lost notes',
      );
      check(!!button('Download MIDI take'), 'Download unavailable in review');
      await click('Keep MIDI notes');
      await wait(() => draft.data.tracks[0].notes.length === 3);
      check(
        draft.data.tracks[0].notes[0].id === 'original',
        'Keep replaced the original notes',
      );
      const kept = JSON.stringify(draft.data.tracks[0].notes);
      await click('Undo');
      check(
        draft.data.tracks[0].notes.length === 1,
        'Undo did not remove one whole performance',
      );
      await click('Redo');
      check(
        JSON.stringify(draft.data.tracks[0].notes) === kept,
        'Redo changed the performance',
      );
      await click('Visible keyboard range');
      await click('G7–G9');
      check(
        !!document.querySelector('button[aria-label^="G9 at beat"]'),
        'High recorded pitch was not editable',
      );
      // Disconnect during capture; then revoke editing after review.
      hardware = fixture();
      await click('Record MIDI keyboard');
      input('MIDI recording length', '2');
      await click('MIDI count-in');
      await click('No count-in');
      await click('Connect MIDI keyboard');
      await click('Start MIDI recording');
      await wait(() => document.body.textContent!.includes('Recording · beat'));
      hardware.port.emit([0x90, 80, 100]);
      await delay(60);
      hardware.port.state = 'disconnected';
      hardware.access.onstatechange?.();
      await wait(() => !!button('Keep MIDI notes'));
      check(
        document.body.textContent!.includes('1 note ready to review'),
        'Unplug lost the held note',
      );
      setAllowed(false);
      await delay(80);
      check(
        !!button('Download MIDI take') && button('Keep MIDI notes')!.disabled,
        'Access loss hid download or allowed Keep',
      );
      check(
        JSON.stringify(draft.data.tracks[0].notes) === kept,
        'Interrupted take edited existing notes',
      );
      await click('Discard MIDI take');
      await wait(() => !!document.querySelector('[role="alertdialog"]'));
      const confirm = [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[role="alertdialog"] button',
        ),
      ].find((b) => b.textContent?.trim() === 'Discard MIDI take')!;
      confirm.click();
      await delay(60);
      check(
        !document.querySelector('[role="dialog"]'),
        'Discard did not close recorder',
      );
      const mockRequest = navigator.requestMIDIAccess;
      try {
        setShow(false);
        await delay(30);
        Object.defineProperty(navigator, 'requestMIDIAccess', {
          configurable: true,
          value: undefined,
        });
        setAllowed(true);
        setKey((k) => k + 1);
        setShow(true);
        await click('Piano roll');
        await click('Record MIDI keyboard');
        check(
          document.body.textContent!.includes(
            'MIDI keyboards are not supported in this browser',
          ),
          'Unsupported browser explanation missing',
        );
        check(
          button('Connect MIDI keyboard')!.disabled,
          'Unsupported browser offered a broken connection button',
        );
        await click('Close MIDI recorder');
        check(
          !!button('Add note') && !button('Add note')!.disabled,
          'Unsupported MIDI blocked the piano roll',
        );
      } finally {
        Object.defineProperty(navigator, 'requestMIDIAccess', {
          configurable: true,
          value: mockRequest,
        });
      }
      setShow(false);
      setLog(
        `PASS: ${checks} MIDI studio permission, review, Keep, Undo/Redo, full-range editing, unplug, access and discard assertions.`,
      );
    } catch (e) {
      setLog('FAIL: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main style={{ padding: 20 }}>
      <h1>SESSION MIDI verification</h1>
      <p>
        Simulated MIDI ports and generated audio only. No hardware access,
        account, or uploads.
      </p>
      <div className="actions">
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void engine()}
        >
          Run MIDI engine checks
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void ui()}
        >
          Run MIDI studio checks
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => {
            hardware = fixture();
            setAllowed(true);
            setShow(true);
            setKey((k) => k + 1);
          }}
        >
          Show MIDI studio
        </button>
      </div>
      <output aria-label="MIDI results">{log}</output>
      <p>{notice}</p>
      {show && (
        <Studio
          key={key}
          initial={structuredClone(initial)}
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
