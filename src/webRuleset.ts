import * as openlintCore from '@openlint/openlint-core';
import { Ruleset } from '@openlint/openlint-core';
import * as openlintFormats from '@openlint/openlint-formats';
import * as openlintFunctions from '@openlint/openlint-functions';
import * as openlintParsers from '@openlint/openlint-parsers';
import * as openlintRefResolver from '@openlint/openlint-ref-resolver';
import { migrateRuleset } from '@openlint/openlint-ruleset-migrator';
import * as openlintRulesets from '@openlint/openlint-rulesets';
import * as openlintRuntime from '@openlint/openlint-runtime';
import type { OutputVerbosity } from './config';
import type { RulesetIo } from './rulesetIo';
import { sanitizeText, sanitizeUrl, type Logger } from './logger';
import { toOpenLintModuleId } from './packageAliases';

const httpPattern = /^https?:\/\//i;

const builtinModules: Record<string, unknown> = {
  '@openlint/openlint-core': openlintCore,
  '@openlint/openlint-formats': openlintFormats,
  '@openlint/openlint-functions': openlintFunctions,
  '@openlint/openlint-parsers': openlintParsers,
  '@openlint/openlint-ref-resolver': openlintRefResolver,
  '@openlint/openlint-rulesets': openlintRulesets,
  '@openlint/openlint-runtime': openlintRuntime
};

export async function loadWebRuleset(
  location: { toString(skipEncoding?: boolean): string },
  io: RulesetIo,
  logger: Logger,
  verbosity: OutputVerbosity
): Promise<Ruleset> {
  const rulesetFile = location.toString(true);

  if (!isBasicRuleset(rulesetFile)) {
    throw new Error(`Web mode can load YAML/JSON rulesets from the workspace or HTTP(S). JavaScript rulesets require VS Code desktop. Received ${sanitizeUrl(rulesetFile)}.`);
  }

  logger.info(verbosity, `Migrating ruleset for web mode ${sanitizeUrl(rulesetFile)}.`);

  const migrated = await migrateRuleset(rulesetFile, {
    format: 'commonjs',
    fetch: io.fetch,
    fs: io.fs as Parameters<typeof migrateRuleset>[1]['fs']
  });
  const definition = evaluateMigratedRuleset(migrated);

  return new Ruleset(definition, {
    severity: 'recommended',
    source: rulesetFile
  });
}

function evaluateMigratedRuleset(code: string): unknown {
  const module = { exports: {} as { default?: unknown } };
  const fn = new Function('require', 'module', 'exports', `"use strict";\n${code}\n`);
  fn(requireBuiltin, module, module.exports);

  return module.exports.default ?? module.exports;
}

function requireBuiltin(id: string): unknown {
  const resolved = toOpenLintModuleId(id);
  const root = resolved.startsWith('@')
    ? resolved.split('/').slice(0, 2).join('/')
    : resolved;
  if (root in builtinModules) {
    return interopModule(builtinModules[root]);
  }

  throw new Error(`Web mode cannot load ruleset module "${sanitizeText(id)}". Use a YAML/JSON ruleset that only imports OpenLint builtins such as spectral:oas, or @openlint/openlint-* and @stoplight/spectral-* packages.`);
}

function interopModule(module: unknown): unknown {
  if (!module || typeof module !== 'object') {
    return module;
  }

  const exported = module as { default?: unknown };
  if (exported.default && typeof exported.default === 'object') {
    return { ...exported, ...exported.default };
  }

  return module;
}

function isBasicRuleset(rulesetFile: string): boolean {
  const pathname = httpPattern.test(rulesetFile)
    ? new URL(rulesetFile).pathname
    : rulesetFile.split(/[?#]/, 1)[0];

  return /\.(?:json|ya?ml)$/i.test(pathname);
}
