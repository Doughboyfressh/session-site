import {
  validateBrowserInstrument,
  type BrowserInstrument,
} from './browser-instruments';
import type { Arrangement, MixerTrack } from './audio';

export type Vst3Instrument = {
  format: 'vst3';
  version: 1;
  classId: string;
  name: string;
  vendor: string;
  stateFileId?: string;
  freeze?: { fileId: string; fingerprint: string };
};
export type InstrumentPlugin = BrowserInstrument | Vst3Instrument;
export type Vst3State = {
  version: 1;
  format: 'vst3';
  classId: string;
  component: string;
  controller: string;
};
export const MAX_PLUGIN_STATE_BYTES = 8 * 1024 * 1024;
export const MAX_PLUGIN_STATE_JSON = 12 * 1024 * 1024;
const classId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
const fileId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function only(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw Error('This instrument contains unsupported settings.');
}
function label(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 100;
}
export function validateInstrumentPlugin(value: unknown): InstrumentPlugin {
  if (!object(value)) throw Error('Choose an available instrument plugin.');
  if (value.format === 'browser') return validateBrowserInstrument(value);
  only(value, ['format', 'version', 'classId', 'name', 'vendor', 'stateFileId', 'freeze']);
  if (!['format', 'version', 'classId', 'name', 'vendor'].every((key) => Object.hasOwn(value, key)) || value.format !== 'vst3' || value.version !== 1 ||
    !classId(value.classId) || !label(value.name) || !label(value.vendor) ||
    (value.stateFileId !== undefined && !fileId(value.stateFileId)))
    throw Error('This VST3 instrument is invalid. Choose an installed instrument again.');
  if (value.freeze !== undefined) {
    if (!object(value.freeze)) throw Error('Invalid rendered instrument.');
    only(value.freeze, ['fileId', 'fingerprint']);
    if (!Object.hasOwn(value.freeze, 'fileId') || !Object.hasOwn(value.freeze, 'fingerprint') || !fileId(value.freeze.fileId) || typeof value.freeze.fingerprint !== 'string' ||
      !/^[0-9a-f]{64}$/.test(value.freeze.fingerprint))
      throw Error('Invalid rendered instrument.');
  }
  return structuredClone(value) as Vst3Instrument;
}
function base64Bytes(value: unknown) {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_PLUGIN_STATE_BYTES / 3) * 4 ||
    value.length % 4 !== 0) throw Error('Invalid plugin state.');
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const content = value.slice(0, value.length - padding);
  if (/[^A-Za-z0-9+/]/.test(content)) throw Error('Invalid plugin state.');
  const last = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.indexOf(content.at(-1) || 'A');
  if ((padding === 2 && (last & 15)) || (padding === 1 && (last & 3))) throw Error('Invalid plugin state.');
  return value.length / 4 * 3 - padding;
}
export function validateVst3State(value: unknown): Vst3State {
  if (!object(value)) throw Error('Invalid plugin state.');
  only(value, ['version', 'format', 'classId', 'component', 'controller']);
  if (!['version', 'format', 'classId', 'component', 'controller'].every((key) => Object.hasOwn(value, key)) || value.version !== 1 || value.format !== 'vst3' || !classId(value.classId) ||
    base64Bytes(value.component) + base64Bytes(value.controller) > MAX_PLUGIN_STATE_BYTES)
    throw Error('Use plugin state within the 8 MB limit.');
  return value as Vst3State;
}
export function instrumentSourceKey(track: MixerTrack) {
  return JSON.stringify([track.id, track.notes, track.noteLoopBeats, track.sound,
    track.fileId, track.sample, track.plugin]);
}
export async function pluginFingerprint(track: MixerTrack, bpm: number) {
  if (track.plugin?.format !== 'vst3') throw Error('Choose a VST3 instrument.');
  // Mix controls and clip placement do not alter an instrument's dry score.
  const bytes = new TextEncoder().encode(JSON.stringify([1, track.plugin.classId,
    track.plugin.stateFileId || '', bpm, track.noteLoopBeats ?? null,
    (track.notes || []).map(({ pitch, start, length, velocity }) => [pitch, start, length, velocity])]));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function projectInstrumentFiles(data: Arrangement) {
  const references = new Map<string, { id: string; purpose: 'audio' | 'plugin-state' }>();
  const add = (id: string, purpose: 'audio' | 'plugin-state') => {
    if (references.has(id) && references.get(id)!.purpose !== purpose)
      throw Object.assign(Error('One file cannot be both audio and plugin state.'), { status: 400 });
    references.set(id, { id, purpose });
  };
  for (const track of data.tracks) {
    if (track.fileId) add(track.fileId, 'audio');
    if (track.plugin?.format !== 'vst3') continue;
    if (track.plugin.stateFileId) add(track.plugin.stateFileId, 'plugin-state');
    if (track.plugin.freeze) add(track.plugin.freeze.fileId, 'audio');
  }
  return [...references.values()];
}
