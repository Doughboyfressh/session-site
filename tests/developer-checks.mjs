import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { loadTS } from './load-ts.mjs';

let checks = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks++;
};
const ok = (condition, message) => {
  assert.ok(condition, message);
  checks++;
};
const { isDeveloper } = loadTS('lib/developer-access.ts');
equal(isDeveloper('owner-immutable', 'owner-immutable'), true);
equal(isDeveloper('owner-immutable', ' other-id , owner-immutable '), true);
for (const [id, config] of [
  [null, 'owner-immutable'],
  ['other-id', 'owner-immutable'],
  ['OWNER-immutable', 'owner-immutable'],
  ['owner', 'owner-immutable'],
  ['owner-immutable', undefined],
  ['owner-immutable', []],
  ['owner-immutable', ''],
  ['owner-immutable', '*'],
  ['owner-immutable', 'owner-immutable,'],
  ['owner-immutable', 'owner-immutable, bad id'],
  ['owner-immutable', 'owner-immutable\n,evil\u0000'],
  ['owner-immutable', 'a'.repeat(4097)],
  [
    'owner-immutable',
    Array.from({ length: 33 }, () => 'owner-immutable').join(','),
  ],
  ['owner-immutable ', 'owner-immutable'],
  ['owner@example.test', 'owner@example.test'],
])
  equal(
    isDeveloper(id, config),
    false,
    'configuration and exact ID validation fail closed',
  );

const now = Date.parse('2026-10-03T00:00:15.000Z');
const DAY = 86400000;
const today = Math.floor(now / DAY) * DAY;
const firstDay = today - 13 * DAY;
const since = now - 7 * DAY;
const old = now - 20 * DAY;
const db = new DatabaseSync(':memory:');
for (const file of fs
  .readdirSync('drizzle')
  .filter((f) => f.endsWith('.sql'))
  .sort())
  db.exec(fs.readFileSync('drizzle/' + file, 'utf8'));
checks++;
const profile = (id, username, name, created = old, visibility = 'private') =>
  db
    .prepare(
      'INSERT INTO profiles(id,username,name,roles,bio,location,visibility,created,avatar,rates) VALUES(?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      id,
      username,
      name,
      '["Developer"]',
      'PRIVATE_BIO',
      'PRIVATE_LOCATION',
      visibility,
      created,
      'PRIVATE_AVATAR_FILE',
      '[{"amountCents":999}]',
    );
profile('owner-immutable', 'owner', 'Owner');
profile('editor', 'editor', 'Editor', old, 'public');
profile('creator', 'creator', 'Creator', since);
profile('percent', 'literal%user', 'Percent', firstDay);
profile('underscore', 'literal_user', 'Underscore', today - 1);
profile('slash', 'literal\\user', 'Slash', today);
profile('after-window', 'future', 'Future', now + 1);
profile('before-window', 'before', 'Before', firstDay - 1);
profile('presence', 'presence', 'Presence');
profile('inactive', 'inactive', 'Inactive');
profile('accented', 'accented', 'Élodie');
for (let i = 0; i < 21; i++)
  profile('filler-' + i, 'filler' + i, 'Filler ' + i);
const project = (id, owner, updatedBy, updated) =>
  db
    .prepare(
      'INSERT INTO projects(id,owner,title,data,updated,updatedBy) VALUES(?,?,?,?,?,?)',
    )
    .run(
      id,
      owner,
      'PRIVATE_PROJECT_TITLE',
      '{"secret":"PRIVATE_PROJECT_DATA"}',
      updated,
      updatedBy,
    );
project('project-1', 'owner-immutable', 'editor', now);
project('project-2', 'creator', null, since - 1);
const track = (id, owner, visibility, created) =>
  db
    .prepare(
      'INSERT INTO tracks(id,owner,title,kind,genre,bpm,musicalKey,visibility,permission,fileId,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      id,
      owner,
      'PRIVATE_TRACK_TITLE',
      'beat',
      'Fixture',
      100,
      'C',
      visibility,
      'listen',
      'PRIVATE_TRACK_FILE',
      created,
    );
track('track-1', 'creator', 'public', now);
track('track-2', 'editor', 'private', since - 1);
db.prepare(
  'INSERT INTO posts(id,owner,kind,fileId,caption,visibility,created) VALUES(?,?,?,?,?,?,?)',
).run(
  'post-1',
  'percent',
  'photo',
  'PRIVATE_POST_FILE',
  'PRIVATE_CAPTION',
  'private',
  now,
);
db.prepare(
  'INSERT INTO comments(id,track,user,body,created) VALUES(?,?,?,?,?)',
).run('comment-1', 'track-1', 'underscore', 'PRIVATE_COMMENT_BODY', now);
const room = (id, owner, expires) =>
  db
    .prepare(
      'INSERT INTO rooms(id,owner,title,invite,expires,created) VALUES(?,?,?,?,?,?)',
    )
    .run(id, owner, 'PRIVATE_ROOM_TITLE', 'PRIVATE_ROOM_BEARER', expires, old);
room('room-live', 'owner-immutable', now + DAY);
room('room-live-2', 'owner-immutable', now + DAY);
room('room-empty', 'owner-immutable', now + DAY);
room('room-expired', 'inactive', now);
const member = (roomId, id, seen) =>
  db
    .prepare('INSERT INTO members(room,user,seen) VALUES(?,?,?)')
    .run(roomId, id, seen);
member('room-live', 'presence', now - 30000);
member('room-live-2', 'presence', now - 10000);
member('room-live', 'editor', now);
member('room-live', 'inactive', now - 30001);
member('room-empty', 'after-window', now + 1);
member('room-expired', 'owner-immutable', now);
member('room-deleted', 'inactive', now);
db.prepare(
  'INSERT INTO files(id,owner,name,mime,size,purpose,created) VALUES(?,?,?,?,?,?,?)',
).run(
  'PRIVATE_FILE_ID',
  'owner-immutable',
  'PRIVATE_FILE_NAME',
  'audio/wav',
  1500,
  'audio',
  now,
);
db.prepare(
  'INSERT INTO files(id,owner,name,mime,size,purpose,created) VALUES(?,?,?,?,?,?,?)',
).run(
  'PRIVATE_STATE_ID',
  'owner-immutable',
  'PRIVATE_STATE_NAME',
  'application/octet-stream',
  500,
  'plugin-state',
  now,
);
db.prepare(
  'INSERT INTO reports(id,user,track,body,created) VALUES(?,?,?,?,?)',
).run('report-1', 'creator', 'track-1', 'PRIVATE_REPORT_BODY', now);
db.prepare(
  'INSERT INTO stripe_accounts(user,accountId,details,created) VALUES(?,?,?,?)',
).run('owner-immutable', 'PRIVATE_PAYMENT_ACCOUNT', '{"private":true}', now);
db.prepare(
  'INSERT INTO events(room,sender,kind,body,created) VALUES(?,?,?,?,?)',
).run('room-live', 'editor', 'message', 'PRIVATE_MESSAGE_BODY', now);

const queries = [];
const logs = [];
const fixture = {
  user: null,
  env: { SESSION_DEVELOPER_IDS: 'owner-immutable' },
};
let failQuery = false;
let numericMode = 'number';
const convert = (row) => {
  if (!row || numericMode === 'number') return row;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === 'number'
        ? numericMode === 'bigint'
          ? BigInt(value)
          : String(value)
        : value,
    ]),
  );
};
fixture.env.DB = {
  prepare(sql) {
    let params = [];
    const read = (many) => {
      queries.push({ sql, params });
      assert.match(
        sql.trim(),
        /^SELECT\b/i,
        'dashboard statements must be read only',
      );
      if (failQuery) throw new Error('PRIVATE_DATABASE_FAILURE');
      const statement = db.prepare(sql);
      return many
        ? statement.all(...params).map(convert)
        : convert(statement.get(...params));
    };
    return {
      bind(...values) {
        params = values;
        return this;
      },
      async all() {
        return { results: read(true) };
      },
      async first() {
        return read(false);
      },
    };
  },
};
const bundled = await build({
  entryPoints: ['app/api/developer/route.ts'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  target: 'es2022',
  plugins: [
    {
      name: 'verified-session-and-database-fixture',
      setup(builder) {
        builder.onResolve(
          { filter: /^(cloudflare:workers|@\/app\/chatgpt-auth)$/ },
          (args) => ({ path: args.path, namespace: 'fixture' }),
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents:
            args.path === 'cloudflare:workers'
              ? 'export const env = globalThis.__developerFixture.env;'
              : 'export async function getChatGPTUser() { return globalThis.__developerFixture.user; }',
        }));
      },
    },
  ],
});
const routeModule = { exports: {} };
class FixedDate extends Date {
  static now() {
    return now;
  }
}
vm.runInNewContext(bundled.outputFiles[0].text, {
  module: routeModule,
  exports: routeModule.exports,
  URL,
  Response,
  Request,
  performance,
  Date: FixedDate,
  __developerFixture: fixture,
  console: { info: (line) => logs.push(JSON.parse(line)) },
});
const { GET } = routeModule.exports;
const request = (query = '', headers = {}) =>
  new Request('https://fixture.invalid/api/developer' + query, { headers });
const call = async (query = '', headers = {}) => {
  const response = await GET(request(query, headers));
  equal(response.headers.get('cache-control'), 'private, no-store');
  equal(response.headers.get('vary'), 'Cookie');
  return { response, body: await response.json() };
};
const denied = async (status, query = '', headers = {}) => {
  const before = queries.length;
  const { response, body } = await call(query, headers);
  equal(response.status, status);
  equal(queries.length, before, 'denial must precede every database query');
  equal(Object.keys(body), ['error']);
};
await denied(401, '?page=-1&userId=owner-immutable', {
  'x-developer-id': 'owner-immutable',
  'x-admin': 'true',
  'oai-authenticated-user-id': 'owner-immutable',
});
fixture.user = {
  userId: 'ordinary',
  displayName: 'Owner',
  email: 'owner@example.test',
  roles: ['Developer'],
  isAdmin: true,
};
await denied(403, '?developer=true&userId=owner-immutable');
fixture.user = {
  userId: 'owner-immutable',
  displayName: 'Owner',
  email: 'owner@example.test',
};
fixture.env.SESSION_DEVELOPER_IDS = undefined;
await denied(403);
fixture.env.SESSION_DEVELOPER_IDS = 'owner-immutable,*';
await denied(403);
fixture.env.SESSION_DEVELOPER_IDS = 'owner-immutable';
for (const query of [
  '?page=-1',
  '?page=0',
  '?page=1.5',
  '?page=1e2',
  '?page=1000001',
  '?page=9999999999999999999999',
  '?page=',
  '?q=' + 'x'.repeat(81),
  '?q=%00',
])
  await denied(400, query);

let { response, body } = await call();
equal(response.status, 200);
equal(body.generatedAt, now);
equal(body.metrics, {
  profiles: 32,
  profiles7d: 3,
  publicProfiles: 1,
  projects: 2,
  publicTracks: 1,
  privateTracks: 1,
  posts: 1,
  rooms: 4,
  liveRooms: 3,
  liveParticipants: 3,
  files: 2,
  mediaBytes: 2000,
  reports: 1,
  recordedActiveCreators7d: 8,
});
equal(body.signupDays.length, 14);
equal(body.signupDays[0], { day: '2026-09-20', count: 1 });
equal(body.signupDays[6], { day: '2026-09-26', count: 1 });
equal(body.signupDays[12], { day: '2026-10-02', count: 1 });
equal(body.signupDays[13], { day: '2026-10-03', count: 1 });
equal(
  body.signupDays.reduce((sum, day) => sum + day.count, 0),
  4,
  'out-of-window and future creation excluded',
);
equal(body.users.total, 32);
equal(body.users.items.length, 25);
equal(body.users.pageSize, 25);
equal(body.users.page, 1);
equal(body.health.database, 'reachable');
ok(Number.isSafeInteger(body.health.queryMs) && body.health.queryMs >= 0);
for (const item of body.users.items)
  equal(
    Object.keys(item).sort(),
    [
      'id',
      'username',
      'name',
      'visibility',
      'created',
      'projects',
      'tracks',
    ].sort(),
  );
ok(
  !JSON.stringify(body).includes('PRIVATE_'),
  'response omits private content, files and payment metadata',
);
equal(body.users.items.find((item) => item.id === 'creator').projects, 1);
equal(body.users.items.find((item) => item.id === 'creator').tracks, 1);
const page1Ids = body.users.items.map((item) => item.id);
body = (await call('?page=2')).body;
equal(body.users.items.length, 7);
ok(
  body.users.items.every((item) => !page1Ids.includes(item.id)),
  'stable ordering keeps pages disjoint',
);
equal((await call('?page=1000000')).body.users.items, []);
for (const [query, expected] of [
  ['%25', 'percent'],
  ['_', 'underscore'],
  ['%5C', 'slash'],
  ['%20CrEaToR%20', 'creator'],
  [encodeURIComponent('Élodie'), 'accented'],
  ['%27%20OR%201%3D1--', null],
]) {
  const result = (await call('?q=' + query)).body;
  equal(
    result.users.total,
    expected ? 1 : 0,
    'search treats wildcards and SQL as literal text',
  );
  equal(
    result.users.items.map((item) => item.id),
    expected ? [expected] : [],
  );
}
numericMode = 'string';
equal((await call('?q=creator')).body.users.items[0].created, since);
numericMode = 'bigint';
equal((await call('?q=creator')).body.metrics.mediaBytes, 2000);
numericMode = 'number';
failQuery = true;
({ response, body } = await call());
equal(response.status, 503);
equal(body, { error: 'Developer metrics are unavailable right now.' });
ok(!JSON.stringify(body).includes('PRIVATE_DATABASE_FAILURE'));
failQuery = false;
db.prepare('UPDATE files SET size=? WHERE id=?').run(
  Number.MAX_SAFE_INTEGER,
  'PRIVATE_STATE_ID',
);
equal(
  (await call()).response.status,
  503,
  'unsafe aggregate numbers fail instead of displaying inaccurate totals',
);
for (const entry of logs) {
  equal(Object.keys(entry).sort(), ['route', 'status', 'durationMs'].sort());
  equal(entry.route, '/api/developer');
  ok(Number.isSafeInteger(entry.durationMs) && entry.durationMs >= 0);
}
ok(
  !JSON.stringify(logs).includes('owner-immutable') &&
    !JSON.stringify(logs).includes('PRIVATE_'),
);

// Record the actual parameterized queries, translated for a read-only PostgreSQL EXPLAIN.
const { postgresSQL } = loadTS('lib/deployment/sql.ts');
const uniqueQueries = [
  ...new Map(queries.map((entry) => [entry.sql, entry])).values(),
];
const literal = (value) =>
  typeof value === 'number'
    ? String(value)
    : "'" + String(value).replaceAll("'", "''") + "'";
const explain = uniqueQueries
  .map(({ sql, params }) => {
    const translated = postgresSQL(sql);
    return (
      'EXPLAIN ' +
      translated.replace(/\$(\d+)/g, (_, index) =>
        literal(params[Number(index) - 1]),
      ) +
      ';'
    );
  })
  .join('\n\n');
fs.mkdirSync('outputs/release-checks', { recursive: true });
fs.writeFileSync('outputs/release-checks/developer-postgres.sql', explain);
fs.writeFileSync(
  'outputs/release-checks/developer-query-evidence.json',
  JSON.stringify(uniqueQueries, null, 2),
);
// The access page exposes only the authenticated visitor's immutable ID.
const pageBundle = await build({
  entryPoints: ['app/developer/page.tsx'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'],
  plugins: [{
    name: 'access-page-fixture',
    setup(builder) {
      builder.onResolve({ filter: /chatgpt-auth|^cloudflare:workers$|^next\/link$|^\.\/dashboard$|\.css$/ },
        args => ({ path: args.path, namespace: 'page-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'page-fixture' }, args => ({
        contents: args.path.includes('chatgpt-auth')
          ? 'export async function getChatGPTUser(){return globalThis.__developerFixture.user;} export function chatGPTSignInPath(){return "/fixture-signin";}'
          : args.path === 'cloudflare:workers'
            ? 'export const env=globalThis.__developerFixture.env;'
            : args.path === 'next/link'
              ? 'import {jsx} from "react/jsx-runtime"; export default function Link(props){return jsx("a",props);}'
              : args.path === './dashboard'
                ? 'import {jsx} from "react/jsx-runtime"; export default function Dashboard(){return jsx("div",{children:"AUTHORIZED_METRICS_FIXTURE"});}'
                : '',
      }));
    },
  }],
});
const pageModule = { exports: {} };
vm.runInNewContext(pageBundle.outputFiles[0].text, {
  module: pageModule,
  exports: pageModule.exports,
  require: createRequire(import.meta.url),
  __developerFixture: fixture,
});
const renderPage = async () => renderToStaticMarkup(await pageModule.exports.default());
fixture.env.SESSION_DEVELOPER_IDS = 'owner-immutable';
fixture.user = null;
let pageHTML = await renderPage();
ok(pageHTML.includes('Sign in to SESSION'));
ok(!pageHTML.includes('Account ID:') && !pageHTML.includes('owner-immutable'));
fixture.user = { userId: 'different-authenticated-id' };
pageHTML = await renderPage();
ok(pageHTML.includes('Account ID: <code>different-authenticated-id</code>'));
ok(!pageHTML.includes('owner-immutable') && !pageHTML.includes('AUTHORIZED_METRICS_FIXTURE'));
fixture.user = { userId: '<img src=x onerror=alert(1)>' };
pageHTML = await renderPage();
ok(pageHTML.includes('&lt;img') && !pageHTML.includes('<img'));
fixture.user = { userId: 'owner-immutable' };
pageHTML = await renderPage();
ok(pageHTML.includes('AUTHORIZED_METRICS_FIXTURE') && !pageHTML.includes('Account ID:'));

db.close();
console.log(
  `PASS: ${checks} developer authorization, privacy, metrics, UTC, pagination, literal search, logging and failure assertions.`,
);
