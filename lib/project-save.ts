import {
  database,
  one,
  projectAccess,
  projectEditCondition,
  fail,
  str,
  readProject,
} from './server';
import { validateArrangement } from './privacy';
import { creationHash, validCreation } from './project-creation';
import { projectInstrumentFiles } from './instrument-plugins';

export async function resolveProjectCreation(key: unknown, uid: string) {
  if (!validCreation({ key, checkpoint: true }))
    fail('Invalid first-save reference.');
  const receipt = await one(
    'SELECT * FROM project_creations WHERE owner=? AND creationKey=?',
    uid,
    key,
  );
  if (!receipt) return { found: false };
  if (receipt.deletedAt !== null)
    fail('This project was deleted. Its earlier save cannot recreate it.', 410);
  const p = await projectAccess(receipt.project, uid);
  if (!p || p.owner !== uid)
    fail(
      'This project is no longer available. Its earlier save cannot recreate it.',
      410,
    );
  let project;
  try {
    project = await readProject(receipt.project, uid);
  } catch (error: any) {
    if (error.status === 403)
      fail(
        'This project is no longer available. Its earlier save cannot recreate it.',
        410,
      );
    throw error;
  }
  return {
    found: true,
    receipt: {
      key: receipt.creationKey,
      project: receipt.project,
      requestHash: receipt.requestHash,
      revision: receipt.revision,
    },
    project,
  };
}

async function replayCreation(key: string, uid: string, hash: string) {
  const resolved = await resolveProjectCreation(key, uid);
  if (!resolved.found) return null;
  if (resolved.receipt!.requestHash !== hash)
    fail(
      'This first-save reference belongs to different edits. Recover the earlier save from Browser recovery before continuing.',
      409,
    );
  return {
    id: resolved.project.id,
    revision: resolved.receipt!.revision,
    owner: uid,
    canEdit: true,
    canManage: true,
    replayed: true,
  };
}

export async function saveProject(b: any, uid: string, now: number) {
  const creation = b.creation;
  if (creation !== undefined && (b.id || !validCreation(creation)))
    fail('Invalid first-save reference.');
  let requestHash = '';
  if (creation) {
    validateArrangement(b.data);
    const snapshot = { title: str(b.title), data: b.data };
    if (JSON.stringify(b.data).length > 250000)
      fail('This arrangement is too large.');
    requestHash = await creationHash(snapshot, creation.checkpoint);
    const replay = await replayCreation(creation.key, uid, requestHash);
    if (replay) return replay;
  }
  const id = b.id || crypto.randomUUID();
  const existing = b.id ? await projectAccess(id, uid) : null;
  if (b.id && (!existing || !existing.canEdit))
    fail('You no longer have editing access to this project.', 403);
  if (
    existing &&
    (!Number.isInteger(b.baseRevision) || b.baseRevision !== existing.revision)
  )
    fail(
      'A newer version was saved. Review the latest changes before saving.',
      409,
    );
  validateArrangement(b.data);
  const title = str(b.title),
    data = JSON.stringify(b.data);
  const forkedFrom =
    typeof b.forkedFrom === 'string' && b.forkedFrom.length <= 128
      ? b.forkedFrom
      : null;
  if (data.length > 250000) fail('This arrangement is too large.');
  const references = projectInstrumentFiles(b.data);
  const files = references.map((reference) => reference.id);
  const sourcesValue = JSON.stringify(references);
  const sources = `NOT EXISTS (SELECT 1 FROM json_each(?) source WHERE NOT EXISTS (SELECT 1 FROM files f WHERE f.id=json_extract(source.value,'$.id') AND f.purpose=json_extract(source.value,'$.purpose') AND (f.owner=? OR (f.purpose='audio' AND EXISTS (SELECT 1 FROM tracks t WHERE t.fileId=f.id AND t.visibility='public' AND t.permission='collaborate')) OR EXISTS (SELECT 1 FROM project_files pf WHERE pf.project=? AND pf.file=f.id))))`;
  if (
    !creation &&
    !(await one(
      `SELECT 1 AS ok WHERE ${sources}`,
      sourcesValue,
      uid,
      id,
    ))
  )
    fail('This track does not allow collaboration.', 403);
  const owner = existing?.owner || uid,
    revision = (existing?.revision || 0) + 1;
  const receipt = crypto.randomUUID(),
    db = database();
  const success = 'EXISTS (SELECT 1 FROM projects WHERE id=? AND lastSaveId=?)';
  const statements = [
    existing
      ? db
          .prepare(
            `UPDATE projects SET title=?,data=?,updated=?,revision=?,updatedBy=?,lastSaveId=? WHERE id=? AND revision=? AND ${projectEditCondition('projects')} AND ${sources} RETURNING id`,
          )
          .bind(
            title,
            data,
            now,
            revision,
            uid,
            receipt,
            id,
            existing.revision,
            uid,
            uid,
            sourcesValue,
            uid,
            id,
          )
      : db
          .prepare(
            `INSERT INTO projects (id,owner,title,data,updated,revision,updatedBy,lastSaveId,forkedFrom) SELECT ?,?,?,?,?,?,?,?,? WHERE ${sources} ${creation ? 'AND NOT EXISTS (SELECT 1 FROM project_creations WHERE owner=? AND creationKey=?)' : ''} RETURNING id`,
          )
          .bind(
            id,
            owner,
            title,
            data,
            now,
            revision,
            uid,
            receipt,
            forkedFrom,
            sourcesValue,
            uid,
            id,
            ...(creation ? [uid, creation.key] : []),
          ),
    db
      .prepare(
        `INSERT OR IGNORE INTO project_files (project,file) SELECT ?,value FROM json_each(?) WHERE ${success}`,
      )
      .bind(id, JSON.stringify(files), id, receipt),
  ];
  if (creation)
    statements.push(
      db
        .prepare(
          `INSERT INTO project_creations (owner,creationKey,project,requestHash,revision,created) SELECT ?,?,?,?,?,? WHERE ${success}`,
        )
        .bind(uid, creation.key, id, requestHash, revision, now, id, receipt),
    );
  if ((creation?.checkpoint ?? b.checkpoint) !== false) {
    statements.push(
      db
        .prepare(
          `INSERT INTO project_versions (id,project,owner,title,data,created,author) SELECT ?,?,?,?,?,?,? WHERE ${success}`,
        )
        .bind(
          crypto.randomUUID(),
          id,
          owner,
          title,
          data,
          now,
          uid,
          id,
          receipt,
        ),
    );
    statements.push(
      db
        .prepare(
          `DELETE FROM project_versions WHERE project=? AND ${success} AND id NOT IN (SELECT id FROM project_versions WHERE project=? ORDER BY created DESC,id DESC LIMIT 20)`,
        )
        .bind(id, id, receipt, id),
    );
  }
  const results = await db.batch(statements);
  if (!results[0].results?.length) {
    if (creation) {
      const replay = await replayCreation(creation.key, uid, requestHash);
      if (replay) return replay;
    }
    if (!(await projectAccess(id, uid))?.canEdit)
      fail(
        'Your editing access ended. Your local draft has not been saved.',
        403,
      );
    fail(
      'The project or its file permissions changed. Review the latest save.',
      409,
    );
  }
  return { id, revision, owner, canEdit: true, canManage: owner === uid };
}
