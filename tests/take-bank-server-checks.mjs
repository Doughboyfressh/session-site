import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

// Run from the Site checkout. This harness never contacts a deployed service.
const root = process.cwd();
const localRequire = createRequire(path.join(root, 'package.json'));
const ts = localRequire('typescript');
const db = new DatabaseSync(':memory:');
for (const f of fs
  .readdirSync(path.join(root, 'drizzle'))
  .filter((f) => f.endsWith('.sql'))
  .sort())
  db.exec(fs.readFileSync(path.join(root, 'drizzle', f), 'utf8'));
assert.ok(
  db.prepare("SELECT 1 FROM sqlite_master WHERE name='take_banks'").get(),
  'Apply a real take-bank migration before running this harness.',
);
let beforeRun = null,
  beforeRead = null,
  beforeBatch = null,
  failBatchAt = -1;
const D1 = {
  prepare(sql) {
    return {
      sql,
      args: [],
      bind(...args) {
        return { ...this, args };
      },
      async first() {
        if (beforeRead) await beforeRead(sql, this.args);
        return db.prepare(sql).get(...this.args) || null;
      },
      async all() {
        if (beforeRead) await beforeRead(sql, this.args);
        return { results: db.prepare(sql).all(...this.args) };
      },
      async run() {
        if (beforeRun) await beforeRun(sql, this.args);
        return { meta: db.prepare(sql).run(...this.args) };
      },
    };
  },
  async batch(stmts) {
    if (beforeBatch) await beforeBatch(stmts);
    db.exec('BEGIN');
    try {
      const results = stmts.map((s, i) => {
        if (i === failBatchAt) throw new Error('Injected database failure');
        const statement = db.prepare(s.sql);
        const results = statement.all(...s.args);
        return {
          results,
          meta: { changes: db.prepare('SELECT changes() n').get().n },
        };
      });
      db.exec('COMMIT');
      return results;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  },
};
const objects = new Map(),
  deleteFailures = new Set();
let afterPut = null,
  puts = 0;
const R2 = {
  async put(id, body, options) {
    objects.set(id, {
      bytes: new Uint8Array(await new Response(body).arrayBuffer()),
      options,
    });
    puts++;
    if (afterPut) await afterPut(id);
  },
  async delete(id) {
    if (deleteFailures.delete(id))
      throw new Error('Injected R2 delete failure');
    objects.delete(id);
  },
  async get(id) {
    const object = objects.get(id);
    return object
      ? {
          body: new Blob([object.bytes]).stream(),
          arrayBuffer: async () => object.bytes.slice().buffer,
        }
      : null;
  },
};
const modules = new Map();
const globals = Object.fromEntries(
  [
    'crypto',
    'TextEncoder',
    'TextDecoder',
    'Uint8Array',
    'Float32Array',
    'ArrayBuffer',
    'DataView',
    'Blob',
    'File',
    'FormData',
    'Request',
    'Response',
    'AbortController',
    'AbortSignal',
    'DOMException',
    'ReadableStream',
    'setTimeout',
    'clearTimeout',
    'URL',
    'structuredClone',
    'console',
  ].map((key) => [key, globalThis[key]]),
);
function load(file) {
  file = path.resolve(root, file);
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(
    code,
    {
      ...globals,
      module,
      exports: module.exports,
      require(id) {
        if (id === 'cloudflare:workers') return { env: { DB: D1, FILES: R2 } };
        if (id.startsWith('.') || id.startsWith('@/')) {
          const base = id.startsWith('@/')
            ? path.join(root, id.slice(2))
            : path.resolve(path.dirname(file), id);
          const resolved = [
            base,
            base + '.ts',
            base + '.tsx',
            path.join(base, 'index.ts'),
          ].find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
          if (!resolved)
            throw new Error('Cannot resolve ' + id + ' from ' + file);
          return load(resolved);
        }
        return localRequire(id);
      },
    },
    { filename: file },
  );
  return module.exports;
}
const api = load('lib/take-bank-server.ts');
const { fileAccess } = load('lib/server.ts');
const { saveProject } = load('lib/project-save.ts');
const { encodeWave } = load('lib/audio-files.ts');
let checks = 0,
  scenarios = 0,
  failures = [];
const check = (v, message) => {
  assert.ok(v, message);
  checks++;
};
const equal = (a, b, message) => {
  assert.deepEqual(a, b, message);
  checks++;
};
const count = (table) => db.prepare('SELECT COUNT(*) n FROM ' + table).get().n;
async function denied(fn, status) {
  let error;
  try {
    await fn();
  } catch (e) {
    error = e;
  }
  check(!!error, 'Expected operation to reject');
  if (status !== undefined)
    check(
      error.status === status,
      `Expected status ${status}; got ${error.status}: ${error.message}`,
    );
  return error;
}
async function scenario(name, fn) {
  try {
    await fn();
    scenarios++;
    console.log('PASS ' + name);
  } catch (e) {
    failures.push(name + ': ' + e.message);
    console.log('FAIL ' + name + ': ' + e.message);
  } finally {
    beforeRun = beforeRead = beforeBatch = afterPut = null;
    failBatchAt = -1;
    deleteFailures.clear();
  }
}
const uuid = () => crypto.randomUUID();
const baseTrack = (fileId) => ({
  id: uuid(),
  name: 'Fixture vocal',
  fileId,
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
});
async function wav({
  rate = 48000,
  frames = 4800,
  depth = 24,
  value = 0.25,
} = {}) {
  const pcm = new Float32Array(frames).fill(value);
  const e = await encodeWave(
    {
      length: frames,
      sampleRate: rate,
      numberOfChannels: 1,
      getChannelData: () => pcm,
    },
    depth,
    { channels: 1 },
  );
  return new File([e.blob], 'Synthetic original.wav', { type: 'audio/wav' });
}
async function sendTake(bank, take, owner, project = '', file = null, signal) {
  file ||= await wav();
  const form = new FormData();
  form.set('bankId', bank);
  form.set('takeId', take);
  form.set('projectId', project);
  form.set('file', file);
  const req = new Request('https://local.test/api/upload', {
    method: 'POST',
    body: form,
    signal,
  });
  return api.uploadBankTake(req, form, file, owner);
}
async function fixture({ owner = uuid(), project = '', file = null } = {}) {
  const bank = uuid(),
    take = uuid();
  file ||= await wav();
  const uploaded = await sendTake(bank, take, owner, project, file);
  const row = db
    .prepare('SELECT * FROM take_bank_files WHERE bank=? AND take=?')
    .get(bank, take);
  const data = {
    version: 1,
    title: 'Synthetic saved takes',
    projectId: project,
    backing: { bpm: 120, tracks: [] },
    offset: 0,
    takes: [
      {
        id: take,
        name: 'Take 1',
        fileId: uploaded.id,
        size: file.size,
        seconds: row.frames / row.sampleRate,
        offset: 0,
        peak: 0.25,
        sampleRate: row.sampleRate,
        depth: row.depth,
      },
    ],
    regions: [{ takeId: take, start: 0, end: row.frames / row.sampleRate }],
    selected: take,
    applied: false,
  };
  return { bank, take, owner, project, file, fileId: uploaded.id, data };
}
const save = (f, revision = 0, saveId = uuid(), data = f.data) =>
  api.takeBankAction(
    {
      action: 'takeBankSave',
      id: f.bank,
      baseRevision: revision,
      saveId,
      data,
    },
    f.owner,
  );
const read = (f, owner = f.owner) =>
  api.takeBankAction({ action: 'takeBankRead', id: f.bank }, owner);
const remove = (f, revision = 1, owner = f.owner) =>
  api.takeBankAction(
    { action: 'takeBankDelete', id: f.bank, baseRevision: revision },
    owner,
  );
function projectFixture(editor = uuid()) {
  const owner = uuid(),
    project = uuid(),
    room = uuid();
  db.prepare(
    'INSERT INTO projects(id,owner,title,data,updated,revision) VALUES (?,?,\'Fixture\',\'{"bpm":120,"tracks":[]}\',1,1)',
  ).run(project, owner);
  db.prepare(
    "INSERT INTO rooms(id,owner,title,project,invite,expires,created) VALUES (?,?,'Fixture room',?,'test',9999999999999,1)",
  ).run(room, owner, project);
  db.prepare('INSERT INTO members(room,user,seen) VALUES (?,?,1)').run(
    room,
    editor,
  );
  db.prepare(
    'INSERT INTO room_editors(room,project,user,grantedBy,created) VALUES (?,?,?,?,1)',
  ).run(room, project, editor, owner);
  return {
    owner,
    project,
    room,
    editor,
    revoke: () => db.prepare('DELETE FROM room_editors WHERE room=?').run(room),
  };
}

await scenario('private upload/save/read and owner-only list', async () => {
  const f = await fixture();
  const first = await save(f);
  check(first.revision === 1, 'First save revision');
  const restored = await read(f);
  check(
    restored.data.takes[0].fileId === f.fileId,
    'Restored original reference',
  );
  check(
    (await fileAccess(f.fileId, f.owner))?.purpose === 'take',
    'Original purpose',
  );
  check(!(await fileAccess(f.fileId, 'outsider')), 'Private original leaked');
  await denied(() => read(f, 'outsider'), 404);
  await denied(() => remove(f, 1, 'outsider'), 404);
  equal(
    (await api.takeBankAction({ action: 'takeBanks' }, 'outsider')).length,
    0,
    'Other account list leaked',
  );
  check(
    (await api.takeBankAction({ action: 'takeBanks' }, f.owner)).some(
      (b) => b.id === f.bank,
    ),
    'Owner list omits bank',
  );
});
await scenario(
  'original byte immutability and upload lost-response replay',
  async () => {
    const f = await fixture();
    const priorPuts = puts,
      bytes = objects.get(f.fileId).bytes.slice();
    equal(
      (await sendTake(f.bank, f.take, f.owner, '', f.file)).id,
      f.fileId,
      'Upload retry changed file ID',
    );
    equal(puts, priorPuts, 'Replay uploaded a duplicate blob');
    await denied(() =>
      sendTake(
        f.bank,
        f.take,
        f.owner,
        '',
        new File([bytes.slice().fill(0, 50, 60)], 'changed.wav', {
          type: 'audio/wav',
        }),
      ),
    );
    const changed = await wav({ value: 0.5 });
    await denied(() => sendTake(f.bank, f.take, f.owner, '', changed), 409);
    equal(objects.get(f.fileId).bytes, bytes, 'Original bytes mutated');
    await denied(() => sendTake(f.bank, uuid(), 'outsider', '', f.file), 409);
    equal(
      count('take_bank_files'),
      db.prepare('SELECT COUNT(DISTINCT file) n FROM take_bank_files').get().n,
      'Duplicate file reference',
    );
  },
);
await scenario(
  'save CAS, latest lost-response replay, and reused save ID mismatch',
  async () => {
    const f = await fixture(),
      firstId = uuid();
    const first = await save(f, 0, firstId);
    equal(
      (await save(f, 0, firstId)).revision,
      first.revision,
      'Retry advanced revision',
    );
    const edited = structuredClone(f.data);
    edited.title = 'Updated fixture';
    const secondId = uuid();
    equal((await save(f, 1, secondId, edited)).revision, 2, 'Edit revision');
    equal(
      (await save(f, 1, secondId, edited)).revision,
      2,
      'Lost response duplicated edit',
    );
    await denied(() => save(f, 1, uuid(), f.data), 409);
    await denied(() => save(f, 2, secondId, f.data), 409);
    equal(
      (await read(f)).data.title,
      'Updated fixture',
      'Conflict overwrote winner',
    );
  },
);
await scenario('simultaneous first-save and update replay races', async () => {
  const f = await fixture(),
    saveId = uuid();
  let winner;
  beforeRun = async (sql) => {
    if (sql.startsWith('UPDATE take_banks SET title')) {
      beforeRun = null;
      winner = await save(f, 0, saveId);
    }
  };
  const loser = await save(f, 0, saveId);
  equal(loser.revision, winner.revision, 'First save race duplicated revision');
  const data = structuredClone(f.data);
  data.title = 'Winner';
  const nextId = uuid();
  beforeRun = async (sql) => {
    if (sql.startsWith('UPDATE take_banks SET title')) {
      beforeRun = null;
      winner = await save(f, 1, nextId, data);
    }
  };
  const retry = await save(f, 1, nextId, data);
  equal(retry.revision, 2, 'Update retry race failed');
  equal((await read(f)).data.title, 'Winner', 'Race lost edits');
});
await scenario(
  'foreign original IDs and changed metadata are rejected',
  async () => {
    const f = await fixture(),
      other = await fixture();
    const foreign = structuredClone(f.data);
    foreign.takes[0].fileId = other.fileId;
    await denied(() => save(f, 0, uuid(), foreign), 409);
    const wrong = structuredClone(f.data);
    wrong.takes[0].size++;
    await denied(() => save(f, 0, uuid(), wrong), 409);
    equal(
      db.prepare('SELECT revision FROM take_banks WHERE id=?').get(f.bank)
        .revision,
      0,
      'Rejected original published a comp',
    );
  },
);
await scenario(
  'transaction rollback and abandoned upload cleanup',
  async () => {
    const beforeFiles = count('files'),
      beforeRefs = count('take_bank_files'),
      beforeObjects = objects.size,
      beforeBanks = count('take_banks');
    for (const position of [1, 2]) {
      failBatchAt = position;
      await denied(() => sendTake(uuid(), uuid(), uuid()));
    }
    failBatchAt = -1;
    equal(count('files'), beforeFiles, 'Failed batch leaked file row');
    equal(
      count('take_bank_files'),
      beforeRefs,
      'Failed batch leaked reference',
    );
    equal(objects.size, beforeObjects, 'Failed batch leaked blob');
    equal(count('take_banks'), beforeBanks, 'Failed batch leaked reservation');
    const controller = new AbortController();
    afterPut = () => {
      afterPut = null;
      controller.abort();
    };
    await denied(
      () => sendTake(uuid(), uuid(), uuid(), '', null, controller.signal),
      499,
    );
    equal(count('files'), beforeFiles, 'Aborted upload leaked file row');
    equal(objects.size, beforeObjects, 'Aborted upload leaked blob');
  },
);
await scenario(
  'malformed WAV headers and lengths reject before storage',
  async () => {
    const good = await wav(),
      raw = new Uint8Array(await good.arrayBuffer()),
      originalPuts = puts;
    const cases = [new Uint8Array(20)];
    for (const alter of [
      (b) => (b[0] = 0),
      (b) => new DataView(b.buffer).setUint16(22, 2, true),
      (b) => new DataView(b.buffer).setUint32(28, 1, true),
      (b) => new DataView(b.buffer).setUint32(40, 1, true),
      (b) => new DataView(b.buffer).setUint32(4, 0, true),
    ]) {
      const b = raw.slice();
      alter(b);
      cases.push(b);
    }
    for (const b of cases)
      await denied(
        () =>
          sendTake(
            uuid(),
            uuid(),
            uuid(),
            '',
            new File([b], 'bad.wav', { type: 'audio/wav' }),
          ),
        400,
      );
    equal(puts, originalPuts, 'Malformed WAV reached storage');
  },
);
await scenario('valid 24/32 bit WAV originals at both rates', async () => {
  for (const rate of [44100, 48000])
    for (const depth of [24, 32]) {
      const f = await fixture({
        file: await wav({ rate, depth, frames: Math.ceil(rate * 0.1) + 1 }),
      });
      await save(f);
      const row = await read(f);
      equal(row.data.takes[0].sampleRate, rate, 'Sample rate changed');
      equal(row.data.takes[0].depth, depth, 'Depth changed');
    }
});
await scenario(
  'malformed float fact headers and nonfinite PCM cannot be saved as originals',
  async () => {
    const file = await wav({ depth: 32 }),
      raw = new Uint8Array(await file.arrayBuffer()),
      before = puts;
    const changes = [
      (b) => (b[38] = 0),
      (b) => new DataView(b.buffer).setUint16(36, 1, true),
      (b) => new DataView(b.buffer).setUint32(46, 1, true),
      (b) => new DataView(b.buffer).setFloat32(58, NaN, true),
      (b) => new DataView(b.buffer).setFloat32(58, Infinity, true),
    ];
    for (const change of changes) {
      const bytes = raw.slice();
      change(bytes);
      await denied(
        () =>
          sendTake(
            uuid(),
            uuid(),
            uuid(),
            '',
            new File([bytes], 'bad-float.wav', { type: 'audio/wav' }),
          ),
        400,
      );
    }
    equal(puts, before, 'Invalid float data reached R2');
  },
);
await scenario(
  'delete tombstone survives partial R2 failure and retry',
  async () => {
    const f = await fixture();
    await save(f);
    deleteFailures.add(f.fileId);
    await denied(() => remove(f));
    check(
      db.prepare('SELECT deletedAt FROM take_banks WHERE id=?').get(f.bank)
        .deletedAt !== null,
      'Failure lost tombstone',
    );
    await denied(() => read(f), 404);
    await denied(() => save(f, 1), 410);
    await denied(() => sendTake(f.bank, uuid(), f.owner, '', f.file), 409);
    await remove(f);
    await remove(f);
    check(!objects.has(f.fileId), 'Delete retry kept blob');
    check(
      !db.prepare('SELECT 1 FROM files WHERE id=?').get(f.fileId),
      'Delete retry kept file row',
    );
    equal(
      db.prepare('SELECT data FROM take_banks WHERE id=?').get(f.bank).data,
      '{}',
      'Delete retry kept pending manifest',
    );
    check(
      !(await api.takeBankAction({ action: 'takeBanks' }, f.owner)).some(
        (b) => b.id === f.bank,
      ),
      'Completed deletion remained listed',
    );
  },
);
await scenario(
  'delete stale revision rejects without losing originals',
  async () => {
    const f = await fixture();
    await save(f);
    await save(f, 1);
    await denied(() => remove(f, 1), 409);
    check(objects.has(f.fileId), 'Stale deletion removed original');
    equal((await read(f)).revision, 2, 'Stale deletion changed revision');
  },
);
await scenario(
  'project edit revocation blocks upload/read/save but allows own deletion',
  async () => {
    const p = projectFixture(),
      f = await fixture({ owner: p.editor, project: p.project });
    await save(f);
    await denied(() => read(f, p.owner), 404);
    check(
      !(await fileAccess(f.fileId, p.owner)),
      'Project owner saw editor original',
    );
    p.revoke();
    await denied(() => read(f), 403);
    await denied(() => save(f, 1), 403);
    await denied(() => sendTake(f.bank, uuid(), f.owner, p.project), 403);
    check(objects.has(f.fileId), 'Revocation erased original');
    await remove(f);
    check(!objects.has(f.fileId), 'Revoked editor cannot delete own original');
  },
);
await scenario(
  'project access revocation during upload commits no file',
  async () => {
    const p = projectFixture(),
      beforeFiles = count('files'),
      beforeObjects = objects.size;
    beforeBatch = () => {
      beforeBatch = null;
      p.revoke();
    };
    await denied(() => sendTake(uuid(), uuid(), p.editor, p.project), 409);
    equal(count('files'), beforeFiles, 'Revoked upload inserted file');
    equal(objects.size, beforeObjects, 'Revoked upload leaked blob');
  },
);
await scenario(
  'project access revocation at save CAS keeps only incomplete reservation',
  async () => {
    const p = projectFixture(),
      f = await fixture({ owner: p.editor, project: p.project });
    beforeRun = (sql) => {
      if (sql.startsWith('UPDATE take_banks SET title')) {
        beforeRun = null;
        p.revoke();
      }
    };
    await denied(() => save(f), 409);
    equal(
      db.prepare('SELECT revision FROM take_banks WHERE id=?').get(f.bank)
        .revision,
      0,
      'Revoked save published bank',
    );
  },
);
await scenario(
  'saved originals cannot become shared project source files',
  async () => {
    const f = await fixture();
    await save(f);
    const start = count('projects');
    for (const creation of [undefined, { key: uuid(), checkpoint: true }])
      await denied(
        () =>
          saveProject(
            {
              title: 'Forbidden original',
              data: { bpm: 120, tracks: [baseTrack(f.fileId)] },
              ...(creation ? { creation } : {}),
            },
            f.owner,
            Date.now(),
          ),
        403,
      );
    equal(count('projects'), start, 'Forbidden original created project');
    check(
      !db.prepare('SELECT 1 FROM project_files WHERE file=?').get(f.fileId),
      'Original gained project sharing',
    );
  },
);
await scenario(
  'take originals stay owner-only despite a stale public source reference',
  async () => {
    const f = await fixture();
    await save(f);
    db.prepare(
      "INSERT INTO tracks(id,owner,title,kind,genre,bpm,musicalKey,visibility,permission,fileId,created) VALUES (?,?,'Fixture','beat','Hip-hop',120,'C','public','collaborate',?,1)",
    ).run(uuid(), f.owner, f.fileId);
    check(
      !(await fileAccess(f.fileId, 'outsider')),
      'Public source reference exposed a private take original',
    );
  },
);

await scenario(
  'interrupted save reservations are discoverable, private, and deletable',
  async () => {
    const f = await fixture();
    const listed = (
      await api.takeBankAction({ action: 'takeBanks' }, f.owner)
    ).find((b) => b.id === f.bank);
    check(listed?.revision === 0, 'Incomplete upload not discoverable');
    equal(listed.bytes, f.file.size, 'Reservation bytes incorrect');
    await denied(() => read(f), 404);
    await denied(() => read(f, 'outsider'), 404);
    await remove(f, 0);
    check(!objects.has(f.fileId), 'Incomplete bank deletion kept original');
    await denied(() => sendTake(f.bank, uuid(), f.owner), 409);
  },
);
await scenario(
  'active eight-take limit differs from retained historical upload limit',
  async () => {
    const f = await fixture();
    const refs = [f.data.takes[0]],
      allIds = [f.fileId];
    for (let i = 1; i < 9; i++) {
      const take = uuid(),
        uploaded = await sendTake(f.bank, take, f.owner, '', f.file);
      allIds.push(uploaded.id);
      refs.push({
        ...f.data.takes[0],
        id: take,
        fileId: uploaded.id,
        name: 'Take ' + (i + 1),
      });
    }
    const eight = { ...f.data, takes: refs.slice(0, 8) };
    await save(f, 0, uuid(), eight);
    await denied(() => save(f, 1, uuid(), { ...f.data, takes: refs }), 400);
    await save(f, 1, uuid(), {
      ...f.data,
      takes: [refs[8]],
      selected: refs[8].id,
      regions: [{ takeId: refs[8].id, start: 0, end: 0.1 }],
    });
    check(
      allIds.every((id) => objects.has(id)),
      'Comp save erased earlier uploaded original',
    );
    equal((await read(f)).data.takes.length, 1, 'Active bank did not shrink');
    for (let i = 9; i < 64; i++) {
      const u = await sendTake(f.bank, uuid(), f.owner, '', f.file);
      allIds.push(u.id);
    }
    equal(
      db
        .prepare('SELECT COUNT(*) n FROM take_bank_files WHERE bank=?')
        .get(f.bank).n,
      64,
      'Historical 64 originals were not accepted',
    );
    const before = objects.size;
    await denied(() => sendTake(f.bank, uuid(), f.owner, '', f.file), 409);
    equal(objects.size, before, '65th upload leaked R2 object');
    equal(
      (await sendTake(f.bank, f.take, f.owner, '', f.file)).id,
      f.fileId,
      'Full historical bank broke idempotent upload retry',
    );
    const listed = (
      await api.takeBankAction({ action: 'takeBanks' }, f.owner)
    ).find((b) => b.id === f.bank);
    equal(
      listed.bytes,
      64 * f.file.size,
      'Historical byte count omitted inactive originals',
    );
    await remove(f, 2);
    check(
      allIds.every((id) => !objects.has(id)),
      'Bank deletion omitted historical original',
    );
  },
);
await scenario(
  'historical 240MB byte quota rejects before committing a new original',
  async () => {
    const f = await fixture();
    const limit = 240 * 1024 * 1024;
    db.prepare('UPDATE take_bank_files SET size=? WHERE bank=?').run(
      limit - f.file.size,
      f.bank,
    );
    const accepted = await sendTake(f.bank, uuid(), f.owner, '', f.file);
    check(objects.has(accepted.id), 'Exact byte quota was rejected');
    const before = objects.size;
    await denied(() => sendTake(f.bank, uuid(), f.owner, '', f.file), 409);
    equal(objects.size, before, 'Over-quota original leaked');
    equal(
      db
        .prepare('SELECT SUM(size) n FROM take_bank_files WHERE bank=?')
        .get(f.bank).n,
      limit,
      'Byte quota exceeded',
    );
  },
);
await scenario(
  'active bank metadata enforces four minutes and 48MB',
  async () => {
    const { validateBank } = load('lib/take-bank.ts');
    const f = await fixture();
    for (const kind of ['seconds', 'bytes']) {
      const records = Array.from({ length: 4 }, (_, i) => ({
        ...f.data.takes[0],
        id: uuid(),
        fileId: uuid(),
        seconds: kind === 'seconds' ? 61 : 0.1,
        size: kind === 'bytes' ? 13 * 1024 * 1024 : f.file.size,
      }));
      const data = {
        ...f.data,
        takes: records,
        selected: records[0].id,
        regions: [{ takeId: records[0].id, start: 0, end: 0.1 }],
      };
      await denied(() => validateBank(data), 400);
    }
  },
);

console.log(
  `${failures.length ? 'FAIL' : 'PASS'}: ${checks} assertions in ${scenarios} passing scenarios; ${failures.length} failing scenarios.`,
);
if (failures.length) {
  for (const failure of failures) console.log('FINDING ' + failure);
  process.exitCode = 1;
}
db.close();
