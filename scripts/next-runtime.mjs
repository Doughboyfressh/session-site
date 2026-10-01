import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', ...process.argv.slice(2)],
  { stdio: 'inherit', env: { ...process.env, SESSION_RUNTIME: 'vercel' } });
child.on('exit', code => { process.exitCode = code || 0; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
