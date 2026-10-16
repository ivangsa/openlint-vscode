import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const targetArg = process.argv.find(argument => argument.startsWith('--target='));
const selectedTarget = targetArg?.split('=')[1] ?? 'all';
const common = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  external: ['vscode', 'fsevents'],
  format: 'cjs',
  sourcemap: true,
  minify: false,
  logLevel: 'info'
};

const targets = [
  {
    name: 'node',
    options: {
      ...common,
      outfile: 'dist/node/extension.js',
      platform: 'node',
      mainFields: ['module', 'main'],
      define: {
        __WEB_EXTENSION__: 'false'
      },
      plugins: [aliasPlugin('./webRuleset', path.join(rootDir, 'src/web-shims/webRuleset.stub.ts'))]
    }
  },
  {
    name: 'web',
    options: {
      ...common,
      outfile: 'dist/web/extension.js',
      platform: 'browser',
      mainFields: ['browser', 'module', 'main'],
      inject: [path.join(rootDir, 'src/web-shims/process.js')],
      define: {
        __WEB_EXTENSION__: 'true',
        global: 'globalThis',
        'process.env.NODE_ENV': '"production"'
      },
      plugins: [
        aliasPlugin('./desktopRuleset', path.join(rootDir, 'src/web-shims/desktopRuleset.stub.ts')),
        webNodeShimsPlugin()
      ]
    }
  }
];

const selectedTargets = targets.filter(target => selectedTarget === 'all' || target.name === selectedTarget);

if (selectedTargets.length === 0) {
  throw new Error(`Unknown build target "${selectedTarget}". Use "node", "web", or "all".`);
}

if (watch) {
  const contexts = await Promise.all(selectedTargets.map(target => esbuild.context(target.options)));
  await Promise.all(contexts.map(context => context.watch()));
  console.log(`Watching ${selectedTarget} extension bundle...`);
} else {
  await Promise.all(selectedTargets.map(target => esbuild.build(target.options)));
}

function aliasPlugin(requested, resolved) {
  return {
    name: `alias:${requested}`,
    setup(build) {
      build.onResolve({ filter: new RegExp(`${escapeRegExp(requested)}$`) }, args => {
        if (args.kind === 'import-statement' || args.kind === 'require-call' || args.kind === 'dynamic-import') {
          return { path: resolved };
        }
      });
    }
  };
}

function webNodeShimsPlugin() {
  const emptyShim = path.join(rootDir, 'src/web-shims/empty.js');
  const fetchShim = path.join(rootDir, 'src/web-shims/node-fetch.js');
  const aliases = {
    path: require.resolve('path-browserify'),
    'node:path': require.resolve('path-browserify'),
    buffer: require.resolve('buffer/'),
    'node:buffer': require.resolve('buffer/'),
    fs: emptyShim,
    'node:fs': emptyShim,
    os: emptyShim,
    'node:os': emptyShim,
    crypto: emptyShim,
    'node:crypto': emptyShim,
    stream: emptyShim,
    'node:stream': emptyShim,
    http: emptyShim,
    https: emptyShim,
    net: emptyShim,
    tls: emptyShim,
    zlib: emptyShim,
    child_process: emptyShim,
    worker_threads: emptyShim,
    tty: emptyShim,
    vm: emptyShim,
    module: emptyShim,
    constants: emptyShim,
    querystring: emptyShim,
    punycode: emptyShim,
    string_decoder: emptyShim,
    assert: emptyShim,
    'node:assert': emptyShim,
    util: emptyShim,
    'node:util': emptyShim,
    events: emptyShim,
    'node:events': emptyShim,
    url: emptyShim,
    'node:url': emptyShim,
    'node-fetch': fetchShim
  };
  const filter = new RegExp(`^(?:${Object.keys(aliases).map(escapeRegExp).join('|')})$`);

  return {
    name: 'web-node-shims',
    setup(build) {
      build.onResolve({ filter }, args => ({
        path: aliases[args.path]
      }));
    }
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
