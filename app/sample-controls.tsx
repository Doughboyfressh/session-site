'use client';
import { useEffect, useState } from 'react';
import { sampleBuffer, type MixerTrack } from '@/lib/audio';
import {
  checkSampleBuffer,
  sampleSettings,
  type SampleSettings,
} from '@/lib/sample-instrument';
import { Pick } from './helpers';
import { noteName } from './piano-roll';

export default function SampleControls({
  track,
  disabled,
  onChange,
  audition,
}: {
  track: MixerTrack;
  disabled: boolean;
  onChange: (p: Partial<MixerTrack>) => void;
  audition: (
    pitch: number,
    length?: number,
    velocity?: number,
    sample?: SampleSettings,
  ) => Promise<void>;
}) {
  const s = track.sample!;
  // Parent keys this editor by source file and applied sample settings.
  const [source] = useState(track);
  const [values, setValues] = useState({
    rootPitch: String(s.rootPitch),
    start: String(s.start),
    end: String(s.end),
    attack: String(s.attack * 1000),
    release: String(s.release * 1000),
  });
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    sampleBuffer(source, { signal: controller.signal, revalidate: true })
      .then((b) => {
        if (!controller.signal.aborted) setBuffer(b);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [source]);
  const settings = () =>
    sampleSettings({
      ...Object.fromEntries(
        Object.entries(values).map(([key, value]) => [
          key,
          value.trim()
            ? Number(value) / (key === 'attack' || key === 'release' ? 1000 : 1)
            : NaN,
        ]),
      ),
      ...(s.name ? { name: s.name } : {}),
    });
  const apply = () => {
    if (disabled || !buffer) return;
    try {
      const next = settings();
      checkSampleBuffer(buffer, next);
      onChange({ sample: next, peaks: undefined, duration: undefined });
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check the sample settings.');
    }
  };
  return (
    <section
      className="sample-controls"
      aria-label="Sample instrument settings"
    >
      <div className="section-title">
        <div>
          <h3>Your sampled instrument</h3>
          <p>
            Every note plays this region once. Pitch changes playback speed.
            Long notes stop when the sample ends.
          </p>
        </div>
        <button
          className="button secondary"
          disabled={disabled || !buffer}
          onClick={() => {
            try {
              const next = settings();
              checkSampleBuffer(buffer!, next);
              setError('');
              void audition(next.rootPitch, 1, 0.65, next);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Audition root note
        </button>
      </div>
      <p className="small-note">
        {s.name || 'Uploaded sample'} ·{' '}
        {loading
          ? 'Loading sample…'
          : buffer
            ? `${buffer.duration.toFixed(2)} seconds · ${buffer.numberOfChannels === 1 ? 'Mono' : 'Stereo'}`
            : 'Sample unavailable'}
      </p>
      <div className="piano-tools">
        <Pick
          label="Sample root note"
          value={values.rootPitch}
          onChange={(v) => setValues({ ...values, rootPitch: v })}
          options={Array.from({ length: 128 }, (_, i) => ({
            value: String(i),
            label: noteName(i),
          }))}
        />
        {(
          [
            ['start', 'Sample start (seconds)', 0, 30, 0.01],
            ['end', 'Sample end (seconds)', 0.01, 30, 0.01],
            ['attack', 'Sample attack (ms)', 0, 2000, 1],
            ['release', 'Sample release (ms)', 0, 500, 1],
          ] as const
        ).map(([key, label, min, max, step]) => (
          <label className="field" key={key}>
            <span>{label}</span>
            <input
              aria-label={label}
              type="number"
              min={min}
              max={max}
              step={step}
              value={values[key]}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })}
            />
          </label>
        ))}
        <button
          className="button primary"
          disabled={disabled || !buffer}
          onClick={apply}
        >
          Apply sample settings
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <p className="small-note">
        Set the root note to the pitch recorded in your sound. Settings apply
        together as one Undo step. Saving shares the complete uploaded audio
        file with project collaborators; the region only controls playback.
      </p>
    </section>
  );
}
