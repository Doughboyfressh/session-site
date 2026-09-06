import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:8787',
  tag = Date.now().toString(36),
  A = 'qa_create_a_' + tag,
  B = 'qa_create_b_' + tag,
  C = 'qa_create_c_' + tag;
const tracked = new Map();
let checks = 0;
const headers = (id) => ({
  'oai-authenticated-user-id': id,
  'oai-authenticated-user-email': id + '@example.test',
});
const check = (v, m) => {
  assert.ok(v, m);
  checks++;
};
async function call(id, body, status = 200) {
  const r = await fetch(base + '/api/action', {
    method: 'POST',
    headers: { ...headers(id), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  assert.equal(r.status, status, JSON.stringify(j));
  checks++;
  if (body.action === 'project' && r.ok) tracked.set(j.id, id);
  return j;
}
const request = (
  key = crypto.randomUUID(),
  title = 'Original first save',
  checkpoint = true,
) => ({
  action: 'project',
  title,
  data: { bpm: 92, tracks: [] },
  creation: { key, checkpoint },
  checkpoint,
});
const history = (owner, id) => call(owner, { action: 'projectVersions', id });
const resolve = (owner, key, status = 200) =>
  call(owner, { action: 'projectCreation', key }, status);
let file;
try {
  for (const [id, name] of [
    [A, 'Creator A'],
    [B, 'Creator B'],
    [C, 'Source owner'],
  ])
    await call(id, {
      action: 'profile',
      username: id.slice(0, 24),
      name,
      roles: ['Producer'],
      visibility: 'private',
    });
  const body = request(),
    first = await call(A, body),
    retry = await call(A, body);
  check(
    first.id === retry.id && retry.revision === 1 && retry.replayed,
    'Retry did not acknowledge original creation',
  );
  const copies = await Promise.all(
    Array.from({ length: 5 }, () => call(A, body)),
  );
  check(
    copies.every((x) => x.id === first.id && x.revision === 1),
    'Concurrent identical retry diverged',
  );
  check((await history(A, first.id)).length === 1, 'Retry added checkpoints');
  const read = await resolve(A, body.creation.key);
  check(
    read.found && read.receipt.project === first.id && read.project.canManage,
    'Receipt did not resolve owned project',
  );
  check(
    !(await resolve(C, body.creation.key)).found,
    'Receipt exposed another account',
  );
  const other = await call(B, body);
  check(
    other.id !== first.id && other.owner === B,
    'Creation keys crossed account namespaces',
  );
  await call(A, {
    action: 'project',
    id: first.id,
    title: 'Later project version',
    data: { bpm: 100, tracks: [] },
    baseRevision: 1,
  });
  const late = await call(A, body);
  check(
    late.revision === 1,
    'Replay acknowledged old data against a new revision',
  );
  const latest = await call(A, { action: 'projectRead', id: first.id });
  check(
    latest.revision === 2 && latest.title === 'Later project version',
    'Replay overwrote later project edits',
  );
  check(
    (await history(A, first.id)).length === 2,
    'Replay repeated history after later save',
  );
  await call(A, { ...body, title: 'Different attempted content' }, 409);
  const key = crypto.randomUUID();
  const contenders = await Promise.all(
    [request(key, 'First contender'), request(key, 'Second contender')].map(
      async (b) => {
        const r = await fetch(base + '/api/action', {
          method: 'POST',
          headers: { ...headers(A), 'Content-Type': 'application/json' },
          body: JSON.stringify(b),
        });
        const j = await r.json();
        if (r.ok) tracked.set(j.id, A);
        return { status: r.status, ...j };
      },
    ),
  );
  check(
    contenders.filter((r) => r.status === 200).length === 1 &&
      contenders.filter((r) => r.status === 409).length === 1,
    'Competing bodies did not produce one winner',
  );
  const winner = (await resolve(A, key)).project;
  check(
    (await history(A, winner.id)).length === 1,
    'Contended create duplicated history',
  );
  const noHistory = request(undefined, 'No checkpoint', false),
    noCheckpoint = await call(A, noHistory);
  await call(A, noHistory);
  check(
    (await history(A, noCheckpoint.id)).length === 0,
    'Retry introduced a disabled checkpoint',
  );
  await call(
    A,
    { ...noHistory, creation: { ...noHistory.creation, checkpoint: true } },
    409,
  );
  await call(A, { ...body, id: first.id }, 400);
  await call(A, { ...body, creation: { key: 'bad', checkpoint: true } }, 400);
  await resolve(A, 'bad', 400);
  const raw = new Uint8Array(204),
    v = new DataView(raw.buffer);
  for (const [i, t] of [
    [0, 'RIFF'],
    [8, 'WAVE'],
    [12, 'fmt '],
    [36, 'data'],
  ])
    for (let n = 0; n < t.length; n++) raw[i + n] = t.charCodeAt(n);
  v.setUint32(4, 196, true);
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  v.setUint32(40, 160, true);
  const fd = new FormData();
  fd.set('purpose', 'audio');
  fd.set(
    'file',
    new File([raw], 'creation-fixture.wav', { type: 'audio/wav' }),
  );
  const uploaded = await fetch(base + '/api/upload', {
    method: 'POST',
    headers: headers(C),
    body: fd,
  });
  check(uploaded.ok, 'Synthetic upload failed');
  file = await uploaded.json();
  const listing = await call(C, {
    action: 'track',
    fileId: file.id,
    title: 'Creation source',
    kind: 'beat',
    genre: 'Hip-hop',
    bpm: 92,
    musicalKey: 'C minor',
    visibility: 'private',
    permission: 'listen',
    rights: true,
  });
  const sourceBody = request();
  sourceBody.data.tracks = [
    {
      id: 'source',
      name: 'Source',
      fileId: file.id,
      volume: 0.8,
      pan: 0,
      offset: 0,
      trimStart: 0,
      trimEnd: 0,
      muted: false,
      solo: false,
      low: 0,
      mid: 0,
      high: 0,
    },
  ];
  await call(A, sourceBody, 403);
  check(
    !(await resolve(A, sourceBody.creation.key)).found,
    'Rejected source left a creation receipt',
  );
  await call(C, {
    action: 'visibility',
    id: listing.id,
    visibility: 'public',
    permission: 'collaborate',
  });
  const sourceProject = await call(A, sourceBody);
  await call(C, {
    action: 'visibility',
    id: listing.id,
    visibility: 'private',
    permission: 'listen',
  });
  check(
    (await call(A, sourceBody)).id === sourceProject.id,
    'Later visibility change broke receipt acknowledgement',
  );
  await call(C, { action: 'eraseFile', id: file.id, confirm: 'ERASE' });
  file = undefined;
  check(
    (await call(A, sourceBody)).id === sourceProject.id,
    'Erased source broke completed receipt',
  );
  check(
    (await history(A, sourceProject.id)).length === 1,
    'Replay after erasure recreated history',
  );
  await call(
    A,
    {
      ...sourceBody,
      creation: { ...sourceBody.creation, key: crypto.randomUUID() },
    },
    403,
  );
  await call(A, { action: 'deleteProject', id: first.id });
  tracked.delete(first.id);
  await call(A, body, 410);
  await resolve(A, body.creation.key, 410);
  const exported = await call(A, { action: 'exportData' }),
    receipts = exported.firstSaveReceipts;
  check(
    receipts.filter((r) => r.creationKey === body.creation.key).length === 1 &&
      receipts.find((r) => r.creationKey === body.creation.key).deletedAt > 0,
    'Deletion did not retain a single tombstone',
  );
  check(
    !exported.projects.some((p) => p.id === first.id),
    'Deleted project resurrected',
  );
  console.log(
    'PASS: ' +
      checks +
      ' creation receipt, retry, concurrency, source permission, history, deletion and account assertions.',
  );
} finally {
  if (file)
    await call(C, { action: 'eraseFile', id: file.id, confirm: 'ERASE' });
  for (const [id, owner] of tracked)
    await call(owner, { action: 'deleteProject', id });
  console.log('Synthetic projects and audio cleaned up.');
}
