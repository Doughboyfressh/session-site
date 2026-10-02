import assert from 'node:assert/strict';
import { loadTS } from './load-ts.mjs';
const { studioShortcut, loopStartRange } = loadTS('lib/studio-ui.ts');
const key = {
  key: ' ',
  code: 'Space',
  defaultPrevented: false,
  repeat: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
};
assert.equal(studioShortcut(key, false), 'play');
assert.equal(studioShortcut(key, true), null);
for (const flag of [
  'defaultPrevented',
  'repeat',
  'altKey',
  'ctrlKey',
  'metaKey',
])
  assert.equal(studioShortcut({ ...key, [flag]: true }, false), null);
assert.equal(
  studioShortcut({ ...key, key: 'R', code: 'KeyR' }, false),
  'record',
);
assert.equal(
  studioShortcut({ ...key, key: '?', code: 'Slash' }, false),
  'help',
);
assert.equal(
  studioShortcut({ ...key, key: 'Escape', code: 'Escape' }, false),
  null,
);
assert.deepEqual(loopStartRange(10, 8, 30), { start: 10, end: 10.25 });
assert.deepEqual(loopStartRange(2, 8, 30), { start: 2, end: 8 });
assert.deepEqual(loopStartRange(40, 8, 30), { start: 29.75, end: 30 });
assert.deepEqual(loopStartRange(-4, 8, 30), { start: 0, end: 8 });
assert.deepEqual(loopStartRange(NaN, 8, 30), { start: 0, end: 8 });
console.log('Studio shortcut ownership and valid loop bounds passed.');
