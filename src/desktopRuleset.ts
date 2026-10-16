import * as vscode from 'vscode';
import { Ruleset } from '@openlint/openlint-core';
import { bundleRuleset, type IO } from '@openlint/openlint-ruleset-bundler';
import { runtime } from '@openlint/openlint-ruleset-bundler/presets/runtime';
import { commonjs } from '@openlint/openlint-ruleset-bundler/plugins/commonjs';
import { stdin } from '@openlint/openlint-ruleset-bundler/plugins/stdin';
import { migrateRuleset } from '@openlint/openlint-ruleset-migrator';
import type { OutputVerbosity } from './config';
import type { RulesetIo } from './rulesetIo';
import { sanitizeUrl, type Logger } from './logger';
import { toOpenLintModuleId } from './packageAliases';

const httpPattern = /^https?:\/\//i;

export async function loadDesktopRuleset(
  location: vscode.Uri,
  io: RulesetIo,
  logger: Logger,
  verbosity: OutputVerbosity
): Promise<Ruleset> {
  let rulesetFile = location.toString(true);
  const plugins = [
    spectralPackageAlias(),
    ...runtime(io as unknown as IO),
    commonjs()
  ];

  logger.info(verbosity, `Bundling ruleset ${sanitizeUrl(location.toString(true))}.`);

  if (isBasicRuleset(rulesetFile)) {
    const migratedRuleset = await migrateRuleset(rulesetFile, {
      format: 'esm',
      fetch: io.fetch,
      fs: io.fs as unknown as IO['fs']
    });
    rulesetFile = toVirtualJavaScriptRuleset(rulesetFile);
    plugins.unshift(stdin(migratedRuleset, rulesetFile));
  }

  const bundledRuleset = await bundleRuleset(rulesetFile, {
    target: 'runtime',
    format: 'iife',
    plugins,
    treeshake: false
  });
  const rulesetDefinition = Function(`return ${bundledRuleset}`)();

  return new Ruleset(rulesetDefinition, {
    severity: 'recommended',
    source: rulesetFile
  });
}

function spectralPackageAlias(): ReturnType<typeof runtime>[number] {
  return {
    name: 'spectral-package-alias',
    resolveId(id: string) {
      const aliased = toOpenLintModuleId(id);
      return aliased === id ? null : aliased;
    }
  } as ReturnType<typeof runtime>[number];
}

function isBasicRuleset(rulesetFile: string): boolean {
  return /\.(?:json|ya?ml)$/i.test(getPathname(rulesetFile));
}

function toVirtualJavaScriptRuleset(rulesetFile: string): string {
  const pathname = getPathname(rulesetFile);
  const dirname = pathname.slice(0, pathname.lastIndexOf('/') + 1);

  if (httpPattern.test(rulesetFile)) {
    const url = new URL(rulesetFile);
    url.pathname = `${dirname}.openlint.js`;
    return url.toString();
  }

  return vscode.Uri.joinPath(vscode.Uri.file(pathname), '..', '.openlint.js').fsPath;
}

function getPathname(location: string): string {
  return httpPattern.test(location)
    ? new URL(location).pathname
    : vscode.Uri.parse(location).fsPath || location;
}
