// Explicit deployed-runtime check. Only generated example.invalid accounts receive invitations.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';
const base = process.env.SESSION_VERIFY_BASE;
assert.ok(
  base && process.env.DATABASE_URL,
  'Configure SESSION_VERIFY_BASE and the matching test runtime DATABASE_URL.',
);
const output = 'outputs/room-invites-evidence';
fs.mkdirSync(output, { recursive: true });
const tag = crypto.randomBytes(5).toString('hex');
const actors = [],
  rooms = [];
let checks = 0;
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000,
});
function check(value, message) {
  assert.ok(value, message);
  checks++;
}
async function request(actor, path, options = {}, status = 200) {
  const headers = new Headers(options.headers);
  headers.set('origin', base);
  if (actor) headers.set('cookie', [...actor.jar.values()].join('; '));
  const response = await fetch(base + path, {
    ...options,
    headers,
    signal: AbortSignal.timeout(45000),
  });
  for (const cookie of response.headers.getSetCookie())
    if (actor) {
      const pair = cookie.split(';')[0];
      actor.jar.set(pair.split('=')[0], pair);
    }
  const result = await response.json();
  assert.equal(
    response.status,
    status,
    path + ': ' + (result.error || 'unexpected response'),
  );
  checks++;
  return result;
}
const post = (actor, path, body, status) =>
  request(
    actor,
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    status,
  );
const action = (actor, body, status) =>
  post(actor, '/api/action', body, status);
const activity = (actor) => request(actor, '/api/social?view=activity');
async function signup(suffix) {
  const actor = { jar: new Map(), username: 'invite_' + tag + suffix };
  const result = await post(actor, '/api/auth/sign-up/email', {
    email: actor.username + '@example.invalid',
    name: 'Disposable invitation check',
    password: crypto.randomBytes(24).toString('hex'),
  });
  actor.id = result.user.id;
  actors.push(actor);
  fs.writeFileSync(
    output + '/accounts.json',
    JSON.stringify(
      actors.map((a) => ({ id: a.id })),
      null,
      2,
    ),
  );
  await action(actor, {
    action: 'profile',
    username: actor.username,
    name: 'Disposable invitation check',
    roles: ['Producer'],
    visibility: 'public',
  });
  return actor;
}
let passed = false;
fs.writeFileSync(
  output + '/http-result.json',
  JSON.stringify({ passed: false, cleanupPending: true }),
);
try {
  const host = await signup('a'),
    guest = await signup('b');
  const room = await action(host, {
    action: 'room',
    title: 'Disposable in-session invite check',
    visibility: 'invite',
  });
  rooms.push(room.id);
  const candidates = await action(host, {
    action: 'roomInviteCandidates',
    id: room.id,
    query: '@' + guest.username,
  });
  check(
    candidates.profiles.length === 1 && candidates.profiles[0].id === guest.id,
    'PostgreSQL member search preserves literal username underscores',
  );
  await request(guest, '/api/room/' + room.id, {}, 403);
  await action(host, {
    action: 'inviteRoom',
    id: room.id,
    recipient: guest.id,
  });
  await action(host, {
    action: 'inviteRoom',
    id: room.id,
    recipient: guest.id,
  });
  const notices = (await activity(guest)).items.filter(
    (n) => n.resourceId === room.id,
  );
  check(
    notices.length === 1 && notices[0].inviteStatus === 'pending',
    'One pending alert for duplicate sends',
  );
  const bearer = (await request(host, '/api/room/' + room.id)).room.invite;
  check(
    !JSON.stringify(notices).includes(bearer),
    'Alerts do not disclose the copy-invite token',
  );
  check(
    !JSON.stringify(await action(guest, { action: 'exportData' })).includes(
      bearer,
    ),
    'Account export does not disclose the token',
  );
  await action(
    host,
    { action: 'respondRoomInvite', id: notices[0].id, response: 'accepted' },
    404,
  );
  await action(guest, {
    action: 'respondRoomInvite',
    id: notices[0].id,
    response: 'accepted',
  });
  await action(guest, {
    action: 'respondRoomInvite',
    id: notices[0].id,
    response: 'accepted',
  });
  const joined = await request(guest, '/api/room/' + room.id);
  check(
    joined.members.length === 2 &&
      !joined.room.invite &&
      !joined.editors.includes(guest.id),
    'Joining preserves host-only invitations and separate editing permission',
  );
  await action(
    guest,
    { action: 'inviteRoom', id: room.id, recipient: host.id },
    403,
  );
  await action(host, { action: 'removeMember', id: room.id, user: guest.id });
  await action(
    guest,
    { action: 'respondRoomInvite', id: notices[0].id, response: 'accepted' },
    403,
  );
  await action(host, {
    action: 'inviteRoom',
    id: room.id,
    recipient: guest.id,
  });
  let notice = (await activity(guest)).items.find(
    (n) => n.inviteStatus === 'pending',
  );
  await post(guest, '/api/social', {
    action: 'block',
    target: host.id,
    value: true,
  });
  await action(
    guest,
    { action: 'respondRoomInvite', id: notice.id, response: 'accepted' },
    403,
  );
  check(
    (
      await action(host, {
        action: 'roomInviteCandidates',
        id: room.id,
        query: guest.username,
      })
    ).profiles.length === 0,
    'Blocked members are absent from search',
  );
  await post(guest, '/api/social', {
    action: 'block',
    target: host.id,
    value: false,
  });
  const seats = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  for (const seat of seats)
    await pool.query(
      'INSERT INTO members(room,"user",seen) VALUES ($1,$2,$3)',
      [room.id, seat, Date.now()],
    );
  await action(
    guest,
    { action: 'respondRoomInvite', id: notice.id, response: 'accepted' },
    409,
  );
  check(
    (await activity(guest)).items.find((n) => n.id === notice.id)
      .inviteStatus === 'full',
    'Full session status is visible',
  );
  await pool.query(
    'DELETE FROM members WHERE room=$1 AND "user"=ANY($2::text[])',
    [room.id, seats],
  );
  await action(guest, {
    action: 'respondRoomInvite',
    id: notice.id,
    response: 'declined',
  });
  await action(
    guest,
    { action: 'respondRoomInvite', id: notice.id, response: 'accepted' },
    403,
  );
  check(
    (await activity(guest)).items.find((n) => n.id === notice.id)
      .inviteStatus === 'declined',
    'Decline persists in PostgreSQL',
  );
  await action(host, { action: 'rotateInvite', id: room.id });
  await action(host, {
    action: 'inviteRoom',
    id: room.id,
    recipient: guest.id,
  });
  notice = (await activity(guest)).items.find(
    (n) => n.inviteStatus === 'pending',
  );
  await pool.query('UPDATE rooms SET expires=$1 WHERE id=$2 AND owner=$3', [
    Date.now() - 1,
    room.id,
    host.id,
  ]);
  await action(
    guest,
    { action: 'respondRoomInvite', id: notice.id, response: 'accepted' },
    403,
  );
  check(
    (await activity(guest)).items.find((n) => n.id === notice.id)
      .inviteStatus === 'expired',
    'Expired invitation status is visible',
  );
  await action(host, { action: 'rotateInvite', id: room.id });
  await action(host, {
    action: 'inviteRoom',
    id: room.id,
    recipient: guest.id,
  });
  notice = (await activity(guest)).items.find(
    (n) => n.inviteStatus === 'pending',
  );
  await action(host, { action: 'closeRoom', id: room.id });
  await action(
    guest,
    { action: 'respondRoomInvite', id: notice.id, response: 'accepted' },
    403,
  );
  check(
    (await activity(guest)).items.find((n) => n.id === notice.id)
      .inviteStatus === 'unavailable',
    'Closed session status is visible',
  );
  passed = true;
  console.log(`${checks} deployed native-invitation HTTP checks passed.`);
} finally {
  const ids = actors.map((a) => a.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ownedRooms = await client.query(
      'SELECT id FROM rooms WHERE owner=ANY($1::text[])',
      [ids],
    );
    const fixtureRooms = [
      ...new Set([...rooms, ...ownedRooms.rows.map((room) => room.id)]),
    ];
    // Room IDs and actors belong only to this run; never sweep other sessions.
    for (const table of ['room_editors', 'media_sessions', 'events', 'members'])
      await client.query(`DELETE FROM ${table} WHERE room=ANY($1::text[])`, [
        fixtureRooms,
      ]);
    await client.query(
      'DELETE FROM rooms WHERE id=ANY($1::text[]) AND owner=ANY($2::text[])',
      [fixtureRooms, ids],
    );
    await client.query(
      'DELETE FROM notifications WHERE "user"=ANY($1::text[]) OR actor=ANY($1::text[])',
      [ids],
    );
    await client.query('DELETE FROM user_blocks WHERE "user"=ANY($1::text[])', [
      ids,
    ]);
    await client.query('DELETE FROM profiles WHERE id=ANY($1::text[])', [ids]);
    await client.query(
      "DELETE FROM rate_limits WHERE split_part(id,':',1)=ANY($1::text[])",
      [ids],
    );
    const counts = {};
    const cleanupScopes = /** @type {[string,string,string[]][]} */ ([
      ['rooms', 'owner', ids],
      ['profiles', 'id', ids],
      ['notifications', 'user', ids],
      ['user_blocks', 'user', ids],
      ['members', 'room', fixtureRooms],
      ['room_editors', 'room', fixtureRooms],
      ['media_sessions', 'room', fixtureRooms],
      ['events', 'room', fixtureRooms],
    ]);
    for (const [table, column, scope] of cleanupScopes) {
      const result = await client.query(
        `SELECT count(*)::int AS count FROM ${table} WHERE "${column}"=ANY($1::text[])`,
        [scope],
      );
      counts[table] = result.rows[0].count;
      assert.equal(counts[table], 0, 'Residual disposable data: ' + table);
    }
    await client.query('COMMIT');
    fs.writeFileSync(
      output + '/http-result.json',
      JSON.stringify(
        { passed, checks, counts, authCleanupPending: ids },
        null,
        2,
      ),
    );
    console.log(
      'Disposable invitation fixtures removed; delete the generated Auth users via provider admin: ' +
        ids.join(', '),
    );
  } catch (error) {
    await client.query('ROLLBACK');
    process.exitCode = 1;
    console.error(
      'Disposable invitation cleanup failed; retain the Auth accounts for recovery:',
      error.message,
    );
    fs.writeFileSync(
      output + '/http-result.json',
      JSON.stringify({
        passed: false,
        checks,
        cleanupFailed: true,
        authCleanupPending: ids,
      }),
    );
  } finally {
    client.release();
    await pool.end();
  }
}
