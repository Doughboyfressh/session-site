'use client';
import { Trash2 } from 'lucide-react';
import type { MixerTrack } from '@/lib/audio';

export default function ArrangementTimeline({
  tracks,
  selected,
  length,
  position,
  zoom,
  canEdit,
  locked,
  onSelect,
  onSeek,
  onPatch,
  onRemove,
}: {
  tracks: MixerTrack[];
  selected?: string;
  length: number;
  position: number;
  zoom: number;
  canEdit: boolean;
  locked: boolean;
  onSelect: (id: string) => void;
  onSeek: (seconds: number) => void;
  onPatch: (id: string, patch: Partial<MixerTrack>) => void;
  onRemove: (id: string) => void;
}) {
  function seek(event: React.MouseEvent<HTMLButtonElement>) {
    if (locked) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    onSeek(((event.clientX - bounds.left) / bounds.width) * length);
  }
  return (
    <div className="timeline-scroll" aria-label="Arrangement timeline">
      <div className="timeline-content" style={{ width: `${zoom * 100}%` }}>
        <div className="timeline-ruler">
          <span>TRACKS · {tracks.length}/32</span>
          <button
            className="timeline-seek"
            aria-label="Set playhead on timeline"
            disabled={locked}
            onClick={seek}
          >
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i}>{Number(((i * length) / 8).toFixed(2))}s</span>
            ))}
          </button>
        </div>
        {tracks.map((track, index) => {
          const duration = track.duration || 20;
          const visible = Math.max(
            0.01,
            duration - track.trimStart - track.trimEnd,
          );
          return (
            <div
              className={
                'audio-row ' + (selected === track.id ? 'selected' : '')
              }
              key={track.id}
            >
              <div
                className="track-controls"
                onClick={() => onSelect(track.id)}
              >
                <span className={'track-number tint-' + (index % 4)}>
                  {String(index + 1).padStart(2, '0')}
                </span>
                <input
                  aria-label={'Name for track ' + (index + 1)}
                  value={track.name}
                  disabled={!canEdit || locked}
                  onChange={(event) =>
                    onPatch(track.id, {
                      name: event.target.value.slice(0, 100),
                    })
                  }
                />
                <div className="track-buttons">
                  <button
                    className={track.muted ? 'on' : ''}
                    aria-pressed={track.muted}
                    aria-label={
                      (track.muted ? 'Unmute ' : 'Mute ') + track.name
                    }
                    onClick={() => onPatch(track.id, { muted: !track.muted })}
                  >
                    M
                  </button>
                  <button
                    className={track.solo ? 'on' : ''}
                    aria-pressed={track.solo}
                    aria-label={'Solo ' + track.name}
                    onClick={() => onPatch(track.id, { solo: !track.solo })}
                  >
                    S
                  </button>
                  <button
                    aria-label={'Remove ' + track.name}
                    disabled={!canEdit || locked}
                    onClick={() => onRemove(track.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <button
                className="track-lane"
                aria-label={'Select ' + track.name}
                onClick={(event) => {
                  onSelect(track.id);
                  seek(event);
                }}
              >
                <div
                  className={'wave-clip tint-' + (index % 4)}
                  style={{
                    left: (track.offset / length) * 100 + '%',
                    width: (visible / length) * 100 + '%',
                    opacity: track.muted ? 0.3 : 1,
                  }}
                >
                  <span>{track.name}</span>
                  <svg
                    viewBox={`${(track.trimStart / duration) * 360} 0 ${(visible / duration) * 360} 40`}
                    preserveAspectRatio="none"
                    aria-label="Audio waveform"
                  >
                    {(track.peaks || []).map((peak, j) => (
                      <line
                        key={j}
                        x1={(j * 360) / Math.max(1, track.peaks!.length - 1)}
                        x2={(j * 360) / Math.max(1, track.peaks!.length - 1)}
                        y1={20 - peak * 20}
                        y2={20 + peak * 20}
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                    ))}
                  </svg>
                </div>
                <div
                  className="playhead"
                  style={{
                    left: Math.min(100, (position / length) * 100) + '%',
                  }}
                />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
