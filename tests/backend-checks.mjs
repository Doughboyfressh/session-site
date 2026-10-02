// Runtime tests for the /api/action backend, exercising the REAL server code
// against an in-memory node:sqlite database with the real Drizzle migrations.
// cloudflare:workers (D1/R2) and next/headers (auth) are mocked; auth is by the
// same oai-authenticated-user-* headers the platform sends. No network, no
// wrangler. Run: node tests/backend-checks.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const root = process.cwd();
const localRequire = createRequire(path.join(root, 'package.json'));
const ts = localRequire('typescript');
const db = new DatabaseSync(':memory:');
for (const f of fs
  .readdirSync(path.join(root, 'drizzle'))
  .filter((f) => f.endsWith('.sql'))
  .sort())
  db.exec(fs.readFileSync(path.join(root, 'drizzle', f), 'utf8'));
assert.ok(
  db.prepare("SELECT 1 FROM sqlite_master WHERE name='projects'").get(),
  'migrations applied',
);

let beforeBatch;
const D1 = {
  prepare(sql) {
    return {
      sql,
      args: [],
      bind(...args) {
        return { ...this, args };
      },
      async first() {
        return db.prepare(sql).get(...this.args) || null;
      },
      async all() {
        return { results: db.prepare(sql).all(...this.args) };
      },
      async run() {
        return { meta: db.prepare(sql).run(...this.args) };
      },
    };
  },
  async batch(stmts) {
    if (beforeBatch) {
      const hook = beforeBatch;
      beforeBatch = null;
      await hook(stmts);
    }
    db.exec('BEGIN');
    try {
      const results = stmts.map((s) => ({
        results: db.prepare(s.sql).all(...s.args),
        meta: { changes: db.prepare('SELECT changes() n').get().n },
      }));
      db.exec('COMMIT');
      return results;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  },
};
const R2store = new Map();
const R2 = {
  async put(id, body) {
    R2store.set(id, new Uint8Array(await new Response(body).arrayBuffer()));
  },
  async delete(id) {
    R2store.delete(id);
  },
  async get(id, options) {
    const o = R2store.get(id);
    return o
      ? {
          body: new Blob([
            options?.range
              ? o.slice(
                  options.range.offset,
                  options.range.offset + options.range.length,
                )
              : o,
          ]).stream(),
          arrayBuffer: async () => o.slice().buffer,
        }
      : null;
  },
};

let currentHeaders = {};
let suppressExpectedErrors = 0;
const modules = new Map();
const globals = Object.fromEntries(
  [
    'crypto',
    'TextEncoder',
    'TextDecoder',
    'Uint8Array',
    'Float32Array',
    'ArrayBuffer',
    'DataView',
    'Blob',
    'File',
    'FormData',
    'Request',
    'Response',
    'AbortController',
    'AbortSignal',
    'DOMException',
    'ReadableStream',
    'setTimeout',
    'clearTimeout',
    'URL',
    'structuredClone',
    'console',
  ].map((key) => [key, globalThis[key]]),
);
globals.console = {
  ...console,
  error: (...args) => {
    if (!suppressExpectedErrors) console.error(...args);
  },
};
function load(file) {
  file = path.resolve(root, file);
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(
    code,
    {
      ...globals,
      module,
      exports: module.exports,
      require(id) {
        if (id === 'cloudflare:workers') return { env: { DB: D1, FILES: R2 } };
        if (id === 'next/headers')
          return {
            headers: async () => ({
              get: (k) => currentHeaders[String(k).toLowerCase()] ?? null,
            }),
          };
        if (id === 'next/navigation')
          return {
            redirect: () => {
              throw Object.assign(new Error('redirect'), { status: 307 });
            },
          };
        if (id.startsWith('.') || id.startsWith('@/')) {
          const base = id.startsWith('@/')
            ? path.join(root, id.slice(2))
            : path.resolve(path.dirname(file), id);
          const resolved = [
            base,
            base + '.ts',
            base + '.tsx',
            path.join(base, 'index.ts'),
          ].find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
          if (!resolved)
            throw new Error('Cannot resolve ' + id + ' from ' + file);
          return load(resolved);
        }
        return localRequire(id);
      },
    },
    { filename: file },
  );
  return module.exports;
}

const route = load('app/api/action/route.ts');
let checks = 0;

// Upgrade safety: 0008 must backfill real scopes and public identity snapshots
// before its unique active-scope index is created. The older schema can contain
// distinct active requests and a reverse-direction profile request pair.
const migrationDb = new DatabaseSync(':memory:');
for (const file of fs
  .readdirSync(path.join(root, 'drizzle'))
  .filter((file) => file.endsWith('.sql') && file < '0008_')
  .sort())
  migrationDb.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8'));
for (const [id, username, name, visibility, avatar] of [
  ['migration-a', 'migration-a', 'Migration Artist', 'public', 'avatar-a'],
  ['migration-b', 'migration-b', 'Migration Producer', 'public', 'avatar-b'],
  ['migration-c', 'migration-c', 'Hidden Engineer', 'private', 'avatar-c'],
  ['migration-d', 'migration-d', 'Migration Engineer', 'public', 'avatar-d'],
  ['migration-e', 'migration-e', 'Migration Writer', 'public', 'avatar-e'],
  ['migration-f', 'migration-f', 'Migration Mixer', 'public', 'avatar-f'],
])
  migrationDb
    .prepare(
      "INSERT INTO profiles(id,username,name,roles,visibility,avatar,created) VALUES (?,?,?,'[]',?,?,1)",
    )
    .run(id, username, name, visibility, avatar);
migrationDb
  .prepare(
    "INSERT INTO tracks(id,owner,title,kind,genre,bpm,musicalKey,visibility,permission,fileId,created) VALUES ('migration-track','migration-d','Legacy mix','song','R&B',92,'C minor','public','collaborate','migration-file',1)",
  )
  .run();
const insertLegacyRequest = migrationDb.prepare(
  'INSERT INTO collaboration_requests(id,sender,recipient,track,role,message,status,created,updated) VALUES (?,?,?,?,?,?,?,?,?)',
);
insertLegacyRequest.run(
  'migration-profile-keeper',
  'migration-a',
  'migration-b',
  null,
  'Producer',
  'Original profile request',
  'pending',
  1,
  1,
);
insertLegacyRequest.run(
  'migration-profile-reverse',
  'migration-b',
  'migration-a',
  null,
  'Artist',
  'Concurrent reverse request',
  'accepted',
  2,
  2,
);
insertLegacyRequest.run(
  'migration-track-request',
  'migration-c',
  'migration-d',
  'migration-track',
  'Engineer',
  'Legacy track request',
  'accepted',
  3,
  3,
);
insertLegacyRequest.run(
  'migration-closed',
  'migration-d',
  'migration-c',
  null,
  'Artist',
  'Closed history',
  'declined',
  4,
  4,
);
insertLegacyRequest.run(
  'migration-accepted-empty',
  'migration-e',
  'migration-f',
  null,
  'Engineer',
  'Accepted conversation without messages',
  'accepted',
  5,
  5,
);
insertLegacyRequest.run(
  'migration-accepted-with-history',
  'migration-f',
  'migration-e',
  null,
  'Artist',
  'Accepted conversation with messages',
  'accepted',
  6,
  6,
);
migrationDb
  .prepare(
    "INSERT INTO direct_messages(id,request,sender,body,created,clientId) VALUES ('migration-message','migration-accepted-with-history','migration-f','Keep this history',7,'migration-client')",
  )
  .run();
migrationDb.exec(
  fs.readFileSync(
    path.join(root, 'drizzle', '0008_freezing_rafael_vega.sql'),
    'utf8',
  ),
);
const migratedProfile = migrationDb
  .prepare(
    'SELECT status,scopeKey,senderName,recipientName,recipientAvatar FROM collaboration_requests WHERE id=?',
  )
  .get('migration-profile-keeper');
const migratedReverse = migrationDb
  .prepare(
    'SELECT status,scopeKey,operationId FROM collaboration_requests WHERE id=?',
  )
  .get('migration-profile-reverse');
const migratedTrack = migrationDb
  .prepare(
    'SELECT scopeKey,trackTitle,senderName,recipientName FROM collaboration_requests WHERE id=?',
  )
  .get('migration-track-request');
const migratedAcceptedEmpty = migrationDb
  .prepare('SELECT status FROM collaboration_requests WHERE id=?')
  .get('migration-accepted-empty');
const migratedAcceptedWithHistory = migrationDb
  .prepare('SELECT status FROM collaboration_requests WHERE id=?')
  .get('migration-accepted-with-history');
assert.equal(migratedProfile.status, 'closed');
assert.equal(migratedProfile.scopeKey, migratedReverse.scopeKey);
assert.equal(migratedReverse.status, 'accepted');
assert.equal(migratedReverse.operationId, null);
assert.deepEqual(
  [
    migratedProfile.senderName,
    migratedProfile.recipientName,
    migratedProfile.recipientAvatar,
  ],
  ['Migration Artist', 'Migration Producer', 'avatar-b'],
);
assert.deepEqual(
  [
    migratedTrack.trackTitle,
    migratedTrack.senderName,
    migratedTrack.recipientName,
  ],
  ['Legacy mix', 'SESSION member', 'Migration Engineer'],
  'migration preserves public history while keeping private profiles generic',
);
assert.match(migratedTrack.scopeKey, /^track:/);
assert.equal(migratedAcceptedEmpty.status, 'closed');
assert.equal(migratedAcceptedWithHistory.status, 'accepted');
assert.equal(
  migrationDb
    .prepare('SELECT COUNT(*) AS count FROM direct_messages WHERE request=?')
    .get('migration-accepted-with-history').count,
  1,
  'migration keeps the accepted duplicate that owns message history',
);
checks += 10;
migrationDb.close();

async function act(userId, body, status = 200) {
  currentHeaders = userId
    ? {
        'oai-authenticated-user-id': userId,
        'oai-authenticated-user-email': userId + '@example.test',
      }
    : {};
  const req = new Request('https://app.local/api/action', {
    method: 'POST',
    headers: {
      origin: 'https://app.local',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const res = await route.POST(req);
  const text = await res.text();
  assert.equal(res.status, status, 'action ' + body.action + ': ' + text);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  checks++;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const now = Date.now();
const producer = 'prod_' + now.toString(36);
const artist = 'artist_' + now.toString(36);
const fileId = crypto.randomUUID();
db.prepare(
  'INSERT INTO files (id,owner,name,mime,size,purpose,created) VALUES (?,?,?,?,?,?,?)',
).run(fileId, producer, 'beat.wav', 'audio/wav', 1000, 'audio', now);
function seedTrack(visibility, permission) {
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO tracks (id,owner,title,kind,genre,bpm,musicalKey,visibility,permission,fileId,created) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    id,
    producer,
    'Beat',
    'beat',
    'Hip-hop',
    92,
    'C minor',
    visibility,
    permission,
    fileId,
    now,
  );
  return id;
}

// --- remix: happy path ---
const beat = seedTrack('public', 'collaborate');
const remix = await act(artist, { action: 'remix', id: beat });
assert.ok(remix.id, 'remix returns project id');
checks++;
const proj = db.prepare('SELECT * FROM projects WHERE id=?').get(remix.id);
assert.equal(proj.owner, artist, 'remix owned by the artist');
assert.equal(proj.forkedFrom, beat, 'forkedFrom lineage recorded');
const data = JSON.parse(proj.data);
assert.equal(data.tracks[0].fileId, fileId, 'remix loads the beat audio');
assert.equal(data.bpm, 92, 'remix inherits the beat tempo');
checks += 4;

// --- remix: listen-only is blocked, private is hidden, anon is rejected ---
await act(artist, { action: 'remix', id: seedTrack('public', 'listen') }, 403);
await act(
  artist,
  { action: 'remix', id: seedTrack('private', 'collaborate') },
  404,
);
await act(null, { action: 'remix', id: beat }, 401);

console.log('✓ remix backend —', checks, 'checks passed');

// Actual upload stream boundaries, independent of Content-Length.
const upload = load('app/api/upload/route.ts');
currentHeaders = {
  'oai-authenticated-user-id': artist,
  'oai-authenticated-user-email': 'artist@example.test',
};
const tiny = new Uint8Array(20);
tiny.set(new TextEncoder().encode('ID3'));
function multipart(extra = '') {
  const form = new FormData();
  form.set('file', new File([tiny], 'test.mp3'));
  form.set('purpose', 'audio');
  if (extra) form.set('unused', extra);
  return form;
}
for (const length of [undefined, '1']) {
  const req = new Request('https://app.local/api/upload', {
    method: 'POST',
    body: multipart('x'.repeat(27 * 1024 * 1024)),
    headers: length ? { 'Content-Length': length } : {},
  });
  assert.equal((await upload.POST(req)).status, 413);
  checks++;
}
const uploaded = await upload.POST(
  new Request('https://app.local/api/upload', {
    method: 'POST',
    body: multipart(),
  }),
);
assert.equal(uploaded.status, 200);
checks++;
const ownFile = (await uploaded.json()).id;
const fileRoute = load('app/api/file/[id]/route.ts');
const fileRequest = (id, range, method = 'GET') =>
  fileRoute[method](
    new Request('https://app.local/api/file/' + id, {
      method,
      headers: range ? { range } : {},
    }),
    { params: Promise.resolve({ id }) },
  );
for (const [range, expected] of [
  ['bytes=0-3', tiny.slice(0, 4)],
  ['bytes=4-', tiny.slice(4)],
  ['bytes=-3', tiny.slice(-3)],
  ['bytes=0-9999', tiny],
]) {
  const response = await fileRequest(ownFile, range);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), expected);
  checks += 3;
}
for (const range of [
  'bytes=999-',
  'bytes=-0',
  'bytes=4-1',
  'bytes=0-1,4-5',
  'bytes=-',
  'bytes=nope',
]) {
  const response = await fileRequest(ownFile, range);
  assert.equal(response.status, 416);
  checks++;
}
assert.equal(
  (await fileRequest(ownFile, null, 'HEAD')).headers.get('content-length'),
  '20',
);
checks++;
currentHeaders = {};
assert.equal((await fileRequest(ownFile, 'bytes=0-1')).status, 404);
checks++;
assert.equal((await fileRequest(ownFile, null, 'HEAD')).status, 404);
checks++;
currentHeaders = {
  'oai-authenticated-user-id': artist,
  'oai-authenticated-user-email': 'artist@example.test',
};
const minuteKey = artist + ':upload:' + Math.floor(Date.now() / 60000);
db.prepare(
  'INSERT OR REPLACE INTO rate_limits (id,count,expires) VALUES (?,30,?)',
).run(minuteKey, Date.now() + 60000);
assert.equal(
  (
    await upload.POST(
      new Request('https://app.local/api/upload', {
        method: 'POST',
        body: multipart(),
      }),
    )
  ).status,
  429,
);
checks++;

// Feed responses contain project metadata and respect a private creator profile.
db.prepare(
  "INSERT INTO profiles(id,username,name,roles,bio,location,visibility,created) VALUES (?,?,?,'[]','','[]','private',?)",
).run(producer, 'private-producer', 'Hidden name', now);
const stateRoute = load('app/api/state/route.ts');
const state = await (await stateRoute.GET()).json();
assert.ok(
  state.projects.some(
    (p) =>
      p.id === remix.id &&
      p.trackCount === 1 &&
      p.bpm === 92 &&
      p.data === undefined,
  ),
);
checks++;
assert.equal(
  state.tracks.find((t) => t.id === beat).creator,
  'Independent creator',
);
checks++;
console.log('Production API checks passed:', checks);

// Private social loop: notifications, request authorization, accepted messaging,
// retry deduplication, and blocking all run through the real route code.
const socialRoute = load('app/api/social/route.ts');
const socialRecipient = 'engineer_' + now.toString(36);
const socialOutsider = 'outsider_' + now.toString(36);
db.prepare(
  "INSERT INTO profiles(id,username,name,roles,bio,location,visibility,created) VALUES (?,?,?,?,'','','public',?)",
).run(
  socialRecipient,
  socialRecipient.slice(0, 24),
  'Mix Engineer',
  JSON.stringify(['Engineer']),
  now,
);
for (const [id, name, roles] of [
  ['reverse_a_' + now.toString(36), 'Reverse A', ['Artist']],
  ['reverse_b_' + now.toString(36), 'Reverse B', ['Producer']],
  ['atomic_a_' + now.toString(36), 'Atomic A', ['Artist']],
  ['atomic_b_' + now.toString(36), 'Atomic B', ['Engineer']],
])
  db.prepare(
    "INSERT INTO profiles(id,username,name,roles,bio,location,visibility,created) VALUES (?,?,?,?,'','','public',?)",
  ).run(id, id.slice(0, 24), name, JSON.stringify(roles), now);
const reverseA = 'reverse_a_' + now.toString(36);
const reverseB = 'reverse_b_' + now.toString(36);
const atomicA = 'atomic_a_' + now.toString(36);
const atomicB = 'atomic_b_' + now.toString(36);
const socialTrack = crypto.randomUUID();
db.prepare(
  'INSERT INTO tracks (id,owner,title,kind,genre,bpm,musicalKey,visibility,permission,fileId,created) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
).run(
  socialTrack,
  socialRecipient,
  'Midnight Mix',
  'song',
  'R&B',
  92,
  'C minor',
  'public',
  'collaborate',
  fileId,
  now,
);
db.prepare(
  "INSERT INTO profiles(id,username,name,roles,bio,location,visibility,created) VALUES (?,?,?,?,'','','public',?)",
).run(
  artist,
  artist.slice(0, 24),
  'Test Artist',
  JSON.stringify(['Artist']),
  now,
);

async function socialPost(
  userId,
  body,
  status = 200,
  origin = 'https://app.local',
) {
  currentHeaders = userId
    ? {
        'oai-authenticated-user-id': userId,
        'oai-authenticated-user-email': userId + '@example.test',
      }
    : {};
  const response = await socialRoute.POST(
    new Request('https://app.local/api/social', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  const text = await response.text();
  assert.equal(response.status, status, JSON.stringify(body) + ': ' + text);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  checks += 2;
  return JSON.parse(text);
}

async function socialGet(userId, query, status = 200) {
  currentHeaders = userId
    ? {
        'oai-authenticated-user-id': userId,
        'oai-authenticated-user-email': userId + '@example.test',
      }
    : {};
  const response = await socialRoute.GET(
    new Request('https://app.local/api/social?' + query),
  );
  const text = await response.text();
  assert.equal(response.status, status, query + ': ' + text);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  checks += 2;
  return JSON.parse(text);
}

beforeBatch = () => {
  db.exec(`CREATE TRIGGER fail_follow_notice
    BEFORE INSERT ON notifications
    BEGIN SELECT RAISE(ABORT,'notification failure'); END`);
};
suppressExpectedErrors++;
try {
  await act(atomicA, { action: 'follow', id: atomicB, value: true }, 500);
} finally {
  suppressExpectedErrors--;
}
db.exec('DROP TRIGGER fail_follow_notice');
assert.equal(
  db
    .prepare('SELECT COUNT(*) AS count FROM follows WHERE user=? AND target=?')
    .get(atomicA, atomicB).count,
  0,
  'follow creation rolls back when its notification fails',
);
checks++;

beforeBatch = () => {
  db.exec(`CREATE TRIGGER fail_comment_notice
    BEFORE INSERT ON notifications
    BEGIN SELECT RAISE(ABORT,'notification failure'); END`);
};
suppressExpectedErrors++;
try {
  await act(
    atomicA,
    {
      action: 'comments',
      id: socialTrack,
      body: 'This comment must roll back with its notification.',
    },
    500,
  );
} finally {
  suppressExpectedErrors--;
}
db.exec('DROP TRIGGER fail_comment_notice');
assert.equal(
  db
    .prepare('SELECT COUNT(*) AS count FROM comments WHERE body LIKE ?')
    .get('This comment must roll back%').count,
  0,
  'comment creation rolls back when its notification fails',
);
checks++;

await act(artist, { action: 'follow', id: socialRecipient, value: true });
let activity = await socialGet(socialRecipient, 'view=activity');
assert.equal(activity.unread, 1);
assert.equal(activity.items[0].kind, 'follow');
checks += 2;
await socialPost(socialRecipient, { action: 'notificationRead' });
await act(artist, { action: 'follow', id: socialRecipient, value: true });
activity = await socialGet(socialRecipient, 'view=activity');
assert.equal(
  activity.unread,
  0,
  'a retried follow does not become unread again',
);
checks++;
await act(artist, {
  action: 'comments',
  id: socialTrack,
  body: 'The vocal space sounds great.',
});
activity = await socialGet(socialRecipient, 'view=activity');
assert.ok(
  activity.items.some(
    (item) => item.kind === 'comment' && item.resourceId === socialTrack,
  ),
  'a track comment notifies its owner',
);
checks++;

const reverseScope = `profile:${JSON.stringify([reverseA, reverseB].sort())}`;
beforeBatch = () => {
  db.prepare(
    `INSERT INTO collaboration_requests
     (id,sender,recipient,role,message,status,scopeKey,created,updated,operationId)
     VALUES ('reverse-winner',?,?,'Artist','Concurrent reverse request wins.','pending',?,?,?,'reverse-winner')`,
  ).run(reverseB, reverseA, reverseScope, now, now);
};
await socialPost(
  reverseA,
  {
    action: 'collaborationRequest',
    recipient: reverseB,
    role: 'Producer',
    message: 'Concurrent forward request should lose safely.',
  },
  409,
);
assert.equal(
  db
    .prepare(
      "SELECT COUNT(*) AS count FROM collaboration_requests WHERE scopeKey=? AND status IN ('pending','accepted')",
    )
    .get(reverseScope).count,
  1,
  'reverse-direction request race leaves one active request',
);
checks++;

beforeBatch = () => {
  db.exec(`CREATE TRIGGER fail_social_notice
    BEFORE INSERT ON notifications
    BEGIN SELECT RAISE(ABORT,'notification failure'); END`);
};
await socialPost(
  atomicA,
  {
    action: 'collaborationRequest',
    recipient: atomicB,
    role: 'Engineer',
    message: 'This request must roll back with its notification.',
  },
  500,
);
db.exec('DROP TRIGGER fail_social_notice');
assert.equal(
  db
    .prepare(
      'SELECT COUNT(*) AS count FROM collaboration_requests WHERE sender=? AND recipient=?',
    )
    .get(atomicA, atomicB).count,
  0,
  'request creation rolls back when its notification fails',
);
checks++;

const racedBlockNotifications = db
  .prepare(
    "SELECT COUNT(*) AS count FROM notifications WHERE actor=? AND kind='collaboration_request'",
  )
  .get(atomicA).count;
beforeBatch = () => {
  db.prepare('INSERT INTO user_blocks(user,target,created) VALUES (?,?,?)').run(
    atomicB,
    atomicA,
    now,
  );
};
await socialPost(
  atomicA,
  {
    action: 'collaborationRequest',
    recipient: atomicB,
    role: 'Engineer',
    message: 'A concurrent block must stop this request atomically.',
  },
  409,
);
assert.equal(
  db
    .prepare(
      'SELECT COUNT(*) AS count FROM collaboration_requests WHERE sender=? AND recipient=?',
    )
    .get(atomicA, atomicB).count,
  0,
  'a block committed before the request batch prevents the request',
);
assert.equal(
  db
    .prepare(
      "SELECT COUNT(*) AS count FROM notifications WHERE actor=? AND kind='collaboration_request'",
    )
    .get(atomicA).count,
  racedBlockNotifications,
  'a rejected raced request does not create a notification',
);
db.prepare('DELETE FROM user_blocks WHERE user=? AND target=?').run(
  atomicB,
  atomicA,
);

beforeBatch = () => {
  db.prepare("UPDATE profiles SET visibility='private' WHERE id=?").run(
    atomicB,
  );
};
await socialPost(
  atomicA,
  {
    action: 'collaborationRequest',
    recipient: atomicB,
    role: 'Engineer',
    message: 'A concurrent privacy change must stop this request.',
  },
  409,
);
assert.equal(
  db
    .prepare(
      'SELECT COUNT(*) AS count FROM collaboration_requests WHERE sender=? AND recipient=?',
    )
    .get(atomicA, atomicB).count,
  0,
  'a profile made private before the request batch rejects the request',
);
db.prepare("UPDATE profiles SET visibility='public' WHERE id=?").run(atomicB);

const racedTrack = crypto.randomUUID();
db.prepare(
  'INSERT INTO tracks (id,owner,title,kind,genre,bpm,musicalKey,visibility,permission,fileId,created) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
).run(
  racedTrack,
  atomicB,
  'Race track',
  'beat',
  'R&B',
  92,
  'C minor',
  'public',
  'collaborate',
  fileId,
  now,
);
beforeBatch = () => {
  db.prepare("UPDATE tracks SET permission='listen' WHERE id=?").run(
    racedTrack,
  );
};
await socialPost(
  atomicA,
  {
    action: 'collaborationRequest',
    recipient: atomicB,
    track: racedTrack,
    role: 'Engineer',
    message: 'A closed collaboration permission must stop this request.',
  },
  409,
);
assert.equal(
  db
    .prepare(
      'SELECT COUNT(*) AS count FROM collaboration_requests WHERE sender=? AND recipient=? AND track=?',
    )
    .get(atomicA, atomicB, racedTrack).count,
  0,
  'a track closed to collaboration before the request batch rejects the request',
);
checks += 4;

const createdRequest = await socialPost(artist, {
  action: 'collaborationRequest',
  recipient: socialRecipient,
  role: 'Engineer',
  message: 'I would like your mix perspective on a new R&B record.',
});
assert.ok(createdRequest.id);
checks++;
db.prepare(
  "UPDATE profiles SET name='Private new name',visibility='private' WHERE id=?",
).run(socialRecipient);
const snapshotInbox = await socialGet(artist, 'view=inbox');
assert.equal(
  snapshotInbox.requests.find((request) => request.id === createdRequest.id)
    ?.recipientName,
  'Mix Engineer',
  'inbox identity is the request-time public snapshot',
);
db.prepare(
  "UPDATE profiles SET name='Private artist name',visibility='private' WHERE id=?",
).run(artist);
activity = await socialGet(socialRecipient, 'view=activity');
assert.equal(
  activity.items.find((item) => item.kind === 'follow')?.actorName,
  'SESSION member',
  'activity does not expose a private actor profile',
);
checks += 2;
db.prepare(
  "UPDATE profiles SET name='Mix Engineer',visibility='public' WHERE id=?",
).run(socialRecipient);
db.prepare(
  "UPDATE profiles SET name='Test Artist',visibility='public' WHERE id=?",
).run(artist);
await socialPost(
  artist,
  {
    action: 'collaborationRequest',
    recipient: socialRecipient,
    role: 'Engineer',
    message: 'Too short',
  },
  400,
);
await socialPost(
  artist,
  {
    action: 'collaborationRequest',
    recipient: socialRecipient,
    role: 'Engineer',
    message: 'This should not create a duplicate active request.',
  },
  409,
);
await socialPost(
  socialRecipient,
  {
    action: 'collaborationRequest',
    recipient: artist,
    role: 'Artist',
    message: 'Let me send the same profile connection in reverse.',
  },
  409,
);
const withdrawnRequest = await socialPost(artist, {
  action: 'collaborationRequest',
  recipient: socialRecipient,
  track: socialTrack,
  role: 'Engineer',
  message: 'Can you review this specific mix when you have time?',
});
await socialPost(
  socialRecipient,
  {
    action: 'collaborationStatus',
    id: withdrawnRequest.id,
    status: 'closed',
  },
  409,
);
await socialPost(artist, {
  action: 'collaborationStatus',
  id: withdrawnRequest.id,
  status: 'closed',
});

const inbox = await socialGet(socialRecipient, 'view=inbox');
assert.equal(
  inbox.requests.find((request) => request.id === createdRequest.id)?.status,
  'pending',
);
assert.equal(
  inbox.requests.find((request) => request.id === withdrawnRequest.id)?.status,
  'closed',
);
checks += 2;
await socialGet(socialOutsider, 'view=thread&id=' + createdRequest.id, 404);
await socialPost(
  artist,
  { action: 'collaborationStatus', id: createdRequest.id, status: 'accepted' },
  409,
);
await socialPost(socialRecipient, {
  action: 'collaborationStatus',
  id: createdRequest.id,
  status: 'accepted',
});

const messageClientId = crypto.randomUUID();
beforeBatch = () => {
  db.exec(`CREATE TRIGGER fail_message_notice
    BEFORE INSERT ON notifications
    BEGIN SELECT RAISE(ABORT,'notification failure'); END`);
};
await socialPost(
  artist,
  {
    action: 'message',
    id: createdRequest.id,
    message: 'This message must roll back with its notification.',
    clientId: crypto.randomUUID(),
  },
  500,
);
db.exec('DROP TRIGGER fail_message_notice');
assert.equal(
  db
    .prepare('SELECT COUNT(*) AS count FROM direct_messages WHERE request=?')
    .get(createdRequest.id).count,
  0,
  'message creation rolls back when its notification fails',
);
checks++;
const firstMessage = await socialPost(artist, {
  action: 'message',
  id: createdRequest.id,
  message: 'Here is the direction and the reference mix.',
  clientId: messageClientId,
});
const retriedMessage = await socialPost(artist, {
  action: 'message',
  id: createdRequest.id,
  message: 'Here is the direction and the reference mix.',
  clientId: messageClientId,
});
assert.equal(
  retriedMessage.id,
  firstMessage.id,
  'a retried message returns the canonical stored id',
);
db.prepare(
  "UPDATE profiles SET name='Later private artist',visibility='private' WHERE id=?",
).run(artist);
const thread = await socialGet(
  socialRecipient,
  'view=thread&id=' + createdRequest.id,
);
assert.equal(thread.messages.length, 1, 'retried message is stored once');
assert.equal(
  thread.messages[0].body,
  'Here is the direction and the reference mix.',
);
assert.equal(
  thread.messages[0].senderName,
  'Test Artist',
  'message identity is the request-time snapshot',
);
checks += 4;
db.prepare(
  "UPDATE profiles SET name='Test Artist',visibility='public' WHERE id=?",
).run(artist);

activity = await socialGet(socialRecipient, 'view=activity');
assert.ok(activity.items.some((item) => item.kind === 'collaboration_request'));
assert.ok(activity.items.some((item) => item.kind === 'message'));
checks += 2;
await socialPost(socialRecipient, { action: 'notificationRead' });
assert.equal((await socialGet(socialRecipient, 'view=activity')).unread, 0);
checks++;

const pagingRequest = await socialPost(artist, {
  action: 'collaborationRequest',
  recipient: socialRecipient,
  track: socialTrack,
  role: 'Engineer',
  message: 'Can you review the long revision history for this mix?',
});
beforeBatch = () => {
  db.exec(`CREATE TRIGGER fail_status_notice
    BEFORE INSERT ON notifications
    BEGIN SELECT RAISE(ABORT,'notification failure'); END`);
};
await socialPost(
  socialRecipient,
  {
    action: 'collaborationStatus',
    id: pagingRequest.id,
    status: 'accepted',
  },
  500,
);
db.exec('DROP TRIGGER fail_status_notice');
assert.equal(
  db
    .prepare('SELECT status FROM collaboration_requests WHERE id=?')
    .get(pagingRequest.id).status,
  'pending',
  'status change rolls back when its notification fails',
);
checks++;
await socialPost(socialRecipient, {
  action: 'collaborationStatus',
  id: pagingRequest.id,
  status: 'accepted',
});
const insertPageMessage = db.prepare(
  'INSERT INTO direct_messages (id,request,sender,body,created,clientId) VALUES (?,?,?,?,?,?)',
);
db.exec('BEGIN');
for (let index = 0; index < 501; index++)
  insertPageMessage.run(
    `page-message-${String(index).padStart(3, '0')}`,
    pagingRequest.id,
    artist,
    `Page ${index + 1}`,
    now + index,
    `page-client-${index}`,
  );
db.exec('COMMIT');
const pagedThread = await socialGet(
  socialRecipient,
  'view=thread&id=' + pagingRequest.id,
);
assert.equal(pagedThread.messages.length, 500);
assert.equal(pagedThread.messages[0].body, 'Page 2');
assert.equal(pagedThread.messages.at(-1).body, 'Page 501');
checks += 3;

const racedClientId = crypto.randomUUID();
beforeBatch = () => {
  db.prepare(
    "UPDATE collaboration_requests SET status='closed',updated=?,operationId='race-close' WHERE id=?",
  ).run(now + 2000, pagingRequest.id);
};
await socialPost(
  artist,
  {
    action: 'message',
    id: pagingRequest.id,
    message: 'This stale send must not cross the close boundary.',
    clientId: racedClientId,
  },
  409,
);
assert.equal(
  db
    .prepare(
      'SELECT COUNT(*) AS count FROM direct_messages WHERE request=? AND clientId=?',
    )
    .get(pagingRequest.id, racedClientId).count,
  0,
  'an in-flight send cannot commit after the conversation closes',
);
checks++;

await socialPost(socialRecipient, {
  action: 'block',
  target: artist,
  value: true,
});
await socialPost(
  artist,
  {
    action: 'message',
    id: createdRequest.id,
    message: 'Blocked message',
    clientId: crypto.randomUUID(),
  },
  403,
);
const blockedInbox = await socialGet(socialRecipient, 'view=inbox');
assert.equal(blockedInbox.requests[0].status, 'closed');
assert.equal(blockedInbox.blocks[0].target, artist);
checks += 2;
await socialPost(
  artist,
  {
    action: 'collaborationRequest',
    recipient: socialRecipient,
    role: 'Engineer',
    message: 'Blocked request should fail clearly.',
  },
  403,
);
await socialPost(socialRecipient, {
  action: 'block',
  target: artist,
  value: false,
});
assert.equal((await socialGet(socialRecipient, 'view=inbox')).blocks.length, 0);
checks++;
await socialPost(
  artist,
  { action: 'notificationRead' },
  403,
  'https://unrelated.example',
);
await socialGet(null, 'view=activity', 401);

for (const id of ['deterministic-b', 'deterministic-a'])
  db.prepare(
    'INSERT INTO tracks (id,owner,title,kind,genre,bpm,musicalKey,visibility,permission,fileId,created) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    id,
    socialRecipient,
    id,
    'beat',
    'R&B',
    92,
    'C minor',
    'public',
    'listen',
    fileId,
    now + 5000,
  );
currentHeaders = {
  'oai-authenticated-user-id': artist,
  'oai-authenticated-user-email': artist + '@example.test',
};
const deterministicState = await (await stateRoute.GET()).json();
assert.deepEqual(
  deterministicState.tracks
    .filter((track) => track.id.startsWith('deterministic-'))
    .map((track) => track.id),
  ['deterministic-a', 'deterministic-b'],
  'same-millisecond tracks use an id tie-breaker',
);
checks++;

// Native session invitations execute the real API and persist through Alerts.
const inviteHost = 'native-host',
  inviteGuest = 'native-guest';
for (const [id, username, visibility] of [
  [inviteHost, 'native_host', 'public'],
  [inviteGuest, 'native_guest', 'public'],
  ['native-private', 'native_private', 'private'],
  ['native-blocked', 'native_blocked', 'public'],
  ['native-other', 'native_other', 'public'],
])
  await act(id, {
    action: 'profile',
    username,
    name: username,
    roles: ['Producer'],
    visibility,
  });
const inviteRoom = await act(inviteHost, {
  action: 'room',
  title: 'Native invitation session',
  visibility: 'invite',
});
db.prepare('INSERT INTO user_blocks(user,target,created) VALUES (?,?,?)').run(
  'native-blocked',
  inviteHost,
  now,
);
let candidates = await act(inviteHost, {
  action: 'roomInviteCandidates',
  id: inviteRoom.id,
  query: '@native_',
});
assert.deepEqual(
  candidates.profiles.map((p) => p.id),
  [inviteGuest, 'native-other'],
);
checks++;
assert.equal(candidates.memberCount, 1);
checks++;
await act(
  inviteGuest,
  { action: 'inviteRoom', id: inviteRoom.id, recipient: 'native-other' },
  403,
);
await act(
  inviteHost,
  { action: 'inviteRoom', id: inviteRoom.id, recipient: inviteHost },
  400,
);
await act(
  inviteHost,
  { action: 'inviteRoom', id: inviteRoom.id, recipient: 'native-private' },
  409,
);
await act(
  inviteHost,
  { action: 'inviteRoom', id: inviteRoom.id, recipient: 'native-blocked' },
  409,
);
await act(
  null,
  { action: 'inviteRoom', id: inviteRoom.id, recipient: inviteGuest },
  401,
);
await act(inviteHost, {
  action: 'inviteRoom',
  id: inviteRoom.id,
  recipient: inviteGuest,
});
await act(inviteHost, {
  action: 'inviteRoom',
  id: inviteRoom.id,
  recipient: inviteGuest,
});
let invitations = (await socialGet(inviteGuest, 'view=activity')).items.filter(
  (n) => n.resourceType === 'room_invite',
);
assert.equal(invitations.length, 1);
checks++;
assert.equal(invitations[0].inviteStatus, 'pending');
checks++;
assert.ok(
  !JSON.stringify(invitations).includes(
    db.prepare('SELECT invite FROM rooms WHERE id=?').get(inviteRoom.id).invite,
  ),
  'bearer secret stays server-side',
);
checks++;
const inviteNotice = invitations[0].id;
const invitedExport = await act(inviteGuest, { action: 'exportData' });
assert.ok(
  !JSON.stringify(invitedExport).includes(
    db.prepare('SELECT invite FROM rooms WHERE id=?').get(inviteRoom.id).invite,
  ),
  'account export also excludes bearer secrets',
);
checks++;
assert.ok(invitedExport.activity.every((n) => !Object.hasOwn(n, 'uniqueKey')));
checks++;
await act(
  inviteHost,
  { action: 'respondRoomInvite', id: inviteNotice, response: 'accepted' },
  404,
);
let joinedRoom = await act(inviteGuest, {
  action: 'respondRoomInvite',
  id: inviteNotice,
  response: 'accepted',
});
assert.equal(joinedRoom.id, inviteRoom.id);
checks++;
await act(inviteGuest, {
  action: 'respondRoomInvite',
  id: inviteNotice,
  response: 'accepted',
});
assert.equal(
  db
    .prepare('SELECT COUNT(*) n FROM members WHERE room=? AND user=?')
    .get(inviteRoom.id, inviteGuest).n,
  1,
);
checks++;
assert.equal(
  db
    .prepare('SELECT COUNT(*) n FROM room_editors WHERE room=? AND user=?')
    .get(inviteRoom.id, inviteGuest).n,
  0,
  'joining does not grant editing',
);
checks++;
assert.equal(
  (await socialGet(inviteGuest, 'view=activity')).items.find(
    (n) => n.id === inviteNotice,
  ).inviteStatus,
  'joined',
);
checks++;
await act(
  inviteGuest,
  { action: 'inviteRoom', id: inviteRoom.id, recipient: 'native-other' },
  403,
);
await act(inviteHost, {
  action: 'inviteRoom',
  id: inviteRoom.id,
  recipient: 'native-other',
});
let otherNotice = (await socialGet('native-other', 'view=activity')).items.find(
  (n) => n.resourceType === 'room_invite',
);
await act('native-other', {
  action: 'respondRoomInvite',
  id: otherNotice.id,
  response: 'declined',
});
await act(
  'native-other',
  { action: 'respondRoomInvite', id: otherNotice.id, response: 'accepted' },
  403,
);
assert.equal(
  (await socialGet('native-other', 'view=activity')).items.find(
    (n) => n.id === otherNotice.id,
  ).inviteStatus,
  'declined',
);
checks++;
await act(inviteHost, { action: 'rotateInvite', id: inviteRoom.id });
await act(inviteHost, {
  action: 'inviteRoom',
  id: inviteRoom.id,
  recipient: 'native-other',
});
otherNotice = (await socialGet('native-other', 'view=activity')).items.find(
  (n) => n.kind === 'room_invite',
);
await act(inviteHost, { action: 'rotateInvite', id: inviteRoom.id });
await act(
  'native-other',
  { action: 'respondRoomInvite', id: otherNotice.id, response: 'accepted' },
  403,
);
assert.equal(
  (await socialGet('native-other', 'view=activity')).items.find(
    (n) => n.id === otherNotice.id,
  ).inviteStatus,
  'expired',
);
checks++;
// Fill the final seat between authorization and the insertion, not a SQL mirror.
await act(inviteHost, {
  action: 'inviteRoom',
  id: inviteRoom.id,
  recipient: 'native-other',
});
otherNotice = (await socialGet('native-other', 'view=activity')).items.find(
  (n) => n.inviteStatus === 'pending',
);
beforeBatch = () => {
  for (const member of ['seat-3', 'seat-4'])
    db.prepare('INSERT INTO members(room,user,seen) VALUES (?,?,?)').run(
      inviteRoom.id,
      member,
      now,
    );
};
await act(
  'native-other',
  { action: 'respondRoomInvite', id: otherNotice.id, response: 'accepted' },
  409,
);
assert.equal(
  db.prepare('SELECT COUNT(*) n FROM members WHERE room=?').get(inviteRoom.id)
    .n,
  4,
);
checks++;
assert.equal(
  (await socialGet('native-other', 'view=activity')).items.find(
    (n) => n.id === otherNotice.id,
  ).inviteStatus,
  'full',
);
checks++;
db.prepare('DELETE FROM members WHERE room=? AND user=?').run(
  inviteRoom.id,
  'seat-4',
);
await act('native-other', {
  action: 'respondRoomInvite',
  id: otherNotice.id,
  response: 'accepted',
});
await act(inviteHost, {
  action: 'removeMember',
  id: inviteRoom.id,
  user: 'native-other',
});
await act(
  'native-other',
  { action: 'respondRoomInvite', id: otherNotice.id, response: 'accepted' },
  403,
);
await act(inviteHost, {
  action: 'inviteRoom',
  id: inviteRoom.id,
  recipient: 'native-other',
});
otherNotice = (await socialGet('native-other', 'view=activity')).items.find(
  (n) => n.inviteStatus === 'pending',
);
beforeBatch = () =>
  db
    .prepare('INSERT INTO user_blocks(user,target,created) VALUES (?,?,?)')
    .run('native-other', inviteHost, now);
await act(
  'native-other',
  { action: 'respondRoomInvite', id: otherNotice.id, response: 'accepted' },
  403,
);
db.prepare('DELETE FROM user_blocks WHERE user=? AND target=?').run(
  'native-other',
  inviteHost,
);
db.prepare('UPDATE rooms SET expires=? WHERE id=?').run(now - 1, inviteRoom.id);
await act(
  'native-other',
  { action: 'respondRoomInvite', id: otherNotice.id, response: 'accepted' },
  403,
);
await act(
  inviteHost,
  { action: 'inviteRoom', id: inviteRoom.id, recipient: 'native-other' },
  409,
);
await act(inviteHost, { action: 'rotateInvite', id: inviteRoom.id });
await act(inviteHost, {
  action: 'inviteRoom',
  id: inviteRoom.id,
  recipient: 'native-other',
});
otherNotice = (await socialGet('native-other', 'view=activity')).items.find(
  (n) => n.inviteStatus === 'pending',
);
await act(inviteHost, { action: 'closeRoom', id: inviteRoom.id });
await act(
  'native-other',
  { action: 'respondRoomInvite', id: otherNotice.id, response: 'accepted' },
  403,
);
assert.equal(
  (await socialGet('native-other', 'view=activity')).items.find(
    (n) => n.id === otherNotice.id,
  ).inviteStatus,
  'unavailable',
);
checks++;

console.log(
  'Social collaboration and native session invitation backend checks passed:',
  checks,
);
