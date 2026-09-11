'use client';
import { useState } from 'react';
import { Plus, Download, Trash2, Music2, Play } from 'lucide-react';
import { Pick, Range } from './helpers';
import {
  context,
  playNote,
  midiFile,
  download,
  type MixerTrack,
  type Note,
} from '@/lib/audio';
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
  disabled = false,
}: {
  track?: MixerTrack;
  bpm: number;
  onChange: (p: Partial<MixerTrack>) => void;
  onAdd: () => void;
  onRecord?: () => void;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState(''),
    [grid, setGrid] = useState('0.25'),
    [pitch, setPitch] = useState('60'),
    [start, setStart] = useState(0),
    [length, setLength] = useState('0.5'),
    [keyboardRange, setKeyboardRange] = useState('48');
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
  const notes = track.notes,
    focus = notes.find((n) => n.id === selected),
    beats = Math.max(
      8,
      Math.ceil(Math.max(0, ...notes.map((n) => n.start + n.length)) / 4) * 4,
    ),
    bottom = Number(keyboardRange),
    top = bottom + 24,
    rows = Array.from({ length: 25 }, (_, i) => top - i);
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
    if (notes.length >= 256) return;
    onChange({ notes: [...notes, n], peaks: undefined, duration: undefined });
    setSelected(n.id);
    context()
      .resume()
      .then(() =>
        playNote(
          context(),
          context().destination,
          p,
          context().currentTime,
          0.2,
          0.4,
          track?.sound,
        ),
      );
  }
  function edit(p: Partial<Note>) {
    onChange({
      notes: notes.map((n) => (n.id === selected ? { ...n, ...p } : n)),
      peaks: undefined,
      duration: undefined,
    });
  }
  return (
    <section className="piano-editor">
      <fieldset disabled={disabled}>
        <div className="section-title">
          <div>
            <h2>{track.name}</h2>
            <p>
              Click the grid to place a note. Select a note to edit its timing,
              length, or velocity.
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
            value={track.sound || 'keys'}
            onChange={(v) =>
              onChange({
                sound: v as any,
                peaks: undefined,
                duration: undefined,
              })
            }
            options={[
              { value: 'keys', label: 'Soft keys' },
              { value: 'bass', label: 'Analog bass' },
              { value: 'pad', label: 'Warm pad' },
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
        </div>
        <div className="piano-scroll">
          <div className="piano-ruler">
            <span />
            {Array.from({ length: beats }, (_, i) => (
              <span key={i}>{i + 1}</span>
            ))}
          </div>
          <div className="piano-body">
            <div className="piano-keys">
              {rows.map((p) => (
                <button
                  key={p}
                  className={noteName(p).includes('♯') ? 'black-key' : ''}
                  onClick={() => {
                    context()
                      .resume()
                      .then(() =>
                        playNote(
                          context(),
                          context().destination,
                          p,
                          context().currentTime,
                          0.3,
                          0.5,
                          track.sound,
                        ),
                      );
                  }}
                  aria-label={'Audition ' + noteName(p)}
                >
                  {noteName(p)}
                </button>
              ))}
            </div>
            <div
              className="piano-grid"
              style={{
                backgroundSize: `${100 / (beats / Number(grid))}% 24px`,
              }}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const p = top - Math.floor((e.clientY - r.top) / 24),
                  at = ((e.clientX - r.left) / r.width) * beats;
                if (p >= bottom && p <= top) add(p, at);
              }}
            >
              {notes
                .filter((n) => n.pitch >= bottom && n.pitch <= top)
                .map((n) => (
                  <button
                    key={n.id}
                    className={
                      'midi-note ' + (selected === n.id ? 'chosen' : '')
                    }
                    style={{
                      left: (n.start / beats) * 100 + '%',
                      top: (top - n.pitch) * 24 + 2,
                      width: (n.length / beats) * 100 + '%',
                      opacity: 0.5 + n.velocity * 0.5,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelected(n.id);
                    }}
                    aria-label={noteName(n.pitch) + ' at beat ' + (n.start + 1)}
                  >
                    {noteName(n.pitch)}
                  </button>
                ))}
            </div>
          </div>
        </div>
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
                  onChange({
                    notes: notes.filter((n) => n.id !== selected),
                    peaks: undefined,
                    duration: undefined,
                  });
                  setSelected('');
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
              onChange({
                notes: notes.map((n) => ({
                  ...n,
                  start: Math.round(n.start / Number(grid)) * Number(grid),
                })),
                peaks: undefined,
                duration: undefined,
              });
            }}
          >
            Quantize all
          </button>
          <button className="button secondary" onClick={() => setSelected('')}>
            Deselect note
          </button>
        </div>
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
export function AutomationEditor({
  track,
  length,
  onChange,
}: {
  track?: MixerTrack;
  length: number;
  onChange: (p: Partial<MixerTrack>) => void;
}) {
  const [time, setTime] = useState(0),
    [value, setValue] = useState(1);
  if (!track)
    return (
      <div className="empty-state">
        Add and select a track to automate its volume.
      </div>
    );
  const points = [...(track.automation || [])].sort((a, b) => a.time - b.time);
  return (
    <section className="automation-editor">
      <div className="section-title">
        <div>
          <h2>{track.name} · Volume automation</h2>
          <p>
            Draw a smooth level change over time. Values multiply the channel
            volume.
          </p>
        </div>
        <button
          className="button secondary"
          onClick={() => onChange({ automation: [] })}
        >
          Clear automation
        </button>
      </div>
      <svg
        viewBox="0 0 800 220"
        role="img"
        aria-label="Volume automation curve"
        className="automation-graph"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line
              x1="40"
              x2="780"
              y1={190 - v * 160}
              y2={190 - v * 160}
              stroke="#405337"
            />
            <text x="4" y={194 - v * 160} fill="#b0c39f" fontSize="12">
              {v * 100}%
            </text>
          </g>
        ))}
        <polyline
          points={(points.length
            ? points
            : [
                { time: 0, value: 1 },
                { time: length, value: 1 },
              ]
          )
            .map(
              (p) => `${40 + (p.time / length) * 740},${190 - p.value * 160}`,
            )
            .join(' ')}
          fill="none"
          stroke="#c2f65a"
          strokeWidth="3"
        />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={40 + (p.time / length) * 740}
            cy={190 - p.value * 160}
            r="5"
            fill="#c2f65a"
          />
        ))}
        <text x="40" y="216" fill="#a1b38f" fontSize="12">
          0 seconds
        </text>
        <text x="710" y="216" fill="#a1b38f" fontSize="12">
          {length.toFixed(1)} s
        </text>
      </svg>
      <div className="piano-tools">
        <label className="field">
          <span>Time (seconds)</span>
          <input
            type="number"
            min={0}
            max={length}
            step={0.1}
            value={time}
            onChange={(e) =>
              setTime(Math.max(0, Math.min(length, +e.target.value)))
            }
          />
        </label>
        <Range
          label={'Level · ' + Math.round(value * 100) + '%'}
          value={value}
          onChange={setValue}
        />
        <button
          className="button primary"
          disabled={points.length >= 64}
          onClick={() =>
            onChange({
              automation: [
                ...points.filter((p) => p.time !== time),
                { time, value },
              ].sort((a, b) => a.time - b.time),
            })
          }
        >
          <Plus size={15} /> Add point
        </button>
      </div>
      <div className="automation-points">
        {points.map((p) => (
          <button
            key={p.time}
            onClick={() =>
              onChange({ automation: points.filter((x) => x !== p) })
            }
            aria-label={'Remove point at ' + p.time + ' seconds'}
          >
            {p.time.toFixed(1)} s · {Math.round(p.value * 100)}%{' '}
            <Trash2 size={12} />
          </button>
        ))}
      </div>
    </section>
  );
}
