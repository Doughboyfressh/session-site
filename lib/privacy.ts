import { all, one, run, database, bucket, fail, str } from './server';
export async function privacyAction(b: any, uid: string) {
  if (b.action === 'projectVersions') {
    const p = await one(
      'SELECT id FROM projects WHERE id=? AND owner=?',
      b.id,
      uid,
    );
    if (!p) fail('Project unavailable.', 404);
    return all(
      'SELECT * FROM project_versions WHERE project=? ORDER BY created DESC LIMIT 20',
      b.id,
    );
  }
  if (b.action === 'myFiles')
    return all(
      'SELECT f.*,(SELECT COUNT(*) FROM project_files pf WHERE pf.file=f.id) AS projects FROM files f WHERE owner=? ORDER BY created DESC LIMIT 500',
      uid,
    );
  if (b.action === 'exportData') {
    const result: any = {
      exportedAt: new Date().toISOString(),
      format: 'SESSION account export v1',
    };
    for (const [key, sql] of Object.entries({
      profile: 'SELECT * FROM profiles WHERE id=?',
      files:
        'SELECT id,name,mime,size,purpose,created FROM files WHERE owner=?',
      tracks: 'SELECT * FROM tracks WHERE owner=?',
      projects: 'SELECT * FROM projects WHERE owner=?',
      versions: 'SELECT * FROM project_versions WHERE owner=?',
      saved: 'SELECT * FROM saved WHERE user=?',
      following: 'SELECT * FROM follows WHERE user=?',
      comments: 'SELECT * FROM comments WHERE user=?',
      reports: 'SELECT * FROM reports WHERE user=?',
      memberships: 'SELECT room,seen FROM members WHERE user=?',
    }))
      result[key] = await all(sql, uid);
    return result;
  }
  if (b.action === 'eraseFile') {
    if (b.confirm !== 'ERASE')
      fail('Type ERASE to permanently delete this file.');
    const file = await one(
      'SELECT * FROM files WHERE id=? AND owner=?',
      b.id,
      uid,
    );
    if (!file) fail('File unavailable.', 404);
    await bucket().delete(file.id);
    await database().batch([
      database()
        .prepare(
          'DELETE FROM saved WHERE track IN (SELECT id FROM tracks WHERE fileId=?)',
        )
        .bind(file.id),
      database()
        .prepare(
          'DELETE FROM comments WHERE track IN (SELECT id FROM tracks WHERE fileId=?)',
        )
        .bind(file.id),
      database().prepare('DELETE FROM tracks WHERE fileId=?').bind(file.id),
      database()
        .prepare('UPDATE profiles SET avatar=NULL WHERE avatar=?')
        .bind(file.id),
      database()
        .prepare('DELETE FROM project_files WHERE file=?')
        .bind(file.id),
      database()
        .prepare('DELETE FROM files WHERE id=? AND owner=?')
        .bind(file.id, uid),
    ]);
    return { ok: true };
  }
  return null;
}
export function validateArrangement(d: any) {
  if (!d || !Array.isArray(d.tracks) || d.tracks.length > 32)
    fail('Keep projects within 32 tracks.');
  if (!Number.isFinite(d.bpm) || d.bpm < 40 || d.bpm > 240)
    fail('Tempo must be 40–240 BPM.');
  const ids = new Set();
  for (const t of d.tracks) {
    if (!t || typeof t !== 'object') fail('Invalid track.');
    if (typeof t.id !== 'string' || ids.has(t.id))
      fail('Each track needs a unique identity.');
    ids.add(t.id);
    str(t.name, 100);
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
      ['compression', 0, 1],
      ['fadeIn', 0, 30],
      ['fadeOut', 0, 30],
    ] as [string, number, number][]) {
      if (
        t[key] !== undefined &&
        (!Number.isFinite(t[key]) || t[key] < min || t[key] > max)
      )
        fail('Invalid track control: ' + key);
    }
    if (t.fileId && typeof t.fileId !== 'string')
      fail('Invalid audio reference.');
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
