# OpenLint

A web-compatible Visual Studio Code extension for linting YAML files with OpenLint.

## Features

- Lint YAML files on type and on save.
- Enable or disable linting globally or per workspace.
- Load one OpenLint ruleset from a relative path, absolute path, or HTTP(S) URL.
- Configure HTTP auth with static headers, bearer tokens, basic auth, or VS Code secret references.
- Filter diagnostics in the standard Problems view to changed lines from a selected Git diff source.

## Rulesets

The default ruleset path is `.openlint.yaml`. With that default, the extension uses the first ruleset file it finds in the workspace folder: `.openlint.yaml`, `.openlint.yml`, `.openlint.json`, `.openlint.js`, then the same names with a `spectral` prefix. When none of those files exist, it lints with the built-in OpenAPI, AsyncAPI, and Arazzo rulesets. An explicit `openlint.ruleset` path is used as given.

`spectral:oas`, `spectral:asyncapi`, and `spectral:arazzo` remain valid `extends` values. JavaScript rulesets may import either `@openlint/openlint-*` or `@stoplight/spectral-*`.

## Important Web Mode Notes

The extension avoids Node-only APIs in its linting path. Absolute local file paths and local JavaScript loader modules are desktop-oriented features; web mode can load workspace files and HTTP(S) rulesets. Web mode accepts YAML and JSON rulesets. JavaScript rulesets require VS Code desktop.

## Example Configuration

```json
{
  "openlint.enabled": true,
  "openlint.lintOnType": true,
  "openlint.lintOnSave": true,
  "openlint.include": ["**/*.openapi.yaml", "apis/**/*.yml"],
  "openlint.ruleset": "https://example.com/.openlint.yaml",
  "openlint.remoteAuth": {
    "headers": {
      "X-Org": "platform"
    },
    "bearerTokenSecret": "openlint-rules-token"
  },
  "openlint.loaders": [
    {
      "match": "https://schemas.example.com/",
      "bearerTokenSecret": "openlint-schema-token"
    }
  ],
  "openlint.diffFilter": "all",
  "openlint.diffBaseBranch": "main"
}
```

Use `OpenLint: Set Secret` to store values referenced by `bearerTokenSecret` or `passwordSecret`.

Ruleset URLs may also include Basic auth credentials, matching the common Bitbucket raw URL pattern:

```json
{
  "openlint.ruleset": "https://user:password@repos.example.com/bitbucket/projects/TEAM/repos/rules/raw/dist/ruleset.js?at=refs/heads/main"
}
```

The extension sends those credentials as an `Authorization: Basic ...` header and fetches the URL without the embedded credentials.

`remoteAuth` is used only for the configured ruleset URL. Remote references loaded by that ruleset must use an explicit matching `loaders` entry, so ruleset credentials are not sent to arbitrary `$ref` URLs.

Set `openlint.outputVerbosity` to `error`, `info`, or `debug` to write diagnostics to the `OpenLint` output channel. The default is `off`.

## Diff Source Switcher

The extension writes diagnostics to VS Code's standard Problems view. Use the bottom-left `OpenLint Diff` status bar item, or `OpenLint: Select Diff Source`, to choose which diagnostics are published. Diff filtering uses changed lines plus YAML/JSON AST ownership, so diagnostics reported on the changed node, its owning block, or the OpenLint result path can still be shown even when the diagnostic does not start on the exact changed line:

- `All problems`: every current OpenLint result for the file.
- `Since last commit`: diagnostics on lines changed against `HEAD`.
- `Branch or PR ref`: diagnostics on lines changed from the merge base with the selected branch or ref.
- `Unstaged changes`: diagnostics on lines changed outside the Git index when VS Code Git exposes the working-tree snapshot.
