'use client';
import { useState, useRef } from 'react';
import { useInstrumentAudition } from './use-instrument-audition';
import SampleControls from './sample-controls';
import { useNoteGesture } from './use-note-gesture';
import {
  checkNotes,
  noteTimingLocked,
  editNotes,
  repeatSpan,
  type NoteEdit,
} from '@/lib/note-edit';
import { Plus, Download, Trash2, Music2, Play } from 'lucide-react';
import { Pick, Range } from './helpers';
import { midiFile, download, type MixerTrack, type Note } from '@/lib/audio';
import { SOUNDS, SOUND_LABELS, type Sound } from '@/lib/instruments';
const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export function noteName(p: number) {
  return names[p % 12] + (Math.floor(p / 12) - 1);
}
export default function PianoRoll({
  track,
  bpm,
  onChange,
  onAdd,
  onRecord,
  onGestureActivity,
  onLoadSample,
  disabled = false,
}: {
  track?: MixerTrack;
  bpm: number;
  onChange: (p: Partial<MixerTrack>) => void;
  onAdd: () => void;
  onRecord?: () => void;
  onGestureActivity?: (active: boolean) => void;
  onLoadSample?: (file: File) => void;
  disabled?: boolean;
}) {
  const [selection, setSelection] = useState<{ track: string; ids: string[] }>({
      track: '',
      ids: [],
    }),
    [multiple, setMultiple] = useState(false),
    [boxMode, setBoxMode] = useState(false),
    [error, setError] = useState(''),
    [groupLength, setGroupLength] = useState('1'),
    [groupVelocity, setGroupVelocity] = useState('75'),
    [grid, setGrid] = useState('0.25'),
    [pitch, setPitch] = useState('60'),
    [start, setStart] = useState(0),
    [length, setLength] = useState('0.5'),
    [keyboardRange, setKeyboardRange] = useState('48');
  const sampleInput = useRef<HTMLInputElement>(null);
  const audition = useInstrumentAudition(track, disabled, setError);
  const notes = track?.notes || [],
    selected =
      selection.track === track?.id
        ? selection.ids.filter((id) => notes.some((n) => n.id === id))
        : [],
    focus =
      selected.length === 1
        ? notes.find((n) => n.id === selected[0])
        : undefined,
    beats =
      track?.noteLoopBeats ??
      Math.max(
        8,
        Math.ceil(Math.max(0, ...notes.map((n) => n.start + n.length)) / 4) *
          4 +
          4,
      ),
    bottom = Number(keyboardRange),
    top = bottom + 24,
    rows = Array.from({ length: 25 }, (_, i) => top - i);
  function select(ids: string[]) {
    setSelection({ track: track!.id, ids });
    setError('');
  }
  function commit(next: Note[]) {
    if (disabled) return false;
    try {
      checkNotes(track!, bpm, next);
      if (JSON.stringify(next) !== JSON.stringify(notes))
        onChange({ notes: next, peaks: undefined, duration: undefined });
      setError('');
      return true;
    } catch (e: any) {
      setError(e.message || 'Could not edit these notes.');
      return false;
    }
  }
  function apply(operation: NoteEdit, ids = selected) {
    if (disabled) return;
    try {
      const result = editNotes(track!, bpm, ids, operation);
      if (commit(result.notes)) select(result.selected);
    } catch (e: any) {
      setError(e.message || 'Could not edit these notes.');
    }
  }
  function repeat() {
    try {
      apply({
        kind: 'duplicate',
        beats: repeatSpan(track!, selected, Number(grid)),
      });
    } catch (e: any) {
      setError(e.message);
    }
  }
  function add(p: number, at: number) {
    if (disabled) return;
    const n = {
      id: crypto.randomUUID(),
      pitch: p,
      start: Math.min(
        256,
        Math.max(0, Math.round(at / Number(grid)) * Number(grid)),
      ),
      length: Number(length),
      velocity: 0.75,
    };
    if (!commit([...notes, n])) return;
    select([n.id]);
    void audition(p, 0.2, 0.4);
  }
  function edit(p: Partial<Note>) {
    commit(notes.map((n) => (n.id === selected[0] ? { ...n, ...p } : n)));
  }
  const gesture = useNoteGesture({
    track,
    bpm,
    beats,
    top,
    grid: Number(grid),
    selected,
    multiple,
    boxMode,
    disabled,
    onSelect: select,
    onCommit: commit,
    onError: setError,
    onActivity: onGestureActivity,
  });
  if (!track?.notes)
    return (
      <div className="empty-state">
        <Music2 size={40} />
        <h2>Write the melody you hear.</h2>
        <p>
          Add an instrument track, then place notes on the piano roll. Notes
          follow your project tempo.
        </p>
        <button className="button primary" onClick={onAdd} disabled={disabled}>
          <Plus size={17} /> Add instrument track
        </button>
      </div>
    );
  return (
    <section
      className="piano-editor"
      tabIndex={0}
      aria-label="Piano roll editor"
      onPointerDownCapture={gesture.freshPointer}
      onClickCapture={(e) => {
        if (gesture.active || gesture.consumeClick(e.detail)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onKeyDown={(e) => {
        if (gesture.active) {
          e.preventDefault();
          return;
        }
        const target = e.target as HTMLElement;
        if (
          disabled ||
          (target !== e.currentTarget && !target.closest('.midi-note')) ||
          e.altKey
        )
          return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
          e.preventDefault();
          select(notes.map((n) => n.id));
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          select([]);
          return;
        }
        if (!selected.length) return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
          e.preventDefault();
          e.currentTarget.focus({ preventScroll: true });
          repeat();
          return;
        }
        if (e.ctrlKey || e.metaKey) return;
        if (
          [
            'Delete',
            'Backspace',
            'ArrowLeft',
            'ArrowRight',
            'ArrowUp',
            'ArrowDown',
          ].includes(e.key)
        ) {
          e.preventDefault();
          e.currentTarget.focus({ preventScroll: true });
        }
        if (e.key === 'Delete' || e.key === 'Backspace')
          apply({ kind: 'delete' });
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
          apply({
            kind: 'move',
            beats:
              (e.key === 'ArrowLeft' ? -1 : 1) *
              (e.shiftKey ? 1 : Number(grid)),
          });
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown')
          apply({
            kind: 'transpose',
            semitones: (e.key === 'ArrowDown' ? -1 : 1) * (e.shiftKey ? 12 : 1),
          });
      }}
    >
      <fieldset disabled={disabled}>
        <div className="section-title">
          <div>
            <h2>{track.name}</h2>
            <p>
              Click the grid to place a note. Drag notes to move them, or drag
              their right edge to change the length.
            </p>
          </div>
          <div className="actions">
            {onRecord && (
              <button className="button primary" onClick={onRecord}>
                Record MIDI keyboard
              </button>
            )}
            <button
              className="button secondary"
              onClick={() =>
                download(midiFile(notes, bpm), track.name + '.mid')
              }
            >
              <Download size={16} /> Export MIDI
            </button>
          </div>
        </div>
        <div className="piano-tools">
          <Pick
            label="Visible keyboard range"
            value={keyboardRange}
            onChange={setKeyboardRange}
            options={[0, 12, 24, 36, 48, 60, 72, 84, 96, 103].map((p) => ({
              value: String(p),
              label: noteName(p) + '–' + noteName(p + 24),
            }))}
          />
          <Pick
            label="Instrument"
            value={track.sample ? 'sample' : track.sound || 'keys'}
            onChange={(v) => {
              if (
                disabled ||
                !SOUNDS.includes(v as Sound) ||
                (!track.sample && v === (track.sound || 'keys'))
              )
                return;
              try {
                onChange({
                  sound: v as any,
                  sample: undefined,
                  fileId: undefined,
                  peaks: undefined,
                  duration: undefined,
                });
                setError('');
              } catch (e: any) {
                setError(e.message || 'Could not change this instrument.');
              }
            }}
            options={[
              ...(track.sample
                ? [{ value: 'sample', label: 'Your sample' }]
                : []),
              ...SOUNDS.map((value) => ({ value, label: SOUND_LABELS[value] })),
            ]}
          />
          <Pick
            label="Grid"
            value={grid}
            onChange={setGrid}
            options={[
              { value: '1', label: 'Quarter notes' },
              { value: '0.5', label: 'Eighth notes' },
              { value: '0.25', label: 'Sixteenth notes' },
            ]}
          />
          <Pick
            label="New note length"
            value={length}
            onChange={setLength}
            options={['0.25', '0.5', '1', '2', '4']}
          />
          <button className="button secondary" onClick={onAdd}>
            <Plus size={15} /> New instrument
          </button>
          {onLoadSample && (
            <>
              <button
                className="button secondary"
                onClick={() => sampleInput.current?.click()}
              >
                {track.sample ? 'Replace sample' : 'Load sample'}
              </button>
              <input
                ref={sampleInput}
                className="sr-only"
                type="file"
                aria-label="Choose instrument sample"
                accept="audio/*,.wav,.mp3,.ogg,.flac,.webm,.m4a"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file && !disabled) onLoadSample(file);
                }}
              />
            </>
          )}
        </div>
        {onLoadSample && !track.sample && (
          <p className="small-note">
            Load your own sound to play it across the keyboard. Use mono or
            stereo audio up to 30 seconds and 25 MB.
          </p>
        )}
        {track.sample && (
          <SampleControls
            key={track.fileId + JSON.stringify(track.sample)}
            track={track}
            disabled={disabled}
            onChange={onChange}
            audition={audition}
          />
        )}
        <div className="note-selection">
          <div className="actions">
            <button
              className="button secondary"
              aria-pressed={boxMode}
              onClick={() => setBoxMode((v) => !v)}
            >
              Box select
            </button>
            <button
              className="button secondary"
              aria-pressed={multiple}
              onClick={() => {
                setMultiple((v) => !v);
                setError('');
              }}
            >
              Select multiple notes
            </button>
            <button
              className="button secondary"
              disabled={!notes.length}
              onClick={() => select(notes.map((n) => n.id))}
            >
              Select all notes
            </button>
            <button
              className="button secondary"
              disabled={!selected.length}
              onClick={() => select([])}
            >
              Clear selection
            </button>
          </div>
          <p role="status" aria-label="Note selection">
            {selected.length} selected ·{' '}
            {
              notes.filter(
                (n) =>
                  selected.includes(n.id) &&
                  (n.pitch < bottom || n.pitch > top),
              ).length
            }{' '}
            selected outside this keyboard range
          </p>
          <details className="note-edit-help">
            <summary>Editing tips and shortcuts</summary>
            <p>
              Shift-click or turn on Select multiple notes to toggle notes. With
              the piano roll focused: arrows move notes; Shift adds an octave or
              moves one beat. Ctrl/⌘A selects all, Ctrl/⌘D repeats, Delete
              removes, and Escape clears the selection.
            </p>
            <p>
              Drag any selected note to move the whole selection. Drag a right
              edge to lengthen or shorten every selected note by the same
              amount. Turn on Box select, or Shift-drag empty grid space, to
              select a phrase. Shift adds to the selection. On touch screens,
              drag notes to edit; turn off Box select and Select multiple notes
              to scroll empty grid space. Release to keep an edit; Escape
              cancels it. Each drag is one Undo step.
            </p>
            <p>
              Moves use the chosen grid. Repeat starts after the selection’s
              full length, rounded up to that grid. Fades follow a changed
              instrument length; volume automation stays at its project times.
            </p>
          </details>
          {noteTimingLocked(track) && (
            <p>
              This clip is trimmed or split. Pitch and velocity edits are
              available; use an untrimmed, unsplit instrument for timing edits.
            </p>
          )}
          {track.noteLoopBeats && (
            <p className="small-note">
              {track.noteLoopBeats / 4}-bar loop · Note edits repeat across this
              instrument’s clips.
            </p>
          )}
          {selected.length > 0 && (
            <div className="note-bulk-tools">
              <div className="actions">
                <button
                  className="button secondary"
                  onClick={() => apply({ kind: 'move', beats: -Number(grid) })}
                >
                  Move earlier
                </button>
                <button
                  className="button secondary"
                  onClick={() => apply({ kind: 'move', beats: Number(grid) })}
                >
                  Move later
                </button>
                <button
                  className="button secondary"
                  onClick={() => apply({ kind: 'transpose', semitones: -1 })}
                >
                  Pitch down
                </button>
                <button
                  className="button secondary"
                  onClick={() => apply({ kind: 'transpose', semitones: 1 })}
                >
                  Pitch up
                </button>
                <button className="button secondary" onClick={repeat}>
                  Repeat selection
                </button>
                <button
                  className="button secondary"
                  onClick={() =>
                    apply({ kind: 'quantize', grid: Number(grid) })
                  }
                >
                  Quantize selected
                </button>
                <button
                  className="button secondary"
                  onClick={() => apply({ kind: 'delete' })}
                >
                  Delete selected
                </button>
              </div>
              <details className="note-edit-properties">
                <summary>Set length or velocity</summary>
                <div className="piano-tools">
                  <label className="field">
                    <span>Selected note length (beats)</span>
                    <input
                      aria-label="Selected note length (beats)"
                      type="number"
                      min="0.01"
                      max="32"
                      step="0.01"
                      value={groupLength}
                      onChange={(e) => setGroupLength(e.target.value)}
                    />
                  </label>
                  <button
                    className="button secondary"
                    onClick={() =>
                      apply({
                        kind: 'length',
                        beats: groupLength.trim() ? Number(groupLength) : NaN,
                      })
                    }
                  >
                    Apply length
                  </button>
                  <label className="field">
                    <span>Selected velocity (%)</span>
                    <input
                      aria-label="Selected velocity (%)"
                      type="number"
                      min="1"
                      max="100"
                      step="1"
                      value={groupVelocity}
                      onChange={(e) => setGroupVelocity(e.target.value)}
                    />
                  </label>
                  <button
                    className="button secondary"
                    onClick={() =>
                      apply({
                        kind: 'velocity',
                        value: groupVelocity.trim()
                          ? Number(groupVelocity) / 100
                          : NaN,
                      })
                    }
                  >
                    Apply velocity
                  </button>
                </div>
              </details>
            </div>
          )}
        </div>
        <div className="piano-scroll">
          <div
            className="piano-ruler"
            style={{ minWidth: Math.max(650, beats * 64 + 56) }}
          >
            <span />
            {Array.from({ length: beats }, (_, i) => (
              <span key={i}>{i + 1}</span>
            ))}
          </div>
          <div
            className="piano-body"
            style={{ minWidth: Math.max(650, beats * 64 + 56) }}
          >
            <div className="piano-keys">
              {rows.map((p) => (
                <button
                  key={p}
                  className={noteName(p).includes('♯') ? 'black-key' : ''}
                  onClick={() => void audition(p)}
                  aria-label={'Audition ' + noteName(p)}
                >
                  {noteName(p)}
                </button>
              ))}
            </div>
            <div
              ref={gesture.gridRef}
              className={
                'piano-grid' +
                (boxMode || multiple ? ' box-mode' : '') +
                (gesture.active ? ' note-gesturing' : '')
              }
              style={{
                backgroundSize: `${100 / (beats / Number(grid))}% 24px`,
              }}
              onPointerDown={(e) => gesture.begin(e)}
              onPointerMove={gesture.move}
              onPointerUp={gesture.end}
              onPointerCancel={gesture.lost}
              onLostPointerCapture={gesture.lost}
              onClick={(e) => {
                if (disabled) return;
                if (
                  boxMode ||
                  multiple ||
                  e.shiftKey ||
                  e.ctrlKey ||
                  e.metaKey
                ) {
                  select([]);
                  return;
                }
                const r = e.currentTarget.getBoundingClientRect();
                const p = top - Math.floor((e.clientY - r.top) / 24),
                  at = ((e.clientX - r.left) / r.width) * beats;
                if (p >= bottom && p <= top) add(p, at);
              }}
            >
              {(gesture.draft || notes)
                .filter((n) => n.pitch >= bottom && n.pitch <= top)
                .map((n) => (
                  <button
                    key={n.id}
                    data-note-id={n.id}
                    className={
                      'midi-note ' +
                      ((gesture.previewSelection || selected).includes(n.id)
                        ? 'chosen'
                        : '')
                    }
                    style={{
                      left: (n.start / beats) * 100 + '%',
                      top: (top - n.pitch) * 24 + 2,
                      width: (n.length / beats) * 100 + '%',
                      opacity: 0.5 + n.velocity * 0.5,
                    }}
                    onPointerDown={(e) => gesture.begin(e, n)}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (disabled) return;
                      select(
                        multiple || e.shiftKey || e.ctrlKey || e.metaKey
                          ? selected.includes(n.id)
                            ? selected.filter((id) => id !== n.id)
                            : [...selected, n.id]
                          : [n.id],
                      );
                    }}
                    aria-pressed={selected.includes(n.id)}
                    aria-label={noteName(n.pitch) + ' at beat ' + (n.start + 1)}
                  >
                    {noteName(n.pitch)}
                    <span
                      className="note-resize-handle"
                      data-note-resize
                      aria-hidden="true"
                      title="Drag to resize"
                    />
                  </button>
                ))}
              {gesture.box && (
                <div
                  className="note-selection-box"
                  style={gesture.box}
                  aria-hidden="true"
                />
              )}
            </div>
          </div>
        </div>
        <p
          className="note-gesture-status"
          role="status"
          aria-label="Note gesture"
        >
          {gesture.status ||
            (boxMode
              ? 'Drag empty grid space to select notes.'
              : 'Drag notes to move · Drag right edges to resize')}
        </p>
        {error && <p role="alert">{error}</p>}
        {selected.length < 2 && (
          <div className="piano-tools">
            <Pick
              label="Pitch"
              value={String(focus?.pitch ?? pitch)}
              onChange={(v) => (focus ? edit({ pitch: +v }) : setPitch(v))}
              options={Array.from({ length: 128 }, (_, i) => ({
                value: String(i),
                label: noteName(i),
              }))}
            />
            <label className="field">
              <span>Start beat (from 1)</span>
              <input
                type="number"
                min={1}
                max={257}
                step={Number(grid)}
                value={(focus?.start ?? start) + 1}
                onChange={(e) =>
                  focus
                    ? edit({
                        start: Math.min(256, Math.max(0, +e.target.value - 1)),
                      })
                    : setStart(Math.min(256, Math.max(0, +e.target.value - 1)))
                }
              />
            </label>
            {focus ? (
              <>
                <label className="field">
                  <span>Length in beats</span>
                  <input
                    type="number"
                    min={0.01}
                    max={32}
                    step={0.01}
                    value={focus.length}
                    onChange={(e) =>
                      edit({
                        length: Math.min(32, Math.max(0.01, +e.target.value)),
                      })
                    }
                  />
                </label>
                <Range
                  label={'Velocity · ' + Math.round(focus.velocity * 100) + '%'}
                  value={focus.velocity}
                  min={0.05}
                  max={1}
                  onChange={(v) => edit({ velocity: v })}
                />
                <button
                  className="button secondary"
                  onClick={() => {
                    apply({ kind: 'delete' });
                  }}
                >
                  <Trash2 size={15} /> Delete note
                </button>
              </>
            ) : (
              <button
                className="button primary"
                onClick={() => add(+pitch, start)}
              >
                <Plus size={15} /> Add note
              </button>
            )}
            <button
              className="button secondary"
              onClick={() => {
                apply(
                  { kind: 'quantize', grid: Number(grid) },
                  notes.map((n) => n.id),
                );
              }}
            >
              Quantize all
            </button>
            <button className="button secondary" onClick={() => select([])}>
              Deselect note
            </button>
          </div>
        )}
        <p className="small-note">
          {notes.length} notes · Showing {noteName(bottom)}–{noteName(top)} ·{' '}
          {notes.filter((n) => n.pitch < bottom || n.pitch > top).length} notes
          outside this range · All MIDI pitches are available in the Pitch
          control · Up to 256 notes per instrument.
        </p>
      </fieldset>
    </section>
  );
}
export { default as AutomationEditor } from './automation-editor';
