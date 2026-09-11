import { env } from 'cloudflare:workers';
export function database(): D1Database {
  return (env as unknown as { DB: D1Database }).DB;
}
export function bucket(): R2Bucket {
  return (env as unknown as { FILES: R2Bucket }).FILES;
}
export async function all(sql: string, ...params: any[]) {
  return (
    await database()
      .prepare(sql)
      .bind(...params)
      .all()
  ).results as any[];
}
export async function one(sql: string, ...params: any[]) {
  return (await database()
    .prepare(sql)
    .bind(...params)
    .first()) as any;
}
export async function run(sql: string, ...params: any[]) {
  return database()
    .prepare(sql)
    .bind(...params)
    .run();
}
export function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
export function str(v: unknown, max = 120) {
  if (typeof v !== 'string' || !v.trim() || v.length > max)
    fail('Please complete the required fields.');
  return v.trim();
}
export function choice(v: unknown, options: string[]) {
  if (typeof v !== 'string' || !options.includes(v))
    fail('Choose a valid option.');
  return v as string;
}
export async function roomAccess(id: string, user: string) {
  const room = await one(
    'SELECT r.* FROM rooms r JOIN members m ON m.room=r.id WHERE r.id=? AND m.user=?',
    id,
    user,
  );
  if (!room) fail('This room is private. Ask the host for an invitation.', 403);
  return room;
}
export async function projectAccess(id: string, user: string) {
  return one(
    `SELECT p.*,${projectEditCondition('p')} AS canEdit FROM projects p WHERE p.id=? AND (p.owner=? OR EXISTS (SELECT 1 FROM rooms r JOIN members m ON r.id=m.room WHERE r.project=p.id AND m.user=?))`,
    user,
    user,
    id,
    user,
    user,
  );
}
// Alias is a fixed application identifier, never request input.
export function projectEditCondition(alias: string) {
  return `(${alias}.owner=? OR EXISTS (SELECT 1 FROM room_editors e JOIN rooms r ON r.id=e.room AND r.project=e.project JOIN members m ON m.room=e.room AND m.user=e.user WHERE e.project=${alias}.id AND e.user=? AND r.owner=${alias}.owner AND e.grantedBy=${alias}.owner))`;
}
export async function readProject(id: string, user: string) {
  const p = await projectAccess(id, user);
  if (!p) fail('Project access ended or the project is unavailable.', 403);
  const editor = p.updatedBy
    ? await one('SELECT name FROM profiles WHERE id=?', p.updatedBy)
    : null;
  const { lastSaveId: _lastSaveId, ...visible } = p;
  return {
    ...visible,
    canEdit: !!p.canEdit,
    canManage: p.owner === user,
    lastEditorName: editor?.name || 'Collaborator',
    data: JSON.parse(p.data),
  };
}
export async function fileAccess(id: string, user: string) {
  const take = await one('SELECT purpose FROM files WHERE id=?', id);
  if (take?.purpose === 'take')
    return one(
      `SELECT f.* FROM files f JOIN take_bank_files tf ON tf.file=f.id WHERE f.id=? AND f.owner=? AND tf.owner=? AND NOT EXISTS(SELECT 1 FROM take_banks b WHERE b.id=tf.bank AND b.deletedAt IS NOT NULL) AND (tf.project='' OR EXISTS(SELECT 1 FROM projects p WHERE p.id=tf.project AND ${projectEditCondition('p')}))`,
      id,
      user,
      user,
      user,
      user,
    );
  return one(
    "SELECT f.* FROM files f WHERE f.id=? AND (f.owner=? OR EXISTS (SELECT 1 FROM tracks t WHERE t.fileId=f.id AND t.visibility='public') OR EXISTS (SELECT 1 FROM profiles p WHERE p.avatar=f.id AND (p.visibility='public' OR p.id=? OR EXISTS (SELECT 1 FROM members self JOIN members other ON self.room=other.room WHERE self.user=? AND other.user=p.id))) OR EXISTS (SELECT 1 FROM project_files pf JOIN projects p ON p.id=pf.project WHERE pf.file=f.id AND (p.owner=? OR EXISTS (SELECT 1 FROM rooms r JOIN members m ON m.room=r.id WHERE r.project=p.id AND m.user=?))))",
    id,
    user,
    user,
    user,
    user,
    user,
  );
}

export async function readJSON(req: Request, max = 300000) {
  const reader = req.body?.getReader();
  if (!reader) fail('Request body required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      fail('Request is too large.', 413);
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) {
    buffer.set(part, offset);
    offset += part.length;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(buffer));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      fail('Expected a request object.');
    return parsed;
  } catch {
    fail('Invalid JSON body.');
  }
}
export async function limit(user: string, operation: string, max = 120) {
  const minute = Math.floor(Date.now() / 60000),
    id = user + ':' + operation + ':' + minute;
  const row = await one(
    'INSERT INTO rate_limits (id,count,expires) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count',
    id,
    Date.now() + 120000,
  );
  if (row.count > max) fail('Too many requests. Please wait a minute.', 429);
  if (Math.random() < 0.02)
    await run('DELETE FROM rate_limits WHERE expires<?', Date.now());
}
