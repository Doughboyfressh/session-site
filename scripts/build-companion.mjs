import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Dependencies and build products remain in ignored outputs. No plug-in installer is run.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'outputs', 'companion');
const dependencies = path.join(output, 'dependencies');
const sdk = path.join(dependencies, 'vst3sdk');
const jsonDir = path.join(dependencies, 'nlohmann');
const sdkCommit = '9fad9770f2ae8542ab1a548a68c1ad1ac690abe0';
const jsonFiles = {
  'json.hpp': ['single_include/nlohmann/json.hpp', 'aaf127c04cb31c406e5b04a63f1ae89369fccde6d8fa7cdda1ed4f32dfc5de63'],
  'LICENSE.MIT': ['LICENSE.MIT', '46a65cffd1ea955132d95a8dd921640714a8d6b537d2e4e482d31145ae95b603'],
};
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status})`);
}
function capture(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(command)} failed`);
  return result.stdout.trim();
}
async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function pinnedFile(name, [source, hash]) {
  const file = path.join(jsonDir, name);
  let data = await exists(file) ? await readFile(file) : null;
  if (!data || createHash('sha256').update(data).digest('hex') !== hash) {
    const response = await fetch(`https://raw.githubusercontent.com/nlohmann/json/v3.12.0/${source}`);
    if (!response.ok) throw new Error(`Could not download pinned JSON dependency (${response.status})`);
    data = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(data).digest('hex') !== hash) throw new Error('JSON dependency checksum mismatch');
    await writeFile(file, data);
  }
}
async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Native VST3 companion builds require Windows x64');
  await mkdir(dependencies, { recursive: true });
  await mkdir(jsonDir, { recursive: true });
  if (!await exists(path.join(sdk, '.git'))) {
    run('git', ['-c', 'core.longpaths=true', 'clone', '--no-checkout', 'https://github.com/steinbergmedia/vst3sdk.git', sdk]);
  }
  const current = capture('git', ['rev-parse', 'HEAD'], sdk);
  if (current !== sdkCommit) run('git', ['-c', 'core.longpaths=true', 'checkout', '--detach', sdkCommit], sdk);
  run('git', ['-c', 'core.longpaths=true', 'submodule', 'update', '--init', '--depth', '1', 'base', 'cmake', 'pluginterfaces', 'public.sdk', 'vstgui4'], sdk);
  for (const entry of Object.entries(jsonFiles)) await pinnedFile(...entry);
  const vswhere = path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  const installation = process.env.SESSION_MSVC_ROOT || capture(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath']);
  if (!installation) throw new Error('Visual Studio Build Tools with MSVC C++ and Windows SDK is required');
  const cmake = process.env.SESSION_CMAKE_PATH || path.join(installation, 'Common7', 'IDE', 'CommonExtensions', 'Microsoft', 'CMake', 'CMake', 'bin', 'cmake.exe');
  const build = path.join(output, 'build');
  const cmakePath = value => value.replaceAll('\\', '/');
  run(cmake, ['-S', path.join(root, 'companion', 'native'), '-B', build, '-G', 'Visual Studio 17 2022', '-A', 'x64', `-DCMAKE_GENERATOR_INSTANCE=${cmakePath(installation)}`, `-DSESSION_VST3_SDK=${cmakePath(sdk)}`, `-DSESSION_JSON_INCLUDE=${cmakePath(dependencies)}`, `-DSESSION_OUTPUT_DIR=${cmakePath(output)}`]);
  run(cmake, ['--build', build, '--config', 'Release', '--target', 'session-vst3-host', 'note-expression-synth', 'session-strict-fixture', 'session-vst3-host-checks', '--parallel', '4']);
  const testPlugin = path.join(output, 'test-plugin', 'note-expression-synth.vst3');
  await mkdir(path.dirname(testPlugin), { recursive: true });
  await cp(path.join(build, 'VST3', 'Release', 'note-expression-synth.vst3'), testPlugin, { recursive: true, force: true });
  await cp(path.join(build, 'VST3', 'Release', 'session-strict-fixture.vst3'), path.join(output, 'regression-plugin', 'session-strict-fixture.vst3'), { recursive: true, force: true });
  const licenses = path.join(output, 'licenses');
  await mkdir(licenses, { recursive: true });
  for (const [source, target] of [[path.join(sdk, 'LICENSE.txt'), 'Steinberg-SDK.txt'], [path.join(sdk, 'vstgui4', 'LICENSE'), 'VSTGUI.txt'], [path.join(jsonDir, 'LICENSE.MIT'), 'nlohmann-json.txt']]) {
    await cp(source, path.join(licenses, target));
  }
  const manifest = { sdkCommit, jsonVersion: '3.12.0', executable: path.join(output, 'session-vst3-host.exe'), testPlugin, platform: 'win32-x64' };
  await writeFile(path.join(output, 'build-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
