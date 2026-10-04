/** The caller also requires a validated bundled v2 recipe, not a separate app-ID allowlist. */
export function sharedRecipeEligible(appId: string, _boundedApply: boolean): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appId);
}
