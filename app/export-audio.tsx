'use client';
import { useEffect, useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Pick } from './helpers';
import {
  createAudioExport,
  type ExportOptions,
  type ExportProgress,
} from '@/lib/audio-export';
import type { Arrangement } from '@/lib/audio';

export default function ExportAudio({
  title,
  data,
  onClose,
}: {
  title: string;
  data: Arrangement;
  onClose: () => void;
}) {
  const audible = data.tracks
    .filter((t) => !t.muted && (!data.tracks.some((x) => x.solo) || t.solo))
    .map((t) => t.id);
  const [options, setOptions] = useState<ExportOptions>({
    kind: 'mix',
    sampleRate: 48000,
    depth: 24,
    processing: 'processed',
    trackIds: audible,
    tail: 2,
    gainDb: 0,
    dither: true,
    includeMix: true,
  });
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [running, setRunning] = useState(false),
    [cancelling, setCancelling] = useState(false),
    [error, setError] = useState('');
  const [ready, setReady] = useState<{
    url: string;
    name: string;
    size: number;
    seconds: number;
    peak: number;
  } | null>(null);
  const control = useRef<AbortController | null>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      control.current?.abort();
    };
  }, []);
  useEffect(
    () => () => {
      if (ready) URL.revokeObjectURL(ready.url);
    },
    [ready],
  );
  function change<K extends keyof ExportOptions>(
    key: K,
    value: ExportOptions[K],
  ) {
    setOptions((previous) => ({ ...previous, [key]: value }));
    setReady(null);
    setError('');
  }
  function cancel() {
    control.current?.abort();
    setCancelling(true);
  }
  async function prepare() {
    if (running) return;
    setRunning(true);
    setCancelling(false);
    setReady(null);
    setError('');
    const controller = new AbortController();
    control.current = controller;
    try {
      const result = await createAudioExport(
        title,
        data,
        options,
        controller.signal,
        (p) => {
          if (alive.current) setProgress(p);
        },
      );
      if (!alive.current || controller.signal.aborted) return;
      setReady({
        url: URL.createObjectURL(result.blob),
        name: result.name,
        size: result.blob.size,
        seconds: result.seconds,
        peak: result.peak,
      });
    } catch (e: unknown) {
      if (alive.current)
        setError(
          e instanceof Error && e.name === 'AbortError'
            ? 'Export cancelled. You can start again.'
            : e instanceof Error
              ? e.message
              : 'Export could not finish. Try fewer tracks.',
        );
    } finally {
      if (alive.current) {
        setRunning(false);
        setCancelling(false);
        setProgress(null);
      }
      control.current = null;
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          control.current?.abort();
          onClose();
        }
      }}
    >
      <DialogContent className="form-dialog export-dialog">
        <DialogTitle>Export audio</DialogTitle>
        <DialogDescription>
          {title} · Uses a snapshot of your current arrangement, including
          unsaved edits.
        </DialogDescription>
        <fieldset disabled={running} className="export-settings">
          <div className="export-grid">
            <Pick
              label="Export as"
              value={options.kind}
              onChange={(v) => change('kind', v as ExportOptions['kind'])}
              options={[
                { value: 'mix', label: 'Stereo mix · WAV' },
                { value: 'tracks', label: 'Separate tracks · ZIP' },
              ]}
            />
            <Pick
              label="Track sound"
              value={options.processing}
              onChange={(v) =>
                change('processing', v as ExportOptions['processing'])
              }
              options={[
                { value: 'processed', label: 'With mixer effects' },
                { value: 'dry', label: 'Dry · ready to mix' },
              ]}
            />
            <Pick
              label="Sample rate"
              value={String(options.sampleRate)}
              onChange={(v) =>
                change('sampleRate', Number(v) as ExportOptions['sampleRate'])
              }
              options={[
                { value: '44100', label: '44.1 kHz' },
                { value: '48000', label: '48 kHz' },
              ]}
            />
            <Pick
              label="Bit depth"
              value={String(options.depth)}
              onChange={(v) =>
                change('depth', Number(v) as ExportOptions['depth'])
              }
              options={[
                { value: '16', label: '16-bit PCM' },
                { value: '24', label: '24-bit PCM' },
                { value: '32', label: '32-bit float · extra headroom' },
              ]}
            />
            <Pick
              label="Room for effect tails"
              value={String(options.tail)}
              onChange={(v) => change('tail', Number(v))}
              options={[
                { value: '0', label: 'No extra time' },
                { value: '2', label: '2 seconds' },
                { value: '5', label: '5 seconds' },
              ]}
            />
            <Pick
              label="Export gain"
              value={String(options.gainDb)}
              onChange={(v) => change('gainDb', Number(v))}
              options={[0, -3, -6, -12, -18, -24, -36].map((v) => ({
                value: String(v),
                label: v === 0 ? '0 dB · unchanged' : v + ' dB',
              }))}
            />
          </div>
          <p className="export-note">
            {options.processing === 'dry'
              ? 'Dry audio keeps positions, trims and fades. Mixer volume, pan, automation and effects are bypassed.'
              : 'Mixer effects, levels, pan and automation are included. Exports leave out the playback safety compressor.'}{' '}
            Export gain applies equally to every file.
          </p>
          <div className="export-checks">
            <label>
              <input
                type="checkbox"
                checked={options.dither}
                disabled={options.depth === 32}
                onChange={(e) => change('dither', e.target.checked)}
              />{' '}
              Dither integer WAVs <span>Helps keep quiet details smooth.</span>
            </label>
            {options.kind === 'tracks' && (
              <label>
                <input
                  type="checkbox"
                  checked={options.includeMix}
                  onChange={(e) => change('includeMix', e.target.checked)}
                />{' '}
                Include a reference mix of the selected tracks
              </label>
            )}
          </div>
          <div className="export-selection-heading">
            <h3>
              Tracks to include{' '}
              <span>
                {options.trackIds.length}/{data.tracks.length}
              </span>
            </h3>
            <div>
              <button
                type="button"
                onClick={() =>
                  change(
                    'trackIds',
                    data.tracks.map((t) => t.id),
                  )
                }
              >
                All
              </button>
              <button type="button" onClick={() => change('trackIds', audible)}>
                Currently audible
              </button>
              <button type="button" onClick={() => change('trackIds', [])}>
                None
              </button>
            </div>
          </div>
          <div className="export-track-list">
            {data.tracks.map((track, index) => (
              <label key={track.id}>
                <input
                  type="checkbox"
                  checked={options.trackIds.includes(track.id)}
                  onChange={(e) =>
                    change(
                      'trackIds',
                      e.target.checked
                        ? [...options.trackIds, track.id]
                        : options.trackIds.filter((id) => id !== track.id),
                    )
                  }
                />
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{track.name}</strong>
                <small>
                  {track.muted
                    ? 'Muted in studio'
                    : data.tracks.some((t) => t.solo) && !track.solo
                      ? 'Outside solo selection'
                      : ''}
                </small>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="export-note">
          Every selected track is included, even if muted in the studio.
          Separate WAVs start at 00:00 and have the same length. ZIP packages
          include an import guide. Five-minute timeline; up to five extra
          seconds for tails. Exports are limited to 128 MB.
        </p>
        {running && (
          <div className="export-progress" role="status">
            <Loader2 size={18} className="spin" />
            <span>
              {cancelling
                ? 'Cancelling · waiting for the current render to finish…'
                : progress?.message || 'Preparing export…'}
            </span>
            <progress
              aria-label="Export progress"
              max={progress?.total || 1}
              value={progress?.completed || 0}
            />
          </div>
        )}
        {error && (
          <p role="alert" className="export-error">
            {error}
          </p>
        )}
        {ready && (
          <div className="export-ready" role="status">
            <strong>
              Your {options.kind === 'tracks' ? 'track package' : 'WAV'} is
              ready.
            </strong>
            <span>
              {(ready.size / 1024 / 1024).toFixed(1)} MB ·{' '}
              {ready.seconds.toFixed(2)} seconds
              {ready.peak > 1
                ? ' · Float audio exceeds 0 dBFS; lower its gain before playback.'
                : ''}
            </span>
          </div>
        )}
        <div className="actions export-actions">
          {running ? (
            <button
              className="button secondary"
              onClick={cancel}
              disabled={cancelling}
            >
              Cancel export
            </button>
          ) : (
            <button className="button secondary" onClick={onClose}>
              Back to studio
            </button>
          )}
          {ready ? (
            <a
              className="button primary"
              href={ready.url}
              download={ready.name}
            >
              <Download size={16} /> Download{' '}
              {options.kind === 'tracks' ? 'ZIP' : 'WAV'}
            </a>
          ) : (
            <button
              className="button primary"
              disabled={running || !options.trackIds.length}
              onClick={() => void prepare()}
            >
              <Download size={16} /> {running ? 'Preparing…' : 'Prepare export'}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
