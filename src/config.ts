import * as vscode from 'vscode';

export type DiffFilterMode = 'all' | 'lastCommit' | 'mergeBase' | 'unstaged';
export type OutputVerbosity = 'off' | 'error' | 'info' | 'debug';

export interface BasicAuthConfig {
  username?: string;
  password?: string;
  passwordSecret?: string;
}

export interface AuthConfig {
  headers?: Record<string, string>;
  bearerToken?: string;
  bearerTokenSecret?: string;
  basic?: BasicAuthConfig;
}

export interface LoaderConfig extends AuthConfig {
  match?: string;
  module?: string;
}

export interface ExtensionConfig {
  enabled: boolean;
  lintOnType: boolean;
  lintOnSave: boolean;
  include: string[];
  ruleset: string;
  remoteAuth: AuthConfig;
  loaders: LoaderConfig[];
  diffFilter: DiffFilterMode;
  diffBaseBranch: string;
  outputVerbosity: OutputVerbosity;
}

export const DEFAULT_RULESET = '.openlint.yaml';

export function getConfig(resource?: vscode.Uri): ExtensionConfig {
  const config = vscode.workspace.getConfiguration('openlint', resource);

  return {
    enabled: config.get('enabled', true),
    lintOnType: config.get('lintOnType', true),
    lintOnSave: config.get('lintOnSave', true),
    include: config.get('include', ['**/*.{yaml,yml}']),
    ruleset: config.get('ruleset', DEFAULT_RULESET),
    remoteAuth: config.get('remoteAuth', {}),
    loaders: config.get('loaders', []),
    diffFilter: config.get('diffFilter', 'all'),
    diffBaseBranch: config.get('diffBaseBranch', 'main'),
    outputVerbosity: config.get('outputVerbosity', 'off')
  };
}

export async function updateWorkspaceConfig<K extends keyof ExtensionConfig>(
  key: K,
  value: ExtensionConfig[K],
  target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace
): Promise<void> {
  await vscode.workspace.getConfiguration('openlint').update(key, value, target);
}
