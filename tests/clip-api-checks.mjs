import assert from 'node:assert/strict';
import { splitClip } from '../lib/clip-edit.ts';
const user = 'qa_clip_' + Date.now().toString(36),
  headers = {
    'Content-Type': 'application/json',
    'oai-authenticated-user-id': user,
    'oai-authenticated-user-email': user + '@example.test',
  };
let checks = 0;
async function act(body, status = 200) {
  const r = await fetch('http://127.0.0.1:8787/api/action', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const value = await r.json();
  assert.equal(r.status, status, JSON.stringify(value));
  checks++;
  return value;
}
await act({
  action: 'profile',
  username: user,
  name: 'QA Clip editing',
  roles: ['Producer'],
  visibility: 'private',
});
const t = {
  id: 'source',
  name: 'Synth source',
  notes: [{ id: 'n', pitch: 60, start: 0, length: 8, velocity: 0.5 }],
  duration: 4.5,
  volume: 0.8,
  pan: 0,
  muted: false,
  solo: false,
  offset: 0,
  trimStart: 0,
  trimEnd: 0,
  low: 0,
  mid: 0,
  high: 0,
  fadeIn: 1,
  fadeOut: 1,
};
const data = splitClip({ bpm: 120, tracks: [t] }, t.id, 2, 'right');
const p = await act({ action: 'project', title: 'QA split save', data });
try {
  const saved = await act({ action: 'projectRead', id: p.id });
  assert.equal(saved.data.tracks.length, 2);
  checks++;
  assert.equal(saved.data.tracks[1].splitFrom, 'source');
  checks++;
  assert.equal(saved.data.tracks[1].fadeStart, 0);
  checks++;
  assert.equal(saved.data.tracks[1].fadeEnd, 4.5);
  checks++;
  for (const bad of [
    { fadeStart: -1 },
    { fadeEnd: 301 },
    { fadeStart: '1' },
    { splitFrom: '' },
    { splitFrom: 42 },
    { splitFrom: 'x'.repeat(129) },
  ]) {
    await act(
      {
        action: 'project',
        id: p.id,
        title: 'QA invalid split',
        baseRevision: saved.revision,
        data: {
          ...data,
          tracks: [{ ...data.tracks[0], ...bad }, data.tracks[1]],
        },
      },
      400,
    );
  }
  const again = await act({ action: 'projectRead', id: p.id });
  assert.equal(again.revision, saved.revision);
  checks++;
} finally {
  await act({ action: 'deleteProject', id: p.id });
}
console.log(`PASS: ${checks} split save, reload and validation assertions.`);
