import { getChatGPTUser } from '@/app/chatgpt-auth';
import { all, one, run, bucket, fail, limit, readJSON } from '@/lib/server';
import { POST as acceptUpload } from '@/app/api/upload/route';
const CHUNK = 3 * 1024 * 1024;
const cap: Record<string, number> = { audio: 25, avatar: 3, photo: 8, video: 60, take: 25, 'plugin-state': 12 };
const privateHeaders = { 'Cache-Control': 'private, no-store' };
const partKey = (id: string, part: number) => `staging/${id}/${part}`;
function uploadError(error: unknown, context: string) {
  const status = error instanceof Error ? (error as Error & { status?: number }).status : undefined;
  if (!status) console.error(context, error);
  return Response.json({ error: status && error instanceof Error ? error.message : 'Upload failed. Try again.' },
    { status: status || 503, headers: privateHeaders });
}
async function cleanup(id: string, parts: number) {
  for (let part = 0; part < parts; part++) await bucket().delete(partKey(id, part));
  await run('DELETE FROM upload_sessions WHERE id=?', id);
}
export async function POST(req: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) fail('Sign in to upload music.', 401);
    if (req.headers.get('origin') !== new URL(req.url).origin) fail('Request not allowed.', 403);
    await limit(user.userId, 'upload-session', 30);
    const body = await readJSON(req, 4000);
    if (body.operation === 'start') {
      const expired = await all("UPDATE upload_sessions SET status='cleaning' WHERE owner=? AND expires<? RETURNING id,parts", user.userId, Date.now());
      for (const row of expired) await cleanup(row.id, row.parts);
      if (typeof body.purpose !== 'string' || !Object.hasOwn(cap, body.purpose) || !Number.isSafeInteger(body.size) || body.size < 1 ||
        body.size > cap[body.purpose] * 1024 * 1024 || typeof body.name !== 'string' || body.name.length > 180)
        fail('Choose a supported file within the upload limit.', 413);
      for (const field of ['projectId', 'bankId', 'takeId'])
        if (body[field] !== undefined && (typeof body[field] !== 'string' || body[field].length > 100))
          fail('Invalid upload reference.');
      const id = crypto.randomUUID();
      const parts = Math.ceil(body.size / CHUNK);
      const metadata = JSON.stringify({ name: body.name, purpose: body.purpose,
        projectId: body.projectId || '', bankId: body.bankId || '', takeId: body.takeId || '' });
      const result = await run(`INSERT INTO upload_sessions(id,owner,metadata,size,parts,expires)
        SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM upload_sessions WHERE owner=?)
        AND (SELECT COALESCE(SUM(size),0) FROM files WHERE owner=?) + ? <= ?`,
        id, user.userId, metadata, body.size, parts, Date.now() + 15 * 60000,
        user.userId, user.userId, body.size, 500 * 1024 * 1024);
      if (!result.meta.changes) fail('Finish your current upload or check your storage space.', 409);
      return Response.json({ id, chunkSize: CHUNK, parts }, { headers: privateHeaders });
    }
    if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/.test(body.id)) fail('Invalid upload reference.');
    const row = await one('SELECT * FROM upload_sessions WHERE id=? AND owner=?', body.id, user.userId);
    if (!row) fail('Upload session unavailable.', 404);
    if (body.operation === 'cancel') {
      const cancelled = await run("UPDATE upload_sessions SET status='cleaning' WHERE id=? AND owner=? AND status='pending'", row.id, user.userId);
      if (!cancelled.meta.changes) fail('Upload is already being saved.', 409);
      await cleanup(row.id, row.parts);
      return Response.json({ cancelled: true }, { headers: privateHeaders });
    }
    if (body.operation !== 'complete' || row.expires < Date.now()) fail('Upload expired. Start again.', 409);
    const locked = await run("UPDATE upload_sessions SET status='finalizing',expires=? WHERE id=? AND owner=? AND status='pending'", Date.now() + 15 * 60000, row.id, user.userId);
    if (!locked.meta.changes) fail('Upload is already being saved.', 409);
    try {
      const buffers: Uint8Array[] = [];
      for (let part = 0; part < row.parts; part++) {
        const object = await bucket().get(partKey(row.id, part));
        if (!object) fail('Upload is incomplete. Try again.', 409);
        const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
        const expected = Math.min(CHUNK, row.size - part * CHUNK);
        if (bytes.length !== expected) fail('Upload size did not match.', 409);
        buffers.push(bytes);
      }
      const metadata = JSON.parse(row.metadata);
      const form = new FormData();
      form.set('file', new File(buffers as BlobPart[], metadata.name));
      for (const field of ['purpose', 'projectId', 'bankId', 'takeId'])
        if (metadata[field]) form.set(field, metadata[field]);
      return await acceptUpload(new Request(new URL('/api/upload', req.url), {
        method: 'POST', headers: { origin: new URL(req.url).origin }, body: form, signal: req.signal,
      }));
    } finally { await cleanup(row.id, row.parts).catch(error => console.error('Pending upload cleanup', error)); }
  } catch (error) {
    return uploadError(error, 'Upload session failed');
  }
}
export async function PUT(req: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) fail('Sign in to upload music.', 401);
    if (req.headers.get('origin') !== new URL(req.url).origin) fail('Request not allowed.', 403);
    await limit(user.userId, 'upload-part', 120);
    const url = new URL(req.url), id = url.searchParams.get('id'), part = Number(url.searchParams.get('part'));
    if (!id || !/^[0-9a-f-]{36}$/.test(id) || !Number.isSafeInteger(part) || part < 0) fail('Invalid upload reference.');
    const row = await one("UPDATE upload_sessions SET status='uploading',expires=? WHERE id=? AND owner=? AND status='pending' AND expires>? AND parts>? RETURNING *", Date.now() + 15 * 60000, id, user.userId, Date.now(), part);
    if (!row) fail('Upload session unavailable.', 404);
    try {
    const reader = req.body?.getReader();
    if (!reader) fail('Upload body required.');
    const pieces: Uint8Array[] = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > CHUNK) { await reader.cancel(); fail('Upload chunk too large.', 413); }
      pieces.push(value);
    }
    if (size !== Math.min(CHUNK, row.size - part * CHUNK)) fail('Upload chunk size did not match.');
    // The deterministic part key bounds repeated writes to the reserved upload size.
    await bucket().put(partKey(id, part), new Uint8Array(await new Blob(pieces as BlobPart[]).arrayBuffer()));
    return Response.json({ saved: true }, { headers: privateHeaders });
    } finally {
      await run("UPDATE upload_sessions SET status='pending' WHERE id=? AND owner=? AND status='uploading'", id, user.userId);
    }
  } catch (error) {
    return uploadError(error, 'Upload part failed');
  }
}
