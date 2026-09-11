'use client';
import { useEffect, useState, type RefObject } from 'react';
import { Download, Layers, Undo2, Redo2 } from 'lucide-react';
import type { CompRegion, LocalTake } from '@/lib/take-comp';
import type { RecordedTake } from '@/lib/recording';

export default function TakeWorkbench({
  takes,
  selected,
  onSelect,
  regions,
  onWhole,
  onReplace,
  onPunch,
  canPunch,
  fixedLength,
  onUndo,
  onRedo,
  undo,
  redo,
  locked,
  prepared,
  preview,
  compPreview,
  onPreview,
  preparing,
  added,
}: {
  takes: LocalTake[];
  selected: LocalTake;
  onSelect: (id: string) => void;
  regions: CompRegion[];
  onWhole: () => void;
  onReplace: (from: number, to: number) => void;
  onPunch: (from: number, to: number) => void;
  canPunch: boolean;
  fixedLength?: boolean;
  onUndo: () => void;
  onRedo: () => void;
  undo: boolean;
  redo: boolean;
  locked: boolean;
  prepared: (RecordedTake & { url: string }) | null;
  preview: RefObject<HTMLAudioElement | null>;
  compPreview: RefObject<HTMLAudioElement | null>;
  onPreview: () => void;
  preparing: boolean;
  added: boolean;
}) {
  const length = regions.at(-1)?.end || selected.seconds;
  const [from, setFrom] = useState('0'),
    [to, setTo] = useState(Math.min(length, selected.seconds).toFixed(2));
  useEffect(() => {
    preview.current?.pause();
    compPreview.current?.pause();
  }, [selected.id]);
  useEffect(() => {
    setFrom('0');
    setTo(String(Math.min(length, selected.seconds)));
  }, [length]);
  return (
    <section className="take-workbench" aria-label="Takes and comp">
      <div className="take-bank-heading">
        <h3>
          <Layers size={18} /> Your takes
        </h3>
        <span>{takes.length}/8 · kept in this recorder</span>
      </div>
      <div className="take-bank" role="group" aria-label="Choose a take">
        {takes.map((t, i) => (
          <button
            key={t.id}
            className="take-bank-item"
            aria-pressed={selected.id === t.id}
            disabled={preparing}
            onClick={() => onSelect(t.id)}
          >
            <span className="take-number">{i + 1}</span>
            <span>
              <strong>{t.name}</strong>
              <small>
                {t.seconds.toFixed(2)}s · {t.sampleRate / 1000} kHz
                {t.peak >= 0.98 ? ' · high input' : ''}
              </small>
            </span>
            <span>
              {regions.some((r) => r.takeId === t.id) ? 'In comp' : ''}
            </span>
          </button>
        ))}
      </div>
      <div className="take-review">
        <strong>{selected.name}</strong>
        {selected.correctionMs !== undefined && (
          <p className="record-note">
            Recorded with {selected.correctionMs.toFixed(1)} ms delay
            correction.
          </p>
        )}
        <p>
          Mono {selected.depth}-bit{selected.depth === 32 ? ' float' : ''} WAV ·{' '}
          {(selected.blob.size / 1024 / 1024).toFixed(1)} MB
        </p>
        {selected.coverageStart !== undefined && (
          <p className="record-note">
            Recorded range:{' '}
            {(selected.coverageStart / selected.sampleRate).toFixed(2)}–
            {(
              selected.coverageStart / selected.sampleRate +
              selected.seconds
            ).toFixed(2)}
            s. This take contains only that section.
          </p>
        )}
        <audio
          ref={preview}
          src={selected.url}
          controls
          preload="metadata"
          aria-label="Listen to selected take"
          onPlay={() => compPreview.current?.pause()}
        />
        <a
          className="button secondary"
          href={selected.url}
          download={'SESSION ' + selected.name + '.wav'}
        >
          <Download size={16} />
          Download {selected.name}
        </a>
        {selected.peak >= 0.98 && (
          <p>
            This take reached the top of the input range. Check for distortion.
          </p>
        )}
      </div>
      <section className="comp-editor" aria-label="Build your comp">
        <div className="take-bank-heading">
          <h3>Your comp</h3>
          <span>
            {length.toFixed(2)}s · {regions.length} section
            {regions.length === 1 ? '' : 's'}
          </span>
        </div>
        <p className="record-note">
          Start with one full take, then replace sections using the same moments
          from another performance. Times below start at the beginning of the
          recording.
        </p>
        <div className="comp-timeline" aria-label="Comp sections">
          {regions.map((r, i) => (
            <button
              key={i}
              disabled={locked}
              style={{ flexGrow: r.end - r.start }}
              onClick={() => {
                onSelect(r.takeId);
                setFrom(String(r.start));
                setTo(String(r.end));
              }}
              aria-label={
                'Section ' +
                (i + 1) +
                ': ' +
                takes.find((t) => t.id === r.takeId)?.name +
                ', ' +
                r.start.toFixed(2) +
                ' to ' +
                r.end.toFixed(2) +
                ' seconds'
              }
            >
              <strong>{takes.find((t) => t.id === r.takeId)?.name}</strong>
              <small>
                {r.start.toFixed(2)}–{r.end.toFixed(2)}s
              </small>
            </button>
          ))}
        </div>
        <fieldset disabled={locked} className="comp-range">
          <label>
            From (seconds)
            <input
              aria-label="Comp range start"
              type="number"
              min="0"
              max={length}
              step="0.01"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            To (seconds)
            <input
              aria-label="Comp range end"
              type="number"
              min="0"
              max={length}
              step="0.01"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button
            className="button primary"
            onClick={() =>
              onReplace(
                from.trim() ? Number(from) : NaN,
                to.trim() ? Number(to) : NaN,
              )
            }
          >
            Use {selected.name} for this section
          </button>
        </fieldset>
        <button
          className="button primary"
          disabled={locked || !canPunch}
          onClick={() =>
            onPunch(
              from.trim() ? Number(from) : NaN,
              to.trim() ? Number(to) : NaN,
            )
          }
        >
          Record this section
        </button>
        <div className="actions comp-tools">
          <button
            className="button secondary"
            disabled={
              locked ||
              selected.coverageStart !== undefined ||
              (!!fixedLength && selected.id !== 'original-clip')
            }
            onClick={onWhole}
          >
            Use {selected.name} as full comp
          </button>
          <button
            className="button secondary"
            disabled={locked || !undo}
            onClick={onUndo}
          >
            <Undo2 size={15} />
            Undo comp edit
          </button>
          <button
            className="button secondary"
            disabled={locked || !redo}
            onClick={onRedo}
          >
            <Redo2 size={15} />
            Redo
          </button>
        </div>
        <p className="record-note">
          Joins use up to a 3 ms fade on each side without moving the
          performance. Original takes stay unchanged. Takes must have the same
          sample rate to combine.
        </p>
        {prepared ? (
          <div className="comp-preview">
            <strong>
              {added ? 'Added to your arrangement' : 'Comp ready to review'}
            </strong>
            <audio
              ref={compPreview}
              src={prepared.url}
              controls
              preload="metadata"
              aria-label="Listen to comp"
              onPlay={() => preview.current?.pause()}
            />
            <a
              className="button secondary"
              href={prepared.url}
              download="SESSION vocal comp.wav"
            >
              <Download size={16} />
              Download comp
            </a>
          </div>
        ) : (
          <button
            className="button secondary"
            disabled={locked}
            onClick={onPreview}
          >
            {preparing ? 'Preparing comp…' : 'Prepare comp preview'}
          </button>
        )}
      </section>
    </section>
  );
}
