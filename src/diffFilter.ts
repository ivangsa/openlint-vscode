import * as vscode from 'vscode';
import type { DiffFilterMode } from './config';

export interface ChangedLines {
  readonly lines: ReadonlySet<number>;
  contains(line: number): boolean;
}

export class DiffFilterProvider {
  private warningShown = false;

  async getChangedLines(uri: vscode.Uri, mode: DiffFilterMode, baseBranch: string): Promise<ChangedLines | undefined> {
    if (mode === 'all') {
      return undefined;
    }

    const repository = await this.getRepository(uri);
    if (!repository) {
      this.showPortableWarning();
      return undefined;
    }

    const diff = await this.readDiff(repository, uri, mode, baseBranch);
    if (!diff) {
      return undefined;
    }

    return parseChangedLines(diff);
  }

  private async getRepository(uri: vscode.Uri): Promise<unknown | undefined> {
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (!gitExtension) {
      return undefined;
    }

    const exports = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
    const api = exports?.getAPI?.(1);
    const repositories = api?.repositories as unknown[] | undefined;

    return repositories?.find(repository => {
      const rootUri = (repository as { rootUri?: vscode.Uri }).rootUri;
      return rootUri && uri.toString().startsWith(rootUri.toString());
    });
  }

  private async readDiff(repository: unknown, uri: vscode.Uri, mode: DiffFilterMode, baseBranch: string): Promise<string | undefined> {
    const repo = repository as {
      diffWithHEAD?: (path?: string) => Promise<string>;
      diffIndexWithHEAD?: (path?: string) => Promise<string>;
      diffWith?: (ref: string, path?: string) => Promise<string>;
      diffIndexWith?: (ref: string, path?: string) => Promise<string>;
      getMergeBase?: (ref: string) => Promise<string | undefined>;
      rootUri?: vscode.Uri;
    };
    const relativePath = repo.rootUri ? vscode.workspace.asRelativePath(uri, false) : uri.fsPath;

    if (mode === 'unstaged') {
      return await this.readUnstagedDiff(repository, uri) ?? await repo.diffWithHEAD?.(relativePath);
    }

    if (mode === 'mergeBase') {
      const mergeBase = await repo.getMergeBase?.(baseBranch);
      const ref = mergeBase || baseBranch;
      return repo.diffWith?.(ref, relativePath) ?? repo.diffIndexWith?.(ref, relativePath);
    }

    return repo.diffIndexWithHEAD?.(relativePath) ?? repo.diffWithHEAD?.(relativePath);
  }

  private async readUnstagedDiff(repository: unknown, uri: vscode.Uri): Promise<string | undefined> {
    const repo = repository as {
      state?: {
        workingTreeChanges?: Array<{
          resourceUri?: vscode.Uri;
          originalResourceUri?: vscode.Uri;
        }>;
      };
    };
    const change = repo.state?.workingTreeChanges?.find(candidate => candidate.resourceUri?.toString() === uri.toString());

    if (!change?.originalResourceUri) {
      return undefined;
    }

    const originalBytes = await vscode.workspace.fs.readFile(change.originalResourceUri);
    const currentBytes = await vscode.workspace.fs.readFile(uri);
    const original = new TextDecoder().decode(originalBytes).split(/\r?\n/);
    const current = new TextDecoder().decode(currentBytes).split(/\r?\n/);
    const changed = diffChangedLines(original, current);

    return [...changed].sort((a, b) => a - b).map(line => `@@ -0,0 +${line + 1},1 @@\n+`).join('\n');
  }

  private showPortableWarning(): void {
    if (this.warningShown) {
      return;
    }

    this.warningShown = true;
    void vscode.window.showWarningMessage('OpenLint diff filters need VS Code Git support. Showing all diagnostics for now.');
  }
}

function diffChangedLines(original: string[], current: string[]): Set<number> {
  if (original.length * current.length > 500_000) {
    return new Set(current.map((_, index) => index));
  }

  const rows = original.length + 1;
  const columns = current.length + 1;
  const table = Array.from({ length: rows }, () => new Array<number>(columns).fill(0));

  for (let row = original.length - 1; row >= 0; row -= 1) {
    for (let column = current.length - 1; column >= 0; column -= 1) {
      table[row][column] = original[row] === current[column]
        ? table[row + 1][column + 1] + 1
        : Math.max(table[row + 1][column], table[row][column + 1]);
    }
  }

  const changed = new Set<number>();
  let row = 0;
  let column = 0;

  while (row < original.length && column < current.length) {
    if (original[row] === current[column]) {
      row += 1;
      column += 1;
    } else if (table[row + 1][column] >= table[row][column + 1]) {
      row += 1;
    } else {
      changed.add(column);
      column += 1;
    }
  }

  while (column < current.length) {
    changed.add(column);
    column += 1;
  }

  return changed;
}

function parseChangedLines(diff: string): ChangedLines {
  const changed = new Set<number>();
  const lines = diff.split(/\r?\n/);
  let newLine = 0;
  let inHunk = false;

  for (const line of lines) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      inHunk = true;
      const length = hunk[2] === undefined ? 1 : Number(hunk[2]);
      if (length === 0) {
        changed.add(Math.max(0, newLine - 1));
      }
      continue;
    }

    if (!inHunk || line.startsWith('\\')) {
      continue;
    }

    if (line.startsWith('+')) {
      changed.add(newLine - 1);
      newLine += 1;
      continue;
    }

    if (line.startsWith(' ')) {
      newLine += 1;
    }
  }

  return {
    lines: changed,
    contains: (line: number) => changed.has(line)
  };
}
