import assert from 'node:assert/strict';
import { loadTS } from './load-ts.mjs';

const { redactAnalyticsUrl } = loadTS('lib/web-analytics.ts');
for (const type of ['pageview', 'event']) {
  const event = {
    type,
    url: 'https://session.example/app?room=private-room&project=private-project#invite=private-token',
  };
  assert.deepEqual(redactAnalyticsUrl(event), {
    type,
    url: 'https://session.example/app',
  });
  assert.ok(event.url.includes('private-token'), 'does not mutate the SDK event');
}
for (const path of ['/', '/developer', '/auth/sign-in', '/t/beat-1', '/p/post-1']) {
  assert.equal(
    redactAnalyticsUrl({ type: 'pageview', url: `https://session.example${path}?email=private%40example.com&token=private` }).url,
    `https://session.example${path}`,
  );
}
assert.equal(
  redactAnalyticsUrl({ type: 'pageview', url: 'https://user:password@session.example/app?secret=x#secret' }).url,
  'https://session.example/app',
);
assert.equal(
  redactAnalyticsUrl({ type: 'pageview', url: 'http://localhost:3000/app?q=secret' }).url,
  'http://localhost:3000/app',
);
for (const url of ['not a URL', '/app?secret=x', 'javascript:alert(1)', 'data:text/plain,private']) {
  assert.equal(redactAnalyticsUrl({ type: 'pageview', url }), null);
}
console.log('PASS Web Analytics URL redaction (15 assertions)');
