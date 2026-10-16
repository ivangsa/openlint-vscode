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

The extension is bundled with esbuild, so packaging skips `node_modules`. `@vscode/vsce` and `ovsx` are development dependencies.

Build a local `.vsix`:

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

Publishing runs from `.github/workflows/release-to-marketplaces.yml` when commits land on `main`. The version comes from [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) since the last `v*` tag, the same rules the AsyncAPI extension uses:

- `fix:` or `fix(scope):` publishes a patch release.
- `feat:` or `feat(scope):` publishes a minor release.
- A breaking change publishes a major release. Write it as `feat!:`, `fix!:`, `refactor!:`, or a `BREAKING CHANGE:` footer.
- `docs:`, `chore:`, `refactor:`, `test:`, and `perf:` do not publish a release.

Squash-merge pull requests so the PR title is the commit message the workflow reads. `main` must allow GitHub Actions to push the release commit.

There is no `v*` tag yet, and `package.json` is `0.0.1`. The first release anchors that version on the root commit, then applies the bump. A `fix:` becomes `0.0.2`. A `feat:` becomes `0.1.0`. A breaking change becomes `1.0.0`.

The workflow bumps `package.json`, writes `CHANGELOG.md`, publishes the same `.vsix` to both registries, then commits `chore(release): <version>`, tags `v<version>`, and opens a GitHub release. The marketplace publish runs before that commit is pushed. A version that is already on a registry is left as it is, so a failed run can be rerun.

`@openlint/*` is not on npm. The workflow checks out `openlint/openlint`, builds it, and links it at `../openlint`, the same path `package.json` uses locally. Set the `OPENLINT_REF` repository variable to pin that checkout. The default ref is `main`.

The Marketplace publisher id and the Open VSX namespace are the `publisher` field in `package.json` (`openlint`). Create that publisher and namespace before the first publish, then add these repository secrets on `openlint/openlint-vscode`:

- `VSCE_PAT`: Azure DevOps personal access token with the Marketplace (Manage) scope.
- `OVSX_PAT`: Open VSX access token.

Run the workflow manually and enable "Show the next version and do not publish" to preview the version semantic-release would pick.
