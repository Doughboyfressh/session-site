import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';
import { loadTS } from './load-ts.mjs';
const db = new DatabaseSync(':memory:');
db.exec(
  `CREATE TABLE files(id TEXT PRIMARY KEY,owner TEXT,name TEXT,mime TEXT,size INTEGER,purpose TEXT,created INTEGER);CREATE TABLE projects(id TEXT PRIMARY KEY,owner TEXT);CREATE TABLE rooms(id TEXT PRIMARY KEY,owner TEXT,project TEXT);CREATE TABLE members(room TEXT,user TEXT);CREATE TABLE room_editors(room TEXT,project TEXT,user TEXT,grantedBy TEXT);INSERT INTO projects VALUES('project','owner');INSERT INTO rooms VALUES('room','owner','project');INSERT INTO members VALUES('room','editor'),('room','listener');INSERT INTO room_editors VALUES('room','project','editor','owner');`,
);
let user = 'owner',
  beforePut = () => {},
  deleted = 0;
const objects = new Set();
const fail = (m, status = 400) => {
  throw Object.assign(Error(m), { status });
};
const serverSource = await fs.readFile(
  new URL('../lib/server.ts', import.meta.url),
  'utf8',
);
const serverExports = {};
vm.runInNewContext(
  ts.transpileModule(serverSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  { exports: serverExports, require: () => ({ env: {} }) },
);
const server = {
  limit: async () => {}, // Rate limiting is exercised against real SQL in backend-checks.
  fail,
  projectEditCondition: serverExports.projectEditCondition,
  str: serverExports.str,
  choice: serverExports.choice,
  one: async (sql, ...args) => db.prepare(sql).get(...args),
  run: async (sql, ...args) => ({ meta: db.prepare(sql).run(...args) }),
  bucket: () => ({
    put: async (id) => {
      objects.add(id);
      await beforePut();
    },
    delete: async (id) => {
      objects.delete(id);
      deleted++;
    },
  }),
};
const exports = {};
const code = ts.transpileModule(
  await fs.readFile(
    new URL('../app/api/upload/route.ts', import.meta.url),
    'utf8',
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
vm.runInNewContext(code, {
  exports,
  require: (id) =>
    id.includes('upload-body')
      ? loadTS('lib/upload-body.ts')
      : id.includes('chatgpt-auth')
        ? { getChatGPTUser: async () => (user ? { userId: user } : null) }
        : server,
  File,
  Response,
  Request,
  crypto,
  Uint8Array,
  TextDecoder,
  Date,
  console,
});
const bytes = new Uint8Array(44);
bytes.set(new TextEncoder().encode('RIFF'));
bytes.set(new TextEncoder().encode('WAVE'), 8);
let checks = 0;
const eq = (a, b) => {
  assert.deepEqual(a, b);
  checks++;
};
async function send(projectId = 'project', purpose = 'audio') {
  const fd = new FormData();
  fd.set('purpose', purpose);
  fd.set('file', new File([bytes], 'take.wav', { type: 'audio/wav' }));
  if (projectId) fd.set('projectId', projectId);
  const r = await exports.POST(
    new Request('http://127.0.0.1/api/upload', { method: 'POST', body: fd }),
  );
  return { status: r.status, body: await r.json() };
}
eq((await send()).status, 200);
user = 'editor';
eq((await send()).status, 200);
user = 'listener';
eq((await send()).status, 403);
user = 'outsider';
eq((await send()).status, 403);
eq((await send('missing')).status, 403);
eq((await send('')).status, 200);
user = '';
eq((await send()).status, 401);
user = 'editor';
const beforeFiles = db.prepare('SELECT COUNT(*) AS n FROM files').get().n,
  beforeObjects = objects.size;
beforePut = () => db.exec('DELETE FROM room_editors');
eq((await send()).status, 409);
eq(db.prepare('SELECT COUNT(*) AS n FROM files').get().n, beforeFiles);
eq(objects.size, beforeObjects);
eq(deleted, 1);
beforePut = () => {};
eq((await send()).status, 403);
db.exec("INSERT INTO room_editors VALUES('room','project','editor','owner')");
beforePut = () => db.exec("UPDATE rooms SET project=NULL WHERE id='room'");
eq((await send()).status, 409);
eq(objects.size, beforeObjects);
eq(deleted, 2);
beforePut = () => {};
user = 'owner';
db.exec(
  "INSERT INTO files VALUES('quota','owner','quota','audio/wav',524288000,'audio',0)",
);
eq((await send()).status, 400);
db.exec("DELETE FROM files WHERE id='quota'");
// Quota is checked again in the same metadata statement, after object staging.
beforePut = () =>
  db.exec(
    "INSERT INTO files VALUES('quota','owner','quota','audio/wav',524288000,'audio',0)",
  );
eq((await send()).status, 409);
eq(objects.size, beforeObjects);
eq(deleted, 3);
db.close();
console.log(
  `${checks} upload authorization and staged-object rollback checks passed.`,
);
