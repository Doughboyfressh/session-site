import fs from 'node:fs';
import pg from 'pg';
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL});
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(fs.readFileSync('deploy/001-session-postgres.sql','utf8'));
  await client.query(fs.readFileSync('deploy/002-session-activity.sql','utf8'));
  await client.query('COMMIT');
  console.log('SESSION PostgreSQL schema applied.');
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {client.release(); await pool.end();}
