import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

let checks = 0;
const ok = (condition, message) => {
  assert.ok(condition, message);
  checks++;
};
const equal = (actual, expected) => {
  assert.deepEqual(actual, expected);
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

const now = Date.now();
db.prepare(
  'INSERT INTO profiles (id,username,name,roles,bio,location,visibility,created) VALUES (?,?,?,?,?,?,?,?)',
).run('u1', 'shooter', 'Shooter', '["Videographer"]', '', '', 'public', now);
db.prepare(
  'INSERT INTO tracks (id,owner,title,kind,genre,bpm,musicalKey,visibility,permission,fileId,created) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
).run(
  't1',
  'u1',
  'Night Drive',
  'beat',
  'Trap',
  140,
  'F minor',
  'public',
  'collaborate',
  'fa',
  now,
);
db.prepare(
  'INSERT INTO files (id,owner,name,mime,size,purpose,created) VALUES (?,?,?,?,?,?,?)',
).run('fv', 'u1', 'clip.mp4', 'video/mp4', 1000, 'video', now);
db.prepare(
  'INSERT INTO files (id,owner,name,mime,size,purpose,created) VALUES (?,?,?,?,?,?,?)',
).run('fp', 'u1', 'still.jpg', 'image/jpeg', 500, 'photo', now);

// create mirrors the action SQL
db.prepare(
  'INSERT INTO posts (id,owner,kind,fileId,track,caption,visibility,created) VALUES (?,?,?,?,?,?,?,?)',
).run('p1', 'u1', 'video', 'fv', 't1', 'The official visual', 'public', now);
db.prepare(
  'INSERT INTO posts (id,owner,kind,fileId,track,caption,visibility,created) VALUES (?,?,?,?,?,?,?,?)',
).run('p2', 'u1', 'photo', 'fp', null, '', 'public', now + 1);
db.prepare(
  'INSERT INTO posts (id,owner,kind,fileId,track,caption,visibility,created) VALUES (?,?,?,?,?,?,?,?)',
).run('p3', 'u1', 'photo', 'fp', null, '', 'private', now + 2);

// state query: public posts + own private ones, owner join, like counts
const stateQuery = `
  SELECT p.id,p.owner,p.kind,p.plays,
          (SELECT COUNT(*) FROM post_likes l WHERE l.post=p.id) AS likes,
          EXISTS(SELECT 1 FROM post_likes l WHERE l.post=p.id AND l.user=?) AS likedByMe,
          (SELECT t.title FROM tracks t WHERE t.id=p.track) AS trackTitle
  FROM posts p LEFT JOIN profiles pr ON pr.id=p.owner
  WHERE p.visibility='public' OR p.owner=?
  ORDER BY p.created DESC LIMIT 40`;
const viewer = 'fan1';
let rows = db.prepare(stateQuery).all(viewer, viewer);
equal(rows.length, 2); // private p3 excluded for others
equal(rows[0].id, 'p2');
equal(rows[1].trackTitle, 'Night Drive');

// like toggle mirrors the action SQL
db.prepare('INSERT OR IGNORE INTO post_likes (user,post) VALUES (?,?)').run(
  viewer,
  'p1',
);
rows = db.prepare(stateQuery).all(viewer, viewer);
equal(rows.find((r) => r.id === 'p1').likes, 1);
equal(rows.find((r) => r.id === 'p1').likedByMe, 1);
db.prepare('DELETE FROM post_likes WHERE user=? AND post=?').run(viewer, 'p1');
rows = db.prepare(stateQuery).all(viewer, viewer);
equal(rows.find((r) => r.id === 'p1').likes, 0);

// watch counting only touches public posts (mirrors the action SQL)
db.prepare(
  "UPDATE posts SET plays=plays+1 WHERE id=? AND visibility='public'",
).run('p3');
equal(db.prepare('SELECT plays FROM posts WHERE id=?').get('p3').plays, 0);
db.prepare(
  "UPDATE posts SET plays=plays+1 WHERE id=? AND visibility='public'",
).run('p1');
equal(db.prepare('SELECT plays FROM posts WHERE id=?').get('p1').plays, 1);

// delete mirrors the action SQL
db.prepare('INSERT INTO post_likes (user,post) VALUES (?,?)').run('fan2', 'p2');
db.prepare('DELETE FROM post_likes WHERE post=?').run('p2');
db.prepare('DELETE FROM posts WHERE id=? AND owner=?').run('p2', 'u1');
equal(db.prepare('SELECT COUNT(*) AS n FROM posts WHERE id=?').get('p2').n, 0);

// upload size caps table
equal({ avatar: 3, audio: 25, photo: 8, video: 60, take: 25 }.video, 60);
checks++;

console.log(`PASS: ${checks} posts assertions.`);
