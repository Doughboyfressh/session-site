import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const cache = new Map();
export function loadTS(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const require = (id) => {
    if (!id.startsWith('.'))
      throw Error('Test module must use relative local imports: ' + id);
    return loadTS(
      path.resolve(path.dirname(file), id.endsWith('.ts') ? id : id + '.ts'),
    );
  };
  new Function('require', 'exports', code)(require, exports);
  return exports;
}
