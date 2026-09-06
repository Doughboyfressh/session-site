import {
  database,
  one,
  projectAccess,
  projectEditCondition,
  fail,
  str,
} from './server';
import { validateArrangement } from './privacy';

export async function saveProject(b: any, uid: string, now: number) {
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
  if (data.length > 250000) fail('This arrangement is too large.');
  const files = [
    ...new Set(b.data.tracks.map((t: any) => t.fileId).filter(Boolean)),
  ] as string[];
  const sources = `NOT EXISTS (SELECT 1 FROM json_each(?) source WHERE NOT EXISTS (SELECT 1 FROM files f WHERE f.id=source.value AND (f.owner=? OR EXISTS (SELECT 1 FROM tracks t WHERE t.fileId=f.id AND t.visibility='public' AND t.permission='collaborate') OR EXISTS (SELECT 1 FROM project_files pf WHERE pf.project=? AND pf.file=f.id))))`;
  if (
    !(await one(
      `SELECT 1 AS ok WHERE ${sources}`,
      JSON.stringify(files),
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
            JSON.stringify(files),
            uid,
            id,
          )
      : db
          .prepare(
            `INSERT INTO projects (id,owner,title,data,updated,revision,updatedBy,lastSaveId) SELECT ?,?,?,?,?,?,?,? WHERE ${sources} RETURNING id`,
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
            JSON.stringify(files),
            uid,
            id,
          ),
    db
      .prepare(
        `INSERT OR IGNORE INTO project_files (project,file) SELECT ?,value FROM json_each(?) WHERE ${success}`,
      )
      .bind(id, JSON.stringify(files), id, receipt),
  ];
  if (b.checkpoint !== false) {
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
