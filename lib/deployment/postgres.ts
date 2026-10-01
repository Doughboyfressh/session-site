import { Pool, types, type PoolClient } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { postgresSQL } from './sql';

// All stored integer values are bounded IDs, counters, sizes, and epoch milliseconds.
types.setTypeParser(20, Number);
types.setTypeParser(1700, Number);
let pool: Pool | undefined;
export function postgresPool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5,
      idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 });
    attachDatabasePool(pool);
  }
  return pool;
}

class Statement {
  constructor(readonly sql: string, readonly params: unknown[] = []) {}
  bind(...params: unknown[]) { return new Statement(this.sql, params); }
  async execute(client: PoolClient) {
    const result = await client.query(postgresSQL(this.sql), this.params);
    return { success: true, results: result.rows, meta: { changes: result.rowCount || 0 } };
  }
  async all() { return (await execute([this]))[0]; }
  async first(column?: string) {
    const result = (await this.all()).results[0];
    return result ? (column ? result[column] : result) : null;
  }
  async run() { return this.all(); }
}
async function execute(statements: Statement[]) {
  // Preserve D1's atomic batches and quota/access checks under concurrent requests.
  for (let attempt = 0; ; attempt++) {
    const client = await postgresPool().connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const results = [];
      for (const statement of statements) results.push(await statement.execute(client));
      await client.query('COMMIT');
      return results;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      const code = (error as { code?: string }).code;
      if (code === '23505') throw Object.assign(new Error('UNIQUE constraint failed'), { code });
      if (attempt >= 3 || !['40001', '40P01'].includes(code || '')) throw error;
    } finally { client.release(); }
  }
}
export const postgresDatabase = {
  prepare(sql: string) { return new Statement(sql); },
  batch(statements: Statement[]) { return execute(statements); },
};
