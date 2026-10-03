import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve('.');
const db = new DatabaseSync(':memory:');
for (const file of fs.readdirSync('drizzle').filter((name) => name.endsWith('.sql')).sort())
  db.exec(fs.readFileSync(path.join('drizzle', file), 'utf8'));
const objects = new Map();
let user = 'owner', beforeBatch;
const D1 = {
  prepare(sql) {
    return { sql, args: [], bind(...args) { return { ...this, args }; },
      async first() { return db.prepare(sql).get(...this.args) || null; },
      async all() { return { results: db.prepare(sql).all(...this.args) }; },
      async run() { return { meta: db.prepare(sql).run(...this.args) }; } };
  },
  async batch(statements) {
    if (beforeBatch) { const action = beforeBatch; beforeBatch = undefined; action(); }
    db.exec('BEGIN');
    try {
      const result = statements.map(({ sql, args }) => ({ results: db.prepare(sql).all(...args), meta: { changes: db.prepare('SELECT changes() n').get().n } }));
      db.exec('COMMIT'); return result;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  },
};
const globals = Object.fromEntries(['crypto', 'TextEncoder', 'TextDecoder', 'Uint8Array', 'Float32Array', 'ArrayBuffer', 'DataView',
  'Blob', 'File', 'FormData', 'Request', 'Response', 'AbortController', 'AbortSignal', 'DOMException', 'ReadableStream',
  'URL', 'structuredClone', 'console', 'setTimeout', 'clearTimeout'].map((key) => [key, globalThis[key]]));
const cache = new Map();
function load(relative) {
  const file = path.resolve(root, relative);
  assert.ok(file.startsWith(root + path.sep));
  if (cache.has(file)) return cache.get(file).exports;
  const fixtureModule = { exports: {} }; cache.set(file, fixtureModule);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const require = (id) => {
      if (id === '@/app/chatgpt-auth') return { getChatGPTUser: async () => user ? { userId: user } : null };
      if (id === 'cloudflare:workers') return { env: { DB: D1, FILES: {
        async put(id, stream) { objects.set(id, new Uint8Array(await new Response(stream).arrayBuffer())); },
        async delete(id) { objects.delete(id); },
        async get(id) { return objects.has(id) ? { body: new Blob([objects.get(id)]).stream() } : null; },
      } } };
      if (!id.startsWith('.') && !id.startsWith('@/')) throw Error('Unexpected import ' + id);
      const base = id.startsWith('@/') ? path.join(root, id.slice(2)) : path.resolve(path.dirname(file), id);
      const resolved = [base, base + '.ts', base + '.tsx'].find((name) => fs.existsSync(name));
      if (!resolved) throw Error('Missing module ' + id);
      return load(resolved);
  };
  // One JavaScript realm, as in production; keep storage and identity injected.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- Execute the actual transpiled modules with fixture-only dependencies.
  new Function('require', 'module', 'exports', 'fetch', ...Object.keys(globals), code)(
    require, fixtureModule, fixtureModule.exports, () => { throw Error('Network is disabled in the local API fixture.'); }, ...Object.values(globals));
  return fixtureModule.exports;
}
const plain = (value) => JSON.parse(JSON.stringify(value));
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
const equal = (a, b, message) => { assert.deepEqual(plain(a), plain(b), message); checks++; };
const rejects = (action, pattern) => { assert.throws(action, pattern); checks++; };
const { defaults } = load('lib/audio.ts');
const { defaultBrowserInstrument } = load('lib/browser-instruments.ts');
const { validateInstrumentPlugin, validateVst3State, pluginFingerprint, projectInstrumentFiles } = load('lib/instrument-plugins.ts');
const { validateArrangement } = load('lib/arrangement-validation.ts');
const { recoverySnapshot } = load('lib/draft-recovery.ts');
const { cleanProject, mergeProject } = load('lib/project-merge.ts');
const { changeArrangementTempo } = load('lib/arrangement-tempo.ts');
const { saveProject } = load('lib/project-save.ts');
const { readProject, fileAccess } = load('lib/server.ts');
const { POST: acceptUpload } = load('app/api/upload/route.ts');
const { GET: readFile, HEAD: headFile } = load('app/api/file/[id]/route.ts');
const { applyNotePatch } = load('lib/note-edit.ts');
const native = { format: 'vst3', version: 1, classId: '1'.repeat(32), name: 'Synthetic VST3', vendor: 'Test vendor' };
const note = { id: 'note', pitch: 60, start: 0, length: 1, velocity: 0.75 };
const track = (plugin = native) => ({ ...defaults('Plugin track'), plugin: plain(plugin), notes: [plain(note)] });
const snapshot = (instrument) => ({ title: 'Plugin project', data: { bpm: 120, tracks: [track(instrument)] } });
for (const instrument of [native, defaultBrowserInstrument('session-wavetable'), defaultBrowserInstrument('session-fm')]) {
  const project = snapshot(instrument);
  validateArrangement(project.data); checks++;
  equal(recoverySnapshot(project), project, 'Recovery retains instrument and score');
  equal(cleanProject(project), project, 'Cloud save retains instrument and score');
  equal(JSON.parse(JSON.stringify(project)), project, 'JSON round trip');
  const changed = changeArrangementTempo(project.data, 60);
  equal(changed.tracks[0].plugin, instrument, 'Tempo preserves plugin settings');
  check(changed.tracks[0].duration === 8.5, 'Tempo recomputes generated source duration');
}
for (const value of [null, {}, { ...native, version: 2 }, { ...native, classId: '../../evil' },
  { ...native, token: 'forbidden' }, { ...native, stateFileId: '/api/other' },
  { ...native, freeze: { fileId: 'audio', fingerprint: 'invalid' } }, Object.create(native)])
  rejects(() => validateInstrumentPlugin(value));
for (const source of [{ sound: 'keys' }, { fileId: 'audio' }, { sample: {} }, { demo: 'demo-1' }, { sequence: [] }, { notes: undefined }])
  rejects(() => validateArrangement({ bpm: 120, tracks: [{ ...track(), ...source }] }));
const state = { version: 1, format: 'vst3', classId: native.classId, component: Buffer.from('synthetic state').toString('base64'), controller: '' };
equal(validateVst3State(state), state);
for (const patch of [{ component: 'A===' }, { component: 'AB==' }, { component: 'AAA!' }, { controller: null },
  { classId: native.classId.toUpperCase().replace('1', 'G') }, { version: 2 }, { modulePath: 'C:/private' },
  { component: Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64') }]) rejects(() => validateVst3State({ ...state, ...patch }));
rejects(() => validateVst3State(Object.create(state)));
const baseTrack = track({ ...native, stateFileId: 'state-owned' });
const fingerprint = await pluginFingerprint(baseTrack, 120);
check(/^[0-9a-f]{64}$/.test(fingerprint));
equal(await pluginFingerprint({ ...baseTrack, volume: 0.2, offset: 2, pan: 1, reverb: 0.5 }, 120), fingerprint, 'Mixer and clips preserve dry rendering');
for (const changed of [{ ...baseTrack, notes: [{ ...note, pitch: 64 }] }, { ...baseTrack, noteLoopBeats: 16 },
  { ...baseTrack, plugin: { ...baseTrack.plugin, stateFileId: 'new-state' } }])
  check(await pluginFingerprint(changed, 120) !== fingerprint, 'Changed sound or score invalidates render');
check(await pluginFingerprint(baseTrack, 90) !== fingerprint, 'Tempo invalidates render');
const frozen = { ...native, stateFileId: 'state-owned', freeze: { fileId: 'render-owned', fingerprint } };
equal(projectInstrumentFiles(snapshot(frozen).data), [{ id: 'state-owned', purpose: 'plugin-state' }, { id: 'render-owned', purpose: 'audio' }]);
rejects(() => projectInstrumentFiles(snapshot({ ...frozen, freeze: { ...frozen.freeze, fileId: 'state-owned' } }).data));
const base = snapshot(frozen), local = plain(base), remote = plain(base);
local.data.tracks[0].plugin.stateFileId = 'new-state';
remote.data.tracks[0].notes[0].pitch = 72;
const merge = mergeProject(base, local, remote);
check(merge.conflicts.length > 0, 'Concurrent plugin/score edits require a whole-source choice');
rejects(() => applyNotePatch(local.data, 120, base.data.tracks[0], { notes: [note] }), /changed/, 'Stale plugin edit cannot overwrite a new sound');

const body = (purpose, value) => {
  const form = new FormData(); form.set('purpose', purpose);
  form.set('file', new File([typeof value === 'string' ? value : JSON.stringify(value)], 'fixture.json'));
  return new Request('https://session.test/api/upload', { method: 'POST', headers: { origin: 'https://session.test' }, body: form });
};
let response = await acceptUpload(body('plugin-state', state));
equal(response.status, 200, 'Valid private state upload');
const stateId = (await response.json()).id;
check(objects.has(stateId));
equal(db.prepare('SELECT purpose,mime FROM files WHERE id=?').get(stateId), { purpose: 'plugin-state', mime: 'application/vnd.session.vst3-state+json' });
response = await acceptUpload(body('plugin-state', { ...state, component: 'not base64' }));
equal(response.status, 400, 'Malformed state upload denied');
const fixtures = [['render-owned', 'owner', 'audio'], ['state-other', 'other', 'plugin-state'], ['audio-other', 'other', 'audio']];
for (const [id, owner, purpose] of fixtures) db.prepare('INSERT INTO files(id,owner,name,mime,size,purpose,created) VALUES(?,?,?,?,?,?,?)')
  .run(id, owner, 'Synthetic', 'audio/wav', 44, purpose, 1);
const persisted = snapshot({ ...frozen, stateFileId: stateId });
const saved = await saveProject(persisted, 'owner', 1);
equal((await readProject(saved.id, 'owner')).data, persisted.data, 'Save/reopen preserves state and rendered audio');
equal(db.prepare('SELECT file FROM project_files WHERE project=? ORDER BY file').all(saved.id).map((row) => row.file), [stateId, 'render-owned'].sort((a, b) => a.localeCompare(b)), 'Both private source references linked');
for (const [instrument, expected] of [[{ ...frozen, stateFileId: 'state-other' }, 403], [{ ...frozen, stateFileId: 'render-owned' }, 400],
  [{ ...frozen, stateFileId: stateId, freeze: { fileId: 'state-other', fingerprint } }, 403]]) {
  let caught; try { await saveProject(snapshot(instrument), 'owner', 1); } catch (error) { caught = error; }
  equal(caught?.status, expected, 'Foreign or wrong-purpose references denied');
}
// Even a forged public listing or avatar cannot turn opaque state into public data.
db.prepare('INSERT INTO tracks(id,owner,title,kind,genre,bpm,musicalKey,visibility,permission,fileId,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
  .run('forged-listing', 'other', 'Synthetic', 'beat', 'Test', 120, 'C', 'public', 'collaborate', 'state-other', 1);
check(!(await fileAccess('state-other', '')), 'Public listing cannot expose plugin state');
check(!(await fileAccess('state-other', 'owner')), 'Foreign state remains private');
let foreign; try { await saveProject(snapshot({ ...native, stateFileId: 'state-other' }), 'owner', 1); } catch (error) { foreign = error; }
equal(foreign?.status, 403, 'Public-collaborate rule applies only to audio');
db.prepare('INSERT INTO rooms(id,owner,title,project,invite,expires,created) VALUES(?,?,?,?,?,?,?)')
  .run('room', 'owner', 'Synthetic', saved.id, 'invite', 9999999999999, 1);
db.prepare('INSERT INTO members(room,user,seen) VALUES(?,?,?)').run('room', 'viewer', 1);
check(!!(await fileAccess(stateId, 'viewer')), 'Current project member can read instrument state');
check(!(await fileAccess(stateId, 'outsider')), 'Nonmember cannot read state');
user = 'viewer';
response = await headFile(new Request('https://session.test/api/file/' + stateId), { params: Promise.resolve({ id: stateId }) });
equal(response.status, 200); equal(response.headers.get('cache-control'), 'private, no-store');
db.prepare('DELETE FROM members WHERE room=? AND user=?').run('room', 'viewer');
response = await readFile(new Request('https://session.test/api/file/' + stateId), { params: Promise.resolve({ id: stateId }) });
equal(response.status, 404, 'Revoked membership denies state file');
user = '';
equal((await acceptUpload(body('plugin-state', state))).status, 401, 'Guest cannot upload plugin state');
user = 'owner';
beforeBatch = () => db.prepare('DELETE FROM files WHERE id=?').run('render-owned');
let race; try { await saveProject({ ...persisted, id: saved.id, baseRevision: 1 }, 'owner', 2); } catch (error) { race = error; }
equal(race?.status, 409, 'Source disappearance at commit prevents save');
equal(db.prepare('SELECT revision FROM projects WHERE id=?').get(saved.id).revision, 1, 'Failed source race leaves revision intact');
db.close();
console.log(`${checks} instrument plugin model, recovery, merge, privacy and actual API/SQL checks passed.`);
