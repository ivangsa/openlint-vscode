const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const { transformSync } = require('esbuild');

const code = transformSync(readFileSync('src/lintTimings.ts', 'utf8'), {
  loader: 'ts', format: 'cjs', target: 'es2022'
}).code;
const sandbox = { exports: {} };
vm.runInNewContext(code, { module: sandbox, exports: sandbox.exports, performance });
const { LintTimings } = sandbox.exports;

function logger() {
  const lines = [];
  return { lines, debug: (_verbosity, message) => lines.push(message) };
}

test('disabled timings run operations without logging', async () => {
  const log = logger();
  const timings = new LintTimings(log, 'info', 'a.yaml', 'one\ntwo', 'all');
  assert.equal(await timings.measure('git', async () => 1), 1);
  assert.equal(timings.measureSync('parse', () => 2), 2);
  timings.log();
  assert.deepEqual(log.lines, []);
});

test('debug timings log one profile line with workload, cache, queue and stages', async () => {
  const log = logger();
  const timings = new LintTimings(log, 'debug', 'a.yaml', 'one\ntwo\nthree', 'staged', { debounceMs: 350, waitedMs: 352 });
  timings.cache = 'hit';
  await timings.measure('ruleset', async () => 1);
  timings.measureSync('parse', () => 2);
  timings.diagnostics = 3;
  timings.log();
  assert.equal(log.lines.length, 1);
  const line = log.lines[0];
  assert.match(line, /^Lint profile for a\.yaml: 3 lines \/ 13 chars, ruleset cache=hit, diff=staged, queue=352\.0 ms \(lag 2\.0 ms\), ruleset=[\d.]+ ms, parse=[\d.]+ ms, diagnostics=3, total=[\d.]+ ms\.$/);
});

test('a failed stage is still recorded and unknown values are n/a', async () => {
  const log = logger();
  const timings = new LintTimings(log, 'debug', 'a.yaml', '', 'all');
  await assert.rejects(timings.measure('execution', async () => { throw new Error('boom'); }), /boom/);
  timings.log();
  assert.match(log.lines[0], /1 lines \/ 0 chars, ruleset cache=n\/a, diff=all, execution=[\d.]+ ms, diagnostics=n\/a/);
});
