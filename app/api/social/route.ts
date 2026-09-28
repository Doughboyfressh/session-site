import { getChatGPTUser } from '@/app/chatgpt-auth';
import { prepareNotification } from '@/lib/social-server';
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

function changeCount(result: unknown) {
  return Number(
    (result as { meta?: { changes?: number } })?.meta?.changes || 0,
  );
}

function requestScope(sender: string, recipient: string, track: string | null) {
  if (track) return `track:${JSON.stringify([sender, recipient, track])}`;
  const senderBytes = new TextEncoder().encode(sender);
  const recipientBytes = new TextEncoder().encode(recipient);
  let senderFirst = senderBytes.length <= recipientBytes.length;
  for (
    let index = 0;
    index < Math.min(senderBytes.length, recipientBytes.length);
    index++
  ) {
    if (senderBytes[index] === recipientBytes[index]) continue;
    senderFirst = senderBytes[index] < recipientBytes[index];
    break;
  }
  return `profile:${JSON.stringify(senderFirst ? [sender, recipient] : [recipient, sender])}`;
}

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
        `SELECT n.id,n.kind,n.resourceType,n.resourceId,n.body,n.created,n.readAt,
          COALESCE(p.name,'SESSION member') AS actorName,p.avatar AS actorAvatar
         FROM notifications n
         LEFT JOIN profiles p ON p.id=n.actor AND p.visibility='public'
          AND NOT EXISTS (
            SELECT 1 FROM user_blocks b
            WHERE (b.user=n.user AND b.target=n.actor)
               OR (b.user=n.actor AND b.target=n.user)
          )
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
          `SELECT r.id,r.sender,r.recipient,r.track,r.trackTitle,r.role,r.message,
          r.status,r.created,r.updated,
          r.senderName,r.senderUsername,r.senderAvatar,
          r.recipientName,r.recipientUsername,r.recipientAvatar,
          (SELECT body FROM direct_messages d WHERE d.request=r.id ORDER BY d.created DESC,d.id DESC LIMIT 1) AS lastMessage,
          (SELECT created FROM direct_messages d WHERE d.request=r.id ORDER BY d.created DESC,d.id DESC LIMIT 1) AS lastMessageAt
         FROM collaboration_requests r
         WHERE r.sender=? OR r.recipient=?
         ORDER BY COALESCE(lastMessageAt,r.updated) DESC,r.id ASC
         LIMIT 100`,
          uid,
          uid,
        ),
        all(
          `SELECT b.target,b.created,COALESCE(p.name,'SESSION member') AS name,
           COALESCE(p.username,'member') AS username,p.avatar
           FROM user_blocks b
           LEFT JOIN profiles p ON p.id=b.target AND p.visibility='public'
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
        `SELECT * FROM (
           SELECT d.id,d.request,d.sender,d.body,d.created,
            CASE WHEN d.sender=r.sender THEN r.senderName ELSE r.recipientName END AS senderName
           FROM direct_messages d
           JOIN collaboration_requests r ON r.id=d.request
           WHERE d.request=?
           ORDER BY d.created DESC,d.id DESC
           LIMIT 500
         ) recent
         ORDER BY recent.created ASC,recent.id ASC`,
        request.id,
      );
      const {
        scopeKey: _scopeKey,
        operationId: _operationId,
        ...visibleRequest
      } = request;
      return Response.json(
        { request: visibleRequest, messages },
        { headers: privateHeaders },
      );
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
        const [target, senderProfile] = await Promise.all([
          one('SELECT * FROM profiles WHERE id=?', recipient),
          one('SELECT name,username,avatar FROM profiles WHERE id=?', uid),
        ]);
        let trackTitle: string | null = null;
        if (track) {
          const available = await one(
            "SELECT id,title FROM tracks WHERE id=? AND owner=? AND visibility='public' AND permission='collaborate'",
            track,
            recipient,
          );
          if (!available)
            fail('This track is no longer open to collaboration.', 404);
          trackTitle = available.title;
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
        const publicTarget = target?.visibility === 'public' ? target : null;
        const createRequest = database()
          .prepare(
            `INSERT INTO collaboration_requests
             (id,sender,recipient,track,trackTitle,role,message,status,scopeKey,
              senderName,senderUsername,senderAvatar,
              recipientName,recipientUsername,recipientAvatar,
              created,updated,operationId)
             SELECT ?,?,?,?,?,?,?,'pending',?,?,?,?,?,?,?,?,?,?
             WHERE NOT EXISTS (
               SELECT 1 FROM user_blocks b
               WHERE (b.user=? AND b.target=?) OR (b.user=? AND b.target=?)
             )
             AND (
               (? IS NULL AND EXISTS (
                 SELECT 1 FROM profiles p
                 WHERE p.id=? AND p.visibility='public'
               ))
               OR
               (? IS NOT NULL AND EXISTS (
                 SELECT 1 FROM tracks t
                 WHERE t.id=? AND t.owner=?
                  AND t.visibility='public' AND t.permission='collaborate'
               ))
             )
             ON CONFLICT DO NOTHING`,
          )
          .bind(
            id,
            uid,
            recipient,
            track,
            trackTitle,
            role,
            message,
            requestScope(uid, recipient, track),
            senderProfile?.name || 'SESSION member',
            senderProfile?.username || 'member',
            senderProfile?.avatar || null,
            publicTarget?.name || 'SESSION member',
            publicTarget?.username || 'member',
            publicTarget?.avatar || null,
            now,
            now,
            id,
            uid,
            recipient,
            recipient,
            uid,
            track,
            recipient,
            track,
            track,
            recipient,
          );
        const createNotice = prepareNotification(
          {
            user: recipient,
            actor: uid,
            kind: 'collaboration_request',
            resourceType: 'collaboration',
            resourceId: id,
            body: `invited you to collaborate as ${role.toLowerCase()}`,
            uniqueKey: `collaboration-request:${id}`,
            created: now,
          },
          'EXISTS (SELECT 1 FROM collaboration_requests WHERE id=?)',
          id,
        );
        const [created] = await database().batch([createRequest, createNotice]);
        if (changeCount(created) === 0)
          fail(
            'This collaboration is no longer available or already has an active request. Refresh and try again.',
            409,
          );
        return Response.json(
          { id, status: 'pending' },
          { headers: privateHeaders },
        );
      }
      case 'collaborationStatus': {
        const id = str(body.id, 80);
        const status = choice(body.status, ['accepted', 'declined', 'closed']);
        const request = await requestFor(id, uid);
        const operationId = crypto.randomUUID();
        const transitionAt = Math.max(now, Number(request.updated || 0) + 1);
        const updateRequest =
          status === 'closed'
            ? database()
                .prepare(
                  "UPDATE collaboration_requests SET status='closed',updated=?,operationId=? WHERE id=? AND ((status='accepted' AND (sender=? OR recipient=?)) OR (status='pending' AND sender=?))",
                )
                .bind(transitionAt, operationId, id, uid, uid, uid)
            : database()
                .prepare(
                  "UPDATE collaboration_requests SET status=?,updated=?,operationId=? WHERE id=? AND recipient=? AND status='pending'",
                )
                .bind(status, transitionAt, operationId, id, uid);
        const other =
          request.sender === uid ? request.recipient : request.sender;
        const statusNotice = prepareNotification(
          {
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
            created: transitionAt,
          },
          'EXISTS (SELECT 1 FROM collaboration_requests WHERE id=? AND status=? AND operationId=?)',
          id,
          status,
          operationId,
        );
        const [changed] = await database().batch([updateRequest, statusNotice]);
        if (changeCount(changed) === 0)
          fail(
            'This request changed in another session. Refresh and try again.',
            409,
          );
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
        const insertMessage = database()
          .prepare(
            `INSERT OR IGNORE INTO direct_messages
             (id,request,sender,body,created,clientId)
             SELECT ?,r.id,?,?,?,?
             FROM collaboration_requests r
             WHERE r.id=? AND r.status='accepted'
              AND (r.sender=? OR r.recipient=?)
              AND NOT EXISTS (
                SELECT 1 FROM user_blocks b
                WHERE (b.user=r.sender AND b.target=r.recipient)
                   OR (b.user=r.recipient AND b.target=r.sender)
              )`,
          )
          .bind(id, uid, text, now, clientId, request.id, uid, uid);
        const updateThread = database()
          .prepare(
            'UPDATE collaboration_requests SET updated=? WHERE id=? AND EXISTS (SELECT 1 FROM direct_messages WHERE id=?)',
          )
          .bind(now, request.id, id);
        const messageNotice = prepareNotification(
          {
            user: other,
            actor: uid,
            kind: 'message',
            resourceType: 'collaboration',
            resourceId: request.id,
            body: 'sent you a collaboration message',
            uniqueKey: `collaboration-message:${id}`,
            created: now,
          },
          'EXISTS (SELECT 1 FROM direct_messages WHERE id=?)',
          id,
        );
        await database().batch([insertMessage, updateThread, messageNotice]);
        const stored = await one(
          'SELECT id FROM direct_messages WHERE request=? AND sender=? AND clientId=?',
          request.id,
          uid,
          clientId,
        );
        if (!stored)
          fail(
            'This conversation changed while the message was sending. Refresh and try again.',
            409,
          );
        return Response.json({ id: stored.id }, { headers: privateHeaders });
      }
      case 'block': {
        const target = str(body.target, 120);
        if (target === uid) fail('Choose another SESSION member.');
        if (body.value) {
          const operationId = crypto.randomUUID();
          await database().batch([
            database()
              .prepare(
                'INSERT OR IGNORE INTO user_blocks (user,target,created) VALUES (?,?,?)',
              )
              .bind(uid, target, now),
            database()
              .prepare(
                "UPDATE collaboration_requests SET status='closed',updated=?,operationId=? WHERE status IN ('pending','accepted') AND ((sender=? AND recipient=?) OR (sender=? AND recipient=?))",
              )
              .bind(now, operationId, uid, target, target, uid),
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
