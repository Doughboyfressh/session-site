'use client';
import type { MixerTrack } from '@/lib/audio';

export default function MixerBoard({
  tracks,
  levels,
  disabled,
  onPatch,
  onSelect,
  onGestureStart,
  onGestureEnd,
}: {
  tracks: MixerTrack[];
  levels: Record<string, number>;
  disabled: boolean;
  onPatch: (id: string, patch: Partial<MixerTrack>) => void;
  onSelect: (id: string) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
}) {
  const gesture = {
    onPointerDown: (event: React.PointerEvent<HTMLInputElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      onGestureStart();
    },
    onPointerUp: onGestureEnd,
    onPointerCancel: onGestureEnd,
    onLostPointerCapture: onGestureEnd,
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (
        [
          'ArrowLeft',
          'ArrowRight',
          'ArrowUp',
          'ArrowDown',
          'PageUp',
          'PageDown',
          'Home',
          'End',
        ].includes(event.key)
      )
        onGestureStart();
    },
    onKeyUp: onGestureEnd,
    onBlur: onGestureEnd,
  };
  return (
    <section className="mixer-board" aria-label="Multichannel mixer">
      <div className="section-title">
        <div>
          <h2>Find your balance.</h2>
          <p>
            Adjust channels together. Open a channel for EQ, effects, and fades.
          </p>
        </div>
      </div>
      {!tracks.length ? (
        <p>Add a track in Arrangement to start mixing.</p>
      ) : (
        <div className="mixer-channels">
          {tracks.map((track, index) => {
            const peak = levels[track.id] || 0;
            return (
              <section
                className={'mix-channel tint-' + (index % 4)}
                key={track.id}
                aria-label={track.name + ' channel'}
              >
                <span className="tiny-label">
                  CHANNEL {String(index + 1).padStart(2, '0')}
                </span>
                <button
                  className="mix-channel-name"
                  onClick={() => onSelect(track.id)}
                  title="Open channel strip"
                >
                  {track.name}
                </button>
                <div className="mix-switches">
                  <button
                    disabled={disabled}
                    aria-pressed={track.muted}
                    onClick={() => onPatch(track.id, { muted: !track.muted })}
                    aria-label={'Mute ' + track.name}
                  >
                    Mute
                  </button>
                  <button
                    disabled={disabled}
                    aria-pressed={track.solo}
                    onClick={() => onPatch(track.id, { solo: !track.solo })}
                    aria-label={'Solo ' + track.name}
                  >
                    Solo
                  </button>
                </div>
                <label className="mix-pan">
                  Pan{' '}
                  <output>
                    {track.pan === 0
                      ? 'Center'
                      : `${Math.round(Math.abs(track.pan) * 100)}${track.pan < 0 ? 'L' : 'R'}`}
                  </output>
                  <input
                    {...gesture}
                    type="range"
                    aria-label={track.name + ' pan'}
                    min={-1}
                    max={1}
                    step={0.01}
                    disabled={disabled}
                    value={track.pan}
                    onChange={(e) =>
                      onPatch(track.id, { pan: +e.target.value })
                    }
                  />
                </label>
                <div className="mix-fader-row">
                  <input
                    {...gesture}
                    className="mix-fader"
                    type="range"
                    aria-label={track.name + ' volume'}
                    aria-valuetext={Math.round(track.volume * 100) + ' percent'}
                    min={0}
                    max={1.5}
                    step={0.01}
                    disabled={disabled}
                    value={track.volume}
                    onChange={(e) =>
                      onPatch(track.id, { volume: +e.target.value })
                    }
                  />
                  <meter
                    className="channel-meter"
                    aria-label={track.name + ' peak level'}
                    min={0}
                    max={1}
                    value={Math.min(1, peak)}
                  />
                </div>
                <output className="mix-volume">
                  {Math.round(track.volume * 100)}%{' '}
                  <span>
                    {track.volume > 0
                      ? `${(20 * Math.log10(track.volume)).toFixed(1)} dB`
                      : '−∞ dB'}
                  </span>
                </output>
                <span className={'channel-level ' + (peak > 1 ? 'over' : '')}>
                  {peak > 1
                    ? 'Over 0 dB'
                    : peak > 0.0001
                      ? `${(20 * Math.log10(peak)).toFixed(1)} dB peak`
                      : 'No signal'}
                </span>
                <button
                  className="button secondary"
                  onClick={() => onSelect(track.id)}
                >
                  EQ & effects
                </button>
              </section>
            );
          })}
        </div>
      )}
      <p className="small-note">
        Meters show each channel after its effects, before the master limiter.
        One fader gesture is one undo step.
      </p>
    </section>
  );
}
