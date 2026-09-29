import type { Arrangement, MixerTrack } from './audio';

export const DRUM_LANES = [
  { id: 'kick', label: 'Kick' },
  { id: 'snare', label: 'Snare' },
  { id: 'clap', label: 'Clap' },
  { id: 'closedHat', label: 'Closed hat' },
  { id: 'openHat', label: 'Open hat' },
  { id: 'percussion', label: 'Percussion' },
] as const;

export const DRUM_KITS = [
  { id: 'studio', label: 'Studio punch' },
  { id: 'analog', label: 'Analog machine' },
  { id: 'dusty', label: 'Dusty tape' },
] as const;

export const DRUM_STEP_COUNTS = [16, 32, 64] as const;
export const DRUM_STEP_LEVELS = [0, 0.4, 0.7, 1] as const;

export type DrumLane = (typeof DRUM_LANES)[number]['id'];
export type DrumKit = (typeof DRUM_KITS)[number]['id'];
export type DrumStepCount = (typeof DRUM_STEP_COUNTS)[number];
export type DrumPattern = {
  version: 1;
  kit: DrumKit;
  steps: DrumStepCount;
  swing: number;
  lanes: Record<DrumLane, number[]>;
};

const laneIds = DRUM_LANES.map((lane) => lane.id);
const kitIds = DRUM_KITS.map((kit) => kit.id);
const patternKeys = ['version', 'kit', 'steps', 'swing', 'lanes'];

function fail(message = 'Invalid drum pattern.'): never {
  throw new Error(message);
}

export function validateDrumPattern(value: unknown): DrumPattern {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const pattern = value as Record<string, unknown>;
  if (
    Object.keys(pattern).sort().join(',') !==
      patternKeys.slice().sort().join(',') ||
    pattern.version !== 1 ||
    !kitIds.includes(pattern.kit as DrumKit) ||
    !DRUM_STEP_COUNTS.includes(pattern.steps as DrumStepCount) ||
    !Number.isFinite(pattern.swing) ||
    (pattern.swing as number) < 0 ||
    (pattern.swing as number) > 60 ||
    !pattern.lanes ||
    typeof pattern.lanes !== 'object' ||
    Array.isArray(pattern.lanes)
  )
    fail();
  const lanes = pattern.lanes as Record<string, unknown>;
  if (Object.keys(lanes).sort().join(',') !== laneIds.slice().sort().join(','))
    fail();
  for (const lane of laneIds) {
    const steps = lanes[lane];
    if (
      !Array.isArray(steps) ||
      steps.length !== pattern.steps ||
      Object.keys(steps).length !== pattern.steps ||
      Array.from(
        { length: pattern.steps as number },
        (_, index) => steps[index],
      ).some(
        (velocity) =>
          !Number.isFinite(velocity) || velocity < 0 || velocity > 1,
      )
    )
      fail('Every drum lane needs a valid velocity for each step.');
  }
  return value as DrumPattern;
}

export function cleanDrumPattern(value: unknown): DrumPattern {
  const pattern = validateDrumPattern(value);
  return {
    version: 1,
    kit: pattern.kit,
    steps: pattern.steps,
    swing: pattern.swing,
    lanes: Object.fromEntries(
      laneIds.map((lane) => [lane, Array.from(pattern.lanes[lane])]),
    ) as DrumPattern['lanes'],
  };
}

export function emptyDrumPattern(
  steps: DrumStepCount = 16,
  kit: DrumKit = 'studio',
): DrumPattern {
  return {
    version: 1,
    kit,
    steps,
    swing: 0,
    lanes: Object.fromEntries(
      laneIds.map((lane) => [lane, Array(steps).fill(0)]),
    ) as DrumPattern['lanes'],
  };
}

export function defaultDrumPattern(
  steps: DrumStepCount = 16,
  kit: DrumKit = 'studio',
): DrumPattern {
  const pattern = emptyDrumPattern(steps, kit);
  for (let step = 0; step < steps; step++) {
    const local = step % 16;
    pattern.lanes.kick[step] = [0, 6, 8, 14].includes(local) ? 1 : 0;
    pattern.lanes.snare[step] = [4, 12].includes(local) ? 0.9 : 0;
    pattern.lanes.closedHat[step] = local % 2 === 0 ? 0.65 : 0;
  }
  return pattern;
}

export function upgradeLegacyPattern(sequence: number[][]): DrumPattern {
  if (
    !Array.isArray(sequence) ||
    sequence.length !== 3 ||
    sequence.some(
      (row) =>
        !Array.isArray(row) ||
        row.length !== 16 ||
        Object.keys(row).length !== 16 ||
        Array.from({ length: 16 }, (_, index) => row[index]).some(
          (step) => step !== 0 && step !== 1,
        ),
    )
  )
    fail('The legacy drum pattern is unavailable.');
  const pattern = emptyDrumPattern();
  for (let step = 0; step < 16; step++) {
    pattern.lanes.kick[step] = sequence[0][step];
    pattern.lanes.snare[step] = sequence[1][step];
    pattern.lanes.closedHat[step] = sequence[2][step];
  }
  return pattern;
}

export function resizeDrumPattern(
  value: DrumPattern,
  steps: DrumStepCount,
): DrumPattern {
  const pattern = cleanDrumPattern(value);
  if (!DRUM_STEP_COUNTS.includes(steps)) fail();
  return {
    ...pattern,
    steps,
    lanes: Object.fromEntries(
      laneIds.map((lane) => {
        const source = pattern.lanes[lane];
        return [
          lane,
          Array.from({ length: steps }, (_, index) => source[index] || 0),
        ];
      }),
    ) as DrumPattern['lanes'],
  };
}

export function setDrumStep(
  value: DrumPattern,
  lane: DrumLane,
  step: number,
  velocity: number,
): DrumPattern {
  const pattern = cleanDrumPattern(value);
  if (
    !laneIds.includes(lane) ||
    !Number.isInteger(step) ||
    step < 0 ||
    step >= pattern.steps ||
    !Number.isFinite(velocity) ||
    velocity < 0 ||
    velocity > 1
  )
    fail('Choose a valid drum step and velocity.');
  pattern.lanes[lane][step] = velocity;
  return pattern;
}

export function cycleDrumStep(
  value: DrumPattern,
  lane: DrumLane,
  step: number,
) {
  const pattern = validateDrumPattern(value);
  const current = pattern.lanes[lane]?.[step];
  const next = DRUM_STEP_LEVELS.find((level) => level > current + 1e-8) ?? 0;
  return setDrumStep(pattern, lane, step, next);
}

export function drumPatternSeconds(pattern: DrumPattern, bpm: number) {
  validateDrumPattern(pattern);
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240)
    fail('Tempo must be 40–240 BPM.');
  return (pattern.steps * 60) / bpm / 4;
}

export function drumStepSeconds(
  pattern: DrumPattern,
  step: number,
  bpm: number,
) {
  validateDrumPattern(pattern);
  if (!Number.isInteger(step) || step < 0 || step >= pattern.steps) fail();
  const size = 60 / bpm / 4;
  return step * size + (step % 2 ? (pattern.swing / 100) * size * 0.5 : 0);
}

export function applyDrumPattern(
  data: Arrangement,
  trackId: string,
  value: DrumPattern,
): Arrangement {
  const pattern = cleanDrumPattern(value),
    current = data.tracks.find((track) => track.id === trackId);
  if (!current || (!current.sequence && !current.drumPattern))
    fail('Select an available drum channel.');
  const duration = drumPatternSeconds(pattern, data.bpm),
    oldDuration = current.duration,
    durationChanged =
      Number.isFinite(oldDuration) && Math.abs(oldDuration! - duration) > 1e-8,
    placements = [
      {
        offset: current.offset,
        trimStart: current.trimStart,
        trimEnd: current.trimEnd,
      },
      ...(current.clips || []),
    ];
  if (
    durationChanged &&
    (current.splitFrom ||
      placements.some((clip) => clip.trimStart || clip.trimEnd))
  )
    fail(
      'Use an untrimmed, unsplit drum channel before changing its pattern length.',
    );
  if (
    placements.some(
      (clip) =>
        duration - clip.trimStart - clip.trimEnd < 0.01 - 1e-8 ||
        clip.offset + duration - clip.trimStart - clip.trimEnd > 300 + 1e-8,
    )
  )
    fail('Keep every drum clip within the five-minute arrangement.');
  const patch: Partial<MixerTrack> = {
    sequence: undefined,
    drumPattern: pattern,
    duration,
    peaks: undefined,
    ...(durationChanged
      ? {
          fadeEnd: undefined,
          clips: current.clips?.map((clip) => ({
            ...clip,
            fadeEnd: undefined,
          })),
        }
      : {}),
  };
  const next = {
    ...data,
    tracks: data.tracks.map((track) =>
      track.id === trackId ? { ...track, ...patch } : track,
    ),
  };
  if (JSON.stringify(next).length > 250000)
    fail(
      'This project is too large. Use fewer patterns or start a new project.',
    );
  return next;
}
