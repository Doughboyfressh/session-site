import { getChatGPTUser } from '@/app/chatgpt-auth';
import { notifyUser } from '@/lib/social-server';
import {
  all,
  choice,
  database,
  fail,
  limit,
  one,
  readJSON,
  run,
  str,
} from '@/lib/server';

const privateHeaders = { 'Cache-Control': 'private, no-store' };

function responseError(error: unknown, fallback: string) {
  const candidate = error as { message?: unknown; status?: unknown };
  const status = typeof candidate?.status === 'number' ? candidate.status : 500;
  return {
    message:
      status >= 400 && status < 500 && typeof candidate?.message === 'string'
        ? candidate.message
        : fallback,
    status,
  };
}

async function signedIn() {
  const user = await getChatGPTUser();
  if (!user) fail('Sign in to connect with collaborators.', 401);
  return user.userId;
}

async function blocked(a: string, b: string) {
  return one(
    'SELECT 1 AS blocked FROM user_blocks WHERE (user=? AND target=?) OR (user=? AND target=?) LIMIT 1',
    a,
    b,
    b,
    a,
  );
}

async function requestFor(id: string, user: string) {
  const request = await one(
    'SELECT * FROM collaboration_requests WHERE id=? AND (sender=? OR recipient=?)',
    id,
    user,
    user,
  );
  if (!request) fail('Collaboration request unavailable.', 404);
  return request;
}

export async function GET(req: Request) {
  try {
    const uid = await signedIn();
    await limit(uid, 'social-read', 240);
    const url = new URL(req.url);
    const view = url.searchParams.get('view') || 'activity';
    if (view === 'activity') {
      const items = await all(
        `SELECT n.*,COALESCE(p.name,'SESSION member') AS actorName,p.avatar AS actorAvatar
         FROM notifications n
         LEFT JOIN profiles p ON p.id=n.actor
         WHERE n.user=?
         ORDER BY n.created DESC
         LIMIT 100`,
        uid,
      );
      const unread = await one(
        'SELECT COUNT(*) AS count FROM notifications WHERE user=? AND readAt IS NULL',
        uid,
      );
      return Response.json(
        { items, unread: Number(unread?.count || 0) },
        { headers: privateHeaders },
      );
    }
    if (view === 'inbox') {
      const [requests, blocks] = await Promise.all([
        all(
          `SELECT r.*,
          COALESCE(sender.name,'SESSION member') AS senderName,
          COALESCE(sender.username,'member') AS senderUsername,
          sender.avatar AS senderAvatar,
          COALESCE(recipient.name,'SESSION member') AS recipientName,
          COALESCE(recipient.username,'member') AS recipientUsername,
          recipient.avatar AS recipientAvatar,
          t.title AS trackTitle,
          (SELECT body FROM direct_messages d WHERE d.request=r.id ORDER BY d.created DESC LIMIT 1) AS lastMessage,
          (SELECT created FROM direct_messages d WHERE d.request=r.id ORDER BY d.created DESC LIMIT 1) AS lastMessageAt
         FROM collaboration_requests r
         LEFT JOIN profiles sender ON sender.id=r.sender
         LEFT JOIN profiles recipient ON recipient.id=r.recipient
         LEFT JOIN tracks t ON t.id=r.track
         WHERE r.sender=? OR r.recipient=?
         ORDER BY COALESCE(lastMessageAt,r.updated) DESC
         LIMIT 100`,
          uid,
          uid,
        ),
        all(
          `SELECT b.target,b.created,COALESCE(p.name,'SESSION member') AS name,
           COALESCE(p.username,'member') AS username,p.avatar
           FROM user_blocks b
           LEFT JOIN profiles p ON p.id=b.target
           WHERE b.user=?
           ORDER BY b.created DESC`,
          uid,
        ),
      ]);
      return Response.json({ requests, blocks }, { headers: privateHeaders });
    }
    if (view === 'thread') {
      const request = await requestFor(
        str(url.searchParams.get('id'), 80),
        uid,
      );
      const messages = await all(
        `SELECT d.*,COALESCE(p.name,'SESSION member') AS senderName
         FROM direct_messages d
         LEFT JOIN profiles p ON p.id=d.sender
         WHERE d.request=?
         ORDER BY d.created ASC
         LIMIT 500`,
        request.id,
      );
      return Response.json({ request, messages }, { headers: privateHeaders });
    }
    fail('Choose a valid social view.');
  } catch (error: unknown) {
    const failure = responseError(
      error,
      'SESSION could not load this conversation.',
    );
    return Response.json(
      { error: failure.message },
      { status: failure.status, headers: privateHeaders },
    );
  }
}

export async function POST(req: Request) {
  try {
    const uid = await signedIn();
    if (
      req.headers.get('origin') &&
      req.headers.get('origin') !== new URL(req.url).origin
    )
      fail('Request not allowed.', 403);
    if (Number(req.headers.get('content-length')) > 16000)
      fail('This request is too large.', 413);
    await limit(uid, 'social-write', 80);
    const body = await readJSON(req, 16000);
    const now = Date.now();
    switch (body.action) {
      case 'notificationRead': {
        if (body.id)
          await run(
            'UPDATE notifications SET readAt=COALESCE(readAt,?) WHERE id=? AND user=?',
            now,
            str(body.id, 80),
            uid,
          );
        else
          await run(
            'UPDATE notifications SET readAt=? WHERE user=? AND readAt IS NULL',
            now,
            uid,
          );
        return Response.json({ ok: true }, { headers: privateHeaders });
      }
      case 'collaborationRequest': {
        const recipient = str(body.recipient, 120);
        if (recipient === uid) fail('Choose another SESSION member.');
        const role = choice(body.role, ['Artist', 'Producer', 'Engineer']);
        const message = str(body.message, 1200);
        if (message.length < 10)
          fail('Add a request note with at least 10 characters.');
        const track = body.track ? str(body.track, 120) : null;
        if (await blocked(uid, recipient))
          fail('This collaboration connection is unavailable.', 403);
        const target = await one(
          'SELECT * FROM profiles WHERE id=?',
          recipient,
        );
        if (track) {
          const available = await one(
            "SELECT id FROM tracks WHERE id=? AND owner=? AND visibility='public' AND permission='collaborate'",
            track,
            recipient,
          );
          if (!available)
            fail('This track is no longer open to collaboration.', 404);
        } else if (!target || target.visibility !== 'public')
          fail('This creator is not accepting profile requests.', 404);
        const activeRequest = track
          ? await one(
              "SELECT id FROM collaboration_requests WHERE sender=? AND recipient=? AND track=? AND status IN ('pending','accepted') LIMIT 1",
              uid,
              recipient,
              track,
            )
          : await one(
              "SELECT id FROM collaboration_requests WHERE track IS NULL AND status IN ('pending','accepted') AND ((sender=? AND recipient=?) OR (sender=? AND recipient=?)) LIMIT 1",
              uid,
              recipient,
              recipient,
              uid,
            );
        if (activeRequest)
          fail('You already have an active request with this creator.', 409);
        const id = crypto.randomUUID();
        const created = await run(
          `INSERT INTO collaboration_requests
           (id,sender,recipient,track,role,message,status,created,updated)
           VALUES (?,?,?,?,?,?,'pending',?,?)
           ON CONFLICT DO NOTHING`,
          id,
          uid,
          recipient,
          track,
          role,
          message,
          now,
          now,
        );
        if (
          Number(
            (created as { meta?: { changes?: number } })?.meta?.changes || 0,
          ) === 0
        )
          fail('You already have an active request with this creator.', 409);
        await notifyUser({
          user: recipient,
          actor: uid,
          kind: 'collaboration_request',
          resourceType: 'collaboration',
          resourceId: id,
          body: `invited you to collaborate as ${role.toLowerCase()}`,
          uniqueKey: `collaboration-request:${id}`,
          created: now,
        });
        return Response.json(
          { id, status: 'pending' },
          { headers: privateHeaders },
        );
      }
      case 'collaborationStatus': {
        const id = str(body.id, 80);
        const status = choice(body.status, ['accepted', 'declined', 'closed']);
        let changed: { sender: string; recipient: string } | null = null;
        if (status === 'closed')
          changed = await one(
            "UPDATE collaboration_requests SET status='closed',updated=? WHERE id=? AND ((status='accepted' AND (sender=? OR recipient=?)) OR (status='pending' AND sender=?)) RETURNING *",
            now,
            id,
            uid,
            uid,
            uid,
          );
        else
          changed = await one(
            "UPDATE collaboration_requests SET status=?,updated=? WHERE id=? AND recipient=? AND status='pending' RETURNING *",
            status,
            now,
            id,
            uid,
          );
        if (!changed)
          fail(
            'This request changed in another session. Refresh and try again.',
            409,
          );
        const other =
          changed.sender === uid ? changed.recipient : changed.sender;
        await notifyUser({
          user: other,
          actor: uid,
          kind: 'collaboration_status',
          resourceType: 'collaboration',
          resourceId: id,
          body:
            status === 'accepted'
              ? 'accepted your collaboration request'
              : status === 'declined'
                ? 'declined your collaboration request'
                : 'closed the collaboration conversation',
          uniqueKey: `collaboration-status:${id}:${status}`,
          created: now,
        });
        return Response.json({ status }, { headers: privateHeaders });
      }
      case 'message': {
        const request = await requestFor(str(body.id, 80), uid);
        if (request.status !== 'accepted')
          fail(
            'Messages open after the collaboration request is accepted.',
            403,
          );
        const other =
          request.sender === uid ? request.recipient : request.sender;
        if (await blocked(uid, other))
          fail('This collaboration connection is unavailable.', 403);
        const text = str(body.message, 2000);
        const clientId = str(body.clientId, 100);
        const id = crypto.randomUUID();
        const write = await run(
          'INSERT OR IGNORE INTO direct_messages (id,request,sender,body,created,clientId) VALUES (?,?,?,?,?,?)',
          id,
          request.id,
          uid,
          text,
          now,
          clientId,
        );
        const inserted =
          Number(
            (write as { meta?: { changes?: number } })?.meta?.changes || 0,
          ) > 0;
        if (inserted) {
          await run(
            'UPDATE collaboration_requests SET updated=? WHERE id=?',
            now,
            request.id,
          );
          await notifyUser({
            user: other,
            actor: uid,
            kind: 'message',
            resourceType: 'collaboration',
            resourceId: request.id,
            body: 'sent you a collaboration message',
            uniqueKey: `collaboration-message:${id}`,
            created: now,
          });
        }
        const stored = await one(
          'SELECT id FROM direct_messages WHERE request=? AND sender=? AND clientId=?',
          request.id,
          uid,
          clientId,
        );
        return Response.json(
          { id: stored?.id || id },
          { headers: privateHeaders },
        );
      }
      case 'block': {
        const target = str(body.target, 120);
        if (target === uid) fail('Choose another SESSION member.');
        if (body.value) {
          await database().batch([
            database()
              .prepare(
                'INSERT OR IGNORE INTO user_blocks (user,target,created) VALUES (?,?,?)',
              )
              .bind(uid, target, now),
            database()
              .prepare(
                "UPDATE collaboration_requests SET status='closed',updated=? WHERE status IN ('pending','accepted') AND ((sender=? AND recipient=?) OR (sender=? AND recipient=?))",
              )
              .bind(now, uid, target, target, uid),
          ]);
        } else
          await run(
            'DELETE FROM user_blocks WHERE user=? AND target=?',
            uid,
            target,
          );
        return Response.json({ ok: true }, { headers: privateHeaders });
      }
      default:
        fail('Choose a valid social action.');
    }
  } catch (error: unknown) {
    const failure = responseError(error, 'SESSION could not save this change.');
    return Response.json(
      { error: failure.message },
      { status: failure.status, headers: privateHeaders },
    );
  }
}
