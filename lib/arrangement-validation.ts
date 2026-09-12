import { GROUP_IDS, validateRouting } from './mixer-routing';
import { sampleSettings } from './sample-instrument';
function fail(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}
export function validateArrangement(d: any, draft = false) {
  if (!d || !Array.isArray(d.tracks) || d.tracks.length > 32)
    fail('Keep projects within 32 tracks.');
  if (!Number.isFinite(d.bpm) || d.bpm < 40 || d.bpm > 240)
    fail('Tempo must be 40–240 BPM.');
  if (d.routing !== undefined) validateRouting(d.routing, draft);
  const ids = new Set();
  for (const t of d.tracks) {
    if (!t || typeof t !== 'object') fail('Invalid track.');
    if (typeof t.id !== 'string' || ids.has(t.id))
      fail('Each track needs a unique identity.');
    ids.add(t.id);
    if (
      typeof t.name !== 'string' ||
      t.name.length > 100 ||
      (!draft && !t.name.trim())
    )
      fail('Please complete the required fields.');
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
        t.sequence
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
    if (t.groupId !== undefined && !GROUP_IDS.includes(t.groupId))
      fail('Choose an available mixer group or Main.');
    if (
      t.splitFrom !== undefined &&
      (typeof t.splitFrom !== 'string' ||
        !t.splitFrom.length ||
        t.splitFrom.length > 128)
    )
      fail('Invalid split reference.');
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
          n.velocity < 0 ||
          n.velocity > 1
        )
          fail('Invalid instrument note.');
    }
    if (t.automation) {
      if (!Array.isArray(t.automation) || t.automation.length > 64)
        fail('Use up to 64 automation points.');
      for (const p of t.automation)
        if (
          !p ||
          !Number.isFinite(p.time) ||
          p.time < 0 ||
          p.time > 300 ||
          !Number.isFinite(p.value) ||
          p.value < 0 ||
          p.value > 1
        )
          fail('Invalid automation point.');
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
}
