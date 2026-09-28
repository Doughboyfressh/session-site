import type { Arrangement, MixerTrack } from './audio';
import {
  cleanRouting,
  routingFor,
  GROUP_IDS,
  type MixerRouting,
} from './mixer-routing';
import {
  AUTOMATION_TARGETS,
  automationLane,
  type AutomationLanes,
} from './automation';

export type ProjectSnapshot = { title: string; data: Arrangement };
export type MergeChoice = 'local' | 'remote';
export type MergeDetail = { label: string; local: unknown; remote: unknown };

// JSON semantics: object key order and absent optional values do not change a save.
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
function equal(a: any, b: any) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
function cleanTrack(track: MixerTrack): MixerTrack {
  const { peaks: _peaks, duration: _duration, ...saved } = track;
  return saved;
}
export function cleanProject(project: ProjectSnapshot): ProjectSnapshot {
  return {
    title: project.title,
    data: {
      bpm: project.data.bpm,
      tracks: project.data.tracks.map(cleanTrack),
      ...(project.data.routing
        ? { routing: cleanRouting(project.data.routing) }
        : {}),
    },
  };
}
export function sameProject(a: ProjectSnapshot, b: ProjectSnapshot) {
  return equal(cleanProject(a), cleanProject(b));
}

export function mergeProject(
  baseValue: ProjectSnapshot,
  localValue: ProjectSnapshot,
  remoteValue: ProjectSnapshot,
  choice?: MergeChoice,
) {
  const base = cleanProject(baseValue),
    local = cleanProject(localValue),
    remote = cleanProject(remoteValue);
  const conflicts: string[] = [];
  const details: MergeDetail[] = [];
  function pick(b: any, l: any, r: any, label: string): any {
    if (equal(l, r)) return l;
    if (equal(l, b)) return r;
    if (equal(r, b)) return l;
    conflicts.push(label);
    details.push({
      label,
      local: structuredClone(l),
      remote: structuredClone(r),
    });
    return choice === 'remote' ? r : l;
  }
  const maps = [base, local, remote].map((p) => {
    const map = new Map(p.data.tracks.map((t) => [t.id, t]));
    if (map.size !== p.data.tracks.length)
      throw new Error('Duplicate track identities. Reload a saved version.');
    return map;
  });
  const [bm, lm, rm] = maps;
  const orders = [base, local, remote].map((p) =>
    p.data.tracks.map((t) => t.id),
  );
  function moved(id: string, order: string[]) {
    return orders[0].some(
      (other) =>
        other !== id &&
        order.includes(other) &&
        orders[0].indexOf(id) < orders[0].indexOf(other) !==
          order.indexOf(id) < order.indexOf(other),
    );
  }
  const tracks = new Map<string, MixerTrack>();
  const handled = new Set<string>();
  // Splits are transactions: selecting a competing move/removal must also remove
  // children introduced by the rejected split, rather than leaving orphan halves.
  const families = new Map<string, Set<string>>();
  for (const map of maps)
    for (const t of map.values())
      if (t.splitFrom) {
        const members = families.get(t.splitFrom) || new Set([t.splitFrom]);
        members.add(t.id);
        families.set(t.splitFrom, members);
      }
  for (const [root, ids] of families) {
    const groups = [base, local, remote].map((p) =>
      p.data.tracks.filter((t) => ids.has(t.id)),
    );
    const topology = groups.map((group) => group.map((t) => t.id).sort());
    if (equal(topology[0], topology[1]) && equal(topology[0], topology[2]))
      continue;
    const label =
      (bm.get(root) || lm.get(root) || rm.get(root) || groups.flat()[0])
        ?.name || 'Clip';
    const selected = pick(
      groups[0],
      groups[1],
      groups[2],
      label + ' · split / related edits',
    );
    for (const t of selected) tracks.set(t.id, structuredClone(t));
    for (const id of ids) handled.add(id);
  }
  const geometry = [
    'offset',
    'trimStart',
    'trimEnd',
    'fadeStart',
    'fadeEnd',
    'fadeIn',
    'fadeOut',
    'splitFrom',
  ];
  const timing = (t: MixerTrack) =>
    Object.fromEntries(
      geometry
        .filter((k) => (t as any)[k] !== undefined)
        .map((k) => [k, (t as any)[k]]),
    );
  const sourceKeys = ['fileId', 'sample', 'notes', 'sound', 'demo', 'sequence'];
  const source = (t: MixerTrack) =>
    Object.fromEntries(
      sourceKeys
        .filter((k) => (t as any)[k] !== undefined)
        .map((k) => [k, (t as any)[k]]),
    );
  for (const id of [
    ...new Set([...bm.keys(), ...lm.keys(), ...rm.keys()]),
  ].sort()) {
    if (handled.has(id)) continue;
    const b = bm.get(id),
      l = lm.get(id),
      r = rm.get(id);
    const label = (l || r || b)!.name;
    let merged: MixerTrack | undefined;
    if (b && l && r) {
      const volumeLanePresent = [b, l, r].some((track) =>
        Object.prototype.hasOwnProperty.call(
          track.automationLanes || {},
          'volume',
        ),
      );
      merged = {
        id,
        ...structuredClone(
          pick(
            timing(b),
            timing(l),
            timing(r),
            label + ' · clip timing and fades',
          ),
        ),
      } as MixerTrack;
      // A sample region belongs to its file. Never combine a replacement asset
      // with a concurrent zone edit, or merge half of an instrument-mode change.
      const sampled = b.sample || l.sample || r.sample;
      if (sampled)
        Object.assign(
          merged,
          structuredClone(
            pick(
              source(b),
              source(l),
              source(r),
              label + ' · instrument source and notes',
            ),
          ),
        );
      for (const key of [
        ...new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)]),
      ].sort()) {
        if (geometry.includes(key) || (sampled && sourceKeys.includes(key)))
          continue;
        if (key === 'automation' && volumeLanePresent) continue;
        if (key === 'automationLanes') {
          const lanes: AutomationLanes = {};
          for (const target of AUTOMATION_TARGETS) {
            const present = [b, l, r].some((track) =>
              Object.prototype.hasOwnProperty.call(
                track.automationLanes || {},
                target,
              ),
            );
            if (!present) continue;
            const value = pick(
              target === 'volume' && volumeLanePresent
                ? automationLane(b, target)
                : b.automationLanes?.[target],
              target === 'volume' && volumeLanePresent
                ? automationLane(l, target)
                : l.automationLanes?.[target],
              target === 'volume' && volumeLanePresent
                ? automationLane(r, target)
                : r.automationLanes?.[target],
              `${label} · ${target} automation`,
            );
            if (value !== undefined) lanes[target] = structuredClone(value);
          }
          if (Object.keys(lanes).length) merged.automationLanes = lanes;
          continue;
        }
        const value = pick(
          (b as any)[key],
          (l as any)[key],
          (r as any)[key],
          label + ' · ' + key,
        );
        if (value !== undefined) (merged as any)[key] = structuredClone(value);
      }
    } else if (
      b &&
      ((!l && r && moved(id, orders[2])) || (!r && l && moved(id, orders[1])))
    ) {
      conflicts.push(label + ' · removal / order');
      merged = choice === 'remote' ? r : l;
    } else merged = pick(b, l, r, label + ' · track');
    if (merged) tracks.set(id, structuredClone(merged));
  }
  // Merge relative order constraints. Cycles represent incompatible rearrangements.
  const ids = [...tracks.keys()].sort(),
    edges = new Map(ids.map((id) => [id, new Set<string>()]));
  function relation(order: string[], a: string, b: string) {
    return order.includes(a) && order.includes(b)
      ? order.indexOf(a) < order.indexOf(b)
      : undefined;
  }
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i],
        b = ids[j],
        [br, lr, rr] = orders.map((o) => relation(o, a, b));
      const rel =
        lr === undefined
          ? rr
          : rr === undefined
            ? lr
            : pick(br, lr, rr, 'Track order');
      if (rel !== undefined) edges.get(rel ? a : b)!.add(rel ? b : a);
    }
  let ordered: string[] = [];
  const pending = new Set(ids);
  while (pending.size) {
    const next = ids.find(
      (id) =>
        pending.has(id) &&
        ![...pending].some((from) => edges.get(from)!.has(id)),
    );
    if (!next) break;
    ordered.push(next);
    pending.delete(next);
  }
  if (pending.size) {
    conflicts.push('Track order');
    const preferred = orders[choice === 'remote' ? 2 : 1];
    ordered = [
      ...preferred.filter((id) => tracks.has(id)),
      ...ids.filter((id) => !preferred.includes(id)),
    ];
  }
  const project: ProjectSnapshot = {
    title: pick(base.title, local.title, remote.title, 'Project title'),
    data: {
      bpm: pick(base.data.bpm, local.data.bpm, remote.data.bpm, 'Tempo'),
      tracks: ordered.map((id) => tracks.get(id)!),
    },
  };
  if ([base, local, remote].some((p) => p.data.routing)) {
    const [b, l, r] = [base, local, remote].map((p) => routingFor(p.data));
    project.data.routing = {
      groups: GROUP_IDS.map((id) => {
        const group = [b, l, r].map((config) =>
          config.groups.find((g) => g.id === id)!,
        );
        return Object.fromEntries(
          ['id', 'name', 'volume', 'pan', 'muted', 'solo'].map((key) => [
            key,
            pick(
              (group[0] as any)[key],
              (group[1] as any)[key],
              (group[2] as any)[key],
              `${group[1].name || id} group · ${key}`,
            ),
          ]),
        );
      }),
      reverb: pick(b.reverb, l.reverb, r.reverb, 'Shared reverb level'),
      delay: pick(b.delay, l.delay, r.delay, 'Shared delay level'),
    } as MixerRouting;
  }
  // A union can exceed the server limit even when both input projects are valid.
  const tooManyTracks = project.data.tracks.length > 48;
  const tooLarge =
    JSON.stringify(project.data).length > 250000 ||
    new TextEncoder().encode(JSON.stringify(project)).length > 290000;
  const overflow = tooManyTracks || tooLarge;
  if (tooManyTracks) conflicts.push('Combined project exceeds 48 tracks');
  if (tooLarge)
    conflicts.push('Combined arrangement exceeds the save size limit');
  return { project, conflicts: [...new Set(conflicts)], details, overflow };
}
