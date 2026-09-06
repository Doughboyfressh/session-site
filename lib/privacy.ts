import { all, one, run, database, bucket, fail } from './server';
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
      firstSaveReceipts:
        'SELECT creationKey,project,revision,created,deletedAt FROM project_creations WHERE owner=?',
      saved: 'SELECT * FROM saved WHERE user=?',
      following: 'SELECT * FROM follows WHERE user=?',
      comments: 'SELECT * FROM comments WHERE user=?',
      reports: 'SELECT * FROM reports WHERE user=?',
      memberships: 'SELECT room,seen FROM members WHERE user=?',
      editingPermissions:
        'SELECT room,project,grantedBy,created FROM room_editors WHERE user=?',
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
export { validateArrangement } from './arrangement-validation';
