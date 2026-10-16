import * as vscode from 'vscode';

export function isLintableDocument(document: vscode.TextDocument): boolean {
  if (document.uri.scheme === 'output' || document.uri.scheme === 'git') {
    return false;
  }

  return document.languageId === 'yaml' || document.languageId === 'yml' || document.fileName.endsWith('.yaml') || document.fileName.endsWith('.yml');
}

export function getWorkspaceFolder(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.getWorkspaceFolder(uri) ?? vscode.workspace.workspaceFolders?.[0];
}
