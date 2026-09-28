import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const suites = [
  'audio-files',
  'recording',
  'recording-timing',
  'recording-upload',
  'loop-recording',
  'routing',
  'automation',
  'clip-edit',
  'comp',
  'merge',
  'note-edit',
  'note-gesture',
  'midi-notes',
  'midi-import',
  'sample-instrument',
  'sample-api',
  'creation-atomic',
  'take-bank-server',
  'backend',
  'production',
];
const results = [];
const out = path.resolve('outputs/release-checks');
fs.mkdirSync(out, { recursive: true });
for (const name of suites) {
  const result = spawnSync(process.execPath, [`tests/${name}-checks.mjs`], {
    encoding: 'utf8',
    timeout: 120000,
  });
  const output =
    (result.stdout || '') +
    (result.stderr || '') +
    (result.error ? String(result.error) : '');
  fs.writeFileSync(path.join(out, `${name}.log`), output);
  results.push({ name, passed: result.status === 0 });
  console.log(`${result.status === 0 ? 'PASS' : 'FAIL'} ${name}`);
  if (result.status !== 0) console.log(output.slice(-5000));
}
fs.writeFileSync(
  path.join(out, 'result.json'),
  JSON.stringify({ time: new Date().toISOString(), results }, null, 2),
);
process.exitCode = results.some((r) => !r.passed) ? 1 : 0;
