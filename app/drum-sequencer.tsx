'use client';
import { useMemo, useState } from 'react';
import { Play, RotateCcw, Square, Trash2 } from 'lucide-react';
import type { MixerTrack } from '@/lib/audio';
import {
  DRUM_KITS,
  DRUM_LANES,
  DRUM_STEP_COUNTS,
  cleanDrumPattern,
  cycleDrumStep,
  defaultDrumPattern,
  drumPatternSeconds,
  resizeDrumPattern,
  setDrumStep,
  upgradeLegacyPattern,
  type DrumKit,
  type DrumLane,
  type DrumPattern,
  type DrumStepCount,
} from '@/lib/drum-pattern';

const velocityLabel = (value: number) =>
  value === 0
    ? 'Off'
    : value < 0.55
      ? 'Soft'
      : value < 0.85
        ? 'Medium'
        : 'Full';

export default function DrumSequencer({
  track,
  bpm,
  position,
  disabled,
  busy,
  playing,
  onAdd,
  onApply,
  onAudition,
  onStop,
}: {
  track?: MixerTrack;
  bpm: number;
  position: number;
  disabled: boolean;
  busy: boolean;
  playing: boolean;
  onAdd: (pattern: DrumPattern) => void;
  onApply: (track: MixerTrack, pattern: DrumPattern) => void;
  onAudition: (pattern: DrumPattern) => void;
  onStop: () => void;
}) {
  const initial = useMemo(
    () =>
      track?.drumPattern
        ? cleanDrumPattern(track.drumPattern)
        : track?.sequence
          ? upgradeLegacyPattern(track.sequence)
          : defaultDrumPattern(),
    [track],
  );
  const source = JSON.stringify([
    track?.id,
    track?.drumPattern ? 'pattern' : track?.sequence ? 'legacy' : 'draft',
    initial,
  ]);
  const [draftSource, setDraftSource] = useState(source),
    [pattern, setPattern] = useState(initial),
    [selected, setSelected] = useState<{ lane: DrumLane; step: number }>({
      lane: 'kick',
      step: 0,
    });
  // Undo, redo, and collaborator updates replace the committed score. Keep
  // drafts through name, mix, and waveform updates on this same channel.
  if (draftSource !== source) {
    setDraftSource(source);
    setPattern(initial);
    setSelected((current) => ({
      lane: current.lane,
      step: Math.min(current.step, initial.steps - 1),
    }));
  }
  const committed = track?.drumPattern
      ? JSON.stringify(cleanDrumPattern(track.drumPattern))
      : '',
    changed = JSON.stringify(pattern) !== committed,
    seconds = drumPatternSeconds(pattern, bpm),
    relative = track ? position - track.offset : position,
    playStep = playing
      ? Math.floor(
          (((relative % seconds) + seconds) % seconds) /
            (seconds / pattern.steps),
        )
      : -1,
    selectedVelocity = pattern.lanes[selected.lane][selected.step] || 0;
  function replace(next: DrumPattern) {
    setPattern(cleanDrumPattern(next));
    setSelected((current) => ({
      lane: current.lane,
      step: Math.min(current.step, next.steps - 1),
    }));
  }
  return (
    <section className="drum-editor" aria-label="Drum pattern editor">
      <div className="section-title">
        <div>
          <h2>{track ? track.name : 'Build a drum pattern'}</h2>
          <p>
            Six lanes, velocity, swing, and up to four bars. Applied edits
            update every playlist clip on this channel.
          </p>
        </div>
        <div className="actions">
          <button
            className="button secondary"
            disabled={busy}
            onClick={playing ? onStop : () => onAudition(pattern)}
          >
            {playing ? <Square size={16} /> : <Play size={16} />}
            {playing ? 'Stop' : 'Audition draft'}
          </button>
          {track ? (
            <button
              className="button primary"
              disabled={disabled || busy || !changed}
              onClick={() => onApply(track, pattern)}
            >
              {track.sequence && !track.drumPattern
                ? 'Upgrade & apply'
                : 'Apply changes'}
            </button>
          ) : (
            <button
              className="button primary"
              disabled={disabled || busy}
              onClick={() => onAdd(pattern)}
            >
              Add drum track
            </button>
          )}
        </div>
      </div>
      {track?.sequence && !track.drumPattern && (
        <output className="drum-legacy-note">
          This legacy track keeps its original eight-bar sound until you apply
          this editable one-bar version.
        </output>
      )}
      <fieldset disabled={disabled || busy}>
        <div className="drum-settings">
          <label className="field">
            <span>Kit</span>
            <select
              aria-label="Drum kit"
              value={pattern.kit}
              onChange={(event) =>
                replace({ ...pattern, kit: event.target.value as DrumKit })
              }
            >
              {DRUM_KITS.map((kit) => (
                <option key={kit.id} value={kit.id}>
                  {kit.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Pattern length</span>
            <select
              aria-label="Pattern length"
              value={pattern.steps}
              onChange={(event) =>
                replace(
                  resizeDrumPattern(
                    pattern,
                    Number(event.target.value) as DrumStepCount,
                  ),
                )
              }
            >
              {DRUM_STEP_COUNTS.map((steps) => (
                <option key={steps} value={steps}>
                  {steps / 16} {steps === 16 ? 'bar' : 'bars'} · {steps} steps
                </option>
              ))}
            </select>
          </label>
          <label className="field drum-swing">
            <span>Swing · {pattern.swing}%</span>
            <input
              aria-label="Pattern swing"
              type="range"
              min="0"
              max="60"
              step="1"
              value={pattern.swing}
              onChange={(event) =>
                replace({ ...pattern, swing: Number(event.target.value) })
              }
            />
          </label>
          <div className="drum-draft-actions">
            <button
              className="button secondary"
              onClick={() =>
                replace(defaultDrumPattern(pattern.steps, pattern.kit))
              }
            >
              <RotateCcw size={15} /> Starter groove
            </button>
            <button
              className="button secondary"
              onClick={() =>
                replace({
                  ...pattern,
                  lanes: Object.fromEntries(
                    DRUM_LANES.map((lane) => [
                      lane.id,
                      Array(pattern.steps).fill(0),
                    ]),
                  ) as DrumPattern['lanes'],
                })
              }
            >
              <Trash2 size={15} /> Clear
            </button>
            <button
              className="button secondary"
              disabled={!changed}
              onClick={() => replace(initial)}
            >
              Cancel draft
            </button>
          </div>
        </div>
        <div className="drum-grid-scroll">
          <div
            className="drum-grid"
            style={{ '--drum-steps': pattern.steps } as React.CSSProperties}
          >
            <div className="drum-grid-corner">Lane</div>
            {Array.from({ length: pattern.steps }, (_, step) => (
              <span
                className={'drum-step-number' + (step % 4 === 0 ? ' beat' : '')}
                key={'number-' + step}
              >
                {step + 1}
              </span>
            ))}
            {DRUM_LANES.map((lane) => (
              <div className="drum-grid-row" key={lane.id}>
                <strong>{lane.label}</strong>
                {pattern.lanes[lane.id].map((velocity, step) => (
                  <button
                    type="button"
                    key={step}
                    className={
                      'drum-step' +
                      (velocity ? ' enabled' : '') +
                      (velocity >= 0.85 ? ' accented' : '') +
                      (step % 4 === 0 ? ' beat' : '') +
                      (playStep === step ? ' playing' : '') +
                      (selected.lane === lane.id && selected.step === step
                        ? ' selected'
                        : '')
                    }
                    aria-label={`${lane.label} step ${step + 1} · ${velocityLabel(velocity)} ${Math.round(velocity * 100)}%`}
                    aria-pressed={velocity > 0}
                    onClick={() => {
                      setSelected({ lane: lane.id, step });
                      replace(cycleDrumStep(pattern, lane.id, step));
                    }}
                  >
                    <span>{velocity ? Math.round(velocity * 100) : ''}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="drum-velocity-editor">
          <label className="field">
            <span>
              {DRUM_LANES.find((lane) => lane.id === selected.lane)!.label} ·
              step {selected.step + 1} · {Math.round(selectedVelocity * 100)}%
            </span>
            <input
              aria-label="Selected step velocity"
              type="range"
              min="0"
              max="100"
              step="1"
              value={Math.round(selectedVelocity * 100)}
              onChange={(event) =>
                replace(
                  setDrumStep(
                    pattern,
                    selected.lane,
                    selected.step,
                    Number(event.target.value) / 100,
                  ),
                )
              }
            />
          </label>
          <p>
            Click a step to cycle Off, Soft, Medium, and Full. Use the slider
            for exact velocity. The grid scrolls inside this panel on smaller
            screens.
          </p>
        </div>
      </fieldset>
    </section>
  );
}
