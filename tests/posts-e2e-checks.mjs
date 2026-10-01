/**
 * Posts E2E: drives the REAL upload and action route handlers (mocked D1/R2
 * and auth, real migrations) through photo upload → post create → like →
 * state-shaped query → watch → delete, mirroring backend-checks' harness.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import vm from 'node:vm';

const root = path.resolve('.');
let checks = 0;
const ok = (condition, message) => {
  assert.ok(condition, message);
  checks++;
};

// ---- migrations
const db = new DatabaseSync(':memory:');
for (const file of fs
  .readdirSync(path.resolve('drizzle'))
  .filter((f) => f.endsWith('.sql'))
  .sort())
  for (const statement of fs
    .readFileSync(path.resolve('drizzle', file), 'utf-8')
    .split('--> statement-breakpoint'))
    if (statement.trim()) db.exec(statement);

const D1 = {
  prepare: (query) => ({
    bind: (...values) => ({
      run: async () => {
        try {
          const r = db.prepare(query).run(...values);
          return { meta: { changes: Number(r.changes || 0) } };
        } catch (e) {
          if (String(e).includes('UNIQUE')) {
            const err = new Error('UNIQUE constraint failed');
            err.message = String(e);
            throw err;
          }
          throw e;
        }
      },
      all: async () => ({ results: db.prepare(query).all(...values) }),
      first: async () => db.prepare(query).get(...values) ?? null,
    }),
  }),
  batch: async (statements) => {
    for (const s of statements) await s.run();
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
  async get(id) {
    const o = R2store.get(id);
    return o
      ? {
          body: new Blob([o]).stream(),
          arrayBuffer: async () => o.slice().buffer,
        }
      : null;
  },
};

let currentUser = null;
const modules = new Map();
const globals = Object.fromEntries(
  [
    'crypto',
    'TextEncoder',
    'TextDecoder',
    'Uint8Array',
    'Blob',
    'File',
    'FormData',
    'Request',
    'Response',
    'AbortController',
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
              get: (k) =>
                currentUser
                  ? ({
                      'oai-authenticated-user-id': currentUser.id,
                      'oai-authenticated-user-email': currentUser.email,
                    }[String(k).toLowerCase()] ?? null)
                  : null,
            }),
          };
        if (id === '@/app/chatgpt-auth')
          return {
            getChatGPTUser: async () =>
              currentUser
                ? { userId: currentUser.id, email: currentUser.email }
                : null,
          };
        if (id.startsWith('.') || id.startsWith('@/')) {
          const target = path.resolve(
            root,
            id.startsWith('@/')
              ? id.slice(2)
              : path.join(path.dirname(file), id),
          );
          const candidates = [
            target,
            target + '.ts',
            target + '.tsx',
            path.join(target, 'index.ts'),
          ];
          const found = candidates.find(
            (c) => fs.existsSync(c) && fs.statSync(c).isFile(),
          );
          if (!found) throw new Error('Cannot resolve ' + id);
          return load(path.relative(root, found).replaceAll('\\', '/'));
        }
        return require(id);
      },
    },
    { filename: file },
  );
  return module.exports;
}

const upload = load('app/api/upload/route.ts');
const action = load('app/api/action/route.ts');

const now = Date.now();
db.prepare(
  'INSERT INTO profiles (id,username,name,roles,bio,location,visibility,rates,created) VALUES (?,?,?,?,?,?,?,?,?)',
).run('vid1', 'lens', 'Lens', '["Videographer"]', '', '', 'public', '[]', now);
db.prepare(
  'INSERT INTO tracks (id,owner,title,kind,genre,bpm,musicalKey,visibility,permission,fileId,created) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
).run(
  'trk1',
  'vid1',
  'Midnight Drive',
  'beat',
  'Trap',
  140,
  'F minor',
  'public',
  'collaborate',
  'fa',
  now,
);

currentUser = { id: 'vid1', email: 'lens@example.test' };

// ---- photo upload through the real handler
const png = new Uint8Array(64);
png.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
const photoForm = new FormData();
photoForm.set('file', new File([png], 'still.png'), 'still.png');
photoForm.set('purpose', 'photo');
const photoRes = await upload.POST(
  new Request('https://app.local/api/upload', {
    method: 'POST',
    body: photoForm,
  }),
);
ok(photoRes.status === 200, 'photo upload accepted');
const { id: photoFileId } = await photoRes.json();
ok(R2store.has(photoFileId), 'photo stored in R2');

// ---- video upload (fake webm magic)
const webm = new Uint8Array(48);
webm.set([26, 69, 223, 163], 0);
const videoForm = new FormData();
videoForm.set('file', new File([webm], 'clip.webm'), 'clip.webm');
videoForm.set('purpose', 'video');
const videoRes = await upload.POST(
  new Request('https://app.local/api/upload', {
    method: 'POST',
    body: videoForm,
  }),
);
ok(videoRes.status === 200, 'video upload accepted');
const { id: videoFileId } = await videoRes.json();

// ---- oversize photo rejected
const big = new Uint8Array(9 * 1024 * 1024);
big.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
const bigForm = new FormData();
bigForm.set('file', new File([big], 'big.png'), 'big.png');
bigForm.set('purpose', 'photo');
const bigRes = await upload.POST(
  new Request('https://app.local/api/upload', {
    method: 'POST',
    body: bigForm,
  }),
);
ok(bigRes.status === 413, 'oversize photo rejected with 413');

// ---- mislabeled photo (audio bytes as photo) rejected
const fake = new FormData();
fake.set(
  'file',
  new File([new TextEncoder().encode('ID3 blah')], 'x.png'),
  'x.png',
);
fake.set('purpose', 'photo');
ok(
  (
    await upload.POST(
      new Request('https://app.local/api/upload', {
        method: 'POST',
        body: fake,
      }),
    )
  ).status === 400,
  'audio bytes rejected as photo',
);

// ---- create post through the real action handler
const act = (body) =>
  action.POST(
    new Request('https://app.local/api/action', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://app.local',
      },
      body: JSON.stringify(body),
    }),
  );
const postRes = await act({
  action: 'post',
  kind: 'photo',
  fileId: photoFileId,
  caption: 'Crimson everything.',
  track: 'trk1',
  visibility: 'public',
});
ok(postRes.status === 200, 'photo post created');
const { id: postId } = await postRes.json();

// foreign file reuse rejected
const stranger = { id: 'stranger1', email: 's@example.test' };
currentUser = stranger;
ok(
  (
    await act({
      action: 'post',
      kind: 'photo',
      fileId: photoFileId,
      visibility: 'public',
    })
  ).status === 400,
  'cannot post someone else’s file',
);
currentUser = { id: 'vid1', email: 'lens@example.test' };

// ---- video post
const vPost = await act({
  action: 'post',
  kind: 'video',
  fileId: videoFileId,
  visibility: 'public',
});
ok(vPost.status === 200, 'video post created');
const { id: videoPostId } = await vPost.json();

// ---- like toggle
let like = await (await act({ action: 'postLike', id: postId })).json();
ok(like.liked === true && like.likes === 1, 'like applied');
like = await (await act({ action: 'postLike', id: postId })).json();
ok(like.liked === false && like.likes === 0, 'like toggled off');

// ---- watch
await act({ action: 'watch', id: videoPostId });
equal(
  db.prepare('SELECT plays FROM posts WHERE id=?').get(videoPostId).plays,
  1,
);
function equal(a, b) {
  assert.deepEqual(a, b);
  checks++;
}

// ---- state-shaped query sees both posts with owner + likes
const rows = db
  .prepare(
    `SELECT p.id,p.kind,(SELECT COUNT(*) FROM post_likes l WHERE l.post=p.id) AS likes
     FROM posts p WHERE p.visibility='public' ORDER BY p.created DESC`,
  )
  .all();
equal(rows.length, 2);

// ---- delete cleans likes
await act({ action: 'deletePost', id: videoPostId });
equal(
  db.prepare('SELECT COUNT(*) AS n FROM posts WHERE id=?').get(videoPostId).n,
  0,
);
equal(
  db
    .prepare('SELECT COUNT(*) AS n FROM post_likes WHERE post=?')
    .get(videoPostId).n,
  0,
);

// ---- guest cannot post
currentUser = null;
ok(
  (
    await act({
      action: 'post',
      kind: 'photo',
      fileId: photoFileId,
      visibility: 'public',
    })
  ).status === 401,
  'guest upload-post rejected',
);

console.log(`PASS: ${checks} posts E2E assertions.`);
