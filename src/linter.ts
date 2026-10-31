import * as vscode from 'vscode';
import { Document, OpenLint } from '@openlint/openlint-core';
import type { IRuleResult } from '@openlint/openlint-core';
import { Yaml } from '@openlint/openlint-parsers';
import type { ExtensionConfig } from './config';
import { RulesetLoader } from './rulesetLoader';
import { DiffFilterProvider } from './diffFilter';
import { createDiagnosticAttribution } from './diffAttribution';

export interface LintSnapshot {
  readonly uri: vscode.Uri;
  readonly text: string;
}

export class OpenLintLinter {
  private openlint?: OpenLint;
  private openlintKey?: string;

  constructor(
    private readonly rulesetLoader: RulesetLoader,
    private readonly diffFilterProvider: DiffFilterProvider
  ) {}

  clearRulesetCache(): void {
    this.rulesetLoader.clear();
  }

  async lint(document: LintSnapshot, config: ExtensionConfig): Promise<vscode.Diagnostic[]> {
    if (!config.enabled) {
      return [];
    }

    const ruleset = await this.rulesetLoader.load(document.uri, config);
    const openlint = await this.getOpenLint(config);
    openlint.setRuleset(ruleset);

    const source = document.uri.toString(true);
    const openlintDocument = new Document(document.text, Yaml, source);
    const results = await openlint.run(openlintDocument, { ignoreUnknownFormat: true });
    const changedLines = await this.diffFilterProvider.getChangedLines(document.uri, config.diffFilter, config.diffBaseBranch);
    const attribution = changedLines ? createDiagnosticAttribution(document.text, changedLines) : undefined;

    return results
      .filter(result => !attribution || attribution.includes(result))
      .map(result => toDiagnostic(result));
  }

  private async getOpenLint(config: ExtensionConfig): Promise<OpenLint> {
    const key = JSON.stringify({
      loaders: config.loaders,
      outputVerbosity: config.outputVerbosity
    });

    if (!this.openlint || this.openlintKey !== key) {
      this.openlint = new OpenLint({
        resolver: await this.rulesetLoader.createDocumentResolver(config)
      });
      this.openlintKey = key;
    }

    return this.openlint;
  }
}

function toDiagnostic(result: IRuleResult): vscode.Diagnostic {
  const range = toRange(result);
  const diagnostic = new vscode.Diagnostic(range, result.message, toSeverity(result.severity));
  diagnostic.code = result.code;
  diagnostic.source = 'OpenLint';

  return diagnostic;
}

function toRange(result: IRuleResult): vscode.Range {
  const start = result.range.start;
  const end = result.range.end;

  return new vscode.Range(
    Math.max(0, start.line),
    Math.max(0, start.character),
    Math.max(0, end.line),
    Math.max(0, end.character)
  );
}

function toSeverity(severity: number): vscode.DiagnosticSeverity {
  if (severity === 0) {
    return vscode.DiagnosticSeverity.Error;
  }

  if (severity === 1) {
    return vscode.DiagnosticSeverity.Warning;
  }

  if (severity === 2) {
    return vscode.DiagnosticSeverity.Information;
  }

  return vscode.DiagnosticSeverity.Hint;
}
