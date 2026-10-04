import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { loadTS } from './load-ts.mjs';

const { createForegroundActivity } = loadTS('lib/foreground-activity.ts');
const flush = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
let now = Date.parse('2026-10-03T23:59:00Z');
let visible = false;
let sends = 0;
let succeeds = true;
let release;
const recorder = createForegroundActivity({
  now: () => now,
  visible: () => visible,
  send: async () => { sends++; return succeeds; },
});
await recorder.record(true);
assert.equal(sends, 0, 'hidden documents are not activity');
visible = true;
await recorder.record(true);
assert.equal(sends, 1, 'visible entry records activity');
for (let n = 0; n < 30; n++) await recorder.record();
assert.equal(sends, 1, 'interaction bursts are throttled');
now += 61 * 1000;
await recorder.record();
assert.equal(sends, 2, 'UTC midnight records a new day even inside throttle window');
await recorder.record(true);
assert.equal(sends, 3, 'route visits can capture a newly signed-in account');
visible = false;
now += 6 * 60 * 1000;
await recorder.record();
assert.equal(sends, 3, 'an idle hidden tab cannot create DAU');
visible = true;
succeeds = false;
await recorder.record();
assert.equal(sends, 4);
await recorder.record(true);
assert.equal(sends, 4, 'failure backoff also covers route visits');
now += 60 * 1000;
succeeds = true;
await recorder.record();
assert.equal(sends, 5, 'retries after backoff on real activity');

let serialized = 0;
const queue = createForegroundActivity({
  now: () => now,
  visible: () => visible,
  send: () => { serialized++; return new Promise(resolve => { release = resolve; }); },
});
const first = queue.record(true);
await flush();
void queue.record(true);
void queue.record(true);
void queue.record();
assert.equal(serialized, 1, 'rapid navigation waits for the visitor cookie');
release(true);
await first;
await flush();
assert.equal(serialized, 2, 'queued route visits coalesce to one follow-up');
visible = false;
void queue.record(true);
release(true);
await flush();
assert.equal(serialized, 2, 'completion does not record a hidden page');

// A real interaction after midnight must survive an older request still pending.
visible = true;
now = Date.parse('2026-10-03T23:59:59Z');
const sentDays = [];
const rollover = createForegroundActivity({
  now: () => now,
  visible: () => visible,
  send: () => {
    sentDays.push(new Date(now).toISOString().slice(0, 10));
    return new Promise(resolve => { release = resolve; });
  },
});
const priorDay = rollover.record(true);
await flush();
now += 2000;
void rollover.record();
release(true);
await priorDay;
await flush();
assert.deepEqual(sentDays, ['2026-10-03', '2026-10-04'],
  'next-day interaction queues behind an in-flight prior-day visit');
release(true);
await flush();

// Run the actual client component's effects, including StrictMode's setup /
// cleanup / setup cycle before the initial timer fires.
class EventTargetFixture {
  listeners = new Map();
  addEventListener(event, listener) {
    const listeners = this.listeners.get(event) || new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }
  removeEventListener(event, listener) { this.listeners.get(event)?.delete(listener); }
  emit(event) { for (const listener of this.listeners.get(event) || []) listener(); }
  get count() { return [...this.listeners.values()].reduce((sum, entries) => sum + entries.size, 0); }
}
const documentFixture = new EventTargetFixture();
documentFixture.visibilityState = 'visible';
const windowFixture = new EventTargetFixture();
const timers = new Map();
let nextTimer = 0;
windowFixture.setTimeout = callback => { timers.set(++nextTimer, callback); return nextTimer; };
windowFixture.clearTimeout = id => timers.delete(id);
const runTimers = async () => {
  const callbacks = [...timers.values()];
  timers.clear();
  callbacks.forEach(callback => callback());
  await flush();
};
let setup;
let pathname = '/';
const requests = [];
class FixtureDate extends Date { static now() { return now; } }
const componentCode = ts.transpileModule(fs.readFileSync('app/session-activity.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const componentModule = { exports: {} };
vm.runInNewContext(componentCode, {
  exports: componentModule.exports,
  require: id => {
    if (id === 'react') return { useEffect: effect => { setup = effect; } };
    if (id === 'next/navigation') return { usePathname: () => pathname };
    if (id === '../lib/foreground-activity') return { createForegroundActivity };
    throw new Error('Unexpected client import: ' + id);
  },
  Date: FixtureDate,
  document: documentFixture,
  window: windowFixture,
  fetch: async (url, options) => { requests.push({ url, options }); return { status: 204 }; },
});
const mount = () => { componentModule.exports.default(); return setup(); };
let cleanup = mount();
cleanup();
cleanup = mount();
assert.equal(timers.size, 1, 'StrictMode leaves one initial timer');
assert.equal(documentFixture.count, 4);
assert.equal(windowFixture.count, 1);
await runTimers();
assert.equal(requests.length, 1, 'StrictMode records one initial visit');
assert.deepEqual(JSON.parse(JSON.stringify(requests[0])), {
  url: '/api/activity',
  options: { method: 'POST', credentials: 'same-origin', cache: 'no-store', keepalive: true },
}, 'client sends no URL, private identifier, identity claim, or body');
documentFixture.emit('pointerdown');
documentFixture.emit('keydown');
documentFixture.emit('scroll');
windowFixture.emit('focus');
await flush();
assert.equal(requests.length, 1, 'foreground listeners share the interaction throttle');
cleanup();
assert.equal(documentFixture.count, 0);
assert.equal(windowFixture.count, 0);
pathname = '/app';
cleanup = mount();
await runTimers();
assert.equal(requests.length, 2, 'navigation records the current server identity');
documentFixture.visibilityState = 'hidden';
now += 6 * 60 * 1000;
documentFixture.emit('visibilitychange');
documentFixture.emit('pointerdown');
await flush();
assert.equal(requests.length, 2, 'hidden interaction is ignored');
documentFixture.visibilityState = 'visible';
documentFixture.emit('visibilitychange');
await flush();
assert.equal(requests.length, 3, 'returning to a foreground page records fresh activity');
cleanup();
assert.equal(timers.size, 0);
console.log('PASS foreground activity visibility, UTC rollover, throttling, backoff, and serialized navigation');
