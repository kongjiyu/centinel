// Function-level reproduction of a live model finding against the unchanged
// public source. No upstream package scripts, network, model or project writes.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'data/public-acceptance-2026-10-19/cors');
const revision = execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
assert.equal(revision, '5317ebe670db2aaebc1d496eb5d33493deefb3ed');
assert.equal(execFileSync('git', ['-C', directory, 'status', '--porcelain'], { encoding: 'utf8', windowsHide: true }).trim(), '');
const source = await fs.readFile(path.join(directory, 'lib/index.js'), 'utf8');
const begin = source.indexOf('  function isString(s)');
const end = source.indexOf('  function configureOrigin(', begin);
assert.ok(begin >= 0 && end > begin);
// Only the two reviewed pure helpers are evaluated, with no require/process or
// other host bindings. RegExp objects are created in the same realm as the code.
const results = vm.runInNewContext(`${source.slice(begin, end)}
  const origin = 'http://example.com';
  function repeated(pattern) { return [1,2,3].map(() => isOriginAllowed(origin, pattern)); }
  ({ plain: repeated(/example\\.com/), global: repeated(/example\\.com/g),
     sticky: repeated(/^http:\\/\\/example\\.com/y), arrayGlobal: repeated([/example\\.com/g]) });`, {}, { timeout: 1000 });
const actual = JSON.parse(JSON.stringify(results));
assert.deepEqual(actual.plain, [true, true, true]);
for (const key of ['global', 'sticky', 'arrayGlobal']) assert.deepEqual(actual[key], [true, false, true]);
const output = path.join(root, 'evidence/public-repositories-ai-2026-10-20');
await fs.mkdir(output, { recursive: true });
const report = { repo: 'expressjs/cors', revision, source: 'lib/index.js:19-34', findingLocation: 'lib/index.js:30',
  mode: 'function-level reproduction, not HTTP integration', expected: [true, true, true], actual,
  confirmed: true, consequence: 'Identical allowed origins can be denied on repeated requests when the configured RegExp has g/y state.',
  limitations: ['No public endpoint was tested.', 'No upstream files were changed.', 'No independent authorization bypass or exhaustive security coverage is claimed.'] };
await fs.writeFile(path.join(output, 'cors-regexp-reproduction.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
