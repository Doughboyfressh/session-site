// Read-only acceptance against an explicitly selected running deployment.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadTS } from './load-ts.mjs';
const { originalFor } = loadTS('lib/originals.ts');
const base = process.env.SESSION_VERIFY_BASE;
assert.ok(base, 'Set SESSION_VERIFY_BASE to the local or production origin.');
const evidence = [];
async function page(path) {
  const response = await fetch(new URL(path, base), {
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200, path);
  evidence.push({ path, status: response.status });
  return response.text();
}
const landing = await page('/');
assert.match(landing, /class="session-landing"/);
assert.match(landing, /Your sound\./);
assert.match(landing, /href="\/app\?view=Studio"/);
assert.match(landing, /href="\/app\?view=Beat%20library"/);
assert.match(landing, /The ten starter beats/);
const featured = [...landing.matchAll(/href="\/t\/([^"?]+)"/g)].map(m => m[1]);
assert.equal(featured.length, 3, 'three featured tracks render as real links');
for (const id of featured) {
  assert.ok(originalFor(id), 'every featured beat has an editable score');
  const track = await page('/t/' + id);
  assert.match(track, /Open full arrangement in Studio/);
  assert.ok(track.includes('/app?track=' + id), 'track opens the workspace');
}
assert.match(await page('/?utm_source=landing-check'), /class="session-landing"/);
for (const path of ['/app', '/app?view=Studio', '/?view=Studio', '/?track=' + featured[0], '/?room=landing-check', '/?project=landing-check', '/?stripe=success&order=landing-check']) {
  const workspace = await page(path);
  assert.doesNotMatch(workspace, /class="session-landing"/);
  assert.match(workspace, /Search music and creators/);
}
const destination = '/app?room=landing-check#invite=fixture-token';
const response = await fetch(new URL('/signin-with-chatgpt?return_to=' + encodeURIComponent(destination), base), { redirect: 'manual' });
assert.equal(response.status, 307);
assert.equal(new URL(response.headers.get('location'), base).searchParams.get('redirectTo'), destination);
evidence.push({ path: 'sign-in preserves query and invitation fragment', status: response.status });
const manifest = JSON.parse(await page('/manifest.webmanifest'));
assert.equal(manifest.start_url, '/app');
fs.mkdirSync('outputs/landing-evidence', { recursive: true });
fs.writeFileSync('outputs/landing-evidence/http-' + new URL(base).hostname + '.json', JSON.stringify({ base, passed: true, evidence }, null, 2));
console.log(`${evidence.length} landing/workspace HTTP checks passed against ${base}.`);
