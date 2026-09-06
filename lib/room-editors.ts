import { one, roomAccess, fail, run } from './server';
export async function setRoomEditor(b: any, uid: string) {
  const room = await roomAccess(b.id, uid);
  if (room.owner !== uid)
    fail('Only the host can manage studio editing access.', 403);
  if (!room.project || b.project !== room.project)
    fail('The room project changed. Reload before changing access.', 409);
  if (
    b.user === uid ||
    typeof b.user !== 'string' ||
    typeof b.editable !== 'boolean'
  )
    fail('Choose a collaborator and an editing permission.');
  const allowed = `EXISTS (SELECT 1 FROM rooms r JOIN projects p ON p.id=r.project JOIN members m ON m.room=r.id WHERE r.id=? AND r.project=? AND r.owner=? AND p.owner=? AND m.user=?)`;
  if (b.editable) {
    const added = await one(
      `INSERT INTO room_editors (room,project,user,grantedBy,created) SELECT ?,?,?,?,? WHERE ${allowed} ON CONFLICT(room,project,user) DO UPDATE SET grantedBy=excluded.grantedBy,created=excluded.created RETURNING user`,
      room.id,
      room.project,
      b.user,
      uid,
      Date.now(),
      room.id,
      room.project,
      uid,
      uid,
      b.user,
    );
    if (!added) fail('This person or project is no longer in your room.', 409);
  } else {
    await run(
      `DELETE FROM room_editors WHERE room=? AND project=? AND user=? AND ${allowed}`,
      room.id,
      room.project,
      b.user,
      room.id,
      room.project,
      uid,
      uid,
      b.user,
    );
  }
  return { ok: true };
}
