import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const modules = new Map();
const requests = [];
let stateRead, nativeRender, healthRead, stalledPath, nextReport;
const timers = new Map();
let timerId = 0;
const setTimer = (callback, milliseconds) => { const id = ++timerId; timers.set(id, { callback, milliseconds }); return id; };
const clearTimer = (id) => timers.delete(id);
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const plugin = { format: 'vst3', version: 1, classId: 'a'.repeat(32), name: 'Synthetic instrument', vendor: 'SESSION test', stateFileId: 'state-fixture' };
const state = { version: 1, format: 'vst3', classId: plugin.classId, component: '', controller: '' };
const track = { id: 'synthetic', plugin, notes: [{ pitch: 60, start: 0, length: 1, velocity: 0.7 }], noteLoopBeats: 8 };
const fetchFixture = async (input, options = {}) => {
  const url = String(input);
  requests.push({ url, options });
  if (stalledPath && url.endsWith(stalledPath)) {
    await new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException('Synthetic aborted fetch.', 'AbortError'));
      options.signal.addEventListener('abort', abort, { once: true });
      if (options.signal.aborted) abort();
    });
  }
  if (url.startsWith('/api/file/')) {
    if (stateRead) await stateRead.promise;
    // Intentionally complete despite cancellation to test ownership rechecks.
    return Response.json(state);
  }
  if (url.endsWith('/health')) {
    if (healthRead) await healthRead.promise;
    return Response.json({ version: 1, platform: 'win32', nativeAvailable: true });
  }
  if (url.endsWith('/plugins') || url.endsWith('/rescan')) {
    const report = nextReport || { plugins: [{ classId: plugin.classId, name: plugin.name, vendor: plugin.vendor, version: '1' }] };
    nextReport = undefined;
    return Response.json(report);
  }
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
  const run = new vm.Script('(function(exports, require, fetch, setTimeout, clearTimeout) {' + code + '\n})', { filename: full }).runInThisContext();
  run(exports, (id) => load(path.resolve(path.dirname(full), id) + '.ts'), fetchFixture, setTimer, clearTimer);
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

const phases = [];
const uppercaseStart = requests.length;
await api.connectCompanion('  ' + 'AB'.repeat(32) + '  ', undefined, (stage) => phases.push(stage));
check(requests.slice(uppercaseStart).every((request) => request.options.headers.Authorization === 'Bearer ' + 'ab'.repeat(32)), 'Accepted uppercase codes authenticate with the actual lowercase bridge protocol');
check(phases.join(',') === 'checking,scanning', 'Pairing reports health and discovery as separate stages');
check(timers.size === 0, 'Completed requests release their timers');

for (const stage of ['checking', 'scanning']) {
  const before = requests.length;
  const result = await api.connectCompanion('a'.repeat(64), undefined, (currentStage) => {
    if (currentStage === stage) api.disconnectCompanion();
  }).catch((error) => error);
  check(result.name === 'AbortError', 'Progress interruption remains intentional cancellation');
  check(requests.slice(before).length === (stage === 'checking' ? 0 : 1), 'Interrupted progress cannot dispatch discovery or an old health request');
}

for (const [endpoint, deadline, expected] of [['/health', 15000, /local network access.*in-app browser/], ['/plugins', 60000, /scan timed out/] ]) {
  stalledPath = endpoint;
  const pending = api.connectCompanion('a'.repeat(64)).catch((error) => error);
  await tick();
  const timer = [...timers.values()].find((item) => item.milliseconds === deadline);
  check(timer, 'The endpoint receives its own bounded deadline');
  timer.callback();
  const error = await pending;
  check(error.name === 'Error' && expected.test(error.message), 'Deadline errors identify the failed stage and recovery action');
  check(!api.companionSnapshot().connected && timers.size === 0, 'Timed-out pairing remains disconnected and releases timers');
  stalledPath = undefined;
}

stalledPath = '/health';
const callerAbort = new AbortController();
const stopped = api.connectCompanion('a'.repeat(64), callerAbort.signal).catch((error) => error);
await tick(); callerAbort.abort();
check((await stopped).name === 'AbortError', 'User cancellation is distinguished from a deadline');
check(timers.size === 0, 'User cancellation releases the endpoint timer');
stalledPath = undefined;

nextReport = { plugins: [], warnings: 2 };
await connect();
check(api.companionSnapshot().plugins.length === 0 && api.companionSnapshot().scanWarnings === 2, 'Empty discovery retains warnings for actionable UI guidance');
nextReport = { plugins: [], warnings: 0 };
await api.rescanCompanion();
check(api.companionSnapshot().scanWarnings === 0, 'Rescan replaces warnings from the prior scan');
nextReport = { plugins: [], warnings: -1 };
const invalidReport = await api.rescanCompanion().catch((error) => error);
check(/invalid scan report/.test(invalidReport.message), 'Malformed scan metadata is rejected');
api.disconnectCompanion();
check(api.companionSnapshot().scanWarnings === 0 && !api.companionSnapshot().connected, 'Disconnect clears discovery diagnostics');
console.log(checks + ' companion-client ownership and cancellation checks passed.');
