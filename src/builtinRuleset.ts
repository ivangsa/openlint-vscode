import { Ruleset } from '@openlint/openlint-core';
import { arazzo, asyncapi, oas } from '@openlint/openlint-rulesets';

export const BUILTIN_RULESET_SOURCE = 'openlint:recommended';

export function createBuiltinRuleset(): Ruleset {
  return new Ruleset(
    {
      extends: [oas, asyncapi, arazzo]
    },
    {
      severity: 'recommended',
      source: BUILTIN_RULESET_SOURCE
    }
  );
}
