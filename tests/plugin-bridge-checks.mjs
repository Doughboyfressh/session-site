import assert from 'node:assert/strict';
import http from 'node:http';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createCompanion, DEFAULT_ORIGIN, validateOrigin } from '../companion/bridge.mjs';

const TOKEN = 'ab'.repeat(32); // Synthetic credential; no actual startup token is printed.
const ID = '0123456789abcdef0123456789abcdef';
const ROOT = await fs.mkdtemp(path.join(os.tmpdir(), 'session-bridge-checks-'));
const pluginsRoot = path.join(ROOT, 'standard-vst3');
const tempRoot = path.join(ROOT, 'private');
await fs.mkdir(pluginsRoot);
await fs.mkdir(tempRoot);
await fs.writeFile(path.join(pluginsRoot, 'Test.vst3'), 'synthetic; never executed');
await fs.mkdir(path.join(pluginsRoot, 'Vendor'));
await fs.mkdir(path.join(pluginsRoot, 'Vendor', 'Bundled.vst3'));
const output = [];
let nextBehavior = 'normal';
let active = 0;
let maxActive = 0;
let aborted = 0;
let heldStarted;
let heldRelease;
const calls = [];
function wav(sampleRate, frames = 16) {
  const data = Buffer.alloc(44 + frames * 4);
  data.write('RIFF', 0);
  data.writeUInt32LE(data.length - 8, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(2, 22);
  data.writeUInt32LE(sampleRate, 24);
  data.writeUInt32LE(sampleRate * 4, 28);
  data.writeUInt16LE(4, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(frames * 4, 40);
  return data;
}
const runner = async ({ command, requestPath, responsePath, signal, jobDirectory }) => {
  active++;
  maxActive = Math.max(maxActive, active);
  const request = JSON.parse(await fs.readFile(requestPath, 'utf8'));
  calls.push({ command, request, directory: jobDirectory });
  const behavior = nextBehavior;
  nextBehavior = 'normal';
  try {
    if (behavior === 'crash') throw new Error('Private crash C:\\Users\\Secret\\plugin.vst3');
    if (behavior === 'hold' || behavior === 'timeout') {
      await new Promise((resolve, reject) => {
        heldRelease = resolve;
        const cancel = () => { aborted++; reject(signal.reason); };
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
        heldStarted?.();
      });
    }
    if (signal.aborted) throw signal.reason;
    if (command === 'scan') {
      assert.equal(Object.keys(request).join(','), 'modulePath');
      assert.ok(request.modulePath.startsWith(pluginsRoot));
      const plugin = { classId: ID.toUpperCase(), name: 'Synthetic Piano', vendor: 'SESSION test', version: '1.0' };
      if (behavior === 'empty-vendor') plugin.vendor = '';
      if (behavior === 'metadata') {
        plugin.name = `Synthetic${String.fromCharCode(0, 9, 10, 127)}${'N'.repeat(200)}`;
        plugin.vendor = String.fromCharCode(0, 9, 10, 127);
        plugin.version = 'V'.repeat(200);
      }
      await fs.writeFile(responsePath, JSON.stringify({ plugins: [plugin] }));
    } else if (command === 'editor') {
      assert.equal(request.classId, ID);
      assert.equal(Object.hasOwn(request, 'audioPath'), false);
      await fs.writeFile(responsePath, JSON.stringify({ state: behavior === 'bad-state' ? { component: '!bad', controller: '' } : { component: 'AQID', controller: '' } }));
    } else {
      assert.equal(request.classId, ID);
      assert.equal(path.dirname(request.audioPath), jobDirectory);
      assert.equal(path.dirname(requestPath), jobDirectory);
      assert.equal(path.dirname(responsePath), jobDirectory);
      const frames = Math.ceil((request.beats * 60 / request.bpm + 0.5) * request.sampleRate);
      let audio = wav(request.sampleRate, behavior === 'truncated-wav' ? frames - 1 : frames);
      if (behavior === 'bad-wav') audio.writeUInt32LE(4, 4);
      if (behavior === 'wrong-rate') audio = wav(22050, frames);
      await fs.writeFile(request.audioPath, audio);
      await fs.writeFile(responsePath, JSON.stringify({ ok: true }));
    }
  } finally { active--; }
};
const bridge = createCompanion({ origin: DEFAULT_ORIGIN, token: TOKEN, platform: 'win32', nativeRunner: runner, pluginRoots: [pluginsRoot], tempDirectory: tempRoot, timeouts: { render: 100, editor: 100, scan: 100 } });
const address = await bridge.start(0);
assert.equal(address.address, '127.0.0.1');
const headers = { Origin: DEFAULT_ORIGIN, Authorization: `Bearer ${TOKEN}` };
const renderPayload = { pluginId: ID, bpm: 120, beats: 4, sampleRate: 48000, notes: [{ pitch: 60, start: 0, length: 1, velocity: 0.8 }] };
async function request(route, { method = 'GET', body, customHeaders = {}, omit = [], raw } = {}) {
  const finalHeaders = { ...headers, ...customHeaders };
  for (const name of omit) delete finalHeaders[name];
  if (body !== undefined || raw !== undefined) finalHeaders['Content-Type'] ??= 'application/json';
  const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: address.port, path: route, method, headers: finalHeaders }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, buffer, json: () => JSON.parse(buffer.toString()) });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(payload);
  });
}
async function check(name, callback) {
  await callback();
  output.push(name);
  console.log(`PASS ${name}`);
}
async function cleanJobs() {
  for (let i = 0; i < 40 && bridge.server.listening; i++) {
    if (!(await request('/v1/health')).json().busy) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const processRoots = await fs.readdir(tempRoot);
  for (const directory of processRoots) assert.deepEqual(await fs.readdir(path.join(tempRoot, directory)), []);
}
try {
  await check('exact origins and loopback-only binding', async () => {
    for (const origin of ['https://session-site-eosin.vercel.app', 'https://example.com:8443', 'http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) assert.equal(validateOrigin(origin), origin);
    for (const origin of ['*', 'http://example.com', 'https://example.com/', 'https://example.com/path', 'https://user:pass@example.com', 'https://example.com#hash', 'http://localhost.evil:3000', 'null']) assert.throws(() => validateOrigin(origin));
    const ok = await request('/v1/health');
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json(), { version: 1, platform: 'win32', nativeAvailable: true, busy: false, paired: true });
    assert.equal(ok.headers['access-control-allow-origin'], DEFAULT_ORIGIN);
    assert.equal(ok.headers['cache-control'], 'private, no-store');
    assert.equal(ok.headers['x-content-type-options'], 'nosniff');
    for (const value of ['https://evil.example', 'null', `${DEFAULT_ORIGIN}.evil`]) {
      const denied = await request('/v1/health', { customHeaders: { Origin: value } });
      assert.equal(denied.status, 403);
      assert.equal(denied.headers['access-control-allow-origin'], undefined);
    }
    assert.equal((await request('/v1/health', { omit: ['Origin'] })).status, 403);
  });
  await check('constant-length token comparison and route authentication', async () => {
    for (const route of ['/v1/health', '/v1/plugins', '/v1/rescan', '/v1/render', '/v1/editor', '/unknown']) {
      assert.equal((await request(route, { omit: ['Authorization'] })).status, 401);
      assert.equal((await request(route, { customHeaders: { Authorization: `Bearer ${'cd'.repeat(32)}` } })).status, 401);
      assert.equal((await request(route, { customHeaders: { Authorization: 'Bearer short' } })).status, 401);
    }
    assert.equal((await request('/v1/health?token=anything')).status, 404);
    assert.equal((await request('/v1/health', { method: 'POST', body: {} })).status, 405);
    assert.equal(calls.length, 0);
  });
  await check('narrow CORS and private-network preflight', async () => {
    const preflight = await request('/v1/render', { method: 'OPTIONS', omit: ['Authorization'], customHeaders: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type', 'Access-Control-Request-Private-Network': 'true' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers['access-control-allow-methods'], 'POST');
    assert.equal(preflight.headers['access-control-allow-headers'], 'authorization, content-type');
    assert.equal(preflight.headers['access-control-allow-private-network'], 'true');
    assert.equal(preflight.headers['access-control-allow-credentials'], undefined);
    for (const customHeaders of [{ 'Access-Control-Request-Method': 'DELETE' }, { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-arbitrary' }, { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, authorization' }, { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' }]) assert.equal((await request('/v1/render', { method: 'OPTIONS', customHeaders, omit: ['Authorization'] })).status, 403);
    assert.equal((await request('/missing', { method: 'OPTIONS', customHeaders: { 'Access-Control-Request-Method': 'GET' } })).status, 403);
  });
  await check('bounded discovery, canonical IDs, private paths and scan cache', async () => {
    const response = await request('/v1/plugins');
    assert.equal(response.status, 200);
    assert.equal(response.json().plugins.length, 1);
    assert.equal(response.json().plugins[0].classId, ID);
    assert.equal(response.json().plugins[0].id, ID);
    assert.equal(response.buffer.includes(Buffer.from(ROOT)), false);
    assert.equal(calls.length, 2);
    await request('/v1/plugins');
    assert.equal(calls.length, 2);
    await request('/v1/rescan', { method: 'POST', body: {} });
    assert.equal(calls.length, 4);
    await cleanJobs();
  });
  await check('metadata clamps long values, strips controls and supplies vendor fallback', async () => {
    nextBehavior = 'empty-vendor';
    const empty = await request('/v1/rescan', { method: 'POST', body: {} });
    assert.equal(empty.json().plugins[0].vendor, 'Unknown vendor');
    nextBehavior = 'metadata';
    const response = await request('/v1/rescan', { method: 'POST', body: {} });
    const plugin = response.json().plugins[0];
    assert.equal(plugin.name.length, 100);
    assert.equal(plugin.version.length, 100);
    assert.equal(plugin.vendor, 'Unknown vendor');
    assert.equal([...plugin.name].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127), false);
    await cleanJobs();
  });
  await check('reject browser paths, unknown classes and malformed state', async () => {
    const count = calls.length;
    assert.equal((await request('/v1/rescan', { method: 'POST', body: { directory: ROOT } })).status, 400);
    for (const data of [{ ...renderPayload, modulePath: ROOT }, { ...renderPayload, audioPath: ROOT }, { ...renderPayload, pluginId: '../Test.vst3' }, { ...renderPayload, state: { component: 'AQID', controller: '', file: ROOT } }, { ...renderPayload, state: { component: 'AQI', controller: '' } }, { ...renderPayload, state: { component: 'AR==', controller: '' } }, { ...renderPayload, state: { component: 'AQ==\n', controller: '' } }, { ...renderPayload, state: { component: 'AA=A', controller: '' } }]) assert.equal((await request('/v1/render', { method: 'POST', body: data })).status, 400);
    const unknown = await request('/v1/render', { method: 'POST', body: { ...renderPayload, pluginId: 'f'.repeat(32) } });
    assert.equal(unknown.status, 404);
    assert.equal(calls.length, count);
    await cleanJobs();
  });
  await check('state and JSON size limits', async () => {
    const component = Buffer.alloc(4 * 1024 * 1024, 1).toString('base64');
    const controller = Buffer.alloc(4 * 1024 * 1024 + 1, 2).toString('base64');
    assert.equal((await request('/v1/render', { method: 'POST', body: { ...renderPayload, state: { component, controller } } })).status, 400);
    assert.equal((await request('/v1/render', { method: 'POST', body: { ...renderPayload, state: { component, controller: component } } })).status, 200);
    assert.equal((await request('/v1/render', { method: 'POST', customHeaders: { 'Content-Type': 'text/plain' }, raw: '{}' })).status, 415);
    assert.equal((await request('/v1/render', { method: 'POST', raw: '{broken' })).status, 400);
    assert.equal((await request('/v1/render', { method: 'POST', customHeaders: { 'Content-Length': String(12 * 1024 * 1024 + 1) }, raw: '' })).status, 413);
    assert.equal((await request('/v1/render', { method: 'POST', customHeaders: { 'Transfer-Encoding': 'chunked' }, raw: ' '.repeat(12 * 1024 * 1024 + 1) })).status, 413);
  });
  await check('finite note, tempo, duration and note-count bounds', async () => {
    const count = calls.length;
    const invalidPayloads = [
      { ...renderPayload, bpm: 39 }, { ...renderPayload, bpm: 241 }, { ...renderPayload, bpm: null },
      { ...renderPayload, beats: 0 }, { ...renderPayload, beats: 513 }, { ...renderPayload, beats: 200, bpm: 40 },
      { ...renderPayload, sampleRate: 96000 }, { ...renderPayload, notes: Array(257).fill(renderPayload.notes[0]) },
      ...[{ pitch: 60.5 }, { pitch: 128 }, { start: -1 }, { start: 4 }, { length: 0 }, { length: 5 }, { velocity: 1.1 }, { velocity: -1 }, { start: '0' }].map((note) => ({ ...renderPayload, notes: [{ ...renderPayload.notes[0], ...note }] })),
    ];
    for (const payload of invalidPayloads) assert.equal((await request('/v1/render', { method: 'POST', body: payload })).status, 400);
    assert.equal((await request('/v1/render', { method: 'POST', raw: JSON.stringify(renderPayload).replace('120', '1e999') })).status, 400);
    assert.equal(calls.length, count);
  });
  await check('binary WAV headers, private native inputs and cleanup', async () => {
    const response = await request('/v1/render', { method: 'POST', body: { ...renderPayload, pluginId: ID.toUpperCase(), state: { component: 'AQID', controller: '' } } });
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'audio/wav');
    assert.equal(Number(response.headers['content-length']), response.buffer.length);
    assert.equal(response.headers['content-disposition'], 'attachment; filename="session-vst3-render.wav"');
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.equal(response.buffer.toString('ascii', 0, 4), 'RIFF');
    assert.equal(response.buffer.readUInt32LE(40), Math.ceil((renderPayload.beats * 60 / renderPayload.bpm + 0.5) * renderPayload.sampleRate) * 4);
    const call = calls.at(-1);
    assert.equal(call.request.classId, ID);
    assert.equal(Object.hasOwn(call.request, 'pluginId'), false);
    assert.deepEqual(call.request.state, { component: 'AQID', controller: '' });
    await assert.rejects(fs.stat(call.directory), { code: 'ENOENT' });
    await cleanJobs();
    const fractional = { ...renderPayload, bpm: 121.5, beats: 4 / 3, sampleRate: 44100 };
    const exact = await request('/v1/render', { method: 'POST', body: fractional });
    assert.equal(exact.status, 200);
    assert.equal(exact.buffer.readUInt32LE(40), Math.ceil((fractional.beats * 60 / fractional.bpm + 0.5) * fractional.sampleRate) * 4);
  });
  await check('native output validation and safe crash errors', async () => {
    for (const behavior of ['bad-wav', 'wrong-rate', 'truncated-wav', 'crash']) {
      nextBehavior = behavior;
      const response = await request('/v1/render', { method: 'POST', body: renderPayload });
      assert.equal(response.status, 502);
      assert.equal(response.buffer.includes(Buffer.from('Secret')), false);
      assert.equal(response.buffer.includes(Buffer.from(ROOT)), false);
      await cleanJobs();
    }
    nextBehavior = 'bad-state';
    assert.equal((await request('/v1/editor', { method: 'POST', body: { pluginId: ID, bpm: 120 } })).status, 502);
    await cleanJobs();
  });
  await check('editor state return and render/editor serialization', async () => {
    const editor = await request('/v1/editor', { method: 'POST', body: { pluginId: ID, bpm: 120 } });
    assert.equal(editor.status, 200);
    assert.deepEqual(editor.json(), { state: { component: 'AQID', controller: '' } });
    nextBehavior = 'hold';
    const started = new Promise((resolve) => { heldStarted = resolve; });
    const pending = request('/v1/editor', { method: 'POST', body: { pluginId: ID, bpm: 120 } });
    await started;
    assert.equal((await request('/v1/health')).json().busy, true);
    assert.equal((await request('/v1/render', { method: 'POST', body: renderPayload })).status, 409);
    assert.equal((await request('/v1/rescan', { method: 'POST', body: {} })).status, 409);
    heldRelease();
    assert.equal((await pending).status, 200);
    assert.equal(maxActive, 1);
    assert.equal((await request('/v1/health')).json().busy, false);
    await cleanJobs();
  });
  await check('native timeout cancels and releases the job', async () => {
    nextBehavior = 'timeout';
    const response = await request('/v1/render', { method: 'POST', body: renderPayload });
    assert.equal(response.status, 504);
    assert.equal(response.json().code, 'NATIVE_TIMEOUT');
    assert.equal(active, 0);
    assert.ok(aborted > 0);
    await cleanJobs();
  });
  await check('browser disconnect cancels native work and cleans files', async () => {
    nextBehavior = 'hold';
    const started = new Promise((resolve) => { heldStarted = resolve; });
    const req = http.request({ hostname: '127.0.0.1', port: address.port, path: '/v1/editor', method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' } });
    req.on('error', () => {});
    req.end(JSON.stringify({ pluginId: ID, bpm: 120 }));
    await started;
    const before = aborted;
    req.destroy();
    for (let i = 0; i < 40 && (aborted === before || active); i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(aborted, before + 1);
    assert.equal(active, 0);
    await cleanJobs();
  });
  await check('shutdown cancels native work and removes only private files', async () => {
    await fs.writeFile(path.join(ROOT, 'keep-me.txt'), 'outside job');
    nextBehavior = 'hold';
    const started = new Promise((resolve) => { heldStarted = resolve; });
    const pending = request('/v1/render', { method: 'POST', body: renderPayload }).catch(() => undefined);
    await started;
    const before = aborted;
    await bridge.close();
    await pending;
    assert.equal(active, 0);
    assert.equal(aborted, before + 1);
    assert.deepEqual(await fs.readdir(tempRoot), []);
    assert.equal(await fs.readFile(path.join(ROOT, 'keep-me.txt'), 'utf8'), 'outside job');
  });
  await check('non-Windows native support is explicitly unavailable', async () => {
    const unsupported = createCompanion({ origin: DEFAULT_ORIGIN, token: TOKEN, platform: 'linux', nativeRunner: runner, tempDirectory: tempRoot });
    const target = await unsupported.start(0);
    try {
      const response = await fetch(`http://127.0.0.1:${target.port}/v1/health`, { headers });
      assert.equal((await response.json()).nativeAvailable, false);
      const unavailable = await fetch(`http://127.0.0.1:${target.port}/v1/plugins`, { headers });
      assert.equal(unavailable.status, 503);
      assert.equal((await unavailable.json()).code, 'NATIVE_UNAVAILABLE');
    } finally { await unsupported.close(); }
  });
  await check('discovery enforces module count and depth bounds', async () => {
    const boundedRoot = path.join(pluginsRoot, 'bounded-fixture');
    await fs.mkdir(boundedRoot);
    await Promise.all(Array.from({ length: 130 }, (_, index) => fs.writeFile(path.join(boundedRoot, `bounded-${index}.vst3`), 'fixture')));
    let deep = path.join(boundedRoot, 'deep');
    for (let i = 0; i < 10; i++) { await fs.mkdir(deep); deep = path.join(deep, 'next'); }
    await fs.writeFile(path.join(path.dirname(deep), 'too-deep.vst3'), 'fixture');
    const bounded = createCompanion({ token: TOKEN, platform: 'win32', nativeRunner: runner, pluginRoots: [boundedRoot], tempDirectory: tempRoot });
    const target = await bounded.start(0);
    const before = calls.length;
    try {
      const response = await fetch(`http://127.0.0.1:${target.port}/v1/plugins`, { headers });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.ok(result.warnings > 0);
      assert.equal(calls.length - before, 128);
      assert.equal(calls.slice(before).some((call) => call.request.modulePath.endsWith('too-deep.vst3')), false);
    } finally { await bounded.close(); }
    assert.deepEqual(await fs.readdir(tempRoot), []);
  });
  await check('total scan deadline cancels slow modules and retains completed instruments', async () => {
    const slowRoot = path.join(pluginsRoot, 'slow-fixture');
    await fs.mkdir(slowRoot);
    await fs.writeFile(path.join(slowRoot, 'first.vst3'), 'fixture');
    await fs.writeFile(path.join(slowRoot, 'second.vst3'), 'fixture');
    let scanCalls = 0;
    const slow = createCompanion({
      token: TOKEN, platform: 'win32', pluginRoots: [slowRoot], tempDirectory: tempRoot,
      timeouts: { scan: 1000, scanTotal: 50 },
      nativeRunner: async (args) => {
        if (++scanCalls > 1) nextBehavior = 'hold';
        return runner(args);
      },
    });
    const target = await slow.start(0);
    const before = aborted;
    const startedAt = Date.now();
    try {
      const response = await fetch(`http://127.0.0.1:${target.port}/v1/plugins`, { headers });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.plugins.length, 1);
      assert.equal(result.plugins[0].classId, ID);
      assert.equal(result.warnings, 1);
      assert.equal(scanCalls, 2);
      assert.equal(aborted, before + 1);
      assert.equal(active, 0);
      assert.ok(Date.now() - startedAt < 1000);
      const health = await fetch(`http://127.0.0.1:${target.port}/v1/health`, { headers });
      assert.equal((await health.json()).busy, false);
    } finally { await slow.close(); }
    assert.deepEqual(await fs.readdir(tempRoot), []);
  });
  console.log(`PASS plugin-bridge: ${output.length} offline HTTP checks`);
} finally {
  await bridge.close();
  const resolved = await fs.realpath(ROOT);
  assert.equal(resolved, ROOT);
  assert.ok(path.basename(ROOT).startsWith('session-bridge-checks-'));
  await fs.rm(ROOT, { recursive: true, force: true });
}
