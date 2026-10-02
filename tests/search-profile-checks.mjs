import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';
import { loadTS } from './load-ts.mjs';

// Exercise the actual route and SQL against disposable local records. Search
// creator dialogs need the same public service fields as the People directory.
const db = new DatabaseSync(':memory:');
for (const file of fs
  .readdirSync('drizzle')
  .filter((f) => f.endsWith('.sql'))
  .sort())
  db.exec(fs.readFileSync('drizzle/' + file, 'utf8'));
const rates = JSON.stringify([
  { service: 'Synthetic mix review', role: 'Engineer', amountCents: 1500 },
]);
for (const [id, visibility] of [
  ['public', 'public'],
  ['private', 'private'],
  ['unconnected', 'public'],
])
  db.prepare(
    'INSERT INTO profiles(id,username,name,roles,bio,location,visibility,created,rates) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run(
    id,
    id,
    'Search Fixture ' + id,
    '["Engineer"]',
    'Synthetic profile',
    'Fixture City',
    visibility,
    1,
    rates,
  );
db.prepare(
  'INSERT INTO stripe_accounts(user,accountId,chargesEnabled,payoutsEnabled,created) VALUES (?,?,?,?,?)',
).run('public', 'acct_private_fixture_only', 1, 1, 1);
const module = { exports: {} };
const queries = [];
const limits = [];
let user = null;
let failQuery = false;
const code = ts.transpileModule(
  fs.readFileSync('app/api/search/route.ts', 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
vm.runInNewContext(code, {
  module,
  exports: module.exports,
  Request,
  Response,
  URL,
  require(id) {
    if (id === '@/app/chatgpt-auth')
      return { getChatGPTUser: async () => user };
    if (id === '@/lib/server')
      return {
        limit: async (...args) => limits.push(args),
        all: async (sql, ...args) => {
          if (failQuery) throw new Error('Synthetic database failure');
          queries.push(sql);
          return db.prepare(sql).all(...args);
        },
      };
    throw new Error('Unexpected dependency: ' + id);
  },
});
const { GET } = module.exports;
const request = (query) =>
  new Request(
    'https://fixture.invalid/api/search?q=' + encodeURIComponent(query),
    {
      headers: { 'x-forwarded-for': '192.0.2.1' },
    },
  );
const response = await GET(request('Search Fixture'));
assert.equal(response.status, 200);
assert.equal(response.headers.get('cache-control'), 'private, no-store');
const data = await response.json();
assert.equal(data.profiles.length, 2, 'private creators stay excluded');
const profile = data.profiles.find((p) => p.id === 'public');
assert.equal(profile.location, 'Fixture City');
assert.deepEqual(JSON.parse(profile.rates), JSON.parse(rates));
assert.equal(profile.chargesEnabled, 1);
assert.equal(
  data.profiles.find((p) => p.id === 'unconnected').chargesEnabled,
  0,
);
assert.deepEqual(
  Object.keys(profile).sort(),
  [
    'id',
    'username',
    'name',
    'roles',
    'bio',
    'avatar',
    'location',
    'rates',
    'followers',
    'chargesEnabled',
  ].sort(),
  'only explicit public fields are exported',
);
assert.ok(!JSON.stringify(data).includes('acct_private_fixture_only'));
assert.deepEqual(limits[0], ['search-ip:192.0.2.1', 'search-ip', 60]);
user = { userId: 'fixture-member' };
await GET(request('Search Fixture'));
assert.deepEqual(limits[1], ['fixture-member', 'search', 240]);
const before = queries.length;
assert.deepEqual(await (await GET(request('x'))).json(), {
  tracks: [],
  profiles: [],
});
assert.equal(queries.length, before, 'short queries do not run SQL');
failQuery = true;
const failure = await GET(request('Search Fixture'));
assert.equal(failure.status, 503);
assert.deepEqual(await failure.json(), {
  error: 'Search is unavailable right now.',
});

// Save the exact translated query for a read-only PostgreSQL EXPLAIN check.
const { postgresSQL } = loadTS('lib/deployment/sql.ts');
const profileSQL = queries.find((sql) => sql.includes('p.rates'));
assert.ok(profileSQL, 'service fields are selected by the actual route');
const postgres = postgresSQL(profileSQL);
assert.match(postgres, /a\."user"=p\.id/);
assert.match(postgres, /"chargesEnabled"/);
fs.mkdirSync('outputs/ui-audit-evidence', { recursive: true });
fs.writeFileSync(
  'outputs/ui-audit-evidence/search-profile-postgres.sql',
  'EXPLAIN ' + postgres.replaceAll('$1', "'%search fixture%'"),
);
db.close();
console.log(
  'Search creator services, public-field privacy, auth budget, failure, and SQL translation checks passed.',
);
