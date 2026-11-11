// Applies the SQLite migrations in drizzle/ to the local D1 database that `npm run dev` uses.
// A fresh clone has an empty local database, so every API route answers 503 until this has run.
// Safe to repeat: Wrangler records applied migrations and skips them.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const hosting = JSON.parse(fs.readFileSync('.openai/hosting.json', 'utf8'));
const dir = path.resolve('.wrangler');
fs.mkdirSync(dir, { recursive: true });
const config = path.join(dir, 'local-d1.json');
// Mirrors the local binding in vite.config.ts so both resolve to the same database file.
fs.writeFileSync(
  config,
  JSON.stringify({
    name: 'sites-project',
    compatibility_date: '2025-01-01',
    d1_databases: [
      {
        binding: hosting.d1,
        database_name: 'site-creator-d1',
        database_id: '00000000-0000-4000-8000-000000000000',
        migrations_dir: path.resolve('drizzle'),
      },
    ],
  }),
);
const result = spawnSync(
  process.execPath,
  [
    'node_modules/wrangler/bin/wrangler.js',
    'd1',
    'migrations',
    'apply',
    'site-creator-d1',
    '--local',
    '--config',
    config,
    '--persist-to',
    path.join(dir, 'state'),
  ],
  { stdio: 'inherit', env: { ...process.env, CI: 'true' } },
);
process.exitCode = result.status ?? 1;
