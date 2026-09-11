import type { Arrangement, MixerTrack } from './audio';
import type { LocalTake, CompRegion } from './take-comp';
import {
  compFrames,
  MAX_TAKES,
  MAX_TAKE_BYTES,
  MAX_TAKE_SECONDS,
} from './take-comp';
import { recoverySnapshot } from './draft-recovery';
import { checkPunchTarget } from './punch-clip';
export type BankTake = Omit<LocalTake, 'blob' | 'url'> & {
  fileId: string;
  size: number;
};
export type BankData = {
  version: 1;
  title: string;
  projectId: string;
  backing: Arrangement;
  offset: number;
  target?: MixerTrack;
  takes: BankTake[];
  regions: CompRegion[];
  selected: string;
  applied: boolean;
};
export type SavedBank = {
  id: string;
  revision: number;
  updated: number;
  data: BankData;
};
export type RestoredBank = SavedBank & { originals: LocalTake[] };
export function bankProject(bank: RestoredBank, current?: any, working?: any) {
  let project = current;
  if (bank.data.projectId) {
    if (!current || current.id !== bank.data.projectId || !current.canEdit)
      throw new Error(
        'Current project editing access is required to reopen these takes.',
      );
  } else {
    const data = structuredClone(bank.data.backing);
    if (bank.data.target)
      data.tracks = data.tracks.map((t) =>
        t.id === bank.data.target!.id ? bank.data.target! : t,
      );
    project = { title: bank.data.title, data, dirty: true };
  }
  const resumed =
    project.id && working?.id === project.id && working.dirty
      ? { ...working, canEdit: project.canEdit, canManage: project.canManage }
      : project;
  let restoreWarning = '';
  if (bank.data.target) {
    try {
      checkPunchTarget(project.data, bank.data.target);
      checkPunchTarget(resumed.data, bank.data.target);
    } catch {
      restoreWarning =
        'This clip has changed in the saved project or your working arrangement. Your originals are available for download; applying this older comp is disabled to protect the current clip.';
    }
  }
  return { ...resumed, restoreBank: bank, restoreWarning };
}
export const bankId = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
export const takeId = (v: unknown): v is string =>
  v === 'original-clip' || bankId(v);
export function validateBank(value: unknown): BankData {
  const b = value as BankData;
  const fail = () => {
    throw Object.assign(
      new Error('This saved take bank has invalid or incomplete details.'),
      { status: 400 },
    );
  };
  if (
    !b ||
    b.version !== 1 ||
    typeof b.title !== 'string' ||
    !b.title.trim() ||
    b.title.length > 120 ||
    typeof b.projectId !== 'string' ||
    (b.projectId !== '' && !bankId(b.projectId)) ||
    !Number.isFinite(b.offset) ||
    b.offset < 0 ||
    b.offset >= 300 ||
    !Array.isArray(b.takes) ||
    !b.takes.length ||
    b.takes.length > MAX_TAKES ||
    !Array.isArray(b.regions) ||
    !b.regions.length ||
    b.regions.length > 64 ||
    typeof b.applied !== 'boolean'
  )
    fail();
  const backing = recoverySnapshot({ title: b.title, data: b.backing }).data;
  const ids = new Set<string>();
  let seconds = 0,
    bytes = 0;
  const takes = b.takes.map((t) => {
    if (
      !t ||
      !takeId(t.id) ||
      ids.has(t.id) ||
      !bankId(t.fileId) ||
      typeof t.name !== 'string' ||
      !t.name.trim() ||
      t.name.length > 120 ||
      ![44100, 48000].includes(t.sampleRate) ||
      ![24, 32].includes(t.depth) ||
      !Number.isFinite(t.seconds) ||
      t.seconds < 0.1 ||
      t.seconds > 120 ||
      !Number.isFinite(t.offset) ||
      t.offset < 0 ||
      t.offset + t.seconds > 300 + 1 / t.sampleRate ||
      !Number.isFinite(t.peak) ||
      t.peak < 0 ||
      !Number.isSafeInteger(t.size) ||
      t.size <= 44 ||
      t.size > 25 * 1024 * 1024 ||
      (t.correctionMs !== undefined &&
        (!Number.isFinite(t.correctionMs) ||
          t.correctionMs < 0 ||
          t.correctionMs > 500))
    )
      fail();
    if (
      (t.coverageStart !== undefined &&
        (!Number.isSafeInteger(t.coverageStart) || t.coverageStart < 0)) ||
      (t.compOrigin !== undefined &&
        (!Number.isFinite(t.compOrigin) || t.compOrigin !== b.offset)) ||
      Math.abs(t.offset - (b.offset + (t.coverageStart ?? 0) / t.sampleRate)) >
        1e-9
    )
      fail();
    ids.add(t.id);
    seconds += t.seconds;
    bytes += t.size;
    return {
      id: t.id,
      name: t.name,
      fileId: t.fileId,
      size: t.size,
      seconds: t.seconds,
      offset: t.offset,
      peak: t.peak,
      sampleRate: t.sampleRate,
      depth: t.depth,
      ...(t.correctionMs === undefined ? {} : { correctionMs: t.correctionMs }),
      ...(t.coverageStart === undefined
        ? {}
        : { coverageStart: t.coverageStart, compOrigin: b.offset }),
    };
  });
  if (
    seconds > MAX_TAKE_SECONDS + 1 / 44100 ||
    bytes > MAX_TAKE_BYTES ||
    !ids.has(b.selected)
  )
    fail();
  const regions = b.regions.map((r) => {
    if (!r) fail();
    return { takeId: r.takeId, start: r.start, end: r.end };
  });
  compFrames(regions, takes as unknown as LocalTake[]);
  let target;
  if (b.target) {
    target = recoverySnapshot({
      title: b.title,
      data: { bpm: backing.bpm, tracks: [b.target] },
    }).data.tracks[0];
    const seed = takes.find((t) => t.id === 'original-clip');
    if (
      !target.fileId ||
      target.trimStart ||
      target.trimEnd ||
      !seed ||
      seed.offset !== b.offset ||
      target.offset !== b.offset ||
      seed.coverageStart !== undefined
    )
      fail();
  } else if (ids.has('original-clip')) fail();
  const result: BankData = {
    version: 1,
    title: b.title,
    projectId: b.projectId,
    backing,
    offset: b.offset,
    takes,
    regions,
    selected: b.selected,
    applied: b.applied,
    ...(target ? { target } : {}),
  };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 260000) fail();
  return result;
}
