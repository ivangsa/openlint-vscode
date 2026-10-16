export async function loadDesktopRuleset(): Promise<never> {
  throw new Error('Desktop OpenLint ruleset bundling is not included in the web extension bundle.');
}
