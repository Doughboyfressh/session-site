import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(':memory:');
for (const file of fs
  .readdirSync('drizzle')
  .filter((f) => f.endsWith('.sql'))
  .sort())
  db.exec(fs.readFileSync('drizzle/' + file, 'utf8'));
let failAt = -1,
  beforeBatch = null,
  beforeRead = null,
  checks = 0;
const D1 = {
  prepare(sql) {
    const s = {
      sql,
      args: [],
      bind(...args) {
        return { ...s, args, bind: s.bind };
      },
      async first() {
        if (beforeRead) await beforeRead(sql);
        return db.prepare(sql).get(...this.args) || null;
      },
      async all() {
        return { results: db.prepare(sql).all(...this.args) };
      },
      async run() {
        return { meta: db.prepare(sql).run(...this.args) };
      },
    };
    return s;
  },
  async batch(stmts) {
    if (beforeBatch) await beforeBatch();
    db.exec('BEGIN');
    try {
      const results = stmts.map((s, i) => {
        if (i === failAt) throw new Error('Injected later-statement failure');
        return { results: db.prepare(s.sql).all(...s.args) };
      });
      db.exec('COMMIT');
      return results;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  },
};
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const exports = {};
  modules.set(file, exports);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    require: (id) =>
      id === 'cloudflare:workers'
        ? { env: { DB: D1 } }
        : load(
            id.includes('mixer-routing')
              ? 'lib/mixer-routing.ts'
              : id.includes('instrument-plugins')
                ? 'lib/instrument-plugins.ts'
                : id.includes('browser-instruments')
                  ? 'lib/browser-instruments.ts'
              : id.includes('project-creation')
                ? 'lib/project-creation.ts'
                : id.includes('privacy')
                  ? 'lib/arrangement-validation.ts'
                  : 'lib/server.ts',
          ),
    crypto,
    TextEncoder,
    Uint8Array,
    Array,
    JSON,
    Error,
    Number,
    Set,
    console,
  });
  return exports;
}
const api = load('lib/project-save.ts');
const body = () => ({
  title: 'Atomic first save',
  data: { bpm: 92, tracks: [] },
  creation: { key: crypto.randomUUID(), checkpoint: true },
});
const check = (v, m) => {
  assert.ok(v, m);
  checks++;
};
const rejected = async (fn, status) => {
  let e;
  try {
    await fn();
  } catch (x) {
    e = x;
  }
  check(!!e, 'Expected rejection');
  if (status) check(e.status === status, 'Unexpected status');
};
const broken = body();
failAt = 2;
await rejected(() => api.saveProject(broken, 'owner', 1));
failAt = -1;
for (const table of [
  'projects',
  'project_creations',
  'project_files',
  'project_versions',
])
  check(
    db.prepare('SELECT COUNT(*) n FROM ' + table).get().n === 0,
    'Rollback leaked ' + table,
  );
const accepted = await api.saveProject(broken, 'owner', 2);
check(accepted.revision === 1, 'Retry after rollback failed');
check(
  db
    .prepare(
      'EXPLAIN QUERY PLAN SELECT * FROM project_creations WHERE owner=? AND creationKey=?',
    )
    .all('owner', broken.creation.key)
    .some((x) => x.detail.includes('INDEX')),
  'Receipt lookup lacks index',
);
db.prepare(
  "INSERT INTO files(id,owner,name,mime,size,purpose,created) VALUES ('source','source-owner','source.wav','audio/wav',44,'audio',1)",
).run();
db.prepare(
  "INSERT INTO tracks(id,owner,title,kind,genre,bpm,musicalKey,visibility,permission,fileId,created) VALUES ('listing','source-owner','Source','beat','Hip-hop',92,'C','public','collaborate','source',1)",
).run();
const race = body();
race.data.tracks = [
  {
    id: 'source-track',
    fileId: 'source',
    name: 'Source',
    volume: 0.8,
    pan: 0,
    offset: 0,
    trimStart: 0,
    trimEnd: 0,
    low: 0,
    mid: 0,
    high: 0,
    muted: false,
    solo: false,
  },
];
let winner;
const tables = [
  'projects',
  'project_creations',
  'project_files',
  'project_versions',
];
const counts = () =>
  tables.map((table) => db.prepare('SELECT COUNT(*) n FROM ' + table).get().n);
const sourceRollback = {
  ...race,
  creation: { ...race.creation, key: crypto.randomUUID() },
};
const startCounts = counts();
failAt = 3;
await rejected(() => api.saveProject(sourceRollback, 'owner', 3));
failAt = -1;
check(
  JSON.stringify(counts()) === JSON.stringify(startCounts),
  'Checkpoint failure left project, receipt, source grant or history',
);
const sourceAccepted = await api.saveProject(sourceRollback, 'owner', 3);
check(
  db
    .prepare('SELECT COUNT(*) n FROM project_files WHERE project=?')
    .get(sourceAccepted.id).n === 1,
  'Source retry after rollback failed',
);
const revoked = {
  ...race,
  creation: { ...race.creation, key: crypto.randomUUID() },
};
const beforeRevoked = counts();
beforeBatch = async () => {
  beforeBatch = null;
  db.prepare("UPDATE tracks SET visibility='private' WHERE id='listing'").run();
};
await rejected(() => api.saveProject(revoked, 'owner', 3), 403);
check(
  JSON.stringify(counts()) === JSON.stringify(beforeRevoked),
  'Source revoked before commit left partial save',
);
db.prepare("UPDATE tracks SET visibility='public' WHERE id='listing'").run();
beforeBatch = async () => {
  beforeBatch = null;
  winner = await api.saveProject(race, 'owner', 3);
  db.prepare(
    "UPDATE tracks SET visibility='private',permission='listen' WHERE id='listing'",
  ).run();
};
const loser = await api.saveProject(race, 'owner', 4);
check(
  loser.id === winner.id && loser.replayed,
  'Pre-batch winner/source-revocation race failed',
);
check(
  db
    .prepare('SELECT COUNT(*) n FROM project_versions WHERE project=?')
    .get(winner.id).n === 1,
  'Race duplicated initial checkpoint',
);
const denied = body();
denied.data = race.data;
await rejected(() => api.saveProject(denied, 'owner', 5), 403);
check(
  !db
    .prepare('SELECT * FROM project_creations WHERE creationKey=?')
    .get(denied.creation.key),
  'Denied source created receipt',
);
let accessReads = 0;
beforeRead = async (sql) => {
  if (sql.startsWith('SELECT p.*') && ++accessReads === 2) {
    beforeRead = null;
    db.prepare('DELETE FROM projects WHERE id=?').run(accepted.id);
  }
};
await rejected(
  () => api.resolveProjectCreation(broken.creation.key, 'owner'),
  410,
);
check(
  !db.prepare('SELECT * FROM projects WHERE id=?').get(accepted.id),
  'Resolution resurrected deleted project',
);
const { defaultRouting } = load('lib/mixer-routing.ts');
const routingSave = body();
routingSave.data = {
  bpm: 120,
  routing: defaultRouting(),
  tracks: [
    {
      id: 'keys',
      name: 'Keys',
      notes: [],
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
      groupId: 'group-1',
      sendReverb: 0.4,
      sendDelay: 0.3,
    },
  ],
};
routingSave.data.routing.groups[0].name = 'My vocals';
const routingSaved = await api.saveProject(routingSave, 'routing-owner', 10);
let storedRouting = JSON.parse(
  db.prepare('SELECT data FROM projects WHERE id=?').get(routingSaved.id).data,
);
check(
  storedRouting.routing.groups[0].name === 'My vocals' &&
    storedRouting.tracks[0].sendReverb === 0.4,
  'Project save dropped routing',
);
check(
  JSON.parse(
    db
      .prepare('SELECT data FROM project_versions WHERE project=?')
      .get(routingSaved.id).data,
  ).routing.groups[0].name === 'My vocals',
  'Checkpoint dropped routing',
);
const updateRouting = {
  id: routingSaved.id,
  title: 'Changed mix',
  baseRevision: 1,
  data: structuredClone(routingSave.data),
};
updateRouting.data.routing.groups[0].volume = 0.5;
const changedRouting = await api.saveProject(
  updateRouting,
  'routing-owner',
  11,
);
check(changedRouting.revision === 2, 'Routing update did not advance revision');
await rejected(() => api.saveProject(updateRouting, 'routing-owner', 12), 409);
for (const bad of [
  null,
  { groups: [] },
  { ...defaultRouting(), delay: -1 },
  { ...defaultRouting(), groups: Array(4).fill(defaultRouting().groups[0]) },
]) {
  await rejected(
    () =>
      api.saveProject(
        {
          ...updateRouting,
          baseRevision: 2,
          data: { ...updateRouting.data, routing: bad },
        },
        'routing-owner',
        13,
      ),
    400,
  );
}
await rejected(
  () =>
    api.saveProject(
      {
        ...updateRouting,
        baseRevision: 2,
        data: {
          ...updateRouting.data,
          tracks: [{ ...updateRouting.data.tracks[0], groupId: 'missing' }],
        },
      },
      'routing-owner',
      14,
    ),
  400,
);
storedRouting = JSON.parse(
  db.prepare('SELECT data FROM projects WHERE id=?').get(routingSaved.id).data,
);
check(
  storedRouting.routing.groups[0].volume === 0.5 &&
    db.prepare('SELECT revision FROM projects WHERE id=?').get(routingSaved.id)
      .revision === 2,
  'Rejected routing overwrote saved project',
);
console.log(
  'PASS: ' +
    checks +
    ' atomic rollback, source-race, deletion-race and query-plan assertions.',
);
db.close();
