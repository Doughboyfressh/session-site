export type RecordingLoop = {
  offset: number;
  frames: number;
  passes: number;
  preRollFrames: number;
};
export function loopPlan(
  offset: number,
  seconds: number,
  passes: number,
  sampleRate: number,
  existing: { seconds: number; blob: { size: number } }[] = [],
) {
  const frames = Math.round(seconds * sampleRate);
  if (
    ![44100, 48000].includes(sampleRate) ||
    !Number.isFinite(offset) ||
    offset < 0 ||
    !Number.isFinite(seconds) ||
    !Number.isSafeInteger(frames) ||
    frames < Math.ceil(sampleRate * 0.1) ||
    frames > sampleRate * 120 ||
    offset + frames / sampleRate > 300 + 1 / sampleRate ||
    !Number.isInteger(passes) ||
    passes < 2 ||
    passes > 8
  )
    throw new Error(
      'Choose 2–8 passes and a loop from 0.1 to 120 seconds within the project.',
    );
  if (
    existing.length + passes > 8 ||
    existing.reduce((n, t) => n + t.seconds, 0) +
      (frames / sampleRate) * passes >
      240 + 1 / sampleRate ||
    existing.reduce((n, t) => n + t.blob.size, 0) + (frames * 4 + 58) * passes >
      48 * 1024 * 1024
  )
    throw new Error(
      'There is not enough room for these passes. Choose fewer passes or a shorter loop, or discard a take first.',
    );
  return { frames, sampleRate, passes };
}
export function loopSegments(loop: RecordingLoop, sampleRate: number) {
  if (!Number.isSafeInteger(loop.frames))
    throw new Error('Invalid loop frame count.');
  loopPlan(loop.offset, loop.frames / sampleRate, loop.passes, sampleRate);
  if (
    !Number.isSafeInteger(loop.preRollFrames) ||
    loop.preRollFrames < 0 ||
    loop.preRollFrames > Math.floor(loop.offset * sampleRate)
  )
    throw new Error('Invalid loop pre-roll.');
  return Array.from({ length: loop.passes }, (_, i) => ({
    frame: i === 0 ? 0 : loop.preRollFrames + i * loop.frames,
    from: i === 0 ? loop.offset - loop.preRollFrames / sampleRate : loop.offset,
    to: loop.offset + loop.frames / sampleRate,
  }));
}
