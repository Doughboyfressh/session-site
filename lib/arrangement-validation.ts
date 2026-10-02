import { GROUP_IDS, validateRouting } from './mixer-routing';
import { sampleSettings } from './sample-instrument';
import { SOUNDS } from './instruments';
import { validateInstrumentPlugin } from './instrument-plugins';
import { validateDrumPattern } from './drum-pattern';
import {
  AUTOMATION_SPECS,
  AUTOMATION_TARGETS,
  MAX_AUTOMATION_POINTS_PER_LANE,
  MAX_AUTOMATION_POINTS_PER_TRACK,
  automationPointCount,
  type AutomationTarget,
} from './automation';
import {
  MAX_CLIPS_PER_PROJECT,
  MAX_CLIPS_PER_TRACK,
  PRIMARY_CLIP_ID,
} from './playlist-clips';
function fail(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}
export function validateArrangement(d: any, draft = false) {
  if (!d || !Array.isArray(d.tracks) || d.tracks.length > 48)
    fail('Keep projects within 48 tracks.');
  if (!Number.isFinite(d.bpm) || d.bpm < 40 || d.bpm > 240)
    fail('Tempo must be 40–240 BPM.');
  if (d.routing !== undefined) validateRouting(d.routing, draft);
  const ids = new Set();
  const clipIds = new Set<string>();
  let clipCount = d.tracks.length;
  for (const t of d.tracks) {
    if (!t || typeof t !== 'object') fail('Invalid track.');
    if (typeof t.id !== 'string' || ids.has(t.id))
      fail('Each track needs a unique identity.');
    ids.add(t.id);
    if (t.sound !== undefined && !SOUNDS.includes(t.sound))
      fail('Choose an available instrument.');
    if (t.plugin !== undefined) {
      try { validateInstrumentPlugin(t.plugin); }
      catch (error) { fail((error as Error).message); }
      if (!Array.isArray(t.notes) || t.fileId || t.sample || t.demo ||
        t.sequence || t.drumPattern || t.sound !== undefined)
        fail('An instrument plugin needs its own note track.');
    }
    if (
      typeof t.name !== 'string' ||
      t.name.length > 100 ||
      (!draft && !t.name.trim())
    )
      fail('Please complete the required fields.');
    if (
      t.clipName !== undefined &&
      (typeof t.clipName !== 'string' || t.clipName.length > 100)
    )
      fail('Clip names must use up to 100 characters.');
    for (const key of [
      'volume',
      'pan',
      'offset',
      'trimStart',
      'trimEnd',
      'low',
      'mid',
      'high',
    ])
      if (!Number.isFinite(t[key])) fail('Missing track control: ' + key);
    if (typeof t.muted !== 'boolean' || typeof t.solo !== 'boolean')
      fail('Invalid mute or solo control.');
    for (const [key, min, max] of [
      ['volume', 0, 1.5],
      ['pan', -1, 1],
      ['offset', 0, 300],
      ['trimStart', 0, 300],
      ['trimEnd', 0, 300],
      ['low', -12, 12],
      ['mid', -12, 12],
      ['high', -12, 12],
      ['reverb', 0, 1],
      ['delay', 0, 1],
      ['sendReverb', 0, 1],
      ['sendDelay', 0, 1],
      ['compression', 0, 1],
      ['drive', 0, 1],
      ['mod', 0, 1],
      ['modRate', 0, 1],
      ['limiter', 0, 1],
      ['pump', 0, 1],
      ['denoise', 0, 1],
      ['autoPitch', 0, 1],
      ['pitchKey', 0, 11],
      ['pitchShift', -12, 12],
      ['stretch', 0.5, 2],
      ['fadeIn', 0, 30],
      ['fadeOut', 0, 30],
      ['fadeStart', 0, 300],
      ['fadeEnd', 0, 300],
    ] as [string, number, number][]) {
      if (
        t[key] !== undefined &&
        (!Number.isFinite(t[key]) || t[key] < min || t[key] > max)
      )
        fail('Invalid track control: ' + key);
    }
    if (t.fileId && typeof t.fileId !== 'string')
      fail('Invalid audio reference.');
    if (t.sample !== undefined) {
      if (
        typeof t.fileId !== 'string' ||
        !t.fileId ||
        t.fileId.length > 128 ||
        !Array.isArray(t.notes) ||
        t.demo ||
        t.sequence ||
        t.drumPattern
      )
        fail('A sampled instrument needs one audio file and a note sequence.');
      try {
        sampleSettings(t.sample);
      } catch (e) {
        fail((e as Error).message);
      }
    }
    if (t.fileId && t.notes && !t.sample)
      fail('Choose a sample instrument before combining audio and notes.');
    if (t.drumPattern !== undefined) {
      if (t.fileId || t.sample || t.notes || t.demo || t.sequence || t.sound)
        fail('Choose one source for this drum channel.');
      try {
        validateDrumPattern(t.drumPattern);
      } catch (e) {
        fail((e as Error).message);
      }
    }
    if (t.groupId !== undefined && !GROUP_IDS.includes(t.groupId))
      fail('Choose an available mixer group or Main.');
    if (
      t.driveType !== undefined &&
      !['soft', 'hard', 'fuzz'].includes(t.driveType)
    )
      fail('Invalid drive character.');
    if (
      t.modType !== undefined &&
      !['chorus', 'flanger', 'phaser'].includes(t.modType)
    )
      fail('Invalid modulation type.');
    if (t.pitchMinor !== undefined && typeof t.pitchMinor !== 'boolean')
      fail('Invalid key scale.');
    if (t.pitchKey !== undefined && !Number.isInteger(t.pitchKey))
      fail('Choose a whole-note key.');
    if (
      t.splitFrom !== undefined &&
      (typeof t.splitFrom !== 'string' ||
        !t.splitFrom.length ||
        t.splitFrom.length > 128)
    )
      fail('Invalid split reference.');
    if (t.clips !== undefined) {
      if (!Array.isArray(t.clips) || t.clips.length > MAX_CLIPS_PER_TRACK - 1)
        fail(`Use up to ${MAX_CLIPS_PER_TRACK} clips on one channel.`);
      clipCount += t.clips.length;
      if (clipCount > MAX_CLIPS_PER_PROJECT)
        fail(`Use up to ${MAX_CLIPS_PER_PROJECT} clips in one project.`);
      for (const clip of t.clips) {
        if (
          !clip ||
          typeof clip !== 'object' ||
          typeof clip.id !== 'string' ||
          !clip.id ||
          clip.id === PRIMARY_CLIP_ID ||
          clip.id.length > 128 ||
          clipIds.has(clip.id)
        )
          fail('Each playlist clip needs a unique identity.');
        clipIds.add(clip.id);
        if (typeof clip.name !== 'string' || clip.name.length > 100)
          fail('Clip names must use up to 100 characters.');
        for (const [key, min, max] of [
          ['offset', 0, 300],
          ['trimStart', 0, 300],
          ['trimEnd', 0, 300],
          ['fadeIn', 0, 30],
          ['fadeOut', 0, 30],
          ['fadeStart', 0, 300],
          ['fadeEnd', 0, 300],
        ] as [string, number, number][]) {
          if (
            (['offset', 'trimStart', 'trimEnd'].includes(key) ||
              clip[key] !== undefined) &&
            (!Number.isFinite(clip[key]) || clip[key] < min || clip[key] > max)
          )
            fail('Invalid playlist clip control: ' + key);
        }
      }
    }
    if (
      t.noteLoopBeats !== undefined &&
      (!t.notes ||
        !Number.isInteger(t.noteLoopBeats) ||
        t.noteLoopBeats < 8 ||
        t.noteLoopBeats > 256)
    )
      fail('Instrument loop length must be 8–256 beats.');
    if (t.notes) {
      if (!Array.isArray(t.notes) || t.notes.length > 256)
        fail('Use up to 256 notes per instrument.');
      for (const n of t.notes)
        if (
          !n ||
          !Number.isInteger(n.pitch) ||
          n.pitch < 0 ||
          n.pitch > 127 ||
          !Number.isFinite(n.start) ||
          n.start < 0 ||
          n.start > 256 ||
          !Number.isFinite(n.length) ||
          n.length < 0.01 ||
          n.length > 32 ||
          !Number.isFinite(n.velocity) ||
          (t.noteLoopBeats !== undefined &&
            n.start + n.length > t.noteLoopBeats + 1e-8) ||
          n.velocity < 0 ||
          n.velocity > 1
        )
          fail('Invalid instrument note.');
    }
    function validateAutomationLane(points: any, target: AutomationTarget) {
      if (
        !Array.isArray(points) ||
        points.length > MAX_AUTOMATION_POINTS_PER_LANE
      )
        fail(
          `Use up to ${MAX_AUTOMATION_POINTS_PER_LANE} points in each automation lane.`,
        );
      const spec = AUTOMATION_SPECS[target],
        times = new Set<number>();
      for (const p of points) {
        if (
          !p ||
          typeof p !== 'object' ||
          !Number.isFinite(p.time) ||
          p.time < 0 ||
          p.time > 300 ||
          times.has(p.time) ||
          !Number.isFinite(p.value) ||
          p.value < spec.min ||
          p.value > spec.max ||
          (p.curve !== undefined && p.curve !== 'linear' && p.curve !== 'hold')
        )
          fail(`Invalid ${spec.label.toLowerCase()} automation point.`);
        times.add(p.time);
      }
    }
    if (t.automation !== undefined)
      validateAutomationLane(t.automation, 'volume');
    if (t.automationLanes !== undefined) {
      if (
        !t.automationLanes ||
        typeof t.automationLanes !== 'object' ||
        Array.isArray(t.automationLanes)
      )
        fail('Invalid automation lanes.');
      const keys = Object.keys(t.automationLanes);
      if (keys.some((key) => !AUTOMATION_TARGETS.includes(key as any)))
        fail('Choose an available automation target.');
      for (const target of AUTOMATION_TARGETS)
        if (Object.prototype.hasOwnProperty.call(t.automationLanes, target)) {
          validateAutomationLane(t.automationLanes[target], target);
        }
      const total = automationPointCount(t);
      if (total > MAX_AUTOMATION_POINTS_PER_TRACK)
        fail(
          `Use up to ${MAX_AUTOMATION_POINTS_PER_TRACK} automation points per track.`,
        );
    }
    if (
      t.sequence &&
      (!Array.isArray(t.sequence) ||
        t.sequence.length !== 3 ||
        t.sequence.some(
          (r: any) =>
            !Array.isArray(r) ||
            r.length !== 16 ||
            r.some((x: any) => x !== 0 && x !== 1),
        ))
    )
      fail('Invalid drum pattern.');
  }
  if ([...clipIds].some((id) => ids.has(id)))
    fail('Track and playlist clip identities must be unique.');
}
