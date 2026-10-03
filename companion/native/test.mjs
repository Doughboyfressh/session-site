import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'outputs', 'companion');
const executable = process.env.SESSION_VST3_HOST || path.join(output, 'session-vst3-host.exe');
const modulePath = process.env.SESSION_VST3_TEST_PLUGIN || path.join(output, 'test-plugin', 'note-expression-synth.vst3');
const evidence = path.join(output, 'native-checks');
await mkdir(evidence, { recursive: true });
const checks = [];
async function invoke(command, payload, expectedOk = true) {
  const job = await mkdtemp(path.join(evidence, `${command}-`));
  const request = path.join(job, 'request.json'), response = path.join(job, 'response.json');
  if (command === 'render') payload = { ...payload, audioPath: path.join(job, 'audio.wav') };
  await writeFile(request, JSON.stringify(payload));
  const result = spawnSync(executable, [command, request, response], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  if (result.error) throw result.error;
  const value = JSON.parse(await readFile(response, 'utf8'));
  assert.equal(result.status === 0, expectedOk, JSON.stringify(value));
  if (!expectedOk) { assert.equal(value.ok, false); assert.equal(typeof value.error, 'string'); assert.ok(!value.error.includes(modulePath)); }
  return { value, job, payload };
}
async function audio(payload) {
  const result = await invoke('render', payload);
  assert.deepEqual(result.value, { ok: true });
  const wav = await readFile(result.payload.audioPath);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(20), 1); assert.equal(wav.readUInt16LE(22), 2); assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(24), payload.sampleRate); assert.equal(wav.readUInt32LE(40), wav.length - 44);
  const frames = (wav.length - 44) / 4;
  const values = Array.from({ length: frames }, (_, i) => wav.readInt16LE(44 + i * 4) / 32768);
  const first = values.findIndex(v => Math.abs(v) > 1 / 32768);
  const peak = Math.max(...values.slice(0, 50000).map(Math.abs));
  return { frames, values, first, peak, file: result.payload.audioPath };
}
const scanned = (await invoke('scan', { modulePath })).value.plugins;
assert.ok(scanned.length > 0); assert.ok(scanned.every(p => /^[0-9a-f]{32}$/.test(p.classId)));
const selected = scanned.find(p => p.name.includes('Note Expression Synth') && !p.name.includes('Touch')) || scanned[0];
const base = { modulePath, classId: selected.classId, bpm: 120, beats: 4, sampleRate: 48000, notes: [{ pitch: 60, start: 1, length: 1, velocity: 0.8 }] };
checks.push({ name: 'instrument factory scan', plugins: scanned });
const state = (await invoke('state', { modulePath, classId: selected.classId })).value.state;
assert.equal(typeof state.component, 'string'); assert.ok(state.component.length > 0); assert.equal(typeof state.controller, 'string');
const roundtrip = (await invoke('state', { modulePath, classId: selected.classId, state })).value.state;
assert.deepEqual(roundtrip, state); checks.push({ name: 'component/controller state roundtrip', bytes: Buffer.from(state.component, 'base64').length + Buffer.from(state.controller, 'base64').length });
const edited = await invoke('editor-check', { modulePath, classId: '41466d9bb0654576b641098f686371b3', state, bpm: 120 });
assert.equal(Buffer.from(edited.value.state.component, 'base64').readDoubleLE(74), 0.25);
checks.push({ name: 'native editor attach, parameter callback and close', audioAvailable: edited.value.audioAvailable, masterVolume: 0.25 });
const first = await audio({ ...base, state });
assert.equal(first.frames, 120000); assert.ok(first.peak > 0.01); assert.ok(first.values.slice(0, 24000).every(v => v === 0));
assert.ok(first.first >= 24000 && first.first < 24512); assert.ok(first.values.slice(110000).every(v => Math.abs(v) < 0.0001));
checks.push({ name: 'note onset and release', frames: first.frames, onsetFrame: first.first, peak: first.peak, wav: first.file });
// SDK3.8 GlobalParameterState v3 serializes masterVolume after its oscillator/filter fields.
// Changing the processor state exercises actual sound recall, independently of UI defaults.
const mutedBytes = Buffer.from(state.component, 'base64');
assert.equal(mutedBytes.readBigUInt64LE(0), 3n); mutedBytes.writeDoubleLE(0, 74);
const mutedState = { ...state, component: mutedBytes.toString('base64') };
assert.deepEqual((await invoke('state', { modulePath, classId: selected.classId, state: mutedState })).value.state, mutedState);
const muted = await audio({ ...base, state: mutedState }); assert.ok(muted.values.every(v => v === 0));
checks.push({ name: 'restored processor state changes rendered sound', peak: muted.peak });
const overload = Buffer.from(state.component, 'base64'); overload.writeDoubleLE(100, 74);
const clipped = await invoke('render', { ...base, state: { ...state, component: overload.toString('base64') } }, false);
assert.match(clipped.value.error, /full scale.*lower its output level/);
checks.push({ name: 'reject raw plug-in output above full scale', clipping: clipped.value.error });
const fast = await audio({ ...base, bpm: 240 }); assert.equal(fast.frames, 72000); assert.ok(fast.first >= 12000 && fast.first < 12512);
checks.push({ name: 'tempo changes note timing', frames: fast.frames, onsetFrame: fast.first });
const silence = await audio({ ...base, notes: [] }); assert.equal(silence.peak, 0); assert.ok(silence.values.every(v => v === 0));
checks.push({ name: 'empty score silence', frames: silence.frames });
const rate = await audio({ ...base, sampleRate: 44100 }); assert.equal(rate.frames, 110250); assert.ok(rate.first >= 22050 && rate.first < 22562);
checks.push({ name: '44100Hz render', frames: rate.frames, onsetFrame: rate.first });
const fractional = await audio({ ...base, bpm: 137.2, beats: 2.25, sampleRate: 44100 });
assert.equal(fractional.frames, Math.ceil((2.25 * 60 / 137.2 + 0.5) * 44100));
checks.push({ name: 'fractional tempo and score use ceiling frame count', frames: fractional.frames });
const invalid = [
  { ...base, bpm: 20 }, { ...base, bpm: 241 }, { ...base, beats: 513 }, { ...base, beats: 512, bpm: 40 },
  { ...base, sampleRate: 47999 }, { ...base, classId: 'z'.repeat(32) }, { ...base, classId: '0'.repeat(32) },
  { ...base, state: { component: '!!!!', controller: '' } }, { ...base, state: { component: 'AA=A', controller: '' } },
  { ...base, state: { component: Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64'), controller: '' } },
  { ...base, notes: [{ pitch: 60.5, start: 0, length: 1, velocity: 0.8 }] },
  { ...base, notes: [{ pitch: 128, start: 0, length: 1, velocity: 0.8 }] },
  { ...base, notes: [{ pitch: 60, start: -1, length: 1, velocity: 0.8 }] },
  { ...base, notes: [{ pitch: 60, start: 4, length: 1, velocity: 0.8 }] },
  { ...base, notes: [{ pitch: 60, start: 0, length: 0, velocity: 0.8 }] },
  { ...base, notes: [{ pitch: 60, start: 0, length: 1, velocity: 128 }] },
  { ...base, notes: Array.from({ length: 257 }, () => ({ pitch: 60, start: 0, length: 1, velocity: 0.8 })) },
  { ...base, unexpected: true },
];
for (const payload of invalid) await invoke('render', payload, false);
checks.push({ name: 'native invalid input rejection', cases: invalid.length });
await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ ok: true, executable, modulePath, checks }, null, 2));
console.log(JSON.stringify({ ok: true, checks }, null, 2));
