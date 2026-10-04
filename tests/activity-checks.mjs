import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { loadTS } from './load-ts.mjs';

let checks = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks++;
};
const ok = (actual, message) => {
  assert.ok(actual, message);
  checks++;
};
const clean = (value) => JSON.parse(JSON.stringify(value));
const {
  ACTIVITY_COOKIE,
  activityDay,
  activityHash,
  activitySecret,
  activityVisitor,
} = loadTS('lib/activity.ts');
const secret = 'offline-fixture-secret-'.repeat(3);
const now = Date.parse('2026-10-03T00:00:15Z');
equal(activityDay(now), '2026-10-03');
equal(activitySecret({}), null);
equal(
  activitySecret({
    SESSION_ACTIVITY_SECRET: 'short',
    NEON_AUTH_COOKIE_SECRET: secret,
  }),
  null,
);
equal(
  activitySecret({
    SESSION_ACTIVITY_SECRET: '',
    NEON_AUTH_COOKIE_SECRET: secret,
  }),
  secret,
);
equal(
  activitySecret({
    SESSION_ACTIVITY_SECRET: null,
    NEON_AUTH_COOKIE_SECRET: secret,
  }),
  null,
);
equal(activitySecret({ SESSION_ACTIVITY_SECRET: secret }), secret);
const first = await activityVisitor(secret, null, now);
const cookie = first.setCookie.split(';')[0];
equal((await activityVisitor(secret, cookie, now)).id, first.id);
equal((await activityVisitor(secret, cookie, now)).setCookie, null);
ok(first.setCookie.includes('HttpOnly; Secure; SameSite=Lax'));
ok(first.setCookie.includes('Path=/;') && !first.setCookie.includes('Domain='));
ok(first.setCookie.includes('Max-Age=86385'));
ok(first.setCookie.includes('Expires=Sun, 04 Oct 2026 00:00:00 GMT'));
for (const malformed of [
  '',
  ACTIVITY_COOKIE + '=untrusted',
  cookie + 'x',
  cookie.replace('v1.', 'v2.'),
  cookie.replace(first.id, '00000000-0000-4000-8000-000000000000'),
  cookie.replace('2026-10-03', '2026-10-02'),
  cookie + '; ' + cookie,
  ACTIVITY_COOKIE + '=' + 'x'.repeat(10000),
])
  ok(
    (await activityVisitor(secret, malformed, now)).id !== first.id,
    'invalid/duplicate/tampered cookies are replaced',
  );
ok((await activityVisitor(secret + 'changed', cookie, now)).id !== first.id);
const tomorrow = now + 86400000;
ok(
  (await activityVisitor(secret, cookie, tomorrow)).id !== first.id,
  'UTC day rollover rotates browser ID',
);
const visitorHash = await activityHash(
  secret,
  'visitor',
  '2026-10-03',
  first.id,
);
ok(/^[0-9a-f]{64}$/.test(visitorHash));
equal(
  await activityHash(secret, 'visitor', '2026-10-03', first.id),
  visitorHash,
);
ok(
  (await activityHash(secret, 'visitor', '2026-10-04', first.id)) !==
    visitorHash,
);
ok(
  (await activityHash(secret, 'user', '2026-10-03', first.id)) !== visitorHash,
  'hash domains cannot be confused',
);

const db = new DatabaseSync(':memory:');
for (const name of fs
  .readdirSync('drizzle')
  .filter((name) => name.endsWith('.sql'))
  .sort())
  db.exec(fs.readFileSync('drizzle/' + name, 'utf8'));
const fixture = {
  now,
  env: { SESSION_ACTIVITY_SECRET: secret },
  processEnv: { DEPLOYMENT_TARGET: 'vercel' },
  request: null,
  session: null,
  authReads: 0,
  failAuth: false,
  failQuery: false,
  failSecondInsert: false,
  numberMode: 'number',
};
const queries = [];
const convert = (row) =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === 'number' && fixture.numberMode !== 'number'
        ? fixture.numberMode === 'bigint'
          ? BigInt(value)
          : String(value)
        : value,
    ]),
  );
fixture.env.DB = {
  prepare(sql) {
    let params = [];
    return {
      bind(...values) {
        params = values;
        return this;
      },
      execute() {
        queries.push({ sql, params });
        if (fixture.failQuery) throw new Error('sensitive-database-failure');
        const statement = db.prepare(sql);
        if (/^\s*SELECT/i.test(sql))
          return {
            results: statement.all(...params).map(convert),
            meta: { changes: 0 },
          };
        const result = statement.run(...params);
        return { results: [], meta: { changes: Number(result.changes) } };
      },
      async all() {
        return this.execute();
      },
      async first() {
        return this.execute().results[0] || null;
      },
    };
  },
  async batch(statements) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement, index) => {
        if (fixture.failSecondInsert && index === 1)
          throw new Error('sensitive-second-insert-failure');
        return statement.execute();
      });
      db.exec('COMMIT');
      return results;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  },
};
const bundled = await build({
  stdin: {
    contents:
      'export {POST} from "./app/api/activity/route"; export {readDeveloperActivity} from "./lib/activity-server";',
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  target: 'es2022',
  plugins: [
    {
      name: 'activity-deployment-fixture',
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /^(cloudflare:workers|next\/headers|next\/navigation|@\/lib\/deployment\/auth)$/,
          },
          (args) => ({ path: args.path, namespace: 'fixture' }),
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents:
            args.path === 'cloudflare:workers'
              ? 'export const env=globalThis.__activityFixture.env;'
              : args.path === 'next/headers'
                ? 'export async function headers(){globalThis.__activityFixture.authReads++;return globalThis.__activityFixture.request.headers;}'
                : args.path === 'next/navigation'
                  ? 'export function redirect(){throw new Error("unexpected redirect");}'
                  : 'export function neonAuth(){return {async getSession(){const f=globalThis.__activityFixture;f.authReads++;if(f.failAuth)throw new Error("sensitive-auth-failure");return {data:f.session};}};}',
        }));
      },
    },
  ],
});
const route = { exports: {} };
class FixedDate extends Date {
  static now() {
    return fixture.now;
  }
}
vm.runInNewContext(bundled.outputFiles[0].text, {
  module: route,
  exports: route.exports,
  crypto: webcrypto,
  TextEncoder,
  Uint8Array,
  URL,
  Request,
  Response,
  Date: FixedDate,
  process: { env: fixture.processEnv },
  __activityFixture: fixture,
});
const { POST, readDeveloperActivity } = route.exports;
const request = (
  headers = {},
  body,
  url = 'https://studio.example.test/api/activity',
) =>
  new Request(url, {
    method: 'POST',
    headers: { Origin: 'https://studio.example.test', ...headers },
    ...(body === undefined ? {} : { body }),
  });
const call = async (req) => {
  fixture.request = req;
  const result = await POST(req);
  equal(result.headers.get('cache-control'), 'private, no-store');
  equal(result.headers.get('vary'), 'Cookie, Origin');
  equal(
    await result.text(),
    '',
    'telemetry responses never disclose identity or content',
  );
  return result;
};
const counts = () =>
  db
    .prepare(
      'SELECT kind,COUNT(*) AS count FROM activity_daily GROUP BY kind ORDER BY kind',
    )
    .all()
    .map(clean);
const activity = async (at = fixture.now) =>
  clean(await readDeveloperActivity(at));
const clear = () => db.exec('DELETE FROM activity_daily'); // disposable in-memory fixture only
let data = await activity();
equal(data.status, 'ready');
equal(data.collectedSince, null);
equal(data.visitorsToday, 0);
equal(data.dailyActiveUsersToday, 0);
equal(data.days.length, 14);
equal(data.days[0], { day: '2026-09-20', visitors: null, activeUsers: null });
equal(data.days[13], { day: '2026-10-03', visitors: 0, activeUsers: 0 });
for (const req of [
  request({ origin: 'https://attacker.example.test' }),
  request({ origin: 'null' }),
  request({ origin: '' }),
  request({ origin: 'https://studio.example.test.attacker.test' }),
  request({ 'content-type': 'application/json' }),
  request({ 'content-type': 'text/plain' }, '{}'),
  request({ 'content-length': '1' }),
  request({ 'content-length': '-1' }),
  request({ 'content-length': '000' }),
  request({}, 'private content'),
]) {
  const before = [queries.length, fixture.authReads];
  const result = await call(req);
  ok([400, 403, 415].includes(result.status));
  equal(result.headers.get('set-cookie'), null);
  equal(
    [queries.length, fixture.authReads],
    before,
    'rejection precedes auth and every database query',
  );
}
let result = await call(request());
equal(result.status, 204);
const browserCookie = result.headers.get('set-cookie').split(';')[0];
equal(counts(), [{ kind: 'visitor', count: 1 }]);
for (let index = 0; index < 3; index++)
  equal((await call(request({ cookie: browserCookie }))).status, 204);
await Promise.all(
  Array.from({ length: 12 }, () => call(request({ cookie: browserCookie }))),
);
equal(
  counts(),
  [{ kind: 'visitor', count: 1 }],
  'duplicate foreground pings and established-cookie tabs count once',
);
result = await call(
  request({
    cookie: browserCookie,
    'oai-authenticated-user-id': 'forged-account',
    'oai-authenticated-user-email': 'forged@example.test',
    'x-user-id': 'forged-account',
  }),
);
equal(result.status, 204);
equal(
  counts(),
  [{ kind: 'visitor', count: 1 }],
  'Vercel getChatGPTUser ignores forged dispatcher identity headers',
);
fixture.session = {
  user: {
    id: 'verified-profileless-account',
    name: 'Fixture',
    email: 'fixture@example.test',
  },
};
equal(db.prepare('SELECT COUNT(*) AS count FROM profiles').get().count, 0);
equal((await call(request({ cookie: browserCookie }))).status, 204);
equal(counts(), [
  { kind: 'user', count: 1 },
  { kind: 'visitor', count: 1 },
]);
await Promise.all(
  Array.from({ length: 8 }, () => call(request({ cookie: browserCookie }))),
);
equal(counts(), [
  { kind: 'user', count: 1 },
  { kind: 'visitor', count: 1 },
]);
equal((await call(request())).status, 204);
equal(
  counts(),
  [
    { kind: 'user', count: 1 },
    { kind: 'visitor', count: 2 },
  ],
  'one verified account across browsers counts once for DAU',
);
fixture.session.user.id = 'another-verified-account';
equal((await call(request({ cookie: browserCookie }))).status, 204);
equal(counts(), [
  { kind: 'user', count: 2 },
  { kind: 'visitor', count: 2 },
]);
data = await activity();
equal(data.collectedSince, '2026-10-03');
equal(data.visitorsToday, 2);
equal(data.dailyActiveUsersToday, 2);
equal(
  data.days
    .slice(0, 13)
    .every((day) => day.visitors === null && day.activeUsers === null),
  true,
);
for (const mode of ['string', 'bigint']) {
  fixture.numberMode = mode;
  equal(
    (await activity()).visitorsToday,
    2,
    'portable database aggregate numeric types',
  );
}
fixture.numberMode = 'number';
const stored = db.prepare('SELECT * FROM activity_daily').all();
for (const row of stored) {
  equal(Object.keys(row).sort(), ['day', 'kind', 'subjectHash'].sort());
  ok(/^[0-9a-f]{64}$/.test(row.subjectHash));
}
ok(
  !JSON.stringify(stored).includes('verified-') &&
    !JSON.stringify(stored).includes('fixture@example.test'),
);

const originalHashes = stored.map((row) => row.subjectHash);
fixture.now = Date.parse('2026-10-03T23:59:59.999Z');
const late = await call(request());
ok(late.headers.get('set-cookie').includes('Max-Age=1;'));
const lateCookie = late.headers.get('set-cookie').split(';')[0];
fixture.now = Date.parse('2026-10-04T00:00:00.000Z');
const next = await call(request({ cookie: lateCookie }));
equal(next.status, 204);
ok(next.headers.get('set-cookie').includes('v1.2026-10-04.'));
const nextRows = db
  .prepare('SELECT * FROM activity_daily WHERE day=?')
  .all('2026-10-04');
equal(nextRows.length, 2);
ok(
  nextRows.every((row) => !originalHashes.includes(row.subjectHash)),
  'daily subjects are unlinkable from the prior UTC day',
);
data = await activity();
equal(data.days[12], { day: '2026-10-03', visitors: 3, activeUsers: 2 });
equal(data.days[13], { day: '2026-10-04', visitors: 1, activeUsers: 1 });
data = await activity(Date.parse('2026-10-05T12:00:00Z'));
equal(data.visitorsToday, 0);
equal(data.dailyActiveUsersToday, 0);
equal(data.collectedSince, '2026-10-03');

clear();
fixture.now = now;
fixture.processEnv.DEPLOYMENT_TARGET = 'sites';
fixture.session = null;
equal(
  (
    await call(
      request({
        'oai-authenticated-user-id': 'trusted-sites-user',
        'oai-authenticated-user-email': 'sites@example.test',
      }),
    )
  ).status,
  204,
);
equal(
  counts(),
  [
    { kind: 'user', count: 1 },
    { kind: 'visitor', count: 1 },
  ],
  'Sites trusted dispatcher path is preserved',
);
fixture.processEnv.DEPLOYMENT_TARGET = 'vercel';
clear();
fixture.env.SESSION_ACTIVITY_SECRET = undefined;
const beforeNoSecret = [queries.length, fixture.authReads];
equal((await call(request())).status, 204);
equal([queries.length, fixture.authReads], beforeNoSecret);
data = await activity();
equal(data, {
  status: 'not-configured',
  timezone: 'UTC',
  collectedSince: null,
  visitorsToday: null,
  dailyActiveUsersToday: null,
  days: [],
});
fixture.env.NEON_AUTH_COOKIE_SECRET = secret;
equal((await call(request())).status, 204);
equal(
  counts(),
  [{ kind: 'visitor', count: 1 }],
  'existing server-only Neon cookie secret is a cryptographic fallback',
);
fixture.env.SESSION_ACTIVITY_SECRET = 'short';
equal(
  (await activity()).status,
  'not-configured',
  'invalid explicit secret cannot silently fall back',
);
fixture.env.SESSION_ACTIVITY_SECRET = secret;
clear();
fixture.failQuery = true;
result = await call(request());
equal(result.status, 503);
equal(result.headers.get('set-cookie'), null);
equal(await activity(), {
  status: 'unavailable',
  timezone: 'UTC',
  collectedSince: null,
  visitorsToday: null,
  dailyActiveUsersToday: null,
  days: [],
});
fixture.failQuery = false;
fixture.failAuth = true;
equal((await call(request())).status, 503);
equal(
  counts(),
  [],
  'auth verification failure cannot count an unverified user or partially count a visitor',
);
fixture.failAuth = false;
fixture.session = {
  user: {
    id: 'verified-profileless-account',
    name: 'Fixture',
    email: 'fixture@example.test',
  },
};
fixture.failSecondInsert = true;
equal((await call(request())).status, 503);
equal(counts(), [], 'visitor/account writes roll back together');
fixture.failSecondInsert = false;
db.prepare(
  'INSERT INTO activity_daily(day,kind,subjectHash) VALUES (?,?,?)',
).run('2026-08-01', 'visitor', 'a'.repeat(64));
db.prepare(
  'INSERT INTO activity_daily(day,kind,subjectHash) VALUES (?,?,?)',
).run('2026-10-04', 'visitor', 'b'.repeat(64));
data = await activity();
equal(
  data.collectedSince,
  '2026-08-01',
  'collection start remains known beyond the displayed 14-day window',
);
equal(
  data.days.every((day) => day.visitors === 0 && day.activeUsers === 0),
  true,
  'future measurements are excluded',
);

const { postgresSQL } = loadTS('lib/deployment/sql.ts');
const insert = queries.find((entry) =>
  entry.sql.startsWith('INSERT OR IGNORE'),
);
equal(
  postgresSQL(insert.sql),
  'INSERT INTO activity_daily(day,kind,"subjectHash") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
);
const read = queries.find((entry) => entry.sql.includes('AS collectedSince'));
const translatedRead = postgresSQL(read.sql);
ok(translatedRead.includes('AS "collectedSince"'));
ok(translatedRead.includes('day>=$2 AND day<=$1'));
ok(translatedRead.includes('ORDER BY day ASC LIMIT 1'));
const unique = [
  ...new Map(queries.map((entry) => [entry.sql, entry])).values(),
];
ok(
  unique.length === 2,
  'collection only inserts dedupe hashes and reads a bounded aggregate',
);
fs.mkdirSync('outputs/release-checks', { recursive: true });
fs.writeFileSync(
  'outputs/release-checks/activity-query-evidence.json',
  JSON.stringify(unique, null, 2),
);
const literal = (value) => "'" + String(value).replaceAll("'", "''") + "'";
fs.writeFileSync(
  'outputs/release-checks/activity-postgres.sql',
  unique
    .map(
      ({ sql, params }) =>
        'EXPLAIN ' +
        postgresSQL(sql).replace(/\$(\d+)/g, (_, index) =>
          literal(params[Number(index) - 1]),
        ) +
        ';',
    )
    .join('\n\n'),
);
ok(
  !JSON.stringify(unique).includes('verified-') &&
    !JSON.stringify(unique).includes('example.test'),
);
equal(
  fs
    .readFileSync('deploy/002-session-activity.sql', 'utf8')
    .includes('CREATE TABLE IF NOT EXISTS activity_daily'),
  true,
);
db.close();
console.log(
  `PASS: ${checks} daily activity cookie, identity, privacy, UTC, atomicity, concurrency, SQLite and PostgreSQL translation assertions.`,
);
