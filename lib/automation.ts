export const AUTOMATION_TARGETS = [
  'volume',
  'pan',
  'low',
  'mid',
  'high',
  'reverb',
  'delay',
] as const;

export type AutomationTarget = (typeof AUTOMATION_TARGETS)[number];
export type AutomationCurve = 'linear' | 'hold';
export type AutomationPoint = {
  time: number;
  value: number;
  curve?: AutomationCurve;
};
export type AutomationLanes = Partial<
  Record<AutomationTarget, AutomationPoint[]>
>;
export type AutomationScheduleDelay =
  | number
  | Partial<Record<AutomationTarget, number>>;

export type AutomationTrack = {
  automation?: AutomationPoint[];
  automationLanes?: AutomationLanes;
};

export type AutomationSpec = {
  label: string;
  shortLabel: string;
  min: number;
  max: number;
  step: number;
  unit: 'percent' | 'pan' | 'db';
  mode: 'multiply' | 'replace';
};

export const AUTOMATION_SPECS: Record<AutomationTarget, AutomationSpec> = {
  volume: {
    label: 'Volume',
    shortLabel: 'VOL',
    min: 0,
    max: 1.5,
    step: 0.01,
    unit: 'percent',
    mode: 'multiply',
  },
  pan: {
    label: 'Pan',
    shortLabel: 'PAN',
    min: -1,
    max: 1,
    step: 0.01,
    unit: 'pan',
    mode: 'replace',
  },
  low: {
    label: 'Low EQ',
    shortLabel: 'LOW',
    min: -12,
    max: 12,
    step: 0.1,
    unit: 'db',
    mode: 'replace',
  },
  mid: {
    label: 'Mid EQ',
    shortLabel: 'MID',
    min: -12,
    max: 12,
    step: 0.1,
    unit: 'db',
    mode: 'replace',
  },
  high: {
    label: 'High EQ',
    shortLabel: 'HIGH',
    min: -12,
    max: 12,
    step: 0.1,
    unit: 'db',
    mode: 'replace',
  },
  reverb: {
    label: 'Reverb',
    shortLabel: 'VERB',
    min: 0,
    max: 1,
    step: 0.01,
    unit: 'percent',
    mode: 'replace',
  },
  delay: {
    label: 'Delay',
    shortLabel: 'DELAY',
    min: 0,
    max: 1,
    step: 0.01,
    unit: 'percent',
    mode: 'replace',
  },
};

export const MAX_AUTOMATION_POINTS_PER_LANE = 64;
export const MAX_AUTOMATION_POINTS_PER_TRACK = 256;

export function sortedAutomation(points: AutomationPoint[]) {
  return [...points].sort((a, b) => a.time - b.time);
}

export function automationLane(
  track: AutomationTrack,
  target: AutomationTarget,
) {
  // An older client can preserve an unknown explicit volume lane while writing
  // the legacy field it understands. In that hybrid, legacy is the newer edit;
  // current editing and recovery migrate it back to the explicit lane.
  if (target === 'volume' && track.automation !== undefined)
    return track.automation;
  if (
    track.automationLanes &&
    Object.prototype.hasOwnProperty.call(track.automationLanes, target)
  )
    return track.automationLanes[target] || [];
  return [];
}

export function activeAutomationTargets(track: AutomationTrack) {
  return AUTOMATION_TARGETS.filter(
    (target) => automationLane(track, target).length > 0,
  );
}

export function automationPointCount(track: AutomationTrack) {
  return AUTOMATION_TARGETS.reduce(
    (count, target) => count + automationLane(track, target).length,
    0,
  );
}

export function automationAt(points: AutomationPoint[], time: number) {
  if (!points.length) return 1;
  const sorted = sortedAutomation(points);
  if (time <= sorted[0].time) return sorted[0].value;
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1];
    const next = sorted[index];
    if (time === next.time) return next.value;
    if (time < next.time) {
      if (previous.curve === 'hold') return previous.value;
      return (
        previous.value +
        ((next.value - previous.value) * (time - previous.time)) /
          (next.time - previous.time || 1)
      );
    }
  }
  return sorted.at(-1)!.value;
}

type SchedulableParam = {
  setValueAtTime: (value: number, time: number) => unknown;
  linearRampToValueAtTime: (value: number, time: number) => unknown;
};

export function scheduleAutomation(
  parameter: SchedulableParam,
  points: AutomationPoint[],
  from: number,
  to: number,
  when: number,
  delay = 0,
) {
  if (!points.length || to < from) return;
  const sorted = sortedAutomation(points);
  const at = when + delay;
  parameter.setValueAtTime(automationAt(sorted, from), at);
  let previous = sorted[0];
  let lastScheduledTime = from;
  for (const point of sorted) {
    if (point.time <= from) {
      previous = point;
      continue;
    }
    if (point.time > to) break;
    const eventTime = at + point.time - from;
    if (previous.curve === 'hold')
      parameter.setValueAtTime(point.value, eventTime);
    else parameter.linearRampToValueAtTime(point.value, eventTime);
    previous = point;
    lastScheduledTime = point.time;
  }
  if (lastScheduledTime >= to) return;
  const endTime = at + to - from;
  const endValue = automationAt(sorted, to);
  if (previous.curve === 'hold') parameter.setValueAtTime(endValue, endTime);
  else parameter.linearRampToValueAtTime(endValue, endTime);
}

export function automationDelayFor(
  delay: AutomationScheduleDelay,
  target: AutomationTarget,
) {
  const value = typeof delay === 'number' ? delay : delay[target] || 0;
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function clampAutomationValue(target: AutomationTarget, value: number) {
  const spec = AUTOMATION_SPECS[target];
  const clamped = Math.max(spec.min, Math.min(spec.max, value));
  return Number((Math.round(clamped / spec.step) * spec.step).toFixed(4));
}

export function formatAutomationValue(target: AutomationTarget, value: number) {
  const spec = AUTOMATION_SPECS[target];
  if (spec.unit === 'db')
    return `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
  if (spec.unit === 'pan') {
    if (Math.abs(value) < 0.005) return 'Center';
    return `${Math.round(Math.abs(value) * 100)} ${value < 0 ? 'L' : 'R'}`;
  }
  return `${Math.round(value * 100)}%`;
}
