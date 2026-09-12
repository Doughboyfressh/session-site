import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

// Entirely local: production TypeScript and SQL, an in-memory D1 adapter, no HTTP.
// Unlike tests/clip-api-checks.mjs and creation-api-checks.mjs, no dev server runs.
const root = path.resolve(process.cwd());
const ts = createRequire(path.join(root, 'package.json'))('typescript');
const db = new DatabaseSync(':memory:');
for (const file of fs.readdirSync(path.join(root, 'drizzle')).filter(f => f.endsWith('.sql')).sort())
  db.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8'));
let beforeBatch;
const D1 = {
  prepare(sql) {
    return {
      sql, args: [],
      bind(...args) { return { ...this, args }; },
      async first() { return db.prepare(sql).get(...this.args) || null; },
      async all() { return { results: db.prepare(sql).all(...this.args) }; },
      async run() { return { meta: db.prepare(sql).run(...this.args) }; },
    };
  },
  async batch(statements) {
    if (beforeBatch) { const hook = beforeBatch; beforeBatch = undefined; await hook(); }
    db.exec('BEGIN');
    try {
      const result = statements.map(({ sql, args }) => ({
        results: db.prepare(sql).all(...args),
        meta: { changes: db.prepare('SELECT changes() n').get().n },
      }));
      db.exec('COMMIT');
      return result;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  },
};
const modules = new Map();
const globals = Object.fromEntries([
  'crypto', 'TextEncoder', 'TextDecoder', 'Uint8Array', 'Float32Array', 'ArrayBuffer',
  'DataView', 'Blob', 'File', 'FormData', 'Request', 'Response', 'AbortController',
  'AbortSignal', 'DOMException', 'ReadableStream', 'URL', 'structuredClone', 'console',
].map(key => [key, globalThis[key]]));
function blocked() { throw new Error('Network and object storage are disabled in this local authorization harness.'); }
function load(file) {
  file = path.resolve(root, file);
  assert.ok(file.startsWith(root + path.sep), 'Production imports must remain inside the checkout');
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    ...globals, fetch: blocked, module, exports: module.exports,
    require(id) {
      if (id === 'cloudflare:workers') return { env: { DB: D1, FILES: { get: blocked, put: blocked, delete: blocked } } };
      if (!id.startsWith('.') && !id.startsWith('@/')) throw new Error('Unexpected external production import: ' + id);
      const base = id.startsWith('@/') ? path.join(root, id.slice(2)) : path.resolve(path.dirname(file), id);
      const resolved = [base, base + '.ts', base + '.tsx', path.join(base, 'index.ts')]
        .find(f => fs.existsSync(f) && fs.statSync(f).isFile());
      if (!resolved) throw new Error('Cannot resolve ' + id + ' from ' + file);
      return load(resolved);
    },
  }, { filename: file });
  return module.exports;
}
const { saveProject } = load('lib/project-save.ts');
const { readProject, fileAccess } = load('lib/server.ts');
let assertions = 0, passed = 0;
const failures = [];
const id = () => crypto.randomUUID();
const plain = value => JSON.parse(JSON.stringify(value));
const equal = (actual, expected, message) => { assert.deepEqual(plain(actual), plain(expected), message); assertions++; };
const check = (condition, message) => { assert.ok(condition, message); assertions++; };
const count = table => db.prepare('SELECT COUNT(*) n FROM ' + table).get().n;
const totals = () => ['projects', 'project_files', 'project_versions', 'project_creations'].map(count);
async function denied(work, status, message) {
  let caught;
  try { await work(); } catch (error) { caught = error; }
  check(caught, message + ': request must fail');
  equal(caught.status, status, message + ': rejection status');
}
async function scenario(name, work) {
  try { await work(); passed++; console.log('PASS ' + name); }
  catch (error) { failures.push(name + ': ' + error.message); console.error('FAIL ' + name + ': ' + error.message); }
  finally { beforeBatch = undefined; }
}
function audio(owner = id(), purpose = 'audio') {
  const file = id();
  db.prepare('INSERT INTO files(id,owner,name,mime,size,purpose,created) VALUES (?,?,?,?,?,?,?)')
    .run(file, owner, 'Synthetic sample.wav', purpose === 'audio' ? 'audio/wav' : 'image/png', 96044, purpose, 1);
  return { file, owner };
}
function track(fileId) {
  return {
    id: id(), name: 'Synthetic sampled instrument', fileId,
    sample: { rootPitch: 60, start: 0.1, end: 0.9, attack: 0.005, release: 0.08 },
    notes: [{ id: id(), pitch: 64, start: 0, length: 1, velocity: 0.75 }],
    volume: 0.8, pan: 0, muted: false, solo: false,
    offset: 0, trimStart: 0, trimEnd: 0, low: 0, mid: 0, high: 0,
  };
}
const body = file => ({ title: 'Synthetic sample authorization', data: { bpm: 120, tracks: [track(file)] } });
function listing(source, visibility = 'public', permission = 'collaborate') {
  const key = id();
  db.prepare('INSERT INTO tracks(id,owner,title,kind,genre,bpm,musicalKey,visibility,permission,fileId,created) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(key, source.owner, 'Synthetic listing', 'beat', 'Test', 120, 'C', visibility, permission, source.file, 1);
  return key;
}
function grant(project, owner, editor = id()) {
  const room = id();
  db.prepare('INSERT INTO rooms(id,owner,title,project,invite,expires,created) VALUES (?,?,?,?,?,?,?)')
    .run(room, owner, 'Synthetic private room', project, id(), 9999999999999, 1);
  db.prepare('INSERT INTO members(room,user,seen) VALUES (?,?,?)').run(room, editor, 1);
  db.prepare('INSERT INTO room_editors(room,project,user,grantedBy,created) VALUES (?,?,?,?,?)')
    .run(room, project, editor, owner, 1);
  return { room, editor, revoke: () => db.prepare('DELETE FROM room_editors WHERE room=? AND user=?').run(room, editor) };
}
async function editRequest(project, editor) {
  const saved = await readProject(project, editor);
  return { id: project, title: 'Edited sampled instrument', baseRevision: saved.revision, data: plain(saved.data) };
}

try {
  await scenario('owned audio saves, reloads and links the complete source once', async () => {
    const source = audio(), request = body(source.file);
    request.data.tracks.push({ ...plain(request.data.tracks[0]), id: id() });
    const result = await saveProject(request, source.owner, 10);
    equal(result.revision, 1, 'Initial revision');
    const saved = await readProject(result.id, source.owner);
    equal(saved.data, request.data, 'Saved sample settings, notes and source identity round-trip');
    equal(db.prepare('SELECT file FROM project_files WHERE project=?').all(result.id).map(r => r.file), [source.file], 'One shared asset link for two sampled tracks');
    equal(JSON.parse(db.prepare('SELECT data FROM project_versions WHERE project=?').get(result.id).data), request.data, 'Version retains sampler settings');
    equal((await fileAccess(source.file, source.owner)).id, source.file, 'Owner can retrieve source');
    equal(await fileAccess(source.file, id()), null, 'Private source unavailable to outsider');
  });

  await scenario('private foreign source rejects ordinary and receipt-backed first saves atomically', async () => {
    const source = audio(), outsider = id();
    for (const creation of [undefined, { key: id(), checkpoint: true }]) {
      const before = totals(), request = { ...body(source.file), ...(creation ? { creation } : {}) };
      await denied(() => saveProject(request, outsider, 20), 403, 'Foreign private source');
      equal(totals(), before, 'Rejected save leaves no project, source link, version or receipt');
    }
  });

  await scenario('public listening allows reading but confers no collaboration grant', async () => {
    const source = audio(), listener = id();
    listing(source, 'public', 'listen');
    equal((await fileAccess(source.file, listener)).id, source.file, 'Public listening remains available');
    const before = totals();
    await denied(() => saveProject(body(source.file), listener, 30), 403, 'Listen-only source reuse');
    equal(totals(), before, 'Listen-only rejection creates no project grant');
  });

  await scenario('public collaboration grants a project source but later privacy blocks new reuse', async () => {
    const source = audio(), producer = id(), publicListing = listing(source);
    const result = await saveProject(body(source.file), producer, 40);
    equal((await readProject(result.id, producer)).data.tracks[0].sample.rootPitch, 60, 'Collaborative sampled track saved');
    db.prepare("UPDATE tracks SET visibility='private',permission='listen' WHERE id=?").run(publicListing);
    const update = await editRequest(result.id, producer);
    update.data.tracks[0].sample.rootPitch = 62;
    equal((await saveProject(update, producer, 41)).revision, 2, 'Existing authorized project source remains usable');
    const before = totals();
    await denied(() => saveProject(body(source.file), producer, 42), 403, 'New project after public grant withdrawal');
    equal(totals(), before, 'New project cannot inherit an unrelated project link');
  });

  await scenario('room editor can edit an existing private project sample without owning its source', async () => {
    const source = audio(), result = await saveProject(body(source.file), source.owner, 50);
    const access = grant(result.id, source.owner);
    equal((await fileAccess(source.file, access.editor)).id, source.file, 'Room member reads existing project source');
    const update = await editRequest(result.id, access.editor);
    update.data.tracks[0].notes[0].pitch = 67;
    equal((await saveProject(update, access.editor, 51)).revision, 2, 'Granted editor saves sampled notes');
    const saved = await readProject(result.id, source.owner);
    equal(saved.data.tracks[0].notes[0].pitch, 67, 'Owner reloads collaborator note edit');
    equal(saved.data.tracks[0].sample, update.data.tracks[0].sample, 'Sample settings preserved by collaborator save');
    await denied(() => saveProject(body(source.file), access.editor, 52), 403, 'Existing-project source cannot be copied into arbitrary project');
    access.revoke();
    const unchanged = db.prepare('SELECT data,revision FROM projects WHERE id=?').get(result.id);
    await denied(() => saveProject({ ...update, baseRevision: 2 }, access.editor, 53), 403, 'Revoked editing grant');
    equal(db.prepare('SELECT data,revision FROM projects WHERE id=?').get(result.id), unchanged, 'Revoked editor cannot change notes or revision');
    equal((await readProject(result.id, access.editor)).canEdit, false, 'Remaining room membership is read-only');
    equal((await fileAccess(source.file, access.editor)).id, source.file, 'Edit revocation preserves authorized listening membership');
    db.prepare('DELETE FROM members WHERE room=? AND user=?').run(access.room, access.editor);
    equal(await fileAccess(source.file, access.editor), null, 'Removing membership ends private source access');
    await denied(() => readProject(result.id, access.editor), 403, 'Removed member project read');
  });

  await scenario('editing revocation between preflight and transaction prevents sampled save', async () => {
    const source = audio(), result = await saveProject(body(source.file), source.owner, 60);
    const access = grant(result.id, source.owner), request = await editRequest(result.id, access.editor);
    request.data.tracks[0].sample.start = 0.2;
    const before = totals(), unchanged = db.prepare('SELECT data,revision FROM projects WHERE id=?').get(result.id);
    beforeBatch = access.revoke;
    await denied(() => saveProject(request, access.editor, 61), 403, 'Transaction-time edit revocation');
    equal(totals(), before, 'Revoked transaction leaves no source link or version');
    equal(db.prepare('SELECT data,revision FROM projects WHERE id=?').get(result.id), unchanged, 'Revoked transaction leaves project unchanged');
  });

  await scenario('source grant withdrawal between preflight and transaction prevents new save', async () => {
    const source = audio(), publicListing = listing(source), before = totals();
    beforeBatch = () => db.prepare("UPDATE tracks SET permission='listen' WHERE id=?").run(publicListing);
    await denied(() => saveProject(body(source.file), id(), 70), 403, 'Transaction-time collaboration withdrawal');
    equal(totals(), before, 'Withdrawn source leaves no project, grant, history or receipt');
  });

  await scenario('deleted source cannot be revived by an existing project_files link', async () => {
    const source = audio(), result = await saveProject(body(source.file), source.owner, 80);
    const request = await editRequest(result.id, source.owner), before = totals();
    db.prepare('DELETE FROM files WHERE id=?').run(source.file);
    equal(await fileAccess(source.file, source.owner), null, 'Deleted source is inaccessible despite retained project reference');
    await denied(() => saveProject(request, source.owner, 81), 403, 'Deleted source save');
    equal(totals(), before, 'Missing source rejection creates no version or replacement file link');
    equal((await readProject(result.id, source.owner)).revision, 1, 'Missing source does not advance project');
  });

  await scenario('own non-audio assets cannot be authorized as sampler sources', async () => {
    for (const purpose of ['avatar', 'take']) {
      const source = audio(id(), purpose), before = totals();
      await denied(() => saveProject(body(source.file), source.owner, 90), 403, 'Disallowed source purpose ' + purpose);
      equal(totals(), before, 'Non-audio source creates no authorization link');
    }
  });

  await scenario('invalid sampled-instrument schema fails before writing authorization state', async () => {
    const source = audio();
    for (const change of [
      t => { delete t.sample; },
      t => { t.sample.rootPitch = 128; },
      t => { t.sample.end = t.sample.start; },
      t => { t.sequence = Array.from({ length: 3 }, () => Array(16).fill(0)); },
    ]) {
      const request = body(source.file), before = totals();
      change(request.data.tracks[0]);
      await denied(() => saveProject(request, source.owner, 100), 400, 'Malformed sampled instrument');
      equal(totals(), before, 'Invalid schema creates no project or file grant');
    }
  });
} finally { db.close(); }
if (failures.length) {
  console.error(`FAIL: ${failures.length} scenarios failed; ${passed} passed; ${assertions} assertions completed.\n${failures.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`PASS: ${passed} sampled-instrument authorization scenarios, ${assertions} assertions. Actual production SQL and functions; SQLite memory only; no HTTP or object-storage access.`);
}

