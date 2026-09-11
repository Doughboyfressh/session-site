export type RecordingTiming = { preRollBars?: number; correctionMs?: number };

// All capture boundaries share the input context's integer audio clock.
export function recordingTiming(
  bpm: number,
  offset: number,
  bars: number,
  sampleRate: number,
  options: RecordingTiming = {},
) {
  const preRollBars = options.preRollBars ?? 0;
  const correctionMs = options.correctionMs ?? 0;
  if (
    !Number.isFinite(bpm) ||
    bpm < 40 ||
    bpm > 240 ||
    !Number.isFinite(offset) ||
    offset < 0 ||
    offset >= 300 ||
    ![0, 1, 2].includes(bars) ||
    ![0, 1, 2].includes(preRollBars) ||
    ![44100, 48000].includes(sampleRate) ||
    !Number.isFinite(correctionMs) ||
    correctionMs < 0 ||
    correctionMs > 500
  )
    throw new Error(
      'Choose a valid tempo, recording position, pre-roll and delay correction (0–500 ms).',
    );
  const beat = 60 / bpm;
  const preRollFrames = Math.min(
    Math.floor(offset * sampleRate),
    Math.round(preRollBars * 4 * beat * sampleRate),
  );
  return {
    beat,
    countFrames: Math.round(bars * 4 * beat * sampleRate),
    preRollFrames,
    from: offset - preRollFrames / sampleRate,
    correctionFrames: Math.round((correctionMs * sampleRate) / 1000),
  };
}
