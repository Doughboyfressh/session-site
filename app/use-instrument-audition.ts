'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { context, playNote, sampleBuffer, type MixerTrack } from '@/lib/audio';
import { playSample, type SampleSettings } from '@/lib/sample-instrument';

export function useInstrumentAudition(
  track: MixerTrack | undefined,
  disabled: boolean,
  onError: (s: string) => void,
) {
  const current = useRef({ track, disabled, onError });
  useLayoutEffect(() => {
    current.current = { track, disabled, onError };
  }, [track, disabled, onError]);
  const requests = useRef(new Set<AbortController>()),
    voices = useRef<(() => void)[]>([]);
  const signature = JSON.stringify([
    track?.id,
    track?.fileId,
    track?.sample,
    track?.sound,
  ]);
  useEffect(() => {
    const stop = () => {
      requests.current.forEach((r) => r.abort());
      requests.current.clear();
      voices.current.forEach((v) => v());
      voices.current = [];
    };
    stop();
    const hidden = () => {
      if (document.hidden) stop();
    };
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      stop();
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [signature, disabled]);
  return async (
    pitch: number,
    length = 0.3,
    velocity = 0.5,
    sample?: SampleSettings,
  ) => {
    const value = current.current;
    if (value.disabled || !value.track) return;
    const controller = new AbortController();
    requests.current.add(controller);
    while (requests.current.size > 8) {
      const oldest = requests.current.values().next().value!;
      oldest.abort();
      requests.current.delete(oldest);
    }
    const target = sample ? { ...value.track, sample } : value.track;
    try {
      const c = context();
      await c.resume();
      const buffer = target.sample
        ? await sampleBuffer(target, {
            signal: controller.signal,
            revalidate: true,
          })
        : null;
      if (controller.signal.aborted || current.current.disabled) return;
      const now = current.current.track;
      if (
        JSON.stringify([now?.id, now?.fileId, now?.sample, now?.sound]) !==
        JSON.stringify([
          value.track.id,
          value.track.fileId,
          value.track.sample,
          value.track.sound,
        ])
      )
        return;
      let stop: () => void;
      if (buffer)
        stop = playSample(
          c,
          c.destination,
          buffer,
          target.sample!,
          pitch,
          c.currentTime,
          length,
          velocity,
        ).stop;
      else {
        const voice = playNote(
          c,
          c.destination,
          pitch,
          c.currentTime,
          length,
          velocity,
          target.sound,
        );
        stop = () => {
          try {
            voice.stop();
          } catch {}
          voice.disconnect();
        };
      }
      voices.current.push(stop);
      while (voices.current.length > 8) voices.current.shift()!();
    } catch (e) {
      if (!controller.signal.aborted)
        current.current.onError(
          e instanceof Error ? e.message : 'This instrument could not play.',
        );
    } finally {
      requests.current.delete(controller);
    }
  };
}
