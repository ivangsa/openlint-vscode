const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const { transformSync } = require('esbuild');

const code = transformSync(readFileSync('src/extension.ts', 'utf8'), {
  loader: 'ts', format: 'cjs', target: 'es2022'
}).code;

function setup() {
  const handlers = {};
  const timers = new Map();
  const calls = [];
  const published = new Map();
  const commands = {};
  const files = [];
  const opened = [];
  let timerId = 0;
  const config = { enabled: true, lintOnType: true, lintOnSave: true, diffFilter: 'all', include: ['**/*.yaml'] };
  const register = name => callback => {
    handlers[name] = callback;
    return { dispose() {} };
  };
  const diagnostics = {
    set: (uri, results) => published.set(uri.toString(), results),
    delete: uri => published.delete(uri.toString()),
    clear: () => published.clear()
  };
  const vscode = {
    languages: { createDiagnosticCollection: () => diagnostics },
    StatusBarAlignment: { Left: 1 },
    DiagnosticSeverity: { Error: 0 },
    ProgressLocation: { Notification: 1 },
    Diagnostic: class { constructor(range, message) { Object.assign(this, { range, message }); } },
    window: {
      createStatusBarItem: () => ({ show() {} }),
      createOutputChannel: () => ({}),
      onDidChangeActiveTextEditor: register('active'),
      withProgress: async (_options, task) => task({ report() {} })
    },
    workspace: {
      onDidChangeTextDocument: register('change'),
      onDidSaveTextDocument: register('save'),
      onDidCloseTextDocument: register('close'),
      onDidChangeConfiguration: register('config'),
      findFiles: async () => files,
      openTextDocument: async doc => { opened.push(doc); return doc; }
    },
    commands: { registerCommand: (name, callback) => {
      commands[name] = callback;
      return { dispose() {} };
    } }
  };
  const imports = {
    vscode,
    './config': { getConfig: () => ({ ...config }) },
    './documentSelector': { isLintableDocument: () => true },
    './diffFilter': { DiffFilterProvider: class {} },
    './rulesetLoader': { RulesetLoader: class {} },
    './logger': { Logger: class { debug() {} info() {} error() {} }, sanitizeText: text => text },
    './linter': { OpenLintLinter: class {
      clearRulesetCache() {}
      lint(snapshot) {
        return new Promise((resolve, reject) => calls.push({ snapshot, resolve, reject }));
      }
    } }
  };
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, Error, performance,
    require: name => {
      assert.ok(name in imports, `Unexpected import: ${name}`);
      return imports[name];
    },
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id)
  });
  const subscriptions = [];
  module.exports.activate({ subscriptions });
  return {
    handlers, calls, published, config, subscriptions, commands, files, opened,
    deactivate: module.exports.deactivate,
    async flush() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach(callback => callback());
      await new Promise(setImmediate);
    }
  };
}

function document(name) {
  return {
    uri: { toString: () => name }, version: 1, isClosed: false,
    text: 'original', reads: 0,
    getText() { this.reads++; return this.text; },
    lineAt: () => ({ range: {} })
  };
}

test('debounce is independent per document and reads one snapshot per run', async () => {
  const s = setup();
  const a = document('a');
  const b = document('b');
  s.handlers.change({ document: a });
  s.handlers.change({ document: b });
  s.handlers.change({ document: a });
  await s.flush();
  assert.equal(s.calls.length, 2);
  assert.equal(a.reads, 1);
  assert.equal(b.reads, 1);
  a.text = 'edited';
  assert.equal(s.calls.find(call => call.snapshot.uri === a.uri).snapshot.text, 'original');
});

for (const fail of [false, true]) {
  test(`older ${fail ? 'error' : 'result'} cannot overwrite a newer request at the same version`, async () => {
    const s = setup();
    const doc = document('a');
    s.handlers.save(doc);
    await s.flush();
    s.handlers.save(doc);
    await s.flush();
    s.calls[1].resolve(['new']);
    await s.flush();
    if (fail) s.calls[0].reject(new Error('old'));
    else s.calls[0].resolve(['old']);
    await s.flush();
    assert.deepEqual(s.published.get('a'), ['new']);
  });
}

for (const action of ['edit', 'configuration', 'close', 'deactivate']) {
  for (const fail of [false, true]) {
    test(`${action} suppresses in-flight ${fail ? 'errors' : 'results'} and clears pending work`, async () => {
      const s = setup();
      const doc = document('a');
      s.handlers.save(doc);
      await s.flush();
      s.handlers.save(document('pending'));
      if (action === 'edit') {
        s.config.lintOnType = false;
        doc.version++;
        s.handlers.change({ document: doc });
      } else if (action === 'configuration') {
        s.config.enabled = false;
        s.handlers.config({ affectsConfiguration: () => true });
      } else if (action === 'close') {
        doc.isClosed = true;
        s.handlers.close(doc);
      } else s.deactivate();
      if (fail) s.calls[0].reject(new Error('obsolete'));
      else s.calls[0].resolve(['obsolete']);
      await s.flush();
      assert.equal(s.published.has('a'), false);
      assert.equal(s.calls.length, action === 'configuration' || action === 'deactivate' ? 1 : 2);
    });
  }
}

test('closing a document cancels its debounce and preserves published diagnostics', async () => {
  const s = setup();
  const doc = document('a');
  s.published.set('a', ['previous']);
  s.handlers.save(doc);
  doc.isClosed = true;
  s.handlers.close(doc);
  await s.flush();
  assert.equal(s.calls.length, 0);
  assert.deepEqual(s.published.get('a'), ['previous']);
});

test('workspace scan diagnostics survive closing the scan-opened document', async () => {
  const s = setup();
  const doc = document('scan');
  s.files.push(doc);
  const scan = s.commands['openlint.lintWorkspace']();
  await s.flush();
  await s.flush();
  s.calls[0].resolve(['workspace problem']);
  await scan;
  doc.isClosed = true;
  s.handlers.close(doc);
  assert.deepEqual(s.published.get('scan'), ['workspace problem']);
});

test('workspace scan result is published when the document is released mid-lint', async () => {
  const s = setup();
  const doc = document('scan');
  s.files.push(doc);
  const scan = s.commands['openlint.lintWorkspace']();
  await s.flush();
  await s.flush();
  doc.isClosed = true;
  s.handlers.close(doc);
  s.calls[0].resolve(['workspace problem']);
  await scan;
  assert.deepEqual(s.published.get('scan'), ['workspace problem']);
});

test('an edit still suppresses an in-flight workspace scan result', async () => {
  const s = setup();
  const doc = document('scan');
  s.files.push(doc);
  s.config.lintOnType = false;
  const scan = s.commands['openlint.lintWorkspace']();
  await s.flush();
  await s.flush();
  doc.version++;
  s.handlers.change({ document: doc });
  s.calls[0].resolve(['obsolete']);
  await scan;
  assert.equal(s.published.has('scan'), false);
});

test('configuration change aborts a workspace scan before opening the next file', async () => {
  const s = setup();
  s.files.push(document('first'), document('second'));
  const scan = s.commands['openlint.lintWorkspace']();
  await s.flush();
  await s.flush();
  s.handlers.config({ affectsConfiguration: () => true });
  s.calls[0].resolve(['obsolete']);
  await scan;
  assert.equal(s.opened.length, 1);
  assert.equal(s.published.size, 0);
});

test('current failures still publish configuration diagnostics', async () => {
  const s = setup();
  s.handlers.save(document('a'));
  await s.flush();
  s.calls[0].reject(new Error('bad ruleset'));
  await s.flush();
  assert.equal(s.published.get('a')[0].message, 'bad ruleset');
});
