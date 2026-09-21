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
