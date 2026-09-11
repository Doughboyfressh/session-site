import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Studio from '../app/studio';
import { defaults, bufferFor, type Note } from '../lib/audio';
import '../app/globals.css';
import '../app/advanced.css';

const delay = (ms = 35) => new Promise<void>((r) => setTimeout(r, ms));
async function wait(test: () => boolean) {
  for (let i = 0; i < 500; i++) {
    if (test()) return;
    await delay(10);
  }
  throw Error('Gesture check timed out');
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
const fixture: Note[] = [60, 64, 67].map((pitch, i) => ({
  id: 'chord-' + i,
  pitch,
  start: 1.13,
  length: [0.5, 1, 0.75][i],
  velocity: 0.4 + i / 5,
}));
fixture.push(
  { id: 'later', pitch: 69, start: 4, length: 0.5, velocity: 0.7 },
  { id: 'hidden', pitch: 36, start: 3, length: 0.5, velocity: 0.7 },
);
const initial = {
  title: 'Direct note editing test',
  canEdit: true,
  canManage: true,
  data: {
    bpm: 120,
    tracks: [
      {
        ...defaults('Gesture keys'),
        id: 'keys',
        notes: fixture,
        sound: 'keys' as const,
      },
    ],
  },
};
let draft: any,
  activity = false;
const grid = () => document.querySelector<HTMLElement>('.piano-grid')!;
const note = (id = 'chord-0') =>
  document.querySelector<HTMLElement>(`[data-note-id="${id}"]`)!;
const selection = () =>
  document.querySelector('[aria-label="Note selection"]')!.textContent!;
const current = (): Note[] => draft.data.tracks[0].notes;
const snapshot = () => JSON.stringify(current());
const scale = () =>
  grid().getBoundingClientRect().width /
  (document.querySelectorAll('.piano-ruler span').length - 1);
type Point = { x: number; y: number };
function location(el: Element, edge = false): Point {
  const r = el.getBoundingClientRect();
  return {
    x: edge ? r.right - 2 : r.left + r.width / 3,
    y: r.top + r.height / 2,
  };
}
function pointer(
  el: Element,
  type: string,
  p: Point,
  options: PointerEventInit = {},
) {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 71,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: p.x,
      clientY: p.y,
      ...options,
    }),
  );
}
function clickAfter(p: Point) {
  grid().dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      detail: 1,
      clientX: p.x,
      clientY: p.y,
    }),
  );
}
async function start(
  id = 'chord-0',
  edge = false,
  options: PointerEventInit = {},
) {
  const el = note(id),
    p = location(el, edge);
  pointer(
    edge ? el.querySelector('[data-note-resize]')! : el,
    'pointerdown',
    p,
    options,
  );
  await delay();
  return p;
}
async function move(
  p: Point,
  beats: number,
  semitones = 0,
  options: PointerEventInit = {},
) {
  const end = { x: p.x + beats * scale(), y: p.y - semitones * 24 };
  pointer(grid(), 'pointermove', end, options);
  await delay();
  return end;
}
async function end(p: Point, options: PointerEventInit = {}) {
  pointer(grid(), 'pointerup', p, options);
  await delay();
  clickAfter(p);
  await delay();
}
function key(value: string) {
  document
    .querySelector('[aria-label="Piano roll editor"]')!
    .dispatchEvent(
      new KeyboardEvent('keydown', {
        key: value,
        bubbles: true,
        cancelable: true,
      }),
    );
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
    await wait(() => current()?.length === 5);
  }
  async function run() {
    let checks = 0;
    const check = (v: unknown, m: string) => {
      if (!v) throw Error(m);
      checks++;
    };
    // Only the synthetic pointer is shimmed. Real browser pointers retain native capture.
    const proto = Element.prototype,
      originalSet = proto.setPointerCapture,
      originalHas = proto.hasPointerCapture,
      originalRelease = proto.releasePointerCapture;
    let captured = false;
    proto.setPointerCapture = function (id) {
      if (id === 71) captured = true;
      else originalSet.call(this, id);
    };
    proto.hasPointerCapture = function (id) {
      return id === 71 ? captured : originalHas.call(this, id);
    };
    proto.releasePointerCapture = function (id) {
      if (id === 71) captured = false;
      else originalRelease.call(this, id);
    };
    setBusy(true);
    setLog('Checking direct note editing in the actual Studio…');
    try {
      await reset();
      const original = snapshot();
      let p = await start(),
        q = await move(p, 0.5, 1);
      const topBefore = grid().getBoundingClientRect().top;
      check(
        snapshot() === original && button('Undo')!.disabled && activity,
        'Preview changed project/history or did not mark activity',
      );
      check(
        note().getAttribute('aria-label')!.startsWith('C♯4'),
        'Preview did not transpose',
      );
      q = await move(p, 1, 2);
      check(
        grid().getBoundingClientRect().top === topBefore,
        'Selecting an unselected note shifted the grid mid-drag',
      );
      check(snapshot() === original, 'Second move committed early');
      await end(q);
      check(
        Math.abs(current()[0].start - 2.13) < 1e-9 && current()[0].pitch === 62,
        'Release lost the combined move/transpose',
      );
      check(
        current().length === 5 && !activity,
        'Release added a stray note or left activity locked',
      );
      check(
        current()[1].pitch === 64 && selection().startsWith('1 selected'),
        'Single drag changed another note or selection',
      );
      await click('Undo');
      check(
        snapshot() === original && button('Undo')!.disabled,
        'Drag was not exactly one Undo step',
      );
      await click('Redo');
      check(current()[0].pitch === 62, 'Drag Redo failed');
      await click('Undo');
      p = await start('chord-1');
      await end(p);
      check(
        selection().startsWith('1 selected') &&
          note('chord-1').getAttribute('aria-pressed') === 'true' &&
          snapshot() === original,
        'Captured tap selected the wrong note',
      );
      await click('Select multiple notes');
      p = await start('chord-0');
      await end(p);
      p = await start('chord-2');
      await end(p);
      check(
        selection().startsWith('3 selected'),
        'Touch-friendly taps did not form a chord',
      );
      await click('Select multiple notes');
      p = await start('chord-1');
      q = await move(p, 0.25, -1);
      q = await move(p, 0.5, -2);
      await end(q);
      check(
        current()
          .slice(0, 3)
          .every(
            (n, i) =>
              Math.abs(n.start - 1.63) < 1e-9 &&
              n.pitch === fixture[i].pitch - 2,
          ),
        'Dragging a selected member failed to move the chord',
      );
      check(
        current()[3].start === 4 &&
          current()[4].pitch === 36 &&
          selection().startsWith('3 selected'),
        'Chord drag changed unselected notes or collapsed selection',
      );
      await click('Undo');
      check(
        snapshot() === original && button('Undo')!.disabled,
        'Chord drag created multiple Undo steps',
      );
      p = await start('chord-0', true);
      q = await move(p, 0.25, 2);
      q = await move(p, 0.5, 4);
      check(snapshot() === original, 'Resize committed before release');
      await end(q);
      check(
        current()
          .slice(0, 3)
          .every(
            (n, i) =>
              n.length === fixture[i].length + 0.5 &&
              n.pitch === fixture[i].pitch &&
              n.start === fixture[i].start,
          ),
        'Group resize did not preserve unequal lengths, pitch and starts',
      );
      await click('Undo');
      check(
        snapshot() === original && button('Undo')!.disabled,
        'Resize was not one Undo step',
      );
      p = await start('chord-0', true);
      q = await move(p, -0.5);
      await end(q);
      check(
        snapshot() === original &&
          button('Undo')!.disabled &&
          !!document.querySelector('.piano-editor [role="alert"]'),
        'Invalid group resize partially changed notes',
      );
      p = await start();
      q = await move(p, -3);
      q = await move(p, 0.25);
      await end(q);
      check(
        current()
          .slice(0, 3)
          .every((n) => Math.abs(n.start - 1.38) < 1e-9),
        'Returning from an invalid preview did not recover',
      );
      await click('Undo');
      for (const terminal of [
        'Escape',
        'pointercancel',
        'lostpointercapture',
        'blur',
      ]) {
        p = await start();
        q = await move(p, 0.75, 1);
        if (terminal === 'Escape') key('Escape');
        else if (terminal === 'blur') window.dispatchEvent(new Event('blur'));
        else pointer(grid(), terminal, q);
        await delay();
        pointer(grid(), 'pointerup', q);
        clickAfter(q);
        await delay();
        check(
          snapshot() === original && button('Undo')!.disabled && !activity,
          terminal + ' did not cancel without committing',
        );
      }
      p = await start();
      q = await move(p, 0.03);
      await end(q);
      check(
        snapshot() === original && button('Undo')!.disabled,
        'A sub-grid drag created an Undo entry',
      );
      await click('Clear selection');
      await click('Box select');
      const r = grid().getBoundingClientRect(),
        s = scale();
      p = { x: r.left + 0.8 * s, y: r.top + (72 - 67) * 24 - 2 };
      q = { x: r.left + 2.4 * s, y: r.top + (72 - 60) * 24 + 24 };
      pointer(grid(), 'pointerdown', p);
      await delay();
      pointer(grid(), 'pointermove', q);
      await delay();
      check(
        document.querySelectorAll('.midi-note.chosen').length === 3 &&
          !!document.querySelector('.note-selection-box'),
        'Box did not preview the chord',
      );
      check(
        selection().startsWith('0 selected') && snapshot() === original,
        'Box preview changed committed selection or notes',
      );
      await end(q);
      check(
        selection().startsWith('3 selected') &&
          snapshot() === original &&
          button('Undo')!.disabled,
        'Box selection changed music/history',
      );
      const later = note('later').getBoundingClientRect();
      p = { x: later.left - 5, y: later.top - 3 };
      q = { x: later.right + 5, y: later.bottom + 3 };
      pointer(grid(), 'pointerdown', p, { shiftKey: true });
      await delay();
      pointer(grid(), 'pointermove', q, { shiftKey: true });
      await delay();
      await end(q, { shiftKey: true });
      check(
        selection().startsWith('4 selected') &&
          selection().includes('0 selected outside'),
        'Additive box lost selection or included hidden notes',
      );
      const r2 = grid().getBoundingClientRect();
      p = { x: r2.left + 6 * scale(), y: r2.top + 25 };
      q = { x: p.x + scale(), y: p.y + 20 };
      pointer(grid(), 'pointerdown', p);
      await delay();
      pointer(grid(), 'pointermove', q);
      await delay();
      key('Escape');
      await delay();
      check(
        selection().startsWith('4 selected') &&
          !document.querySelector('.note-selection-box'),
        'Cancel box did not restore selection',
      );
      pointer(grid(), 'pointerdown', p);
      await delay();
      pointer(grid(), 'pointermove', q);
      await delay();
      await end(q);
      check(
        selection().startsWith('0 selected') && snapshot() === original,
        'Empty replacement box did not clear selection safely',
      );
      await click('Box select');
      p = await start('chord-0', false, { pointerType: 'touch' });
      q = await move(p, 1, 1, { pointerType: 'touch' });
      await end(q, { pointerType: 'touch' });
      check(
        current()[0].pitch === 61 && Math.abs(current()[0].start - 2.13) < 1e-9,
        'Touch pointer drag failed',
      );
      await click('Undo');
      check(
        getComputedStyle(note()).touchAction === 'none' &&
          getComputedStyle(grid()).touchAction !== 'none',
        'Touch note editing blocks empty-grid scrolling',
      );
      check(
        document.documentElement.scrollWidth <= window.innerWidth + 1,
        'Piano editing overflows the page',
      );
      p = await start();
      q = await move(p, 1, 1);
      setAllowed(false);
      await delay(80);
      check(
        snapshot() === original &&
          !activity &&
          !document.querySelector('.piano-grid'),
        'Lost room access committed a preview or kept its activity lock',
      );
      await reset();
      p = await start();
      q = await move(p, 0.5, 1);
      pointer(grid(), 'pointerup', q);
      await delay();
      const rendered = await bufferFor(draft.data.tracks[0], 120);
      check(
        rendered.getChannelData(0).some((v) => Math.abs(v) > 0.001),
        'Dragged notes rendered silence',
      );
      setShow(false);
      setLog(
        `PASS: ${checks} direct manipulation, cancellation, box selection, touch pointer, one-step Undo, access and audio assertions.`,
      );
    } catch (e: any) {
      setLog('FAIL: ' + e.message);
    } finally {
      proto.setPointerCapture = originalSet;
      proto.hasPointerCapture = originalHas;
      proto.releasePointerCapture = originalRelease;
      setBusy(false);
    }
  }
  return (
    <main style={{ padding: 20 }}>
      <h1>SESSION direct note editing verification</h1>
      <p>
        Generated notes only. Synthetic pointer checks plus a manual editor for
        native dragging.
      </p>
      <div className="actions">
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void run()}
        >
          Run gesture checks
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void reset()}
        >
          Show gesture editor
        </button>
      </div>
      <output aria-label="Gesture results">{log}</output>
      <p>{notice}</p>
      {show && (
        <Studio
          key={version}
          initial={structuredClone(initial)}
          roomAllowed={allowed}
          onDraft={(p) => {
            draft = p;
          }}
          onActivity={(v) => {
            activity = v;
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
