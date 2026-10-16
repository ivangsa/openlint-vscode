const PACKAGE_ALIASES: Record<string, string> = {
  '@stoplight/spectral-core': '@openlint/openlint-core',
  '@stoplight/spectral-formats': '@openlint/openlint-formats',
  '@stoplight/spectral-functions': '@openlint/openlint-functions',
  '@stoplight/spectral-parsers': '@openlint/openlint-parsers',
  '@stoplight/spectral-ref-resolver': '@openlint/openlint-ref-resolver',
  '@stoplight/spectral-rulesets': '@openlint/openlint-rulesets',
  '@stoplight/spectral-runtime': '@openlint/openlint-runtime',
  '@stoplight/spectral-ruleset-bundler': '@openlint/openlint-ruleset-bundler',
  '@stoplight/spectral-ruleset-migrator': '@openlint/openlint-ruleset-migrator'
};

export function toOpenLintModuleId(id: string): string {
  if (id in PACKAGE_ALIASES) {
    return PACKAGE_ALIASES[id];
  }

  for (const [spectralId, openLintId] of Object.entries(PACKAGE_ALIASES)) {
    const prefix = `${spectralId}/`;
    if (id.startsWith(prefix)) {
      return `${openLintId}/${id.slice(prefix.length)}`;
    }
  }

  return id;
}
