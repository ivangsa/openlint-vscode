import * as vscode from 'vscode';
import { getConfig, updateWorkspaceConfig, type DiffFilterMode } from './config';
import { isLintableDocument } from './documentSelector';
import { DiffFilterProvider } from './diffFilter';
import { OpenLintLinter } from './linter';
import { Logger, sanitizeText } from './logger';
import { RulesetLoader } from './rulesetLoader';
import type { LintQueueInfo } from './lintTimings';

const lintTimers = new Map<string, ReturnType<typeof setTimeout>>();
const lintRequests = new Map<string, { id: number; background: boolean }>();
let nextLintRequest = 0;
let configGeneration = 0;
let disposed = false;

export function activate(context: vscode.ExtensionContext): void {
  disposed = false;
  const diagnostics = vscode.languages.createDiagnosticCollection('openlint');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 80);
  const output = vscode.window.createOutputChannel('OpenLint');
  const logger = new Logger(output);
  const linter = new OpenLintLinter(new RulesetLoader(context, logger), new DiffFilterProvider(), logger);

  status.name = 'OpenLint Diff Source';
  status.command = 'openlint.selectDiffFilter';
  context.subscriptions.push(diagnostics, status, output, { dispose: deactivate });

  const lintOpenDocument = (document = vscode.window.activeTextEditor?.document) => {
    if (!document || !isLintableDocument(document)) {
      return;
    }

    queueLint(document, diagnostics, linter, logger);
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(event => {
      invalidateDocument(event.document.uri);
      const config = getConfig(event.document.uri);
      if (config.lintOnType) {
        queueLint(event.document, diagnostics, linter, logger);
      }
    }),
    vscode.workspace.onDidCloseTextDocument(document => {
      // Keep published workspace diagnostics, and let background scan lints finish,
      // when VS Code releases a document it opened only for the scan.
      invalidateDocument(document.uri, true);
    }),
    vscode.workspace.onDidSaveTextDocument(document => {
      const config = getConfig(document.uri);
      if (config.lintOnSave) {
        queueLint(document, diagnostics, linter, logger, 0);
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(editor => {
      updateStatus(status, editor?.document.uri);
      lintOpenDocument(editor?.document);
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('openlint')) {
        invalidateAllLints();
        linter.clearRulesetCache();
        diagnostics.clear();
        updateStatus(status, vscode.window.activeTextEditor?.document.uri);
        logger.debug(getConfig(vscode.window.activeTextEditor?.document.uri).outputVerbosity, 'Configuration changed; cleared ruleset cache and diagnostics.');
        lintOpenDocument();
      }
    }),
    vscode.commands.registerCommand('openlint.enable', async () => {
      await updateWorkspaceConfig('enabled', true);
      lintOpenDocument();
    }),
    vscode.commands.registerCommand('openlint.disable', async () => {
      await updateWorkspaceConfig('enabled', false);
      diagnostics.clear();
    }),
    vscode.commands.registerCommand('openlint.lintWorkspace', async () => {
      await lintWorkspace(diagnostics, linter, logger);
    }),
    vscode.commands.registerCommand('openlint.selectDiffFilter', async () => {
      await selectDiffFilter();
      updateStatus(status, vscode.window.activeTextEditor?.document.uri);
      lintOpenDocument();
    }),
    vscode.commands.registerCommand('openlint.clearDiffFilter', async () => {
      await updateWorkspaceConfig('diffFilter', 'all');
      updateStatus(status, vscode.window.activeTextEditor?.document.uri);
      lintOpenDocument();
    }),
    vscode.commands.registerCommand('openlint.setDiffBaseBranch', async () => {
      const current = getConfig(vscode.window.activeTextEditor?.document.uri).diffBaseBranch;
      const branch = await vscode.window.showInputBox({
        title: 'OpenLint diff base branch',
        value: current,
        prompt: 'Branch or ref used when filtering diagnostics since merge base'
      });

      if (branch) {
        await updateWorkspaceConfig('diffBaseBranch', branch);
        updateStatus(status, vscode.window.activeTextEditor?.document.uri);
        lintOpenDocument();
      }
    }),
    vscode.commands.registerCommand('openlint.setSecret', async () => {
      const key = await vscode.window.showInputBox({
        title: 'OpenLint secret key',
        prompt: 'Name used by bearerTokenSecret or passwordSecret settings'
      });

      if (!key) {
        return;
      }

      const value = await vscode.window.showInputBox({
        title: `Set OpenLint secret: ${key}`,
        password: true,
        ignoreFocusOut: true
      });

      if (value !== undefined) {
        await context.secrets.store(key, value);
      }
    }),
    vscode.commands.registerCommand('openlint.deleteSecret', async () => {
      const key = await vscode.window.showInputBox({
        title: 'Delete OpenLint secret',
        prompt: 'Secret key to delete'
      });

      if (key) {
        await context.secrets.delete(key);
      }
    })
  );

  updateStatus(status, vscode.window.activeTextEditor?.document.uri);
  lintOpenDocument();
}

export function deactivate(): void {
  disposed = true;
  invalidateAllLints();
}

function invalidateDocument(uri: vscode.Uri, keepBackgroundRequest = false): void {
  const key = uri.toString();
  const timer = lintTimers.get(key);
  if (timer !== undefined) {
    clearTimeout(timer);
  }
  lintTimers.delete(key);
  if (!keepBackgroundRequest || !lintRequests.get(key)?.background) {
    lintRequests.delete(key);
  }
}

function invalidateAllLints(): void {
  configGeneration += 1;
  for (const timer of lintTimers.values()) {
    clearTimeout(timer);
  }
  lintTimers.clear();
  lintRequests.clear();
}

function queueLint(
  document: vscode.TextDocument,
  diagnostics: vscode.DiagnosticCollection,
  linter: OpenLintLinter,
  logger: Logger,
  delay = 350
): void {
  if (disposed || document.isClosed || !isLintableDocument(document)) {
    return;
  }

  invalidateDocument(document.uri);
  const key = document.uri.toString();
  const enqueuedAt = performance.now();
  lintTimers.set(key, setTimeout(() => {
    lintTimers.delete(key);
    void lintDocument(document, diagnostics, linter, logger, false, {
      debounceMs: delay,
      waitedMs: performance.now() - enqueuedAt
    });
  }, delay));
}

async function lintDocument(
  document: vscode.TextDocument,
  diagnostics: vscode.DiagnosticCollection,
  linter: OpenLintLinter,
  logger: Logger,
  background = false,
  queue?: LintQueueInfo
): Promise<void> {
  if (disposed || document.isClosed) {
    return;
  }

  invalidateDocument(document.uri);
  const key = document.uri.toString();
  const requestId = ++nextLintRequest;
  lintRequests.set(key, { id: requestId, background });
  const version = document.version;
  const generation = configGeneration;
  const config = getConfig(document.uri);
  const snapshot = { uri: document.uri, text: document.getText() };
  const isCurrent = () => !disposed
    && (background || !document.isClosed)
    && document.version === version
    && configGeneration === generation
    && lintRequests.get(key)?.id === requestId;

  try {
    logger.debug(config.outputVerbosity, `Linting document ${document.uri.toString(true)}.`);
    const problems = await linter.lint(snapshot, config, queue);
    if (!isCurrent()) {
      return;
    }
    diagnostics.set(document.uri, problems);
    logger.info(config.outputVerbosity, `Linted ${document.uri.toString(true)} with ${problems.length} diagnostics.`);
  } catch (error) {
    if (!isCurrent()) {
      return;
    }
    diagnostics.set(document.uri, [configurationDiagnostic(document, error)]);
    logger.error(config.outputVerbosity, `Linting failed for ${document.uri.toString(true)}.`, error);
  } finally {
    if (lintRequests.get(key)?.id === requestId) {
      lintRequests.delete(key);
    }
  }
}

async function lintWorkspace(
  diagnostics: vscode.DiagnosticCollection,
  linter: OpenLintLinter,
  logger: Logger
): Promise<void> {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  const config = getConfig(activeUri);
  const generation = configGeneration;
  const include = `{${config.include.join(',')}}`;
  const files = await vscode.workspace.findFiles(include, '**/{node_modules,.git}/**');

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Linting YAML files with OpenLint',
    cancellable: false
  }, async progress => {
    for (let index = 0; index < files.length; index += 1) {
      if (disposed || configGeneration !== generation) {
        break;
      }
      progress.report({ message: `${index + 1}/${files.length}` });
      const document = await vscode.workspace.openTextDocument(files[index]);
      if (disposed || configGeneration !== generation) {
        break;
      }
      await lintDocument(document, diagnostics, linter, logger, true);
    }
  });
}

async function selectDiffFilter(): Promise<void> {
  const config = getConfig(vscode.window.activeTextEditor?.document.uri);
  const diffFilterOptions: Array<vscode.QuickPickItem & { mode: DiffFilterMode }> = [
    { label: 'All problems', description: 'Show every current OpenLint diagnostic', mode: 'all' },
    { label: 'Last commit', description: 'Show diagnostics on lines changed against HEAD', mode: 'lastCommit' },
    { label: 'Branch or PR ref', description: `Show diagnostics changed from merge base with ${config.diffBaseBranch}`, mode: 'mergeBase' },
    { label: 'Unstaged changes', description: 'Show diagnostics on lines changed outside the index', mode: 'unstaged' }
  ];
  const picks = diffFilterOptions.map(pick => ({
    ...pick,
    picked: pick.mode === config.diffFilter
  }));
  const selected = await vscode.window.showQuickPick(picks, {
    title: 'OpenLint diff source',
    placeHolder: 'Choose which Git diff controls the diagnostics in Problems'
  });

  if (!selected) {
    return;
  }

  await updateWorkspaceConfig('diffFilter', selected.mode);

  if (selected.mode === 'mergeBase') {
    await vscode.commands.executeCommand('openlint.setDiffBaseBranch');
  }
}

function updateStatus(status: vscode.StatusBarItem, resource?: vscode.Uri): void {
  const config = getConfig(resource);
  const label = diffFilterLabel(config.diffFilter);
  status.text = `$(git-compare) OpenLint Diff: ${config.enabled ? label : 'Off'}`;
  status.tooltip = config.diffFilter === 'mergeBase'
    ? `OpenLint diagnostics filtered to changes since merge base with ${config.diffBaseBranch}`
    : 'Select the Git diff source for OpenLint diagnostics';
  status.show();
}

function diffFilterLabel(mode: DiffFilterMode): string {
  switch (mode) {
    case 'all':
      return 'All';
    case 'lastCommit':
      return 'HEAD';
    case 'mergeBase':
      return 'Branch/PR';
    case 'unstaged':
      return 'Unstaged';
  }
}

function configurationDiagnostic(document: vscode.TextDocument, error: unknown): vscode.Diagnostic {
  const firstLine = document.lineAt(0);
  const diagnostic = new vscode.Diagnostic(
    firstLine.range,
    sanitizeText(error instanceof Error ? error.message : String(error)),
    vscode.DiagnosticSeverity.Error
  );
  diagnostic.source = 'OpenLint configuration';

  return diagnostic;
}
