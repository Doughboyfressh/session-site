'use client';
import { Trash2 } from 'lucide-react';
import type { MixerTrack } from '@/lib/audio';
import { activeAutomationTargets } from '@/lib/automation';
import { playlistClips, PRIMARY_CLIP_ID } from '@/lib/playlist-clips';

export default function ArrangementTimeline({
  tracks,
  selectedTrack,
  selectedClip,
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
  selectedTrack?: string;
  selectedClip?: string;
  length: number;
  position: number;
  zoom: number;
  canEdit: boolean;
  locked: boolean;
  onSelect: (trackId: string, clipId: string) => void;
  onSeek: (seconds: number) => void;
  onPatch: (id: string, patch: Partial<MixerTrack>) => void;
  onRemove: (id: string) => void;
}) {
  function seek(event: React.MouseEvent<HTMLElement>) {
    if (locked) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    onSeek(((event.clientX - bounds.left) / bounds.width) * length);
  }
  return (
    <div className="timeline-scroll" aria-label="Arrangement timeline">
      <div className="timeline-content" style={{ width: `${zoom * 100}%` }}>
        <div className="timeline-ruler">
          <span>
            TRACKS · {tracks.length}/48 · CLIPS ·{' '}
            {tracks.reduce(
              (count, track) => count + playlistClips(track).length,
              0,
            )}
            /256
          </span>
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
          const automation = activeAutomationTargets(track);
          const clips = playlistClips(track);
          return (
            <div
              className={
                'audio-row ' + (selectedTrack === track.id ? 'selected' : '')
              }
              key={track.id}
            >
              <div className="track-controls">
                <button
                  type="button"
                  className={'track-number tint-' + (index % 4)}
                  aria-label={'Select channel ' + track.name}
                  onClick={() => onSelect(track.id, PRIMARY_CLIP_ID)}
                >
                  {String(index + 1).padStart(2, '0')}
                </button>
                <input
                  aria-label={'Name for track ' + (index + 1)}
                  value={track.name}
                  disabled={!canEdit || locked}
                  onFocus={() => onSelect(track.id, PRIMARY_CLIP_ID)}
                  onChange={(event) =>
                    onPatch(track.id, {
                      name: event.target.value.slice(0, 100),
                    })
                  }
                />
                <span className="track-clip-count">
                  {clips.length} {clips.length === 1 ? 'clip' : 'clips'}
                </span>
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
                    aria-label={
                      'Remove ' + track.name + ' and all of its clips'
                    }
                    disabled={!canEdit || locked}
                    onClick={() => onRemove(track.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <div
                className="track-lane"
                aria-label={track.name + ' clip lane'}
              >
                <button
                  type="button"
                  className="lane-seek-surface"
                  aria-label={'Place playhead on ' + track.name}
                  disabled={locked}
                  onClick={(event) => {
                    onSelect(
                      track.id,
                      selectedTrack === track.id
                        ? selectedClip || PRIMARY_CLIP_ID
                        : PRIMARY_CLIP_ID,
                    );
                    if (event.detail) seek(event);
                  }}
                />
                {clips.map((clip) => {
                  const visible = Math.max(
                    0.01,
                    duration - clip.trimStart - clip.trimEnd,
                  );
                  const active =
                    selectedTrack === track.id && selectedClip === clip.id;
                  return (
                    <button
                      type="button"
                      key={clip.id}
                      data-clip-id={clip.id}
                      aria-pressed={active}
                      aria-label={`Select ${clip.name || track.name} on ${track.name}`}
                      className={
                        `wave-clip tint-${index % 4}` +
                        (active ? ' active' : '')
                      }
                      style={{
                        left: (clip.offset / length) * 100 + '%',
                        width: (visible / length) * 100 + '%',
                        opacity: track.muted ? 0.3 : 1,
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (locked) return;
                        onSelect(track.id, clip.id);
                        onSeek(clip.offset);
                      }}
                    >
                      <span>{clip.name || track.name}</span>
                      {clip.primary && !!automation.length && (
                        <span
                          className="clip-automation-badge"
                          aria-label={`${automation.length} active automation ${automation.length === 1 ? 'lane' : 'lanes'}`}
                        >
                          AUTO · {automation.length}
                        </span>
                      )}
                      <svg
                        viewBox={`${(clip.trimStart / duration) * 360} 0 ${(visible / duration) * 360} 40`}
                        preserveAspectRatio="none"
                        aria-label="Audio waveform"
                      >
                        {(track.peaks || []).map((peak, j) => (
                          <line
                            key={j}
                            x1={
                              (j * 360) / Math.max(1, track.peaks!.length - 1)
                            }
                            x2={
                              (j * 360) / Math.max(1, track.peaks!.length - 1)
                            }
                            y1={20 - peak * 20}
                            y2={20 + peak * 20}
                            stroke="currentColor"
                            strokeWidth="2"
                          />
                        ))}
                      </svg>
                    </button>
                  );
                })}
                <div
                  className="playhead"
                  style={{
                    left: Math.min(100, (position / length) * 100) + '%',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
