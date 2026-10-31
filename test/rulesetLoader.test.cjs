const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const { transformSync } = require('esbuild');

const code = transformSync(readFileSync('src/rulesetLoader.ts', 'utf8'), {
  loader: 'ts', format: 'cjs', target: 'es2022'
}).code;

function setup() {
  const module = { exports: {} };
  const imports = {
    vscode: { Uri: { parse: value => ({ toString: () => value }) } },
    '@openlint/openlint-core': {},
    '@openlint/openlint-ref-resolver': {},
    './builtinRuleset': {},
    './config': { DEFAULT_RULESET: '.openlint.yaml' },
    './auth': {},
    './desktopRuleset': {},
    './documentSelector': {},
    './logger': { sanitizeUrl: value => value },
    './webRuleset': {}
  };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: name => {
      assert.ok(name in imports, `Unexpected import: ${name}`);
      return imports[name];
    }
  });
  const loader = new module.exports.RulesetLoader({}, { debug() {} });
  const loads = [];
  // Control completion order without running the external ruleset bundler.
  loader.bundle = () => new Promise(resolve => loads.push(resolve));
  const config = { ruleset: 'https://example.test/rules.yaml', loaders: [] };
  return { loader, loads, config };
}

test('a load completed after clear cannot repopulate the cache at the same location', async () => {
  const { loader, loads, config } = setup();
  const old = loader.load(undefined, config);
  await Promise.resolve();
  loader.clear();
  const oldRuleset = { version: 'old' };
  loads[0](oldRuleset);
  assert.equal(await old, oldRuleset);

  const fresh = loader.load(undefined, config);
  await Promise.resolve();
  assert.equal(loads.length, 2);
  const freshRuleset = { version: 'fresh' };
  loads[1](freshRuleset);
  assert.equal(await fresh, freshRuleset);
  assert.equal(await loader.load(undefined, config), freshRuleset);
  assert.equal(loads.length, 2);
});

test('an obsolete load cannot overwrite a newer cached ruleset', async () => {
  const { loader, loads, config } = setup();
  const old = loader.load(undefined, config);
  await Promise.resolve();
  loader.clear();
  const fresh = loader.load(undefined, config);
  await Promise.resolve();
  const freshRuleset = { version: 'fresh' };
  loads[1](freshRuleset);
  await fresh;
  loads[0]({ version: 'old' });
  await old;
  assert.equal(await loader.load(undefined, config), freshRuleset);
  assert.equal(loads.length, 2);
});

test('loadWithInfo reports cache miss then hit', async () => {
  const { loader, loads, config } = setup();
  const first = loader.loadWithInfo(undefined, config);
  await Promise.resolve();
  const ruleset = { version: 'one' };
  loads[0](ruleset);
  const miss = await first;
  assert.equal(miss.ruleset, ruleset);
  assert.equal(miss.cache, 'miss');
  const hit = await loader.loadWithInfo(undefined, config);
  assert.equal(hit.ruleset, ruleset);
  assert.equal(hit.cache, 'hit');
});
