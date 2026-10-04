import fs from 'node:fs';
import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(
    fs.readFileSync(
      new URL('../deploy/002-session-activity.sql', import.meta.url),
      'utf8',
    ),
  );
  await client.query('COMMIT');
  console.log('SESSION daily activity forward migration applied.');
} catch {
  await client.query('ROLLBACK');
  console.error('SESSION daily activity migration failed.');
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
