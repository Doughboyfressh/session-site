// Read-only guest acceptance against an explicitly selected Vercel/Neon deployment.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const base = process.env.SESSION_VERIFY_BASE;
assert.ok(base, 'Set SESSION_VERIFY_BASE to the Vercel/Neon origin.');
const evidence = [];
for (const [name, headers] of [
  ['guest', {}],
  ['forged dispatcher identity', {
    'oai-auth-user-id': 'developer-http-fixture',
    'oai-auth-user-name': 'Owner',
    'oai-auth-user-role': 'admin',
  }],
]) {
  const response = await fetch(new URL('/api/developer?q=private&page=1', base), {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 401, name);
  assert.match(response.headers.get('cache-control') ?? '', /private/);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  assert.match(response.headers.get('vary') ?? '', /cookie/i);
  assert.deepEqual(await response.json(), { error: 'Sign in to continue.' });
  evidence.push({ check: name, status: response.status, passed: true });
}
for (const route of ['/developer', '/app']) {
  const response = await fetch(new URL(route, base), {
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200, route);
  const html = await response.text();
  if (route === '/developer') {
    assert.match(html, /Sign in to SESSION/);
    assert.match(html, /noindex/);
    assert.doesNotMatch(html, /Search creator profiles|Database reachable/);
  } else {
    assert.doesNotMatch(html, /href="\/developer"/);
  }
  evidence.push({ check: `guest ${route}`, status: response.status, passed: true });
}
fs.mkdirSync('outputs/developer-evidence', { recursive: true });
fs.writeFileSync('outputs/developer-evidence/live-guest-checks.json', JSON.stringify({
  base,
  passed: true,
  evidence,
}, null, 2));
console.log(`${evidence.length} developer guest HTTP checks passed against ${base}.`);
