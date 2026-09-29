import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

let checks = 0;
const ok = (condition, message) => {
  assert.ok(condition, message);
  checks++;
};

const db = new DatabaseSync(':memory:');
const migrations = fs
  .readdirSync(path.resolve('drizzle'))
  .filter((f) => f.endsWith('.sql'))
  .sort();
for (const file of migrations)
  for (const statement of fs
    .readFileSync(path.resolve('drizzle', file), 'utf-8')
    .split('--> statement-breakpoint'))
    if (statement.trim()) db.exec(statement);
checks++;

// 0010 columns landed with safe defaults
const trackCols = db
  .prepare('PRAGMA table_info(tracks)')
  .all()
  .map((c) => c.name);
ok(trackCols.includes('plays'), 'tracks.plays exists');
const roomCols = db
  .prepare('PRAGMA table_info(rooms)')
  .all()
  .map((c) => c.name);
ok(roomCols.includes('visibility'), 'rooms.visibility exists');

const now = Date.now();
db.prepare(
  "INSERT INTO profiles (id,username,name,roles,bio,location,visibility,created) VALUES (?,?,?,?,?,?,?,?)",
).run('u1', 'grower', 'Grower', '["Producer"]', '', '', 'public', now);
db.prepare(
  "INSERT INTO tracks (id,owner,title,kind,genre,bpm,musicalKey,visibility,permission,fileId,plays,created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
).run('t1', 'u1', 'Night Shift', 'beat', 'R&B', 94, 'C minor', 'public', 'listen', 'f1', 3, now);
db.prepare(
  "INSERT INTO tracks (id,owner,title,kind,genre,bpm,musicalKey,visibility,permission,fileId,plays,created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
).run('t2', 'u1', 'Daylight', 'song', 'Pop', 120, 'A major', 'private', 'listen', 'f2', 99, now);

// play counting only touches public tracks (mirrors the action's SQL)
db.prepare(
  "UPDATE tracks SET plays=plays+1 WHERE id=? AND visibility='public'",
).run('t2');
equal(db.prepare('SELECT plays FROM tracks WHERE id=?').get('t2').plays, 99);
db.prepare(
  "UPDATE tracks SET plays=plays+1 WHERE id=? AND visibility='public'",
).run('t1');
equal(db.prepare('SELECT plays FROM tracks WHERE id=?').get('t1').plays, 4);

// trending query surfaces only public, played tracks, ordered by plays
db.prepare(
  "INSERT INTO tracks (id,owner,title,kind,genre,bpm,musicalKey,visibility,permission,fileId,plays,created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
).run('t3', 'u1', 'Big One', 'beat', 'Trap', 140, 'F minor', 'public', 'listen', 'f3', 40, now);
const trending = db
  .prepare(
    "SELECT id FROM tracks WHERE visibility='public' AND plays>0 ORDER BY plays DESC, created DESC LIMIT 8",
  )
  .all()
  .map((r) => r.id);
assert.deepEqual(trending, ['t3', 't1']);
checks++;

// public room join honors capacity and visibility (mirrors the action's SQL)
db.prepare(
  'INSERT INTO rooms (id,owner,title,project,invite,expires,created,visibility) VALUES (?,?,?,?,?,?,?,?)',
).run('r1', 'u1', 'Open session', null, 'inv1', now + 86400000, now, 'public');
db.prepare(
  'INSERT INTO rooms (id,owner,title,project,invite,expires,created,visibility) VALUES (?,?,?,?,?,?,?,?)',
).run('r2', 'u1', 'Closed session', null, 'inv2', now + 86400000, now, 'invite');
db.prepare('INSERT INTO members (room,user,seen) VALUES (?,?,?)').run('r1', 'u1', now);
for (const joiner of ['a', 'b', 'c'])
  db.prepare(
    "INSERT INTO members (room,user,seen) SELECT id,?,? FROM rooms WHERE id='r1' AND visibility='public' AND (SELECT COUNT(*) FROM members WHERE room='r1')<4",
  ).run(joiner, now);
const members = db
  .prepare("SELECT COUNT(*) AS n FROM members WHERE room='r1'")
  .get().n;
equal(members, 4); // full: owner + 3
// a fifth joiner must not fit
db.prepare(
  "INSERT INTO members (room,user,seen) SELECT id,?,? FROM rooms WHERE id='r1' AND visibility='public' AND (SELECT COUNT(*) FROM members WHERE room='r1')<4",
).run('d', now);
equal(
  db.prepare("SELECT COUNT(*) AS n FROM members WHERE room='r1'").get().n,
  4,
);
// invite-only room refuses the public path entirely
db.prepare(
  "INSERT INTO members (room,user,seen) SELECT id,?,? FROM rooms WHERE id='r2' AND visibility='public' AND (SELECT COUNT(*) FROM members WHERE room='r2')<4",
).run('e', now);
equal(
  db.prepare("SELECT COUNT(*) AS n FROM members WHERE room='r2'").get().n,
  0,
);

// search LIKE behavior matches the /api/search queries
const like = '%night%';
const found = db
  .prepare(
    "SELECT id FROM tracks WHERE visibility='public' AND LOWER(title) LIKE ?",
  )
  .all(like)
  .map((r) => r.id);
assert.deepEqual(found, ['t1']);
checks++;

function equal(actual, expected) {
  assert.deepEqual(actual, expected);
  checks++;
}

console.log(`PASS: ${checks} growth assertions.`);
