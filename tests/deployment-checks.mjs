import assert from 'node:assert/strict';
import {loadTS} from './load-ts.mjs';
const {postgresSQL} = loadTS('lib/deployment/sql.ts');
const {safeReturnPath} = loadTS('lib/deployment/return-path.ts');
assert.equal(postgresSQL("SELECT * FROM members WHERE user=? AND room=? AND 'what?'='what?'"),
  'SELECT * FROM members WHERE "user"=$1 AND room=$2 AND \'what?\'=\'what?\'');
assert.equal(postgresSQL('UPDATE rooms SET project=? WHERE project IS ? AND (? IS NULL)'),
  'UPDATE rooms SET project=$1 WHERE project IS NOT DISTINCT FROM $2 AND (CAST($3 AS TEXT) IS NULL)');
assert.equal(postgresSQL('DELETE FROM room_editors WHERE project IS NOT ?'),
  'DELETE FROM room_editors WHERE project IS DISTINCT FROM $1');
assert.equal(postgresSQL('SELECT ?1, ?1, ?2'), 'SELECT $1, $1, $2');
assert.match(postgresSQL('INSERT INTO rate_limits(id,count) VALUES (?,1) ON CONFLICT(id) DO UPDATE SET count=count+1'),
  /count=rate_limits.count\+1/);
assert.equal(postgresSQL('INSERT OR IGNORE INTO saved(user,track) VALUES (?,?) RETURNING track'),
  'INSERT INTO saved("user",track) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING track');
assert.match(postgresSQL("SELECT json_extract(t.value,'$.size')"), /CAST\(session_json_extract\(t.value,'size'\) AS NUMERIC\)/);
assert.equal(safeReturnPath('/?room=123#studio'), '/?room=123#studio');
for (const value of ['//evil.invalid', 'https://evil.invalid', '/\\evil.invalid', 'javascript:alert(1)', '\n/room', '/a/..//evil.invalid', '/%2e//evil.invalid'])
  assert.equal(safeReturnPath(value), '/');
console.log('Deployment SQL and safe redirect regression checks passed.');
