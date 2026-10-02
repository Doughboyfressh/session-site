import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const DEFAULT_ORIGIN = 'https://session-site-eosin.vercel.app';
export const DEFAULT_PORT = 17341;
const BODY_LIMIT = 12 * 1024 * 1024;
const STATE_LIMIT = 8 * 1024 * 1024;
const WAV_LIMIT = 58_000_000;
const MAX_MODULES = 128;
const MAX_SCAN_ENTRIES = 4096;
const CLASS_ID = /^[0-9a-f]{32}$/i;
const HERE = path.dirname(fileURLToPath(import.meta.url));

class BridgeError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const invalid = (message = 'Invalid request.') => new BridgeError(400, 'INVALID_REQUEST', message);
const abortError = () => new BridgeError(499, 'CANCELLED', 'The local operation was cancelled.');
const checkAbort = (signal) => { if (signal.aborted) throw signal.reason || abortError(); };
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function exactKeys(value, allowed, required = []) {
  if (!isObject(value) || Object.keys(value).some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(value, key))) throw invalid();
}
function finite(value, min, max, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw invalid();
  return value;
}
export function validateOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Origin must be an exact HTTPS or loopback HTTP origin.'); }
  if (url.origin !== value || url.username || url.password || !['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Origin must be an exact HTTPS or loopback HTTP origin.');
  return value;
}
function validateState(value) {
  exactKeys(value, ['component', 'controller'], ['component', 'controller']);
  let total = 0;
  for (const key of ['component', 'controller']) {
    const data = value[key];
    if (typeof data !== 'string' || data.length > Math.ceil(STATE_LIMIT / 3) * 4 || data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(data)) throw invalid('Invalid plug-in state.');
    const decoded = Buffer.from(data, 'base64');
    if (decoded.toString('base64') !== data) throw invalid('Invalid plug-in state.');
    total += decoded.length;
    if (total > STATE_LIMIT) throw invalid('Plug-in state exceeds the 8 MiB limit.');
  }
  return { component: value.component, controller: value.controller };
}
function validatePayload(value, command) {
  const keys = command === 'render' ? ['pluginId', 'state', 'bpm', 'beats', 'sampleRate', 'notes'] : ['pluginId', 'state', 'bpm'];
  exactKeys(value, keys, command === 'render' ? ['pluginId', 'bpm', 'beats', 'sampleRate', 'notes'] : ['pluginId', 'bpm']);
  if (typeof value.pluginId !== 'string' || !CLASS_ID.test(value.pluginId)) throw invalid();
  const result = { pluginId: value.pluginId.toLowerCase(), bpm: finite(value.bpm, 40, 240) };
  if (Object.hasOwn(value, 'state')) result.state = validateState(value.state);
  if (command === 'render') {
    result.beats = finite(value.beats, Number.MIN_VALUE, 512);
    if (![44100, 48000].includes(value.sampleRate)) throw invalid();
    result.sampleRate = value.sampleRate;
    if (result.beats * 60 / result.bpm + 0.5 > 300) throw invalid('The render exceeds the 300 second limit.');
    if (!Array.isArray(value.notes) || value.notes.length > 256) throw invalid('A render supports at most 256 notes.');
    result.notes = value.notes.map((note) => {
      exactKeys(note, ['pitch', 'start', 'length', 'velocity'], ['pitch', 'start', 'length', 'velocity']);
      const mapped = { pitch: finite(note.pitch, 0, 127, true), start: finite(note.start, 0, result.beats), length: finite(note.length, Number.MIN_VALUE, result.beats), velocity: finite(note.velocity, 0, 1) };
      if (mapped.start + mapped.length > result.beats) throw invalid('Notes must end within the render.');
      return mapped;
    });
  }
  return result;
}
function inside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
function standardRoots() {
  const drive = process.env.SystemDrive || 'C:';
  return [...new Set([
    path.join(process.env.ProgramW6432 || process.env.ProgramFiles || `${drive}\\Program Files`, 'Common Files', 'VST3'),
    path.join(process.env['ProgramFiles(x86)'] || `${drive}\\Program Files (x86)`, 'Common Files', 'VST3'),
    ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, 'Programs', 'Common', 'VST3')] : []),
  ])];
}
function safeMetadata(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  // Metadata never includes native error output or machine paths.
  if (/[A-Za-z]:[\\/]|\\\\|(?:^|\s)\/(?:Users|home|tmp|var|etc)\//i.test(value)) return fallback;
  return value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 128).trim() || fallback;
}
async function checkedFile(file, jobDir, maxSize) {
  const stat = await fs.lstat(file);
  const resolved = await fs.realpath(file);
  if (!stat.isFile() || stat.isSymbolicLink() || !inside(jobDir, resolved) || stat.size > maxSize) throw new BridgeError(502, 'INVALID_NATIVE_OUTPUT', 'The native host returned invalid output.');
  return fs.readFile(file);
}
function validateWav(buffer, payload) {
  const fail = () => { throw new BridgeError(502, 'INVALID_AUDIO', 'The native host returned invalid audio.'); };
  if (buffer.length < 44 || buffer.length > WAV_LIMIT || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE' || buffer.readUInt32LE(4) !== buffer.length - 8) fail();
  let offset = 12, format = false, audio = false, chunks = 0;
  const maxFrames = Math.ceil((payload.beats * 60 / payload.bpm + 0.5) * payload.sampleRate);
  while (offset < buffer.length) {
    if (++chunks > 256 || offset + 8 > buffer.length) fail();
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > buffer.length) fail();
    if (id === 'fmt ') {
      if (format || size < 16 || buffer.readUInt16LE(start) !== 1 || buffer.readUInt16LE(start + 2) !== 2 || buffer.readUInt32LE(start + 4) !== payload.sampleRate || buffer.readUInt32LE(start + 8) !== payload.sampleRate * 4 || buffer.readUInt16LE(start + 12) !== 4 || buffer.readUInt16LE(start + 14) !== 16) fail();
      format = true;
    } else if (id === 'data') {
      if (!format || audio || size === 0 || size % 4 !== 0 || size > maxFrames * 4) fail();
      audio = true;
    }
    offset = end + (size & 1);
  }
  if (offset !== buffer.length || !format || !audio) fail();
}

function spawnNative(executable, { command, requestPath, responsePath, signal }) {
  return new Promise((resolve, reject) => {
    checkAbort(signal);
    const child = spawn(executable, [command, requestPath, responsePath], { windowsHide: command !== 'editor', stdio: ['ignore', 'ignore', 'pipe'], shell: false });
    let settled = false;
    // Drain stderr, retaining only a bounded count; paths and plug-in output never enter HTTP errors.
    let stderrBytes = 0;
    child.stderr.on('data', (chunk) => { stderrBytes = Math.min(8192, stderrBytes + chunk.length); });
    const kill = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
        killer.on('error', () => { child.kill('SIGKILL'); });
        killer.on('exit', (code) => { if (code !== 0) child.kill('SIGKILL'); });
      } else child.kill('SIGKILL');
    };
    signal.addEventListener('abort', kill, { once: true });
    if (signal.aborted) kill();
    const finish = (error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', kill);
      if (signal.aborted) reject(signal.reason || abortError());
      else if (error) reject(new BridgeError(502, 'NATIVE_FAILED', 'The native plug-in host could not complete the operation.'));
      else resolve();
    };
    child.on('error', finish);
    child.on('close', (code) => finish(code === 0 ? undefined : new Error('Native process failed.')));
  });
}

/** Local dependency injection is for offline tests; HTTP clients cannot set roots, paths, runners or limits. */
export function createCompanion(options = {}) {
  const origin = validateOrigin(options.origin || DEFAULT_ORIGIN);
  const token = options.token || randomBytes(32).toString('hex');
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Pairing token must contain 32 random bytes encoded as lowercase hexadecimal.');
  const tokenHash = createHash('sha256').update(token).digest();
  const platform = options.platform || process.platform;
  const roots = options.pluginRoots || standardRoots();
  const timeouts = { scan: 10_000, render: 120_000, editor: 30 * 60_000, ...options.timeouts };
  let executable;
  let nativeAvailable = false;
  let privateRoot;
  let activeJob;
  let closing = false;
  let started = false;
  let cache;
  let registry = new Map();
  let closePromise;
  const nativeRunner = options.nativeRunner || ((args) => spawnNative(executable, args));

  async function cleanup(directory) {
    if (!privateRoot || !directory || !inside(privateRoot, directory) || !path.basename(directory).startsWith('job-')) return;
    try {
      const stat = await fs.lstat(directory);
      const resolved = await fs.realpath(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(directory, resolved) || !inside(privateRoot, resolved)) return;
      await fs.rm(directory, { recursive: true, force: true });
    } catch (error) { if (error.code !== 'ENOENT') throw new BridgeError(500, 'CLEANUP_FAILED', 'Private companion files could not be cleaned up.'); }
  }
  async function withJob(signal, operation) {
    if (!nativeAvailable) throw new BridgeError(503, 'NATIVE_UNAVAILABLE', platform !== 'win32' ? 'The VST3 companion requires Windows.' : 'Build or install the native VST3 companion first.');
    if (closing) throw new BridgeError(503, 'SHUTTING_DOWN', 'The local companion is shutting down.');
    if (activeJob) throw new BridgeError(409, 'BUSY', 'The companion is busy. Close the plug-in editor or wait for the current operation.');
    checkAbort(signal);
    const controller = new AbortController();
    const forward = () => controller.abort(signal.reason || abortError());
    signal.addEventListener('abort', forward, { once: true });
    if (signal.aborted) forward();
    const job = { controller, directory: undefined, done: undefined };
    activeJob = job;
    const work = async () => {
      try {
        job.directory = await fs.mkdtemp(path.join(privateRoot, 'job-'));
        checkAbort(controller.signal);
        return await operation({ directory: job.directory, signal: controller.signal });
      } finally {
        try { await cleanup(job.directory); }
        finally { signal.removeEventListener('abort', forward); if (activeJob === job) activeJob = undefined; }
      }
    };
    job.done = work();
    return job.done;
  }
  async function runNative(command, request, job, index = 0) {
    checkAbort(job.signal);
    const requestPath = path.join(job.directory, `request-${index}.json`);
    const responsePath = path.join(job.directory, `response-${index}.json`);
    await fs.writeFile(requestPath, JSON.stringify(request), { mode: 0o600, flag: 'wx' });
    checkAbort(job.signal);
    const controller = new AbortController();
    const forward = () => controller.abort(job.signal.reason || abortError());
    job.signal.addEventListener('abort', forward, { once: true });
    if (job.signal.aborted) forward();
    const timer = setTimeout(() => controller.abort(new BridgeError(504, 'NATIVE_TIMEOUT', 'The native plug-in operation timed out.')), timeouts[command]);
    timer.unref();
    try {
      await nativeRunner({ command, requestPath, responsePath, signal: controller.signal, timeoutMs: timeouts[command], jobDirectory: job.directory });
      checkAbort(controller.signal);
      let response;
      try { response = JSON.parse((await checkedFile(responsePath, job.directory, command === 'editor' ? BODY_LIMIT : 1024 * 1024)).toString('utf8')); }
      catch (error) { if (error instanceof BridgeError) throw error; throw new BridgeError(502, 'INVALID_NATIVE_OUTPUT', 'The native host returned invalid output.'); }
      checkAbort(controller.signal);
      return response;
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason || abortError();
      if (error instanceof BridgeError) throw error;
      throw new BridgeError(502, 'NATIVE_FAILED', 'The native plug-in host could not complete the operation.');
    } finally { clearTimeout(timer); job.signal.removeEventListener('abort', forward); }
  }
  async function discover(signal) {
    const modules = [];
    let entries = 0, warnings = 0;
    for (const configuredRoot of roots) {
      checkAbort(signal);
      let root;
      try {
        root = await fs.realpath(configuredRoot);
        const stat = await fs.lstat(configuredRoot);
        if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(path.resolve(configuredRoot), root)) { warnings++; continue; }
      } catch { continue; }
      async function walk(directory, depth) {
        checkAbort(signal);
        if (depth > 8 || entries >= MAX_SCAN_ENTRIES || modules.length >= MAX_MODULES) { warnings++; return; }
        let listing;
        try { listing = await fs.opendir(directory); } catch { warnings++; return; }
        for await (const entry of listing) {
          checkAbort(signal);
          if (++entries > MAX_SCAN_ENTRIES || modules.length >= MAX_MODULES) { warnings++; break; }
          if (entry.isSymbolicLink()) continue;
          const file = path.join(directory, entry.name);
          let resolved;
          try { resolved = await fs.realpath(file); } catch { warnings++; continue; }
          if (!inside(root, resolved) || !samePath(file, resolved)) continue;
          if (/\.vst3$/i.test(entry.name) && (entry.isFile() || entry.isDirectory())) modules.push({ modulePath: resolved, root });
          else if (entry.isDirectory()) await walk(resolved, depth + 1);
        }
      }
      await walk(root, 0);
    }
    return { modules, warnings };
  }
  async function scan(signal) {
    return withJob(signal, async (job) => {
      const found = await discover(job.signal);
      const next = new Map();
      let warnings = found.warnings;
      for (let i = 0; i < found.modules.length; i++) {
        checkAbort(job.signal);
        const module = found.modules[i];
        try {
          const result = await runNative('scan', { modulePath: module.modulePath }, job, i);
          if (!isObject(result) || !Array.isArray(result.plugins) || result.plugins.length > 256) throw new Error('Invalid scan.');
          for (const plugin of result.plugins) {
            if (!isObject(plugin) || typeof plugin.classId !== 'string' || !CLASS_ID.test(plugin.classId) || next.size >= 256) { warnings++; continue; }
            const classId = plugin.classId.toLowerCase();
            if (!next.has(classId)) next.set(classId, { ...module, classId, name: safeMetadata(plugin.name, 'VST3 instrument'), vendor: safeMetadata(plugin.vendor), version: safeMetadata(plugin.version) });
          }
        } catch (error) { checkAbort(job.signal); warnings++; }
      }
      checkAbort(job.signal);
      registry = next;
      cache = { plugins: [...registry.values()].map(({ classId, name, vendor, version }) => ({ id: classId, classId, name, vendor, version })), scannedAt: new Date().toISOString(), warnings };
      return cache;
    });
  }
  async function registeredPlugin(pluginId) {
    const plugin = registry.get(pluginId);
    if (!plugin) throw new BridgeError(404, 'PLUGIN_NOT_FOUND', 'Rescan and select an installed VST3 instrument.');
    try {
      const stat = await fs.lstat(plugin.modulePath);
      const real = await fs.realpath(plugin.modulePath);
      if (stat.isSymbolicLink() || !samePath(real, plugin.modulePath) || !inside(plugin.root, real)) throw new Error('Changed path.');
    } catch { throw new BridgeError(404, 'PLUGIN_NOT_FOUND', 'The selected plug-in is no longer available. Rescan installed instruments.'); }
    return plugin;
  }
  async function body(request, signal) {
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '')) throw new BridgeError(415, 'CONTENT_TYPE', 'Use application/json.');
    const length = request.headers['content-length'];
    if (length && (!/^\d+$/.test(length) || Number(length) > BODY_LIMIT)) throw new BridgeError(413, 'BODY_TOO_LARGE', 'The request exceeds the 12 MiB limit.');
    let size = 0;
    const chunks = [];
    await new Promise((resolve, reject) => {
      const finish = (error) => {
        request.removeListener('data', data);
        request.removeListener('end', end);
        request.removeListener('error', failed);
        signal.removeEventListener('abort', cancelled);
        if (error) { request.pause(); reject(error); } else resolve();
      };
      const data = (chunk) => {
        size += chunk.length;
        if (size > BODY_LIMIT) finish(new BridgeError(413, 'BODY_TOO_LARGE', 'The request exceeds the 12 MiB limit.'));
        else chunks.push(chunk);
      };
      const end = () => finish();
      const failed = () => finish(invalid('The request body was interrupted.'));
      const cancelled = () => finish(signal.reason || abortError());
      request.on('data', data);
      request.once('end', end);
      request.once('error', failed);
      signal.addEventListener('abort', cancelled, { once: true });
      if (signal.aborted) cancelled();
    });
    checkAbort(signal);
    try { return size === 0 ? {} : JSON.parse(Buffer.concat(chunks, size).toString('utf8')); } catch { throw invalid('Use valid JSON.'); }
  }
  function cors(response) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
  function json(response, status, data) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(data));
  }
  const routes = new Map([['/v1/health', 'GET'], ['/v1/plugins', 'GET'], ['/v1/rescan', 'POST'], ['/v1/render', 'POST'], ['/v1/editor', 'POST']]);
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const controller = new AbortController();
    const abort = () => controller.abort(abortError());
    const closed = () => { if (!response.writableFinished) abort(); };
    request.on('aborted', abort);
    response.on('close', closed);
    try {
      if (request.headers.origin !== origin) throw new BridgeError(403, 'ORIGIN_DENIED', 'This browser origin is not paired with the companion.');
      cors(response);
      const method = routes.get(request.url);
      if (request.method === 'OPTIONS') {
        const requestedHeaders = (request.headers['access-control-request-headers'] || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
        if (!method || request.headers['access-control-request-method'] !== method || requestedHeaders.some((header) => !['authorization', 'content-type'].includes(header)) || new Set(requestedHeaders).size !== requestedHeaders.length || (request.headers['access-control-request-private-network'] && request.headers['access-control-request-private-network'] !== 'true')) throw new BridgeError(403, 'PREFLIGHT_DENIED', 'The browser preflight is not allowed.');
        response.setHeader('Access-Control-Allow-Methods', method);
        response.setHeader('Access-Control-Allow-Headers', requestedHeaders.join(', '));
        response.setHeader('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers, Access-Control-Request-Private-Network');
        if (request.headers['access-control-request-private-network'] === 'true') response.setHeader('Access-Control-Allow-Private-Network', 'true');
        response.writeHead(204);
        response.end();
        return;
      }
      const authorization = request.headers.authorization || '';
      const candidate = /^Bearer ([a-f0-9]{64})$/.exec(authorization)?.[1] || '';
      const candidateHash = createHash('sha256').update(candidate).digest();
      if (!timingSafeEqual(tokenHash, candidateHash)) throw new BridgeError(401, 'PAIRING_REQUIRED', 'Pair the browser with the local companion.');
      if (!method) throw new BridgeError(404, 'NOT_FOUND', 'Unknown companion endpoint.');
      if (request.method !== method) throw new BridgeError(405, 'METHOD_NOT_ALLOWED', 'This method is not allowed.');
      if (request.url === '/v1/health') json(response, 200, { version: 1, platform, nativeAvailable, busy: !!activeJob, paired: true });
      else if (request.url === '/v1/plugins') json(response, 200, cache || await scan(controller.signal));
      else {
        const data = await body(request, controller.signal);
        if (request.url === '/v1/rescan') {
          exactKeys(data, []);
          json(response, 200, await scan(controller.signal));
        } else {
          const command = request.url === '/v1/render' ? 'render' : 'editor';
          const payload = validatePayload(data, command);
          const output = await withJob(controller.signal, async (job) => {
            const plugin = await registeredPlugin(payload.pluginId);
            const { pluginId, ...nativePayload } = payload;
            const audioPath = path.join(job.directory, 'audio.wav');
            const result = await runNative(command, { modulePath: plugin.modulePath, classId: plugin.classId, ...nativePayload, ...(command === 'render' ? { audioPath } : {}) }, job);
            if (command === 'editor') {
              try { return { state: validateState(result.state) }; } catch { throw new BridgeError(502, 'INVALID_NATIVE_OUTPUT', 'The native editor returned invalid plug-in state.'); }
            }
            if (!isObject(result) || result.ok !== true) throw new BridgeError(502, 'NATIVE_FAILED', 'The native plug-in host could not complete the render.');
            const audio = await checkedFile(audioPath, job.directory, WAV_LIMIT);
            checkAbort(job.signal);
            validateWav(audio, payload);
            return audio;
          });
          checkAbort(controller.signal);
          if (command === 'editor') json(response, 200, output);
          else {
            response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': output.length, 'Content-Disposition': 'attachment; filename="session-vst3-render.wav"' });
            response.end(output);
          }
        }
      }
    } catch (error) {
      if (!response.destroyed && !response.writableEnded) {
        const safe = error instanceof BridgeError ? error : new BridgeError(500, 'COMPANION_ERROR', 'The local companion could not complete the operation.');
        if (safe.status === 413) response.setHeader('Connection', 'close');
        json(response, safe.status, { error: safe.message, code: safe.code });
        request.resume();
      }
    } finally { request.removeListener('aborted', abort); response.removeListener('close', closed); }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 32;

  return {
    server,
    origin,
    token,
    async start(port = options.port ?? DEFAULT_PORT) {
      if (started || closing) throw new Error('The companion is already started or closed.');
      finite(port, 0, 65535, true);
      started = true;
      if (platform === 'win32') {
        if (options.nativeRunner) nativeAvailable = true;
        else for (const candidate of [path.join(HERE, 'session-vst3-host.exe'), path.resolve(HERE, '..', 'outputs', 'companion', 'session-vst3-host.exe')]) {
          try { if ((await fs.stat(candidate)).isFile()) { executable = candidate; nativeAvailable = true; break; } } catch { /* Health explains unavailable native host. */ }
        }
      }
      privateRoot = await fs.mkdtemp(path.join(options.tempDirectory || os.tmpdir(), 'session-companion-'));
      await fs.chmod(privateRoot, 0o700);
      try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); }); }
      catch (error) { await fs.rmdir(privateRoot); privateRoot = undefined; throw error; }
      return server.address();
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        const job = activeJob;
        if (job) job.controller.abort(new BridgeError(503, 'SHUTTING_DOWN', 'The local companion is shutting down.'));
        const stopped = new Promise((resolve) => { if (!server.listening) resolve(); else server.close(() => resolve()); });
        server.closeAllConnections();
        if (job) await job.done.catch(() => {});
        await stopped;
        if (privateRoot) {
          // Never recursively remove the process root: job cleanup owns verified job directories.
          await fs.rmdir(privateRoot);
          privateRoot = undefined;
        }
      })();
      return closePromise;
    },
  };
}

async function main() {
  let origin = DEFAULT_ORIGIN;
  let port = DEFAULT_PORT;
  for (let i = 2; i < process.argv.length; i++) {
    const argument = process.argv[i];
    if (argument === '--origin' && process.argv[i + 1]) origin = validateOrigin(process.argv[++i]);
    else if (argument === '--port' && /^\d+$/.test(process.argv[i + 1] || '')) port = Number(process.argv[++i]);
    else throw new Error('Usage: node companion/bridge.mjs [--origin https://your-session-origin] [--port 17341]');
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a port between 1024 and 65535.');
  const companion = createCompanion({ origin, port });
  const address = await companion.start();
  console.log(`SESSION VST3 companion: http://127.0.0.1:${address.port}`);
  console.log(`Allowed browser origin: ${origin}`);
  console.log(`Pairing token: ${companion.token}`);
  console.log('Paste this token into SESSION. Keep this window open; Ctrl+C stops the companion.');
  const stop = () => { companion.close().then(() => { process.exitCode = 0; }).catch(() => { console.error('Could not clean up private companion files.'); process.exitCode = 1; }); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
if (process.argv[1] && samePath(path.resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  main().catch(() => { console.error('SESSION companion could not start. Check the origin, port, and native host installation.'); process.exitCode = 1; });
}
