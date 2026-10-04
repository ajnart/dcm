const digestPattern = /^sha256:[a-f0-9]{64}$/;
const repositoryPattern = /^(?:[a-z0-9][a-z0-9.-]*(?::[0-9]{1,5})?\/)?[a-z0-9]+(?:[._-]+[a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-]+[a-z0-9]+)*)*$/;
const tagPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

function parsed(value: unknown): { digest: string | null } | null {
  if (typeof value !== "string" || value.length > 512) return null;
  const parts = value.split("@");
  if (parts.length > 2) return null;
  let digest: string | null = null;
  if (parts.length === 2) {
    if (!digestPattern.test(parts[1]!)) return null;
    digest = parts[1]!;
  }
  let repository = parts[0]!;
  const colon = repository.lastIndexOf(":");
  let tagged = false;
  if (colon > repository.lastIndexOf("/")) {
    const tag = repository.slice(colon + 1);
    if (!tagPattern.test(tag) || tag.toLowerCase() === "latest") return null;
    repository = repository.slice(0, colon);
    tagged = true;
  }
  if (!repositoryPattern.test(repository) || (!tagged && digest === null)) return null;
  return { digest };
}

/** A recipe selects a fixed tag or an exact publisher digest, never a guessed tag. */
export function isRecipeImageReference(value: unknown): value is string {
  return parsed(value) !== null;
}

/** Registry evidence cannot substitute a different digest for a pinned recipe. */
export function pinRecipeImage(reference: string, observedDigest: string): string {
  const image = parsed(reference);
  if (!image || !digestPattern.test(observedDigest)) {
    throw new Error("Recipe image needs a fixed non-latest tag or immutable sha256 digest");
  }
  if (image.digest !== null) {
    if (image.digest !== observedDigest) throw new Error("Registry digest differs from the reviewed recipe image");
    return reference;
  }
  return `${reference}@${observedDigest}`;
}

/** Exact repository/tag binding remains unchanged; digest recipes require equality. */
export function matchesRecipeImagePin(reference: unknown, selected: unknown): boolean {
  const image = parsed(reference);
  if (!image || typeof reference !== "string" || typeof selected !== "string") return false;
  if (image.digest !== null) return selected === reference;
  const prefix = `${reference}@`;
  return selected.startsWith(prefix) && digestPattern.test(selected.slice(prefix.length));
}
