import type { Arrangement, MixerTrack } from './audio';

export const GROUP_IDS = ['group-1', 'group-2', 'group-3', 'group-4'] as const;
export type GroupId = (typeof GROUP_IDS)[number];
export type MixerGroup = {
  id: GroupId;
  name: string;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
};
export type MixerRouting = {
  groups: MixerGroup[];
  reverb: number;
  delay: number;
};
export function defaultRouting(): MixerRouting {
  return {
    groups: GROUP_IDS.map((id, i) => ({
      id,
      name: ['Vocals', 'Drums', 'Music', 'Other'][i],
      volume: 1,
      pan: 0,
      muted: false,
      solo: false,
    })),
    reverb: 1,
    delay: 1,
  };
}
export function routingFor(data: Pick<Arrangement, 'routing'>): MixerRouting {
  return data.routing || defaultRouting();
}
export function audibleTrack(data: Arrangement, track: MixerTrack) {
  const groups = routingFor(data).groups;
  const group = groups.find((g) => g.id === track.groupId);
  if (track.muted || group?.muted) return false;
  const solo = data.tracks.some((t) => t.solo) || groups.some((g) => g.solo);
  return !solo || track.solo || !!group?.solo;
}
export function validateRouting(
  value: unknown,
  draft = false,
): asserts value is MixerRouting {
  const fail = () => {
    throw Object.assign(
      new Error('Invalid mixer groups or shared effect levels.'),
      { status: 400 },
    );
  };
  const r = value as MixerRouting;
  if (
    !r ||
    typeof r !== 'object' ||
    Array.isArray(r) ||
    !Array.isArray(r.groups) ||
    r.groups.length !== 4
  )
    fail();
  const ids = new Set<string>();
  for (const g of r.groups) {
    if (
      !g ||
      !GROUP_IDS.includes(g.id) ||
      ids.has(g.id) ||
      typeof g.name !== 'string' ||
      g.name.length > 40 ||
      (!draft && !g.name.trim()) ||
      !Number.isFinite(g.volume) ||
      g.volume < 0 ||
      g.volume > 1.5 ||
      !Number.isFinite(g.pan) ||
      g.pan < -1 ||
      g.pan > 1 ||
      typeof g.muted !== 'boolean' ||
      typeof g.solo !== 'boolean'
    )
      fail();
    ids.add(g.id);
  }
  for (const n of [r.reverb, r.delay])
    if (!Number.isFinite(n) || n < 0 || n > 1.5) fail();
}
export function cleanRouting(r: MixerRouting): MixerRouting {
  return {
    groups: GROUP_IDS.map((id) => {
      const g = r.groups.find((g) => g.id === id)!;
      return {
        id,
        name: g.name,
        volume: g.volume,
        pan: g.pan,
        muted: g.muted,
        solo: g.solo,
      };
    }),
    reverb: r.reverb,
    delay: r.delay,
  };
}
