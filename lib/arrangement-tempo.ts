import type { Arrangement, MixerTrack } from './audio';
import { validateArrangement } from './arrangement-validation';
import { playlistTrackEnd } from './playlist-clips';

// Recorded files stay at their recorded positions; generated layers follow beats.
export function changeArrangementTempo(
  data: Arrangement,
  bpm: number,
): Arrangement {
  validateArrangement({ bpm, tracks: [] }, true);
  if (bpm === data.bpm) return data;
  const ratio = data.bpm / bpm;
  const tracks = data.tracks.map((t): MixerTrack => {
    if (
      (t.fileId && !t.sample) ||
      !(t.demo || t.sequence || t.notes || t.drumPattern)
    )
      return t;
    const tail = t.drumPattern ? 0 : 0.5;
    const beats = t.notes
      ? (t.noteLoopBeats ??
        Math.max(8, ...t.notes.map((n) => n.start + n.length)))
      : t.drumPattern
        ? t.drumPattern.steps / 4
        : 32;
    const duration = (beats * 60) / bpm + tail;
    if (duration > 300)
      throw new Error(
        'This tempo would extend a generated source past five minutes. Choose a faster tempo.',
      );
    const timing = (clip: {
      offset: number;
      trimStart: number;
      trimEnd: number;
      fadeIn?: number;
      fadeOut?: number;
      fadeStart?: number;
      fadeEnd?: number;
    }) => ({
      offset: clip.offset * ratio,
      trimStart: clip.trimStart * ratio,
      trimEnd:
        clip.trimEnd <= tail
          ? clip.trimEnd
          : (clip.trimEnd - tail) * ratio + tail,
      ...(clip.fadeIn === undefined
        ? {}
        : { fadeIn: Math.min(30, clip.fadeIn * ratio) }),
      ...(clip.fadeOut === undefined
        ? {}
        : { fadeOut: Math.min(30, clip.fadeOut * ratio) }),
      ...(clip.fadeStart === undefined
        ? {}
        : { fadeStart: clip.fadeStart * ratio }),
      ...(clip.fadeEnd === undefined ? {} : { fadeEnd: clip.fadeEnd * ratio }),
    });
    return {
      ...t,
      ...timing(t),
      duration,
      peaks: undefined,
      clips: t.clips?.map((c) => ({ ...c, ...timing(c) })),
      automation: t.automation?.map((p) => ({ ...p, time: p.time * ratio })),
      automationLanes:
        t.automationLanes &&
        Object.fromEntries(
          Object.entries(t.automationLanes).map(([target, points]) => [
            target,
            points?.map((p) => ({ ...p, time: p.time * ratio })),
          ]),
        ),
    };
  });
  const next = { ...data, bpm, tracks };
  validateArrangement(next, true);
  if (tracks.some((t) => playlistTrackEnd(t) > 300))
    throw new Error(
      'This tempo would extend the session past five minutes. Choose a faster tempo.',
    );
  return next;
}
