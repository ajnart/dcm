type Check = Record<string, unknown>;
export type HealthObservation = { health: unknown; documented: boolean };

/** Image-inherited checks count only when the exact container retained them unchanged. */
export function inheritedHealthcheckMatches(actual: Check, image: Check): boolean {
  if (!Array.isArray(image.Test) || image.Test.length < 2 || image.Test[0] === "NONE") return false;
  if (JSON.stringify(actual.Test) !== JSON.stringify(image.Test)) return false;
  for (const field of ["Interval", "Timeout", "StartPeriod", "StartInterval", "Retries"]) {
    if ((actual[field] ?? 0) !== (image[field] ?? 0)) return false;
  }
  return true;
}

/** Report any documented failure even when other dependencies have no check. */
export function documentedUnitHealth(observations: readonly HealthObservation[]): string {
  const known = observations.filter((item) => item.documented);
  if (known.some((item) => item.health === "unhealthy")) return "unhealthy";
  if (known.some((item) => item.health === "starting")) return "starting";
  if (observations.length > 0 && known.length === observations.length
    && known.every((item) => item.health === "healthy")) return "healthy";
  return "unknown";
}
