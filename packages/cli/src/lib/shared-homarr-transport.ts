import { createHash } from "node:crypto";
import { dirname } from "node:path";
import type { sharedHomarrTrust } from "./shared-homarr-trust.ts";
import type { SharedProjectState } from "./shared-project-state.ts";

/** Only this module can mint evidence, after fresh exact-owner route and trust reads. */
export type OwnedHomarrTransport = Readonly<{ integrationUrl: string; ownerRecordHash: string;
  bindingHash: string; caSha256: string; recipeSha256: string; transportProofSha256: string }>;
const verified = new WeakMap<OwnedHomarrTransport, string>();
function recipeHash(recipe: unknown): string {
  return createHash("sha256").update(JSON.stringify(recipe) ?? "null").digest("hex");
}
/** Nonsecret receipt identity, not current Homarr certificate trust or connectivity. */
export async function readOwnedHomarrTransportIdentity(state: SharedProjectState, appId: string, recipe: unknown,
  canonicalRecipe: Record<string, any>): Promise<OwnedHomarrTransport> {
  const { resolveSharedHttpsTarget } = await import("./shared-https-target.ts");
  const { loadSharedPrivateHttpsTransportProof, validateSharedPrivateHttpsTransportProof } = await import("./shared-private-https-state.ts");
  const target = await resolveSharedHttpsTarget(state, canonicalRecipe, appId);
  const transport = await loadSharedPrivateHttpsTransportProof(state.project.directory, state.recordHash);
  await validateSharedPrivateHttpsTransportProof(state.project.directory, transport);
  const routes = transport.proofs.filter((item) => item.appId === appId);
  if (transport.projectId !== state.project.id || transport.bindingHash !== target.bindingHash
    || transport.caSha256 !== target.caSha256 || routes.length !== 1 || routes[0]!.verified !== true
    || routes[0]!.url !== target.origin || routes[0]!.hostname !== target.hostname
    || routes[0]!.method !== "curl-cacert-resolve") throw new Error("Owned Homarr transport identity differs");
  return { integrationUrl: target.origin, ownerRecordHash: target.ownerRecordHash,
    bindingHash: target.bindingHash, caSha256: target.caSha256, recipeSha256: recipeHash(recipe),
    transportProofSha256: recipeHash(transport) };
}
export function ownedHomarrTransportMatches(proof: OwnedHomarrTransport | undefined,
  recipe: unknown, expectedRecipeSha256: string, integrationUrl?: string): boolean {
  if (!proof || !recipe || typeof recipe !== "object") return false;
  return verified.get(proof) === (recipe as Record<string, unknown>).appId
    && proof.recipeSha256 === expectedRecipeSha256 && recipeHash(recipe) === expectedRecipeSha256
    && (integrationUrl === undefined || proof.integrationUrl === integrationUrl);
}

/** No caller-provided origin, CA or trust flag; no certificate mutations. */
export async function resolveOwnedHomarrTransport(state: SharedProjectState, appId: string, recipe: unknown,
  dependencies: Parameters<typeof sharedHomarrTrust>[4]): Promise<OwnedHomarrTransport | null> {
  try {
    const { restoreSavedSharedSelection } = await import("./shared-saved-recipe.ts");
    const restored = restoreSavedSharedSelection(state, appId, dependencies.recipeFor).recipe;
    if (!recipe || typeof recipe !== "object" || (recipe as Record<string, unknown>).appId !== appId
      || recipeHash(recipe) !== recipeHash(restored)) return null;
    const { resolveSharedHttpsTarget } = await import("./shared-https-target.ts");
    const { sharedHomarrTrust } = await import("./shared-homarr-trust.ts");
    const target = await resolveSharedHttpsTarget(state, dependencies.recipeFor("caddy").recipe, appId);
    const report = await sharedHomarrTrust(dirname(dirname(dirname(state.project.directory))),
      state.project.id, appId, null, dependencies);
    if (report.trustStoreReadbackVerified !== true || report.ownerRecordHash !== state.recordHash
      || report.manifestHash !== state.manifestHash || report.certificate?.sha256 !== target.caSha256
      || report.containerRouteBinding !== "source-bound-route-unverified") return null;
    // The published container listener and private host listener share the owned port.
    const current = await resolveSharedHttpsTarget(state, dependencies.recipeFor("caddy").recipe, appId);
    if (JSON.stringify(current) !== JSON.stringify(target)) return null;
    const proof = Object.freeze(await readOwnedHomarrTransportIdentity(state, appId, recipe, dependencies.recipeFor("caddy").recipe));
    if (proof.integrationUrl !== target.origin || proof.bindingHash !== target.bindingHash
      || proof.caSha256 !== target.caSha256 || proof.ownerRecordHash !== state.recordHash) return null;
    verified.set(proof, appId);
    return proof;
  } catch { return null; }
}
