import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, lstat } from "node:fs/promises";
import { join } from "node:path";
import type { SharedProjectCandidate } from "./shared-compose-project.ts";
import type { SharedProjectState } from "./shared-project-state.ts";
import { bundledPostAccountTransition } from "./shared-post-account-settings.ts";

type Entry = Record<string, any>;

/** Recipe-owned, non-secret switch. This is a pure review gate, not an apply operation. */
export type SharedEnvironmentTransition = {
  serviceId: string;
  name: string;
  from: string;
  to: string | null;
  after: "first-admin-created";
  proof?: { stage: "account-verified"; attemptedActions: string[] };
};

export type SharedEnvironmentReview = {
  candidate: SharedProjectCandidate;
  serviceId: string;
  manifestHash: string;
  approval: string;
};

/** Reads only the exact adapter-owned setup proof; a caller cannot assert it on argv. */
export async function requireFirstAccountProof(state: SharedProjectState, appId: string,
  projectRoot: string, identity: string, fileId: string, expectedApiKeyRef?: string): Promise<void> {
  const path = join(state.project.directory, `first-run-${appId}.json`);
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch { throw new Error("No exact saved first-account proof exists"); }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size < 2 || before.size > 65536
      || (before.mode & 0o7777) !== 0o600
      || (typeof process.getuid === "function" && before.uid !== process.getuid())) {
      throw new Error("Saved first-account proof is not an owner-only regular file");
    }
    const bytes = await handle.readFile("utf8");
    const after = await handle.stat();
    if (after.ino !== before.ino || after.dev !== before.dev || after.size !== before.size) {
      throw new Error("Saved first-account proof changed during review");
    }
    let record: Entry;
    try { record = JSON.parse(bytes); }
    catch { throw new Error("Saved first-account proof is invalid"); }
    const proof = bundledPostAccountTransition(appId)?.proof;
    const actions = proof?.attemptedActions ?? [`${appId}-create-first-account`];
    if (record.schemaVersion !== 1 || record.appId !== appId
      || record.projectRoot !== projectRoot || record.stage !== "account-verified"
      || !Number.isSafeInteger(record.revision) || record.revision < 1
      || record.data?.ownerManifestHash !== state.manifestHash
      || record.data?.identity !== identity
      || record.data?.credentialRef !== join(state.project.directory, "secrets", appId, fileId)
      || !Array.isArray(record.attemptedActions)
      || actions.some((action) => !record.attemptedActions.includes(action))) {
      throw new Error("Saved first-account proof does not match this exact owner and credential");
    }
    if (expectedApiKeyRef !== undefined) {
      if (expectedApiKeyRef !== join(state.project.directory, "secrets", appId, `${appId}-api-key`)
        || record.data.apiKeyRef !== expectedApiKeyRef) {
        throw new Error("Saved first-account proof lacks its verified API-key reference");
      }
      const file = await lstat(expectedApiKeyRef);
      if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1
        || file.uid !== process.getuid?.() || (file.mode & 0o7777) !== 0o600
        || file.size < 8 || file.size > 8192) {
        throw new Error("Saved first-account API-key reference is not an owner-only file");
      }
    }
  } finally { await handle.close(); }
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Compile exactly one post-first-account environment change from the saved owner.
 * The caller must still prove administrator creation, persist a reviewed manifest
 * revision, checkpoint before Docker, recreate only the returned service, and
 * verify saved-admin login. No caller-supplied YAML or arbitrary env value enters.
 */
export function reviewSharedEnvironmentTransition(
  state: SharedProjectState,
  appId: string,
  recipe: Entry,
  transition: SharedEnvironmentTransition,
): SharedEnvironmentReview {
  if (state?.checkpoint?.phase !== "completed" || state.manifestHash !== hash(state.manifest)
    || !Object.hasOwn(state.units ?? {}, appId)
    || recipe?.appId !== appId || recipe?.schemaVersion !== 2
    || !Array.isArray(recipe.services) || !same(recipe.postFirstAccountEnvironment, transition)
    || transition?.after !== "first-admin-created"
    || !/^[A-Z][A-Z0-9_]{0,127}$/.test(transition.name)
    || typeof transition.from !== "string" || (transition.to !== null && typeof transition.to !== "string")
    || transition.from === transition.to || transition.from.length > 256
    || (transition.to !== null && (transition.to.length > 256 || /[\r\n\0$]/.test(transition.to)))
    || /[\r\n\0$]/.test(transition.from)
    || !same(bundledPostAccountTransition(appId), transition)) {
    throw new Error("Post-first-account transition is not a reviewed recipe-owned switch");
  }
  const service = recipe.services.find((item: Entry) => item.id === transition.serviceId);
  if (!service || recipe.services.filter((item: Entry) => item.id === transition.serviceId).length !== 1
    || !Array.isArray(service.environment)
    || service.environment.filter((item: Entry) => item.name === transition.name).length !== 1
    || service.environment.find((item: Entry) => item.name === transition.name)?.value !== transition.from
    || [...(service.hostEnvironment ?? []), ...(service.derivedEnvironment ?? []),
      ...(service.secretEnvironment ?? []), ...(service.fileEnvironment ?? [])]
      .some((item: Entry) => item.name === transition.name)) {
    throw new Error("Post-first-account switch does not own one static non-secret recipe environment value");
  }
  const serviceId = transition.serviceId === appId
    ? appId : `${appId}-${transition.serviceId}`;
  if (!state.units[appId].includes(serviceId)) {
    throw new Error("Transition service is outside the saved app unit");
  }
  const services = state.manifest.services as Entry[];
  if (services.filter((item) => item.id === serviceId).length !== 1) {
    throw new Error("Saved manifest does not uniquely own the transition service");
  }
  const saved = services.find((item) => item.id === serviceId)!;
  if (!Array.isArray(saved.environment)
    || saved.environment.filter((item: Entry) => item.name === transition.name).length !== 1
    || saved.environment.find((item: Entry) => item.name === transition.name)?.value !== transition.from) {
    throw new Error("Saved service environment does not match the recipe's initial value");
  }
  const candidate: SharedProjectCandidate = {
    manifest: structuredClone(state.manifest), units: structuredClone(state.units),
    selectionFingerprints: structuredClone(state.selectionFingerprints),
    settings: structuredClone(state.settings), projectDirectory: state.project.directory,
  };
  // This exact completed journal already owns the directory. The scoped render
  // must retain that ownership rather than treat an occupied project as new.
  candidate.manifest.project.ownership = "verified-existing";
  candidate.manifest.observed.project = { id: state.project.id,
    directory: state.project.directory, owner: state.project.owner };
  const target = candidate.manifest.services.find((item: Entry) => item.id === serviceId);
  if (transition.to === null) target.environment = target.environment.filter((item: Entry) => item.name !== transition.name);
  else target.environment.find((item: Entry) => item.name === transition.name).value = transition.to;
  const manifestHash = hash(candidate.manifest);
  const approvalHash = hash({ project: state.project, revision: state.revision,
    previousManifestHash: state.manifestHash, manifestHash, appId, serviceId,
    environment: transition });
  return { candidate, serviceId, manifestHash,
    approval: `TRANSITION:${appId}:${approvalHash}` };
}
