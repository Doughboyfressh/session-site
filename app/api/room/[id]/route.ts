import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  all,
  one,
  run,
  roomAccess,
  fail,
  str,
  choice,
  readJSON,
  limit,
} from '@/lib/server';
const uuid = (v: any) =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(v);
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const u = await getChatGPTUser();
    if (!u) fail('Sign in to enter a room.', 401);
    const { id } = await params,
      room = await roomAccess(id, u.userId),
      url = new URL(req.url),
      session = url.searchParams.get('session'),
      since = Math.max(0, Number(url.searchParams.get('since')) || 0);
    const now = Date.now();
    await run(
      'UPDATE members SET seen=MAX(seen,?) WHERE room=? AND user=?',
      now,
      id,
      u.userId,
    );
    if (session)
      await run(
        'UPDATE media_sessions SET seen=MAX(seen,?) WHERE room=? AND user=? AND session=?',
        now,
        id,
        u.userId,
        session,
      );
    const [members, sessions, events, active] = await Promise.all([
      all(
        "SELECT m.user,m.seen,COALESCE(p.name,'Creator') AS name,p.avatar FROM members m LEFT JOIN profiles p ON p.id=m.user WHERE m.room=?",
        id,
      ),
      all(
        'SELECT s.* FROM media_sessions s JOIN members m ON m.room=s.room AND m.user=s.user WHERE s.room=? AND s.seen>?',
        id,
        now - 30000,
      ),
      all(
        'SELECT e.* FROM events e WHERE e.room=? AND e.id>? AND (e.recipient IS NULL OR e.recipient=?) AND e.created>? AND EXISTS (SELECT 1 FROM members m WHERE m.room=e.room AND m.user=e.sender) ORDER BY e.id ASC LIMIT 200',
        id,
        since,
        u.userId,
        now - 86400000,
      ),
      session
        ? one(
            'SELECT session FROM media_sessions WHERE room=? AND user=?',
            id,
            u.userId,
          )
        : null,
    ]);
    const safeEvents = events
      .map((e) => ({ ...e, body: JSON.parse(e.body) }))
      .filter(
        (e) =>
          e.kind !== 'signal' ||
          (session &&
            e.body.recipientSession === session &&
            sessions.some(
              (s) => s.user === e.sender && s.session === e.body.senderSession,
            )),
      );
    return Response.json(
      {
        room: {
          ...room,
          invite: room.owner === u.userId ? room.invite : undefined,
        },
        members,
        sessions,
        mediaReplaced: !!session && !!active && active.session !== session,
        mediaMissing: !!session && !active,
        events: safeEvents,
        cursor: events.length ? events.at(-1)!.id : since,
        more: events.length === 200,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e: any) {
    return Response.json(
      { error: e.status ? e.message : 'Could not connect to the room.' },
      { status: e.status || 500 },
    );
  }
}
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const u = await getChatGPTUser();
    if (!u) fail('Sign in to connect.', 401);
    if (
      req.headers.get('origin') &&
      req.headers.get('origin') !== new URL(req.url).origin
    )
      fail('Request not allowed.', 403);
    const { id } = await params;
    await roomAccess(id, u.userId);
    await limit(u.userId, 'room:' + id, 360);
    const b = await readJSON(req, 64000),
      kind = choice(b.kind, [
        'signal',
        'chat',
        'startMedia',
        'stopMedia',
        'sharing',
      ]);
    const now = Date.now();
    if (kind === 'startMedia') {
      if (!uuid(b.session)) fail('Invalid media session.');
      const cursor = (
        await one(
          'SELECT COALESCE(MAX(id),0) AS cursor FROM events WHERE room=?',
          id,
        )
      ).cursor;
      await run(
        'INSERT INTO media_sessions (room,user,session,seen,sharing) VALUES (?,?,?,?,0) ON CONFLICT(room,user) DO UPDATE SET session=excluded.session,seen=excluded.seen,sharing=0',
        id,
        u.userId,
        b.session,
        now,
      );
      return Response.json({ cursor });
    }
    if (kind === 'stopMedia') {
      await run(
        'DELETE FROM media_sessions WHERE room=? AND user=? AND session=?',
        id,
        u.userId,
        b.session || '',
      );
      return Response.json({ ok: true });
    }
    if (kind === 'sharing') {
      await run(
        'UPDATE media_sessions SET sharing=? WHERE room=? AND user=? AND session=?',
        b.value ? 1 : 0,
        id,
        u.userId,
        b.session,
      );
      return Response.json({ ok: true });
    }
    if (!uuid(b.clientId)) fail('Invalid message identity.');
    if (kind === 'chat') b.body = { text: str(b.body?.text, 1000) };
    if (kind === 'signal') {
      if (
        !b.recipient ||
        !b.body ||
        !uuid(b.body.senderSession) ||
        !uuid(b.body.recipientSession)
      )
        fail('Invalid signaling envelope.');
      const sender = await one(
          'SELECT session FROM media_sessions WHERE room=? AND user=? AND session=?',
          id,
          u.userId,
          b.body.senderSession,
        ),
        recipient = await one(
          'SELECT s.session FROM media_sessions s JOIN members m ON m.room=s.room AND m.user=s.user WHERE s.room=? AND s.user=? AND s.session=?',
          id,
          b.recipient,
          b.body.recipientSession,
        );
      if (!sender || !recipient)
        fail('Media session has changed. Reconnect.', 409);
      const d = b.body.description,
        c = b.body.candidate;
      if (Number(!!d) + Number(!!c) + Number(b.body.restart === true) !== 1)
        fail('Invalid signal.');
      if (
        d &&
        (!['offer', 'answer'].includes(d.type) ||
          typeof d.sdp !== 'string' ||
          d.sdp.length > 48000)
      )
        fail('Invalid session description.');
      if (c && (typeof c.candidate !== 'string' || c.candidate.length > 2048))
        fail('Invalid network candidate.');
    }
    await run(
      'INSERT OR IGNORE INTO events (room,sender,recipient,kind,body,created,clientId) VALUES (?,?,?,?,?,?,?)',
      id,
      u.userId,
      b.recipient || null,
      kind,
      JSON.stringify(b.body),
      now,
      b.clientId,
    );
    await run(
      'DELETE FROM events WHERE room=? AND created<?',
      id,
      now - 86400000,
    );
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json(
      { error: e.status ? e.message : 'Message could not be sent.' },
      { status: e.status || 500 },
    );
  }
}
