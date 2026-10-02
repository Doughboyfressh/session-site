import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nodeVersion = '22.23.3';
const nodeArchiveName = `node-v${nodeVersion}-win-x64.zip`;
const nodeArchiveHash = '2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71';
const runtimeDefault = path.join(root, 'outputs', 'companion', 'node-runtime');
const hash = data => createHash('sha256').update(data).digest('hex');
const quotePS = value => `'${value.replaceAll("'", "''")}'`;
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, windowsHide: true, encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
function powershell(code) { return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code]); }
async function download(url, target, expectedHash) {
  let data;
  try { data = await readFile(target); } catch { /* Fetch an absent cached dependency. */ }
  if (!data || (expectedHash && hash(data) !== expectedHash)) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Official runtime download failed (${response.status})`);
    data = Buffer.from(await response.arrayBuffer());
    if (expectedHash && hash(data) !== expectedHash) throw new Error('Official runtime checksum mismatch');
    await writeFile(target, data);
  }
  return data;
}
async function prepareRuntime(runtime) {
  await mkdir(runtime, { recursive: true });
  const checksums = await download(`https://nodejs.org/dist/v${nodeVersion}/SHASUMS256.txt`, path.join(runtime, 'SHASUMS256.txt'));
  const expected = checksums.toString('utf8').split(/\r?\n/).find(line => line.endsWith(`  ${nodeArchiveName}`))?.split(/\s+/)[0];
  if (expected !== nodeArchiveHash) throw new Error('Official Node checksum list does not match the pinned archive');
  const archive = path.join(runtime, nodeArchiveName);
  await download(`https://nodejs.org/dist/v${nodeVersion}/${nodeArchiveName}`, archive, nodeArchiveHash);
  const prefix = `node-v${nodeVersion}-win-x64/`;
  powershell(`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $taskArchive=[IO.Compression.ZipFile]::OpenRead(${quotePS(archive)}); try { foreach ($taskName in @('node.exe','LICENSE')) { $taskEntry=$taskArchive.GetEntry(${quotePS(prefix)}+$taskName); if (-not $taskEntry) { throw 'Missing official runtime entry' }; [IO.Compression.ZipFileExtensions]::ExtractToFile($taskEntry,[IO.Path]::Combine(${quotePS(runtime)},$taskName),$true) } } finally { $taskArchive.Dispose() }`);
  const executable = path.join(runtime, 'node.exe');
  if (run(executable, ['--version']) !== `v${nodeVersion}`) throw new Error('Extracted portable runtime version mismatch');
  return { executable, version: nodeVersion, archiveSha256: nodeArchiveHash, exeSha256: hash(await readFile(executable)), license: path.join(runtime, 'LICENSE') };
}
async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Companion packaging requires Windows x64');
  const options = {};
  for (let i = 2; i < process.argv.length; ++i) {
    const name = process.argv[i];
    if (!['--source-root', '--host-exe', '--runtime-dir', '--test-plugin'].includes(name) || !process.argv[i + 1]) throw new Error('Usage: node scripts/package-companion.mjs [--source-root directory] [--host-exe file] [--runtime-dir directory] [--test-plugin module]');
    options[name] = path.resolve(process.argv[++i]);
  }
  const sourceRoot = options['--source-root'] || root;
  const host = options['--host-exe'] || path.join(root, 'outputs', 'companion', 'session-vst3-host.exe');
  const nativeOutput = path.dirname(host);
  const runtime = await prepareRuntime(options['--runtime-dir'] || runtimeDefault);
  const testPlugin = options['--test-plugin'] || path.join(nativeOutput, 'test-plugin', 'note-expression-synth.vst3');
  // Tests execute with exactly the Node executable copied into the download.
  run(runtime.executable, [path.join(sourceRoot, 'tests', 'plugin-bridge-checks.mjs')]);
  run(runtime.executable, [path.join(root, 'companion', 'native', 'test.mjs')], { env: { ...process.env, SESSION_VST3_HOST: host, SESSION_VST3_TEST_PLUGIN: testPlugin } });
  const releases = path.join(root, 'outputs', 'companion-release');
  const buildId = randomUUID();
  const stage = path.join(releases, `build-${buildId}`, 'session-companion-windows-x64');
  await mkdir(path.join(stage, 'licenses'), { recursive: true });
  const copies = [
    [host, 'session-vst3-host.exe'], [runtime.executable, 'node.exe'],
    [path.join(sourceRoot, 'companion', 'bridge.mjs'), 'bridge.mjs'],
    [path.join(sourceRoot, 'companion', 'start-session-companion.cmd'), 'start-session-companion.cmd'],
    [path.join(sourceRoot, 'companion', 'README.md'), 'README.md'],
    [runtime.license, 'licenses/Node-LICENSE.txt'],
    [path.join(nativeOutput, 'licenses', 'Steinberg-SDK.txt'), 'licenses/Steinberg-SDK.txt'],
    [path.join(nativeOutput, 'licenses', 'nlohmann-json.txt'), 'licenses/nlohmann-json.txt'],
  ];
  for (const [source, relative] of copies) await copyFile(source, path.join(stage, relative));
  const launcher = await readFile(path.join(stage, 'start-session-companion.cmd'), 'utf8');
  if (!launcher.includes('%~dp0node.exe')) throw new Error('Companion launcher must prefer the bundled portable runtime');
  const setup = `SESSION local instrument companion — Windows x64\r\n\r\n1. Extract the entire ZIP into a local folder.\r\n2. Double-click start-session-companion.cmd and keep the console open.\r\n3. Copy its pairing token into SESSION's local instrument controls.\r\n4. Rescan, choose your separately installed VST3 instrument, and open its editor.\r\n\r\nNode ${nodeVersion} is included; no Node or Visual C++ runtime installer is needed.\r\nFor a custom SESSION deployment, run start-session-companion.cmd --origin https://your-site.example\r\nThe default browser origin and full instructions are in README.md.\r\nInstall and authorize Serum 2 or other instruments separately through their vendors.\r\nThis package includes no instruments, presets, sample content, SDK sources, or license keys.\r\nThe third-party notices in licenses must remain with this package.\r\n\r\nSupported: Windows x64 VST3 instruments with float32 audio and a note input.\r\nRender limits: stereo PCM16 WAV, 44.1/48kHz, 40-240 BPM, 256 notes, 512 beats, 300 seconds including the 0.5-second release tail.\r\nThere is no VST2, hardware MIDI input, plug-in latency compensation or surround export.\r\nEditor audition uses the Windows audio output and can stutter during heavy editor interactions.\r\nSerum 2 has not been included or verified against a licensed installation in this package.\r\n`;
  await writeFile(path.join(stage, 'START-HERE.txt'), setup);
  const smoke = `import assert from 'node:assert/strict'; import {createCompanion,DEFAULT_ORIGIN} from './bridge.mjs'; const token='ab'.repeat(32); const companion=createCompanion({origin:DEFAULT_ORIGIN,token}); try {const address=await companion.start(0); const headers={Origin:DEFAULT_ORIGIN,Authorization:'Bearer '+token}; const response=await fetch('http://127.0.0.1:'+address.port+'/v1/health',{headers}); assert.equal(response.status,200); const health=await response.json(); assert.equal(health.nativeAvailable,true); assert.equal(health.paired,true); assert.equal(health.platform,'win32'); const denied=await fetch('http://127.0.0.1:'+address.port+'/v1/health',{headers:{Origin:DEFAULT_ORIGIN}}); assert.equal(denied.status,401); console.log(JSON.stringify({ok:true,node:process.version,health,unauthorizedStatus:denied.status}));} finally {await companion.close();}`;
  // Saved outside the archive, with a file URL so imports resolve to the packaged bridge.
  const smokePath = path.join(releases, `smoke-${buildId}.mjs`);
  await writeFile(smokePath, smoke.replace("from './bridge.mjs'", `from ${JSON.stringify(new URL('file:///' + path.join(stage, 'bridge.mjs').replaceAll('\\', '/')).href)}`));
  JSON.parse(run(path.join(stage, 'node.exe'), [smokePath]));
  const files = {};
  for (const name of [...copies.map(([, name]) => name), 'START-HERE.txt']) files[name] = { bytes: (await stat(path.join(stage, name))).size, sha256: hash(await readFile(path.join(stage, name))) };
  await writeFile(path.join(stage, 'manifest.json'), JSON.stringify({ version: 1, platform: 'win32-x64', node: { version: nodeVersion, archiveSha256: nodeArchiveHash }, files }, null, 2));
  const zip = path.join(releases, 'session-companion-windows-x64.zip');
  try { await unlink(zip); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  powershell(`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory(${quotePS(stage)},${quotePS(zip)},[IO.Compression.CompressionLevel]::Optimal,$true)`);
  const sha256 = hash(await readFile(zip));
  const verify = path.join(releases, `verify-${buildId}`);
  powershell(`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory(${quotePS(zip)},${quotePS(verify)})`);
  const extracted = path.join(verify, 'session-companion-windows-x64');
  for (const [name, expected] of Object.entries(files)) {
    if (hash(await readFile(path.join(extracted, name))) !== expected.sha256) throw new Error(`Extracted package checksum mismatch: ${name}`);
  }
  await writeFile(smokePath, smoke.replace("from './bridge.mjs'", `from ${JSON.stringify(new URL('file:///' + path.join(extracted, 'bridge.mjs').replaceAll('\\', '/')).href)}`));
  const health = JSON.parse(run(path.join(extracted, 'node.exe'), [smokePath]));
  await writeFile(path.join(releases, 'session-companion-windows-x64.sha256'), `${sha256}  session-companion-windows-x64.zip\n`);
  const metadata = { zip, sha256, bytes: (await stat(zip)).size, stage, node: { ...runtime, license: 'licenses/Node-LICENSE.txt' }, host: files['session-vst3-host.exe'], smoke: health, sourceRoot };
  await writeFile(path.join(releases, 'package-result.json'), JSON.stringify(metadata, null, 2));
  console.log(JSON.stringify(metadata, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
