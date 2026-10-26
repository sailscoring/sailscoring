/**
 * What each scope an app can ask for lets it do (ADR-016 §4), as the consent
 * page and the Connected apps card say it. Client-safe.
 */
export const SCOPE_DESCRIPTIONS: Record<string, string> = {
  read: 'See the workspace’s series: entries, races, starts, finishes and what’s published',
  races: 'Add and delete races, change their starts, and set each start’s course',
  submissions: 'Submit a race’s finishes for a scorer to review, and revise or withdraw them',
  publish: 'Publish and unpublish results',
  offline_access: 'Keep this access until you disconnect it, without asking you each time',
};

/** The scopes in the order the consent page lists them, described. */
export function describeScopes(scopes: readonly string[]): { scope: string; description: string }[] {
  const order = Object.keys(SCOPE_DESCRIPTIONS);
  return [...new Set(scopes)]
    .filter((s) => s in SCOPE_DESCRIPTIONS)
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((scope) => ({ scope, description: SCOPE_DESCRIPTIONS[scope] }));
}
