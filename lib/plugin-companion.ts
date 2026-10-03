import type { MixerTrack } from './audio';
import {
  MAX_PLUGIN_STATE_JSON, validateVst3State, type Vst3Instrument, type Vst3State,
} from './instrument-plugins';

export type InstalledPlugin = { classId: string; name: string; vendor: string; version: string };
type CompanionSnapshot = { connected: boolean; plugins: InstalledPlugin[]; scanWarnings: number };
const EMPTY: CompanionSnapshot = { connected: false, plugins: [], scanWarnings: 0 };
let snapshot = EMPTY;
let pairing = '';
let epoch = 0;
let lifetime = new AbortController();
let queue: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();
export const companionSnapshot = () => snapshot;
export const companionServerSnapshot = () => EMPTY;
export function subscribeCompanion(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publish(next: CompanionSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}
export function disconnectCompanion() {
  epoch++;
  pairing = '';
  lifetime.abort();
  lifetime = new AbortController();
  queue = Promise.resolve();
  publish(EMPTY);
}
async function bytes(response: Response, maximum: number): Promise<ArrayBuffer> {
  if (Number(response.headers.get('content-length')) > maximum)
    throw Error('The companion response exceeds the supported size.');
  const reader = response.body?.getReader();
  if (!reader) throw Error('The companion returned an empty response.');
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maximum) throw Error('The companion response exceeds the supported size.');
      chunks.push(part.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  return new Blob(chunks).arrayBuffer();
}
async function request(
  path: '/health' | '/plugins' | '/rescan' | '/render' | '/editor',
  body?: unknown,
  signal?: AbortSignal,
  token = pairing,
) {
  if (!token) throw Error('Connect the SESSION companion to use this VST3 instrument.');
  const controller = new AbortController();
  const session = lifetime;
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  session.signal.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted || session.signal.aborted) cancel();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; cancel(); },
    path === '/health' ? 15000 : path === '/editor' ? 30 * 60000 : path === '/render' ? 125000 : 60000);
  try {
    const response = await fetch('http://127.0.0.1:17341/v1' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: 'Bearer ' + token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    });
    if (!response.ok) {
      const error = JSON.parse(new TextDecoder().decode(await bytes(response, 4000)));
      throw Error(typeof error.error === 'string' ? error.error.slice(0, 200) : 'The companion could not complete this action.');
    }
    const binary = path === '/render';
    const result = await bytes(response, binary ? 58 * 1024 * 1024 : MAX_PLUGIN_STATE_JSON);
    if (controller.signal.aborted) throw new DOMException('Plugin operation cancelled.', 'AbortError');
    if (binary) return result;
    return JSON.parse(new TextDecoder().decode(result));
  } catch (error) {
    if (controller.signal.aborted) {
      if (!timedOut || signal?.aborted || session.signal.aborted)
        throw new DOMException('Plugin operation cancelled.', 'AbortError');
      const message = path === '/health'
        ? 'The companion did not respond. Keep its console open and allow SESSION local network access in your browser, then retry. An in-app browser may block this connection.'
        : path === '/plugins' || path === '/rescan'
          ? 'The instrument scan timed out. Keep the companion open and retry the connection or rescan.'
          : path === '/editor'
            ? 'The instrument editor timed out. Close its window and reopen it from SESSION.'
            : 'The instrument render timed out. Try a shorter score or a different instrument.';
      throw Error(message);
    }
    if (error instanceof TypeError)
      throw Error('The companion could not connect. Start it, check the pairing code, and allow local network access when your browser asks.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    session.signal.removeEventListener('abort', cancel);
  }
}
function installed(value: unknown): InstalledPlugin[] {
  if (!Array.isArray(value) || value.length > 256) throw Error('The companion returned an invalid plugin list.');
  const ids = new Set<string>();
  return value.map((plugin) => {
    if (!plugin || typeof plugin !== 'object' || typeof plugin.classId !== 'string' ||
      !/^[0-9a-f]{32}$/.test(plugin.classId) || ids.has(plugin.classId) ||
      !['name', 'vendor', 'version'].every((key) => typeof plugin[key] === 'string' && plugin[key].length <= 100) ||
      !plugin.name.trim() || !plugin.vendor.trim()) throw Error('The companion returned an invalid plugin list.');
    ids.add(plugin.classId);
    return { classId: plugin.classId, name: plugin.name, vendor: plugin.vendor, version: plugin.version };
  });
}
function scanWarnings(value: unknown) {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 100000)
    throw Error('The companion returned an invalid scan report.');
  return value;
}
export async function connectCompanion(token: string, signal?: AbortSignal,
  onProgress?: (stage: 'checking' | 'scanning') => void) {
  if (!/^[0-9a-f]{64}$/i.test(token.trim())) throw Error('Paste the 64-character pairing code from the companion.');
  disconnectCompanion();
  const current = epoch;
  const value = token.trim().toLowerCase();
  const checkPairing = () => {
    if (epoch !== current || signal?.aborted) throw new DOMException('Pairing cancelled.', 'AbortError');
  };
  checkPairing();
  onProgress?.('checking');
  checkPairing();
  const health = await request('/health', undefined, signal, value);
  checkPairing();
  if (health.version !== 1 || health.platform !== 'win32' || health.nativeAvailable !== true)
    throw Error('Build and start the Windows companion before connecting.');
  onProgress?.('scanning');
  checkPairing();
  const report = await request('/plugins', undefined, signal, value);
  const plugins = installed(report.plugins);
  const warnings = scanWarnings(report.warnings);
  checkPairing();
  pairing = value;
  publish({ connected: true, plugins, scanWarnings: warnings });
}
export async function rescanCompanion(signal?: AbortSignal) {
  const current = epoch;
  const report = await request('/rescan', {}, signal);
  const plugins = installed(report.plugins);
  const warnings = scanWarnings(report.warnings);
  if (current !== epoch || signal?.aborted) throw new DOMException('Scan cancelled.', 'AbortError');
  publish({ connected: true, plugins, scanWarnings: warnings });
}
export async function readPluginState(plugin: Vst3Instrument, signal?: AbortSignal): Promise<Vst3State | undefined> {
  if (!plugin.stateFileId) return undefined;
  const response = await fetch('/api/file/' + plugin.stateFileId, { signal, cache: 'no-store' });
  if (!response.ok) throw Error('This instrument state is private or is no longer available.');
  const state = validateVst3State(JSON.parse(new TextDecoder().decode(await bytes(response, MAX_PLUGIN_STATE_JSON))));
  if (state.classId !== plugin.classId) throw Error('This state belongs to a different instrument.');
  return state;
}
export async function editVst3(plugin: Vst3Instrument, bpm: number, signal?: AbortSignal): Promise<Vst3State> {
  const current = epoch;
  const ownedSignal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
  const work = async () => {
    if (ownedSignal.aborted || current !== epoch) throw new DOMException('Editor cancelled.', 'AbortError');
    const state = await readPluginState(plugin, ownedSignal);
    if (ownedSignal.aborted || current !== epoch) throw new DOMException('Editor cancelled.', 'AbortError');
    const result = await request('/editor', { pluginId: plugin.classId, bpm,
      ...(state ? { state: { component: state.component, controller: state.controller } } : {}) }, signal);
    if (signal?.aborted || current !== epoch) throw new DOMException('Editor cancelled.', 'AbortError');
    return validateVst3State({ version: 1, format: 'vst3', classId: plugin.classId,
      component: result.state?.component, controller: result.state?.controller });
  };
  const job = queue.then(work, work);
  queue = job.catch(() => {});
  return job;
}
export async function renderVst3(track: MixerTrack, bpm: number, sampleRate = 44100, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (track.plugin?.format !== 'vst3') throw Error('Choose a VST3 instrument.');
  const plugin = track.plugin;
  const current = epoch;
  const ownedSignal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
  const work = async () => {
    if (ownedSignal.aborted || epoch !== current) throw new DOMException('Render cancelled.', 'AbortError');
    const state = await readPluginState(plugin, ownedSignal);
    if (ownedSignal.aborted || epoch !== current) throw new DOMException('Render cancelled.', 'AbortError');
    const result = await request('/render', {
      pluginId: plugin.classId, bpm,
      beats: track.noteLoopBeats ?? Math.max(8, ...(track.notes || []).map((note) => note.start + note.length)),
      sampleRate: sampleRate === 48000 ? 48000 : 44100,
      notes: (track.notes || []).map(({ pitch, start, length, velocity }) => ({ pitch, start, length, velocity })),
      ...(state ? { state: { component: state.component, controller: state.controller } } : {}),
    }, signal);
    if (epoch !== current || signal?.aborted) throw new DOMException('Render cancelled.', 'AbortError');
    return result as ArrayBuffer;
  };
  const job = queue.then(work, work);
  queue = job.catch(() => {});
  return job;
}
