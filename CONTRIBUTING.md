# Contributing

This project uses `pnpm` for dependency management and is intended to build as both a VS Code desktop extension and a VS Code web extension.

## Prerequisites

- Git Bash
- Node.js 22 or newer
- VS Code

The repository pins the toolchain in `package.json` and `.node-version`:

```json
"packageManager": "pnpm@11.23.0",
"engines": {
  "node": ">=22.0.0"
}
```

pnpm 11 requires Node.js 22 or newer. Node 20 is not supported.

If you use fnm:

```bash
fnm install
fnm use
node -v
```

## OpenLint packages

`@openlint/*` is not published to npm yet. This extension links the sibling checkout at `../openlint`. Build that checkout before installing or compiling this extension:

```bash
cd ../openlint
node .yarn/releases/yarn-3.5.0.cjs install
node .yarn/releases/yarn-3.5.0.cjs build
```

## Setup

From Git Bash, with Node.js 22 or newer active, and the sibling OpenLint checkout already built:

```bash
npm install -g pnpm@11.23.0
pnpm --version
pnpm install
pnpm approve-builds
```

## Build

Run the TypeScript typecheck:

```bash
pnpm run typecheck
```

Build the desktop extension bundle:

```bash
pnpm run compile:node
```

Build the web extension bundle:

```bash
pnpm run compile:web
```

Build both extension bundles:

```bash
pnpm run compile
```

Run the full build alias:

```bash
pnpm run build
```

For active development:

```bash
pnpm run watch
```

## Local Testing

After building, open the repository in VS Code and use the extension development host:

```bash
code .
```

Then press `F5` in VS Code to launch a new Extension Development Host window.

The default F5 target is `Run Extension`, which runs the desktop extension host after `pnpm run compile:node`.

To debug web extension behavior, choose `Run Web Extension` from the Run and Debug dropdown. That target compiles `dist/web/extension.js`, starts a web extension host, and opens `fixtures/web-workspace`.

To test the same web bundle in a browser (VS Code for the Web served locally):

```bash
pnpm run open-in-browser
```

This builds the web bundle and starts `@vscode/test-web` on the sample workspace. The first run downloads VS Code for the Web into `.vscode-test-web`. Open `api.openapi.yaml` and confirm OpenLint diagnostics appear in the Problems view. The sample ruleset expects `info.contact` and `info.description`, which the sample API omits on purpose.

Web mode loads YAML/JSON rulesets from the workspace or HTTP(S). JavaScript rulesets and local loader modules remain desktop-only.

Useful commands in the command palette:

- `OpenLint: Enable`
- `OpenLint: Disable`
- `OpenLint: Lint Workspace`
- `OpenLint: Select Diff Source`
- `OpenLint: Set Secret`
- `OpenLint: Delete Secret`

## Dependency Checks

Audit dependencies:

```bash
pnpm audit
```

Check outdated dependencies:

```bash
pnpm outdated
```

Install runtime dependencies:

```bash
pnpm add <package>
```

Install development dependencies:

```bash
pnpm add -D <package>
```

## Release

Marketplace publishing is intentionally out of scope for now. Releases can be produced as local `.vsix` packages.

The extension is bundled with esbuild, so packaging skips `node_modules`. `@vscode/vsce` is already a development dependency.

```bash
pnpm run package
```

This typechecks, compiles both bundles, and writes a `.vsix` file in the repository root.

Install the generated extension locally:

```bash
code --install-extension openlint-0.0.1.vsix
```

Before creating a release package, verify:

- `pnpm install` completes cleanly.
- `pnpm run typecheck` passes.
- `pnpm run build` passes.
- The extension works in the VS Code Extension Development Host.
- The generated `.vsix` installs locally.
