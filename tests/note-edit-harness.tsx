import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Studio from '../app/studio';
import { defaults, bufferFor, type Note } from '../lib/audio';
import '../app/globals.css';
import '../app/advanced.css';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function wait(test: () => boolean) {
  for (let i = 0; i < 1000; i++) {
    if (test()) return;
    await delay(10);
  }
  throw Error('Note editing check timed out');
}
const button = (name: string) =>
  [
    ...document.querySelectorAll<HTMLButtonElement>(
      'button,[role="tab"],summary',
    ),
  ].find(
    (b) =>
      b.textContent?.trim() === name || b.getAttribute('aria-label') === name,
  );
async function click(name: string) {
  await wait(() => !!button(name) && !button(name)!.disabled);
  button(name)!.click();
  await delay(40);
}
function setInput(name: string, value: string) {
  const el = document.querySelector<HTMLInputElement>(
    `input[aria-label="${name}"]`,
  )!;
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
const selection = () =>
  document.querySelector('[aria-label="Note selection"]')!.textContent || '';
const key = (
  name: string,
  options: KeyboardEventInit = {},
  target: Element | null = document.querySelector(
    '[aria-label="Piano roll editor"]',
  ),
) => {
  const event = new KeyboardEvent('keydown', {
    key: name,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  target!.dispatchEvent(event);
  return event;
};
const notes: Note[] = [60, 64, 67].map((pitch, i) => ({
  id: 'chord-' + i,
  pitch,
  start: 1.13,
  length: 0.5,
  velocity: 0.4 + i / 5,
}));
notes.push({ id: 'low', pitch: 36, start: 3, length: 0.5, velocity: 0.7 });
const target = {
  ...defaults('First keys'),
  id: 'first',
  notes,
  sound: 'keys' as const,
};
const initial = {
  title: 'Note editing test',
  canEdit: true,
  canManage: true,
  data: {
    bpm: 120,
    tracks: [
      target,
      {
        ...target,
        id: 'second',
        name: 'Second keys',
        notes: notes.map((n) => ({ ...n })),
      },
    ],
  },
};
let draft: any;
function App() {
  const [show, setShow] = useState(false),
    [version, setVersion] = useState(0),
    [allowed, setAllowed] = useState(true),
    [busy, setBusy] = useState(false),
    [log, setLog] = useState(''),
    [notice, setNotice] = useState('');
  async function run() {
    let checks = 0;
    setBusy(true);
    setLog('Checking chord editing in the actual Studio…');
    const check = (v: unknown, message: string) => {
      if (!v) throw Error(message);
      checks++;
    };
    const current = (): Note[] => draft.data.tracks[0].notes;
    const snapshot = () => JSON.stringify(current());
    try {
      setAllowed(true);
      setVersion((v) => v + 1);
      setShow(true);
      await click('Piano roll');
      const original = snapshot();
      await click('C4 at beat 2.13');
      const second = button('E4 at beat 2.13')!;
      second.dispatchEvent(
        new MouseEvent('click', { bubbles: true, shiftKey: true }),
      );
      await delay(40);
      check(
        selection().startsWith('2 selected'),
        'Shift-click did not extend selection',
      );
      await click('Select multiple notes');
      await click('G4 at beat 2.13');
      check(
        selection().startsWith('3 selected'),
        'Touch selection mode did not add a note',
      );
      check(
        snapshot() === original && button('Undo')!.disabled,
        'Selecting notes changed music or history',
      );
      await click('Pitch up');
      check(
        current()
          .slice(0, 3)
          .every((n, i) => n.pitch === notes[i].pitch + 1),
        'Chord did not transpose together',
      );
      check(current()[3].pitch === 36, 'Transpose changed an unselected note');
      await click('Undo');
      check(snapshot() === original, 'Transpose was not one Undo step');
      await click('Redo');
      check(current()[0].pitch === 61, 'Redo lost the transpose');
      await click('Move later');
      check(
        current()
          .slice(0, 3)
          .every((n) => Math.abs(n.start - 1.38) < 1e-9),
        'Move lost chord alignment',
      );
      check(current()[3].start === 3, 'Move changed an unselected note');
      const beforeRepeat = snapshot();
      await click('Repeat selection');
      check(
        current().length === 7 && selection().startsWith('3 selected'),
        'Repeat count or selection is wrong',
      );
      check(
        current()
          .slice(4)
          .every((n) => Math.abs(n.start - 1.88) < 1e-9) &&
          new Set(current().map((n) => n.id)).size === 7,
        'Repeat changed spacing or reused identities',
      );
      await click('Undo');
      check(snapshot() === beforeRepeat, 'Repeat was not one Undo step');
      await click('Redo');
      const beforeVelocity = snapshot();
      await click('Set length or velocity');
      setInput('Selected velocity (%)', '55');
      await delay(30);
      check(snapshot() === beforeVelocity, 'Typing a velocity committed early');
      const velocityInput = document.querySelector(
        '[aria-label="Selected velocity (%)"]',
      )!;
      check(
        !key('Delete', {}, velocityInput).defaultPrevented &&
          snapshot() === beforeVelocity,
        'Shortcut intercepted numeric input',
      );
      await click('Apply velocity');
      check(
        current()
          .slice(4)
          .every((n) => n.velocity === 0.55),
        'Group velocity did not apply',
      );
      await click('Undo');
      check(snapshot() === beforeVelocity, 'Velocity was not one Undo step');
      await click('Redo');
      const beforeLength = snapshot();
      setInput('Selected note length (beats)', '1.5');
      await delay(30);
      await click('Apply length');
      check(
        current()
          .slice(4)
          .every((n) => n.length === 1.5),
        'Group length failed',
      );
      await click('Undo');
      check(snapshot() === beforeLength, 'Length was not one Undo step');
      await click('Redo');
      await click('Quantize selected');
      check(
        current()
          .slice(4)
          .every((n) => n.start === 2),
        'Selected notes were not quantized',
      );
      check(
        current()[0].start === 1.38,
        'Quantize changed original unselected notes',
      );
      const beforeKey = snapshot();
      key('ArrowUp', { shiftKey: true });
      await delay(40);
      check(
        current()
          .slice(4)
          .every((n, i) => n.pitch === current()[i].pitch + 12),
        'Shift arrow did not transpose an octave',
      );
      await click('Undo');
      check(snapshot() === beforeKey, 'Keyboard edit was not undoable');
      key('Escape');
      await delay(30);
      check(
        selection().startsWith('0 selected'),
        'Escape did not clear selection',
      );
      key('a', { ctrlKey: true });
      await delay(30);
      check(
        selection().startsWith('7 selected') &&
          selection().includes('1 selected outside'),
        'Select-all omitted hidden notes or their warning',
      );
      const beforeInvalid = snapshot();
      setInput('Selected velocity (%)', '0');
      await delay(30);
      await click('Apply velocity');
      check(
        !!document.querySelector('.piano-editor [role="alert"]') &&
          snapshot() === beforeInvalid,
        'Invalid velocity partially changed notes',
      );
      key('Delete');
      await delay(40);
      check(current().length === 0, 'Delete did not remove selection');
      await click('Undo');
      check(snapshot() === beforeInvalid, 'Delete Undo lost notes');
      await click('Select all notes');
      await click('Arrangement');
      await click('Select Second keys');
      await click('Piano roll');
      check(
        selection().startsWith('0 selected'),
        'Selection leaked into another track with shared note IDs',
      );
      const otherBefore = JSON.stringify(draft.data.tracks[1].notes);
      key('Delete');
      await delay(30);
      check(
        JSON.stringify(draft.data.tracks[1].notes) === otherBefore,
        'Empty selection deleted another instrument',
      );
      await click('G4 at beat 2.13');
      const focusedNote = button('G4 at beat 2.13')!;
      focusedNote.focus();
      key('ArrowUp', { shiftKey: true }, focusedNote);
      await delay(40);
      check(
        document.activeElement ===
          document.querySelector('[aria-label="Piano roll editor"]'),
        'Transposing outside the visible range lost keyboard focus',
      );
      key('ArrowDown', { shiftKey: true }, document.activeElement);
      await delay(40);
      check(
        JSON.stringify(draft.data.tracks[1].notes) === otherBefore,
        'Keyboard could not bring the offscreen note back',
      );
      await click('Select all notes');
      check(
        document.documentElement.scrollWidth <= window.innerWidth + 1,
        'Piano tools overflow horizontally',
      );
      setAllowed(false);
      await delay(60);
      check(
        !button('Delete selected') || button('Delete selected')!.disabled,
        'Lost editing access left bulk controls enabled',
      );
      check(
        !button('Undo') || button('Undo')!.disabled,
        'Lost access left Undo available',
      );
      if (document.querySelector('[aria-label="Piano roll editor"]')) {
        key('ArrowDown');
        key('Delete');
      } else
        check(
          document.body.textContent!.includes('This editor is paused'),
          'Missing room-access explanation',
        );
      await delay(30);
      check(
        JSON.stringify(draft.data.tracks[1].notes) === otherBefore,
        'Shortcut edited after access loss',
      );
      const rendered = await bufferFor(draft.data.tracks[0], 120);
      check(
        rendered.getChannelData(0).some((v) => Math.abs(v) > 0.001),
        'Edited notes rendered silence',
      );
      setShow(false);
      setLog(
        `PASS: ${checks} chord selection, group edits, repeats, keyboard scope, Undo/Redo, access and rendering assertions.`,
      );
    } catch (e: any) {
      setLog('FAIL: ' + e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main style={{ padding: 20 }}>
      <h1>SESSION note editing verification</h1>
      <p>Generated notes only. No accounts, uploads or hardware.</p>
      <div className="actions">
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void run()}
        >
          Run note editing checks
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={async () => {
            setAllowed(true);
            setVersion((v) => v + 1);
            setShow(true);
            await click('Piano roll');
            await click('Select all notes');
          }}
        >
          Show note editor
        </button>
      </div>
      <output aria-label="Note editing results">{log}</output>
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
