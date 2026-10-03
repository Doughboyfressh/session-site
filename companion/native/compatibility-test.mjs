import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'outputs', 'companion');
const executable = process.env.SESSION_VST3_HOST || path.join(output, 'session-vst3-host.exe');
const modulePath = path.join(output, 'regression-plugin', 'session-strict-fixture.vst3');
const evidence = path.join(output, 'compatibility-checks');
await mkdir(evidence, { recursive: true });
const checks = [];
async function invoke(command, payload) {
  const job = await mkdtemp(path.join(evidence, `${command}-`));
  const request = path.join(job, 'request.json'), response = path.join(job, 'response.json');
  if (command === 'render') payload = { ...payload, audioPath: path.join(job, 'audio.wav') };
  await writeFile(request, JSON.stringify(payload));
  const result = spawnSync(executable, [command, request, response], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  if (result.error) throw result.error;
  return { exitCode: result.status, value: JSON.parse(await readFile(response, 'utf8')), payload };
}
const scanned = await invoke('scan', { modulePath });
assert.equal(scanned.exitCode, 0);
const classId = scanned.value.plugins[0].classId;
const score = { modulePath, classId, bpm: 120, beats: 1, sampleRate: 48000, notes: [{ pitch: 60, start: 0, length: 0.5, velocity: 0.8 }] };
const rendered = await invoke('render', score);
assert.equal(rendered.exitCode, 0, JSON.stringify(rendered.value));
const wav = await readFile(rendered.payload.audioPath);
assert.equal(wav.readUInt32LE(40), 48000 * 4);
assert.ok(wav.readInt16LE(44 + 100 * 4) > 1000, 'strict fixture was silent: required buses were activated before setup');
assert.equal(wav.readInt16LE(44 + 20000 * 4), 0);
checks.push('processing setup precedes bus activation and notes produce sound');
for (const [mode, bus] of [[1, 'audio'], [2, 'event']]) {
  const refused = await invoke('render', { ...score, state: { component: Buffer.from([mode]).toString('base64'), controller: '' } });
  assert.equal(refused.exitCode, 1, `${bus} activation refusal was ignored`);
  assert.equal(refused.value.ok, false);
  assert.match(refused.value.error, /activate.*bus|bus.*activation/i);
  checks.push(`required ${bus} bus refusal fails explicitly`);
}
const callbacks = spawnSync(path.join(output, 'session-vst3-host-checks.exe'), [], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
if (callbacks.error) throw callbacks.error;
assert.equal(callbacks.status, 0, callbacks.stderr);
const result = JSON.parse(callbacks.stdout);
assert.equal(result.ok, true);
checks.push(`native callbacks and editor geometry (${result.checks} scenarios)`);
await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ ok: true, checks }, null, 2));
console.log(JSON.stringify({ ok: true, checks }, null, 2));
