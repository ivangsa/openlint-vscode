export async function loadWebRuleset(): Promise<never> {
  throw new Error('Web OpenLint ruleset loading is not included in the desktop extension bundle.');
}
