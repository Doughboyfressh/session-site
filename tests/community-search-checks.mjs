import assert from 'node:assert/strict';
import { loadTS } from './load-ts.mjs';

const {
  initialCommunitySearch,
  startCommunitySearch,
  mergeSearchTracks,
  trackPermalink,
} = loadTS('lib/community-search.ts');
const { demos } = loadTS('lib/catalog.ts');
const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
const timers = new Map();
const pending = [];
let timerId = 0;
let state;
let updates = 0;
globalThis.setTimeout = (run, delay) => {
  assert.equal(delay, 350);
  timers.set(++timerId, run);
  return timerId;
};
globalThis.clearTimeout = (id) => timers.delete(id);
const fetcher = (url, init) =>
  new Promise((resolve, reject) =>
    pending.push({ url, init, resolve, reject }),
  );
const publish = (value) => {
  state = value;
  updates++;
};
function fireTimer() {
  const [id, run] = timers.entries().next().value;
  timers.delete(id);
  return run();
}
function response(track, status = 200) {
  return Response.json(
    status === 200
      ? { tracks: track ? [track] : [], profiles: [] }
      : { error: 'Fixture HTTP failure' },
    { status },
  );
}

try {
  assert.deepEqual(initialCommunitySearch(' a '), {
    query: 'a',
    results: null,
    searching: false,
    error: '',
  });
  const cancelDebounce = startCommunitySearch('unrequested', publish, fetcher);
  cancelDebounce();
  assert.equal(timers.size, 0);
  assert.equal(pending.length, 0);

  const cancelAlpha = startCommunitySearch(' alpha ', publish, fetcher);
  const alpha = fireTimer();
  assert.equal(pending[0].url, '/api/search?q=alpha');
  cancelAlpha();
  const cancelBeta = startCommunitySearch('beta', publish, fetcher);
  assert.equal(state.query, 'beta');
  assert.equal(state.searching, true);
  assert.equal(state.results, null);
  const beta = fireTimer();
  pending[1].resolve(response({ id: 'beta' }));
  await beta;
  assert.equal(state.results.tracks[0].id, 'beta');
  const settledBetaUpdates = updates;
  pending[0].resolve(response({ id: 'alpha' }));
  await alpha;
  assert.equal(pending[0].init.signal.aborted, true);
  assert.equal(state.results.tracks[0].id, 'beta');
  assert.equal(updates, settledBetaUpdates);
  cancelBeta();

  const cancelOldFailure = startCommunitySearch(
    'old failure',
    publish,
    fetcher,
  );
  const oldFailure = fireTimer();
  cancelOldFailure();
  const cancelCurrent = startCommunitySearch('current', publish, fetcher);
  const current = fireTimer();
  const currentUpdates = updates;
  pending[2].reject(new Error('Old network failure'));
  await oldFailure;
  assert.equal(updates, currentUpdates);
  assert.equal(state.query, 'current');
  assert.equal(state.searching, true);
  pending[3].resolve(response({ id: 'current' }));
  await current;
  assert.equal(state.searching, false);
  cancelCurrent();

  const cancelCleared = startCommunitySearch('clear me', publish, fetcher);
  const cleared = fireTimer();
  cancelCleared();
  startCommunitySearch('', publish, fetcher)();
  const clearedUpdates = updates;
  pending[4].resolve(response({ id: 'cleared' }));
  await cleared;
  assert.equal(updates, clearedUpdates);
  assert.equal(state.results, null);
  assert.equal(state.searching, false);

  const cancelFailed = startCommunitySearch('failed', publish, fetcher);
  const failed = fireTimer();
  pending[5].resolve(response(null, 503));
  await failed;
  assert.equal(state.query, 'failed');
  assert.equal(state.searching, false);
  assert.equal(state.results, null);
  assert.match(state.error, /unavailable/);
  cancelFailed();
  const cancelRetry = startCommunitySearch('failed', publish, fetcher);
  const retry = fireTimer();
  assert.equal(state.error, '');
  assert.equal(state.searching, true);
  pending[6].resolve(response({ id: 'retried' }));
  await retry;
  assert.equal(state.results.tracks[0].id, 'retried');
  assert.equal(state.error, '');
  cancelRetry();

  const cancelUnmounted = startCommunitySearch('unmounted', publish, fetcher);
  const unmounted = fireTimer();
  cancelUnmounted();
  const unmountedUpdates = updates;
  pending[7].reject(new Error('Response after unmount'));
  await unmounted;
  assert.equal(updates, unmountedUpdates);

  const cancelInvalid = startCommunitySearch('invalid json', publish, fetcher);
  const invalid = fireTimer();
  pending[8].resolve(new Response('not JSON'));
  await invalid;
  assert.match(state.error, /unavailable/);
  assert.equal(state.searching, false);
  cancelInvalid();

  const ambient = mergeSearchTracks(' AMBIENT ', [], demos);
  assert.equal(ambient.length, 2);
  assert(ambient.every((track) => track.genre === 'Ambient'));
  const remote = {
    id: 'remote',
    title: 'Remote ambient',
    genre: 'Ambient',
    creator: 'Member',
  };
  const merged = mergeSearchTracks(
    'ambient',
    [remote, ambient[0], remote],
    demos,
  );
  assert.equal(merged.length, 3);
  assert.equal(new Set(merged.map((track) => track.id)).size, 3);
  assert.equal(merged[0], remote);
  assert.equal(
    mergeSearchTracks(ambient[0].title.toLowerCase(), [], demos)[0].id,
    ambient[0].id,
  );
  assert.equal(
    mergeSearchTracks('session originals', [], demos).length,
    demos.length,
  );
  assert.deepEqual(mergeSearchTracks('unmatched fixture', [], demos), []);
  assert.deepEqual(mergeSearchTracks('a', [remote], demos), []);
  assert.equal(trackPermalink('archive /?#'), '/t/archive%20%2F%3F%23');
  console.log(
    'Community search cancellation, ownership, errors, retry, Originals merge and permalink checks passed.',
  );
} finally {
  globalThis.setTimeout = nativeSetTimeout;
  globalThis.clearTimeout = nativeClearTimeout;
}
