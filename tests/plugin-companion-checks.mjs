import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const modules = new Map();
const requests = [];
let stateRead, nativeRender, healthRead;
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const plugin = { format: 'vst3', version: 1, classId: 'a'.repeat(32), name: 'Synthetic instrument', vendor: 'SESSION test', stateFileId: 'state-fixture' };
const state = { version: 1, format: 'vst3', classId: plugin.classId, component: '', controller: '' };
const track = { id: 'synthetic', plugin, notes: [{ pitch: 60, start: 0, length: 1, velocity: 0.7 }], noteLoopBeats: 8 };
const fetchFixture = async (input, options = {}) => {
  const url = String(input);
  requests.push({ url, options });
  if (url.startsWith('/api/file/')) {
    if (stateRead) await stateRead.promise;
    // Intentionally complete despite cancellation to test ownership rechecks.
    return Response.json(state);
  }
  if (url.endsWith('/health')) {
    if (healthRead) await healthRead.promise;
    return Response.json({ version: 1, platform: 'win32', nativeAvailable: true });
  }
  if (url.endsWith('/plugins') || url.endsWith('/rescan'))
    return Response.json({ plugins: [{ classId: plugin.classId, name: plugin.name, vendor: plugin.vendor, version: '1' }] });
  if (url.endsWith('/editor')) return Response.json({ state });
  if (url.endsWith('/render')) {
    if (nativeRender) await nativeRender.promise;
    return new Response(new Uint8Array([82, 73, 70, 70]));
  }
  throw Error('Unexpected fixture request ' + url);
};
function load(file) {
  const full = path.resolve(file);
  if (modules.has(full)) return modules.get(full);
  const exports = {}; modules.set(full, exports);
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const run = new vm.Script('(function(exports, require, fetch) {' + code + '\n})', { filename: full }).runInThisContext();
  run(exports, (id) => load(path.resolve(path.dirname(full), id) + '.ts'), fetchFixture);
  return exports;
}
const api = load('lib/plugin-companion.ts');
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
const tick = () => new Promise((resolve) => setImmediate(resolve));
const connect = () => api.connectCompanion('b'.repeat(64));
for (const operation of ['render', 'editor']) {
  await api.connectCompanion('a'.repeat(64));
  stateRead = deferred();
  const start = requests.length;
  const pending = (operation === 'render' ? api.renderVst3(track, 120) : api.editVst3(plugin, 120))
    .then(() => null, (error) => error);
  await tick();
  const oldRead = requests.slice(start).find((request) => request.url.startsWith('/api/file/'));
  check(oldRead, 'Operation reads its private state');
  api.disconnectCompanion();
  check(oldRead.options.signal.aborted, 'Disconnect cancels the owned state read');
  await connect();
  stateRead.resolve(); stateRead = undefined;
  check((await pending)?.name === 'AbortError', 'Old operation is rejected');
  check(!requests.slice(start).some((request) => request.url.endsWith('/' + operation)), 'Old operation never reaches the newly paired native host');
  check(api.companionSnapshot().connected, 'New pairing remains connected');
}
await connect();
stateRead = deferred();
const abort = new AbortController();
const cancelled = api.renderVst3(track, 120, 44100, abort.signal).catch((error) => error);
await tick(); abort.abort(); stateRead.resolve(); stateRead = undefined;
check((await cancelled).name === 'AbortError', 'Caller cancellation owns private-state reads');

await connect();
nativeRender = deferred();
const start = requests.length;
const first = api.renderVst3({ ...track, plugin: { ...plugin, stateFileId: undefined } }, 120).catch((error) => error);
const second = api.renderVst3({ ...track, plugin: { ...plugin, stateFileId: undefined } }, 120).catch((error) => error);
await tick();
check(requests.slice(start).filter((request) => request.url.endsWith('/render')).length === 1, 'Native jobs are serialized');
api.disconnectCompanion(); nativeRender.resolve(); nativeRender = undefined;
check((await first).name === 'AbortError' && (await second).name === 'AbortError', 'Disconnect rejects running and queued jobs');
check(requests.slice(start).filter((request) => request.url.endsWith('/render')).length === 1, 'Queued job cannot cross disconnect');

healthRead = deferred();
const oldPairing = api.connectCompanion('a'.repeat(64)).catch((error) => error);
await tick(); api.disconnectCompanion();
healthRead.resolve(); healthRead = undefined;
check((await oldPairing).name === 'AbortError', 'Interrupted health check cannot continue discovery');
check(!api.companionSnapshot().connected, 'Interrupted pairing stays disconnected');
console.log(checks + ' companion-client ownership and cancellation checks passed.');
