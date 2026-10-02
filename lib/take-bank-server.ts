import {
  all,
  one,
  run,
  database,
  bucket,
  fail,
  projectEditCondition,
} from './server';
import { bankId, takeId, validateBank } from './take-bank';
import { projectInstrumentFiles } from './instrument-plugins';

const projectGuard = `( ?='' OR EXISTS (SELECT 1 FROM projects p WHERE p.id=? AND ${projectEditCondition('p')}))`;
const args = (project: string, uid: string) => [project, project, uid, uid];
export async function uploadBankTake(
  req: Request,
  form: FormData,
  file: File,
  uid: string,
) {
  const bank = form.get('bankId'),
    take = form.get('takeId'),
    project = String(form.get('projectId') || '');
  if (!bankId(bank) || !takeId(take) || (project && !bankId(project)))
    fail('Invalid take upload reference.');
  if (!(await one(`SELECT 1 WHERE ${projectGuard}`, ...args(project, uid))))
    fail('Project editing access ended.', 403);
  const existingBank = await one(
    'SELECT owner,project,deletedAt FROM take_banks WHERE id=?',
    bank,
  );
  if (
    existingBank &&
    (existingBank.owner !== uid ||
      existingBank.project !== project ||
      existingBank.deletedAt !== null)
  )
    fail('This take bank is unavailable.', 409);
  // Accept only the bounded, mono WAV layouts emitted by SESSION's recorder.
  const header = new DataView(await file.slice(0, 58).arrayBuffer());
  const word = (at: number, n: number) =>
    String.fromCharCode(...new Uint8Array(header.buffer, at, n));
  if (
    header.byteLength < 44 ||
    word(0, 4) !== 'RIFF' ||
    word(8, 4) !== 'WAVE' ||
    word(12, 4) !== 'fmt '
  )
    fail('Use an original SESSION recording.');
  const rate = header.getUint32(24, true),
    depth = header.getUint16(34, true),
    start = depth === 32 ? 58 : 44;
  if (
    ![44100, 48000].includes(rate) ||
    ![24, 32].includes(depth) ||
    header.byteLength < start ||
    header.getUint16(22, true) !== 1 ||
    header.getUint16(20, true) !== (depth === 32 ? 3 : 1) ||
    header.getUint32(16, true) !== (depth === 32 ? 18 : 16) ||
    header.getUint16(32, true) !== depth / 8 ||
    header.getUint32(28, true) !== (rate * depth) / 8 ||
    word(start - 8, 4) !== 'data' ||
    header.getUint32(4, true) !== file.size - 8
  )
    fail('The take WAV format is invalid.');
  const size = header.getUint32(start - 4, true),
    frames = size / (depth / 8);
  if (
    !Number.isSafeInteger(frames) ||
    frames < rate * 0.1 ||
    frames > rate * 120 ||
    file.size !== start + size + (size & 1)
  )
    fail('The take WAV length is invalid.');
  if (
    depth === 32 &&
    (header.getUint16(36, true) !== 0 ||
      word(38, 4) !== 'fact' ||
      header.getUint32(42, true) !== 4 ||
      header.getUint32(46, true) !== frames)
  )
    fail('The take WAV header is invalid.');
  const bytes = await file.arrayBuffer();
  if (depth === 32) {
    const pcm = new DataView(bytes);
    for (let at = start; at < start + size; at += 4)
      if (!Number.isFinite(pcm.getFloat32(at, true)))
        fail('The take contains invalid audio samples.');
  }
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
  const replay = async () => {
    const old = await one(
      `SELECT tf.* FROM take_bank_files tf JOIN files f ON f.id=tf.file JOIN take_banks b ON b.id=tf.bank WHERE tf.bank=? AND tf.take=? AND b.deletedAt IS NULL AND ${projectGuard}`,
      bank,
      take,
      ...args(project, uid),
    );
    if (!old) return null;
    if (old.owner !== uid || old.project !== project || old.hash !== hash)
      fail('This take reference belongs to different audio.', 409);
    return { id: old.file };
  };
  const prior = await replay();
  if (prior) return prior;
  const id = crypto.randomUUID(),
    now = Date.now();
  if (req.signal.aborted) fail('Upload cancelled.', 499);
  await bucket().put(id, file.stream(), {
    httpMetadata: { contentType: 'audio/wav' },
  });
  try {
    if (req.signal.aborted) fail('Upload cancelled.', 499);
    const guard = `${projectGuard} AND NOT EXISTS (SELECT 1 FROM take_banks WHERE id=? AND (owner<>? OR project<>? OR deletedAt IS NOT NULL)) AND NOT EXISTS (SELECT 1 FROM take_bank_files WHERE bank=? AND (owner<>? OR project<>?))`;
    const db = database();
    const results = await db.batch([
      db
        .prepare(
          `INSERT OR IGNORE INTO take_banks(id,owner,project,title,data,revision,updated,lastSaveId) SELECT ?,?,?,'Incomplete upload','{}',0,?,'' WHERE (SELECT COUNT(*) FROM take_banks WHERE owner=? AND deletedAt IS NULL)<20 AND ${projectGuard}`,
        )
        .bind(bank, uid, project, now, uid, ...args(project, uid)),
      db
        .prepare(
          `INSERT INTO files(id,owner,name,mime,size,purpose,created) SELECT ?,?,?,'audio/wav',?,'take',? WHERE (SELECT COALESCE(SUM(size),0) FROM files WHERE owner=?)+?<=? AND (SELECT COUNT(*) FROM take_bank_files WHERE bank=?)<64 AND (SELECT COALESCE(SUM(size),0) FROM take_bank_files WHERE bank=?)+?<=? AND EXISTS(SELECT 1 FROM take_banks WHERE id=? AND owner=?) AND ${guard} RETURNING id`,
        )
        .bind(
          id,
          uid,
          file.name.slice(0, 180),
          file.size,
          now,
          uid,
          file.size,
          500 * 1024 * 1024,
          bank,
          bank,
          file.size,
          240 * 1024 * 1024,
          bank,
          uid,
          ...args(project, uid),
          bank,
          uid,
          project,
          bank,
          uid,
          project,
        ),
      db
        .prepare(
          `INSERT INTO take_bank_files(bank,take,owner,project,file,hash,size,frames,sampleRate,depth,created) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM files WHERE id=?)`,
        )
        .bind(
          bank,
          take,
          uid,
          project,
          id,
          hash,
          file.size,
          frames,
          rate,
          depth,
          now,
          id,
        ),
    ]);
    if (!results[1].results?.length)
      fail(
        'Upload could not be accepted. Check storage space and project access. Older uploaded takes remain until their bank is deleted.',
        409,
      );
  } catch (e) {
    await bucket().delete(id);
    const old = await replay();
    if (old) return old;
    throw e;
  }
  return { id };
}

export async function takeBankAction(b: Record<string, unknown>, uid: string) {
  if (b.action === 'takeBanks')
    return all(
      "SELECT id,title,project,revision,updated,deletedAt,json_array_length(data,'$.takes') AS takeCount,(SELECT COALESCE(SUM(size),0) FROM take_bank_files tf WHERE tf.bank=take_banks.id) AS bytes FROM take_banks WHERE owner=? AND (deletedAt IS NULL OR data<>'{}') ORDER BY updated DESC LIMIT 40",
      uid,
    );
  if (!bankId(b.id)) fail('Invalid take bank reference.');
  const old = await one(
    'SELECT * FROM take_banks WHERE id=? AND owner=?',
    b.id,
    uid,
  );
  if (b.action === 'takeBankRead') {
    if (!old || old.deletedAt !== null || old.revision === 0)
      fail(
        'This upload has no saved comp yet. Retry from the original recorder or delete the incomplete bank.',
        404,
      );
    if (
      !(await one(`SELECT 1 WHERE ${projectGuard}`, ...args(old.project, uid)))
    )
      fail(
        'Project editing access is unavailable. Your saved bank is kept private; ask the owner to restore access.',
        403,
      );
    return {
      id: old.id,
      revision: old.revision,
      updated: old.updated,
      data: validateBank(JSON.parse(old.data)),
    };
  }
  if (b.action === 'takeBankDelete') {
    if (!old) fail('Saved takes unavailable.', 404);
    if (old.deletedAt === null && b.baseRevision !== old.revision)
      fail('The bank changed. Refresh before deleting it.', 409);
    const db = database();
    if (old.deletedAt === null) {
      const result = await run(
        "UPDATE take_banks SET deletedAt=?,updated=?,revision=revision+1,data=json_object('eraseFiles',(SELECT json_group_array(file) FROM take_bank_files WHERE bank=?)) WHERE id=? AND owner=? AND revision=? AND deletedAt IS NULL",
        Date.now(),
        Date.now(),
        b.id,
        b.id,
        uid,
        old.revision,
      );
      if (!result.meta.changes)
        fail('The bank changed. Refresh before deleting it.', 409);
    }
    const pending = await one(
      'SELECT data FROM take_banks WHERE id=? AND owner=?',
      b.id,
      uid,
    );
    const ids = JSON.parse(pending.data).eraseFiles || [];
    for (const id of ids) await bucket().delete(id);
    await db.batch([
      db
        .prepare(
          "DELETE FROM files WHERE owner=? AND purpose='take' AND id IN(SELECT file FROM take_bank_files WHERE bank=? AND owner=?)",
        )
        .bind(uid, b.id, uid),
      db
        .prepare('DELETE FROM take_bank_files WHERE bank=? AND owner=?')
        .bind(b.id, uid),
      db
        .prepare(
          "UPDATE take_banks SET data='{}' WHERE id=? AND owner=? AND deletedAt IS NOT NULL",
        )
        .bind(b.id, uid),
    ]);
    return { ok: true };
  }
  if (b.action !== 'takeBankSave') fail('Unknown saved-take operation.');
  if (
    !Number.isSafeInteger(b.baseRevision) ||
    Number(b.baseRevision) < 0 ||
    !bankId(b.saveId)
  )
    fail('Invalid save reference.');
  const data = validateBank(b.data),
    json = JSON.stringify(data),
    now = Date.now();
  if (old?.deletedAt !== undefined && old.deletedAt !== null)
    fail(
      'This take bank was deleted. It cannot be recreated by an old save.',
      410,
    );
  if (old && old.project !== data.projectId)
    fail('A take bank cannot change projects.', 409);
  if (
    !(await one(`SELECT 1 WHERE ${projectGuard}`, ...args(data.projectId, uid)))
  )
    fail('Project editing access ended. Download your local takes.', 403);
  if (old?.lastSaveId === b.saveId) {
    if (old.data !== json)
      fail('This save reference belongs to different edits.', 409);
    return { id: old.id, revision: old.revision, updated: old.updated };
  }
  const originalGuard = `NOT EXISTS(SELECT 1 FROM json_each(?) t WHERE NOT EXISTS(SELECT 1 FROM take_bank_files tf JOIN files f ON f.id=tf.file WHERE tf.bank=? AND tf.owner=? AND tf.project=? AND tf.take=json_extract(t.value,'$.id') AND tf.file=json_extract(t.value,'$.fileId') AND tf.size=json_extract(t.value,'$.size') AND tf.sampleRate=json_extract(t.value,'$.sampleRate') AND tf.depth=json_extract(t.value,'$.depth') AND tf.frames=CAST(round(json_extract(t.value,'$.seconds')*tf.sampleRate) AS INTEGER) AND f.purpose='take' AND f.owner=?))`;
  const sourceGuard = `NOT EXISTS(SELECT 1 FROM json_each(?) s WHERE NOT EXISTS(SELECT 1 FROM files f WHERE f.id=json_extract(s.value,'$.id') AND f.purpose=json_extract(s.value,'$.purpose') AND (f.owner=? OR (f.purpose='audio' AND EXISTS(SELECT 1 FROM tracks t WHERE t.fileId=f.id AND t.visibility='public' AND t.permission='collaborate')) OR EXISTS(SELECT 1 FROM project_files pf WHERE pf.file=f.id AND pf.project=?))))`;
  const sources = projectInstrumentFiles({ bpm: data.backing.bpm,
    tracks: [...data.backing.tracks, ...(data.target ? [data.target] : [])] });
  const bindings = [
    ...args(data.projectId, uid),
    JSON.stringify(data.takes),
    b.id,
    uid,
    data.projectId,
    uid,
    JSON.stringify(sources),
    uid,
    data.projectId,
  ];
  let saved;
  if (old) {
    saved = await run(
      `UPDATE take_banks SET title=?,data=?,revision=revision+1,updated=?,lastSaveId=? WHERE id=? AND owner=? AND revision=? AND deletedAt IS NULL AND ${projectGuard} AND ${originalGuard} AND ${sourceGuard}`,
      data.title,
      json,
      now,
      b.saveId,
      b.id,
      uid,
      b.baseRevision,
      ...bindings,
    );
  } else {
    if (b.baseRevision !== 0)
      fail('The bank is missing. Your local takes are unchanged.', 409);
    saved = await run(
      `INSERT OR IGNORE INTO take_banks(id,owner,project,title,data,revision,updated,lastSaveId) SELECT ?,?,?,?,?,1,?,? WHERE (SELECT COUNT(*) FROM take_banks WHERE owner=? AND deletedAt IS NULL)<20 AND ${projectGuard} AND ${originalGuard} AND ${sourceGuard}`,
      b.id,
      uid,
      data.projectId,
      data.title,
      json,
      now,
      b.saveId,
      uid,
      ...bindings,
    );
  }
  if (!saved.meta.changes) {
    const winner = await one(
      'SELECT revision,updated,lastSaveId,data FROM take_banks WHERE id=? AND owner=? AND deletedAt IS NULL',
      b.id,
      uid,
    );
    if (winner?.lastSaveId === b.saveId && winner.data === json)
      return { id: b.id, revision: winner.revision, updated: winner.updated };
    fail(
      'Saved takes changed, access ended, or storage is full. Your local takes are unchanged. Reopen the latest bank before replacing it.',
      409,
    );
  }
  return { id: b.id, revision: Number(b.baseRevision) + 1, updated: now };
}
