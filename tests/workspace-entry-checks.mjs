import assert from 'node:assert/strict';
import { loadTS } from './load-ts.mjs';
const { hasWorkspaceIntent, workspaceSignInHref } = loadTS(
  'lib/workspace-entry.ts',
);
const { safeReturnPath } = loadTS('lib/deployment/return-path.ts');

assert.equal(hasWorkspaceIntent({}), false);
assert.equal(
  hasWorkspaceIntent({ utm_source: 'newsletter', campaign: 'session' }),
  false,
);
assert.equal(hasWorkspaceIntent({ view: '', track: [], room: [''] }), false);
for (const search of [
  { view: 'Studio' },
  { view: 'Beat library' },
  { view: ['Discover', 'Studio'] },
  { room: 'private-room' },
  { track: 'original-logwood' },
  { project: 'private-project' },
  { stripe: 'success' },
  { order: 'payment-return' },
])
  assert.equal(hasWorkspaceIntent(search), true);

assert.equal(
  new URL(workspaceSignInHref(), 'https://session.local').searchParams.get(
    'return_to',
  ),
  '/app',
);
for (const state of [
  { search: '?room=private-room', hash: '#invite=fixture-token' },
  { search: '?track=demo-1&view=Studio', hash: '' },
  { search: '?view=My%20projects', hash: '' },
  { search: '?stripe=success&order=fixture-order', hash: '' },
]) {
  const returnTo = new URL(
    workspaceSignInHref(state),
    'https://session.local',
  ).searchParams.get('return_to');
  assert.equal(returnTo, '/app' + state.search + state.hash);
  assert.equal(
    safeReturnPath(returnTo),
    returnTo,
    'existing auth sanitizer preserves supported workspace destinations',
  );
}
console.log('Landing/workspace entry and sign-in destination checks passed.');
