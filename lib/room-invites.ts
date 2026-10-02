import { all, choice, database, fail, one, roomAccess, str } from './server';
import { prepareNotification } from './social-server';

const keyPrefix = (room: { id: string; invite: string }) =>
  `room-invite:${room.id}:${room.invite}:`;
const currentKey =
  "('room-invite:' || r.id || ':' || r.invite || ':' || n.user)";
const unblocked = `NOT EXISTS (SELECT 1 FROM user_blocks b
  WHERE (b.user=n.user AND b.target=r.owner) OR (b.user=r.owner AND b.target=n.user))`;
const validInvite = `n.resourceType='room_invite' AND n.actor=r.owner
  AND n.uniqueKey=${currentKey} AND r.expires>? AND ${unblocked}`;

// Activity never exposes the bearer token or notification uniqueness key.
export const roomInviteActivityFields = `r.title AS roomTitle,
  CASE WHEN n.resourceType<>'room_invite' THEN NULL
    WHEN n.kind='room_invite_declined' THEN 'declined'
    WHEN r.id IS NULL OR n.actor<>r.owner THEN 'unavailable'
    WHEN EXISTS (SELECT 1 FROM members m WHERE m.room=r.id AND m.user=n.user) THEN 'joined'
    WHEN n.uniqueKey<>${currentKey} OR r.expires<=? THEN 'expired'
    WHEN n.kind<>'room_invite' OR NOT (${unblocked}) THEN 'unavailable'
    WHEN (SELECT COUNT(*) FROM members m WHERE m.room=r.id)>=4 THEN 'full'
    ELSE 'pending' END AS inviteStatus,
  CASE WHEN n.resourceType='room_invite' THEN r.expires ELSE NULL END AS inviteExpires`;

export async function roomInviteAction(
  body: Record<string, unknown>,
  uid: string,
) {
  const now = Date.now();
  if (body.action === 'respondRoomInvite') {
    const id = str(body.id, 80);
    const response = choice(body.response, ['accepted', 'declined']);
    const notice = await one(
      "SELECT * FROM notifications WHERE id=? AND user=? AND resourceType='room_invite'",
      id,
      uid,
    );
    if (!notice) fail('Session invitation unavailable.', 404);
    if (response === 'declined') {
      const [changed] = await database().batch([
        database()
          .prepare(
            "UPDATE notifications SET kind='room_invite_declined',readAt=COALESCE(readAt,?) WHERE id=? AND user=? AND kind='room_invite'",
          )
          .bind(now, id, uid),
      ]);
      if (!changed.meta.changes && notice.kind !== 'room_invite_declined')
        fail('This invitation has already changed. Refresh your alerts.', 409);
      return { status: 'declined' };
    }
    if (notice.kind === 'room_invite_declined')
      fail('This invitation was declined.', 403);
    // An existing member can reopen a session after its link expires or rotates.
    if (
      await one(
        'SELECT r.id FROM rooms r JOIN members m ON m.room=r.id WHERE r.id=? AND r.owner=? AND m.user=?',
        notice.resourceId,
        notice.actor,
        uid,
      )
    )
      return { id: notice.resourceId, status: 'joined' };
    const [_, joined] = await database().batch([
      database()
        .prepare(
          `INSERT OR IGNORE INTO members (room,user,seen)
        SELECT r.id,n.user,? FROM rooms r JOIN notifications n ON n.resourceId=r.id
        WHERE n.id=? AND n.user=? AND n.kind='room_invite' AND ${validInvite}
          AND (SELECT COUNT(*) FROM members m WHERE m.room=r.id)<4`,
        )
        .bind(now, id, uid, now),
      database()
        .prepare(
          `UPDATE notifications SET kind='room_invite_joined',readAt=COALESCE(readAt,?)
        WHERE id=? AND user=? AND kind='room_invite'
          AND EXISTS (SELECT 1 FROM rooms r JOIN members m ON m.room=r.id
            WHERE r.id=notifications.resourceId AND m.user=notifications.user
              AND r.owner=notifications.actor AND notifications.uniqueKey=('room-invite:' || r.id || ':' || r.invite || ':' || notifications.user)
              AND r.expires>?)`,
        )
        .bind(now, id, uid, now),
    ]);
    if (!joined.meta.changes) {
      if (
        await one(
          'SELECT r.id FROM rooms r JOIN members m ON m.room=r.id WHERE r.id=? AND r.owner=? AND m.user=?',
          notice.resourceId,
          notice.actor,
          uid,
        )
      )
        return { id: notice.resourceId, status: 'joined' };
      const current = await one(
        `SELECT r.id FROM rooms r JOIN notifications n ON n.resourceId=r.id
        WHERE n.id=? AND n.user=? AND n.kind='room_invite' AND ${validInvite}`,
        id,
        uid,
        now,
      );
      if (!current)
        fail(
          'This invitation expired or was replaced. Ask the host for another invite.',
          403,
        );
      fail('This session is full. Try again when a seat opens.', 409);
    }
    return { id: notice.resourceId, status: 'joined' };
  }

  const room = await roomAccess(str(body.id, 120), uid);
  if (room.owner !== uid)
    fail('Only the host can invite people to this session.', 403);
  if (body.action === 'roomInviteCandidates') {
    if (body.query !== undefined && typeof body.query !== 'string')
      fail('Enter a name or username.');
    const query = String(body.query || '')
      .trim()
      .replace(/^@/, '')
      .slice(0, 80)
      .toLowerCase();
    const like = '%' + query.replace(/[\\%_]/g, '\\$&') + '%';
    const profiles = await all(
      `SELECT p.id,p.name,p.username,p.avatar,
        CASE n.kind WHEN 'room_invite' THEN 'pending' WHEN 'room_invite_declined' THEN 'declined' ELSE NULL END AS inviteStatus
      FROM profiles p LEFT JOIN notifications n ON n.uniqueKey=? || p.id AND n.user=p.id AND n.resourceType='room_invite'
      WHERE p.visibility='public' AND p.id<>?
        AND (LOWER(p.name) LIKE ? ESCAPE '\\' OR LOWER(p.username) LIKE ? ESCAPE '\\')
        AND NOT EXISTS (SELECT 1 FROM members m WHERE m.room=? AND m.user=p.id)
        AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.user=? AND b.target=p.id) OR (b.user=p.id AND b.target=?))
      ORDER BY CASE WHEN EXISTS (SELECT 1 FROM follows f WHERE f.user=? AND f.target=p.id) THEN 0 ELSE 1 END,p.name,p.id LIMIT 16`,
      keyPrefix(room),
      uid,
      like,
      like,
      room.id,
      uid,
      uid,
      uid,
    );
    const count = await one(
      'SELECT COUNT(*) AS count FROM members WHERE room=?',
      room.id,
    );
    return {
      profiles,
      memberCount: Number(count.count),
      expires: Number(room.expires),
      expired: Number(room.expires) <= now,
    };
  }

  const recipient = str(body.recipient, 120);
  if (recipient === uid) fail('Choose another SESSION member.');
  if (Number(room.expires) <= now)
    fail(
      'Invitations expired. Refresh invitations before sending another.',
      409,
    );
  const uniqueKey = keyPrefix(room) + recipient;
  const message = `invited you to join “${room.title}”`;
  const sendGuard = `EXISTS (SELECT 1 FROM rooms r WHERE r.id=? AND r.owner=? AND r.invite=? AND r.expires>?
    AND (SELECT COUNT(*) FROM members m WHERE m.room=r.id)<4
    AND NOT EXISTS (SELECT 1 FROM members m WHERE m.room=r.id AND m.user=?)
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.id=? AND p.visibility='public')
    AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.user=? AND b.target=?) OR (b.user=? AND b.target=?)))`;
  const sendValues = [
    room.id,
    uid,
    room.invite,
    now,
    recipient,
    recipient,
    uid,
    recipient,
    recipient,
    uid,
  ];
  const [sent, reissued] = await database().batch([
    prepareNotification(
      {
        user: recipient,
        actor: uid,
        kind: 'room_invite',
        resourceType: 'room_invite',
        resourceId: room.id,
        body: message,
        uniqueKey,
        created: now,
      },
      sendGuard,
      ...sendValues,
    ),
    // A guest who voluntarily left can receive the same invitation again.
    // Declined invitations stay declined, and every send guard still applies.
    database()
      .prepare(
        `UPDATE notifications SET kind='room_invite',body=?,created=?,readAt=NULL
        WHERE uniqueKey=? AND user=? AND actor=? AND resourceType='room_invite'
          AND resourceId=? AND kind='room_invite_joined' AND ${sendGuard}`,
      )
      .bind(
        message.slice(0, 240),
        now,
        uniqueKey,
        recipient,
        uid,
        room.id,
        ...sendValues,
      ),
  ]);
  if (!sent.meta.changes && !reissued.meta.changes) {
    const pending = await one(
      `SELECT n.id FROM notifications n JOIN rooms r ON r.id=n.resourceId
      WHERE n.user=? AND r.id=? AND r.owner=? AND n.kind='room_invite' AND ${validInvite}
        AND (SELECT COUNT(*) FROM members m WHERE m.room=r.id)<4
        AND NOT EXISTS (SELECT 1 FROM members m WHERE m.room=r.id AND m.user=n.user)
        AND EXISTS (SELECT 1 FROM profiles p WHERE p.id=n.user AND p.visibility='public')`,
      recipient,
      room.id,
      uid,
      now,
    );
    if (!pending)
      fail(
        'This invitation is unavailable or the session is full. Refresh and try again.',
        409,
      );
  }
  return { status: 'pending' };
}
