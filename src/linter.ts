import * as vscode from 'vscode';
import { Document, OpenLint } from '@openlint/openlint-core';
import type { IRuleResult } from '@openlint/openlint-core';
import { Yaml } from '@openlint/openlint-parsers';
import type { ExtensionConfig } from './config';
import { RulesetLoader } from './rulesetLoader';
import { DiffFilterProvider } from './diffFilter';
import { createDiagnosticAttribution } from './diffAttribution';
import type { Logger } from './logger';
import { LintTimings } from './lintTimings';
import type { LintQueueInfo } from './lintTimings';

export interface LintSnapshot {
  readonly uri: vscode.Uri;
  readonly text: string;
}

export class OpenLintLinter {
  private openlint?: OpenLint;
  private openlintKey?: string;

  constructor(
    private readonly rulesetLoader: RulesetLoader,
    private readonly diffFilterProvider: DiffFilterProvider,
    private readonly logger: Logger
  ) {}

  clearRulesetCache(): void {
    this.rulesetLoader.clear();
  }

  async lint(document: LintSnapshot, config: ExtensionConfig, queue?: LintQueueInfo): Promise<vscode.Diagnostic[]> {
    if (!config.enabled) {
      return [];
    }

    const source = document.uri.toString(true);
    const timings = new LintTimings(this.logger, config.outputVerbosity, source, document.text, config.diffFilter, queue);

    try {
      const { ruleset, cache } = await timings.measure('ruleset', () => this.rulesetLoader.loadWithInfo(document.uri, config));
      timings.cache = cache;
      const openlint = await timings.measure('engine', () => this.getOpenLint(config));
      openlint.setRuleset(ruleset);

      const openlintDocument = timings.measureSync('parse', () => new Document(document.text, Yaml, source));
      const results = await timings.measure('execution', () => openlint.run(openlintDocument, { ignoreUnknownFormat: true }));
      const changedLines = await timings.measure('git', () => this.diffFilterProvider.getChangedLines(document.uri, config.diffFilter, config.diffBaseBranch));

      const diagnostics = timings.measureSync('attribution', () => {
        const attribution = changedLines ? createDiagnosticAttribution(document.text, changedLines) : undefined;

        return results
          .filter(result => !attribution || attribution.includes(result))
          .map(result => toDiagnostic(result));
      });
      timings.diagnostics = diagnostics.length;
      return diagnostics;
    } finally {
      timings.log();
    }
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
