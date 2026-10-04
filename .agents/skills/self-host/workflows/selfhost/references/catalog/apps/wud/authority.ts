import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import type { SharedDerivedRecipeBinding } from "../../../../../../../../../packages/cli/src/lib/shared-derived-recipe.ts";
import { compileWudRecipe } from "./configuration.ts";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
function fail(): never { throw new Error("WUD separate pre-start remote Docker authority approval is missing or differs from its exact owner"); }
function exact(value: any, keys: string[]): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
function digest(value: unknown): boolean { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }
export function checkedWudInputs(value: unknown): Record<string, string> {
  if (!exact(value, ["docker-server-name", "docker-port", "watched-container-id"])
    && !exact(value, ["docker-authority-mode", "docker-server-name", "docker-port", "watched-container-id"])) fail();
  const inputs = value as Record<string, string>;
  if (inputs["docker-authority-mode"] !== undefined
    && !["docker-inventory-mtls", "docker-management-mtls"].includes(inputs["docker-authority-mode"]!)) fail();
  return inputs;
}

/** Pure, app-owned review. The shared owner must replay the binding against its
 * immutable source revision first; this does not load state or read TLS files. */
export function planWudAuthority(binding: SharedDerivedRecipeBinding) {
  if (!exact(binding, ["schemaVersion", "kind", "source", "derived", "selection", "selectionFingerprint", "bindingHash"])
    || binding.schemaVersion !== 1 || binding.kind !== "shared-derived-recipe-binding"
    || binding.derived?.input?.appId !== "wud" || binding.selection?.appId !== "wud"
    || !exact(binding.derived.input, ["appId", "inputs"])) fail();
  checkedWudInputs(binding.derived.input.inputs);
  const { bindingHash, ...record } = binding;
  const source = binding.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) fail();
  const { recordHash, ...sourceRecord } = source;
  const project = source.project;
  if (!project || ["id", "owner", "root", "directory", "dockerContext"].some((key) =>
    typeof project[key as keyof typeof project] !== "string")
    || project.owner !== project.id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project.id)
    || !/^[a-z0-9]+(?:[a-z0-9_.-]*[a-z0-9])?$/.test(project.dockerContext)
    || project.directory !== join(project.root, project.id) || resolve(project.root) !== project.root
    || !project.root.endsWith("/.selfhost/shared") || /[\x00-\x20\x7f]/.test(project.directory)
    || !Number.isSafeInteger(source.revision) || source.revision < 1
    || source.checkpoint?.phase !== "completed" || source.recordHash !== hash(sourceRecord)
    || source.manifestHash !== hash(source.manifest)
    || bindingHash !== hash(record) || binding.selectionFingerprint !== hash(binding.selection)
    || !digest(binding.derived.sourceSha256) || !digest(binding.derived.recipeSha256)) fail();
  for (const key of ["id", "owner", "root", "directory", "dockerContext"] as const) {
    if (source.manifest?.project?.[key] !== project[key]) fail();
  }
  const input = binding.derived.input.inputs;
  const expected = compileWudRecipe(input["docker-server-name"]!, input["docker-port"]!, input["watched-container-id"]!, input["docker-authority-mode"]);
  if (!same(binding.derived.recipe, expected.recipe) || !same(binding.selection.recipe, expected.recipe)
    || binding.derived.recipeSha256 !== hash(expected.recipe)
    || !same(binding.derived.configuration, expected.configuration)
    || !same(binding.derived.peerAppIds, [])) fail();
  const owner = { projectId: project.id, owner: project.owner, directory: project.directory,
    dockerContext: project.dockerContext, sourceRevision: source.revision, sourceRecordHash: source.recordHash };
  const tlsFiles = expected.configuration.privateFileIds.map((name) => ({ name,
    ref: `local/${project.id}/wud/${name}`, target: name,
    filePath: join(project.directory, "secrets", "wud", name), source: "owner" as const }));
  const review = { schemaVersion: 1 as const, kind: "wud-remote-docker-authority-plan" as const, appId: "wud" as const,
    owner, bindingHash, sourceSha256: binding.derived.sourceSha256, recipeSha256: binding.derived.recipeSha256,
    selectionFingerprint: binding.selectionFingerprint,
    authority: { kind: "remoteTLS" as const, serverName: expected.configuration.serverName,
      port: expected.configuration.port, watchedContainerId: expected.configuration.watchedContainerId,
      authorityFingerprint: expected.configuration.authorityFingerprint, tlsFiles },
    effects: { credentialAuthority: "remote-docker-api-access" as const,
      watchSelection: "only-containers-with-wud.watch=true" as const, watchSelectionIsAcl: false as const,
      endpointAclVerified: false as const, transportVerified: false as const,
      mutatingOperations: expected.configuration.mutatingOperations } };
  const planHash = hash(review);
  return { ...review, planHash, approval: `WUD-REMOTE-DOCKER:${project.id}:${planHash}` };
}

export type WudAuthorityPlan = ReturnType<typeof planWudAuthority>;
export type WudAuthorityClaim = {
  schemaVersion: 1;
  kind: "reviewed-pre-start-authority";
  appId: "wud";
  plan: WudAuthorityPlan;
  claimHash: string;
};

/** A matching separate token records credential-authority consent only. No
 * approved Boolean, credential input, endpoint ACL claim or network observation. */
export function approveWudAuthority(binding: SharedDerivedRecipeBinding, approval: string): WudAuthorityClaim {
  const plan = planWudAuthority(binding);
  if (approval !== plan.approval) fail();
  const record = { schemaVersion: 1 as const, kind: "reviewed-pre-start-authority" as const, appId: "wud" as const, plan };
  return { ...record, claimHash: hash(record) };
}

function checkedClaim(value: unknown): WudAuthorityClaim {
  const claim = value as WudAuthorityClaim;
  if (!exact(claim, ["schemaVersion", "kind", "appId", "plan", "claimHash"])
    || claim.schemaVersion !== 1 || claim.kind !== "reviewed-pre-start-authority" || claim.appId !== "wud") fail();
  const { claimHash, ...record } = claim;
  const plan = claim.plan;
  if (!exact(plan, ["schemaVersion", "kind", "appId", "owner", "bindingHash", "sourceSha256", "recipeSha256",
    "selectionFingerprint", "authority", "effects", "planHash", "approval"])
    || plan.schemaVersion !== 1 || plan.kind !== "wud-remote-docker-authority-plan" || plan.appId !== "wud"
    || !exact(plan.owner, ["projectId", "owner", "directory", "dockerContext", "sourceRevision", "sourceRecordHash"])
    || !exact(plan.authority, ["kind", "serverName", "port", "watchedContainerId", "authorityFingerprint", "tlsFiles"])
    || plan.authority.kind !== "remoteTLS" || !Array.isArray(plan.authority.tlsFiles)
    || plan.authority.tlsFiles.length !== 3
    || plan.authority.tlsFiles.some((file) => !exact(file, ["name", "ref", "target", "filePath", "source"]))
    || ![plan.bindingHash, plan.sourceSha256, plan.recipeSha256, plan.selectionFingerprint, plan.owner.sourceRecordHash].every(digest)) fail();
  const { planHash, approval, ...review } = plan;
  if (claimHash !== hash(record) || planHash !== hash(review)
    || approval !== `WUD-REMOTE-DOCKER:${plan.owner?.projectId}:${planHash}`) fail();
  return claim;
}

/** Replay immediately before every start/add/recreate, including resumed apply.
 * Only a durable owner record may reach this function; hashes are not signatures. */
export function assertWudAuthorityClaim(binding: SharedDerivedRecipeBinding, value: unknown): WudAuthorityClaim {
  const claim = checkedClaim(value);
  if (!same(claim.plan, planWudAuthority(binding))) fail();
  return structuredClone(claim);
}

/** Post-start inspection consumes the same owner-loaded claim, never inputs or
 * approved:true. Full binding replay remains mandatory at the state producer. */
export function assertWudAuthorityStatus(status: Record<string, any>, value: unknown): WudAuthorityClaim {
  const claim = checkedClaim(value);
  const derived = status.derivedRecipe;
  const plan = claim.plan;
  if (status.ownerKind !== "shared" || status.appId !== "wud" || !derived
    || status.projectId !== plan.owner.projectId || status.dockerContext !== plan.owner.dockerContext
    || status.privateFiles !== join(plan.owner.directory, "secrets", "wud")
    || dirname(dirname(status.privateFiles)) !== plan.owner.directory
    || ["bindingHash", "sourceSha256", "recipeSha256", "selectionFingerprint"].some((key) =>
      !digest(derived[key]) || derived[key] !== plan[key as keyof WudAuthorityPlan])
    || status.selectionFingerprint !== plan.selectionFingerprint) fail();
  const input = derived.input;
  if (!exact(input, ["appId", "inputs"]) || input.appId !== "wud") fail();
  checkedWudInputs(input.inputs);
  const expected = compileWudRecipe(input.inputs["docker-server-name"], input.inputs["docker-port"], input.inputs["watched-container-id"], input.inputs["docker-authority-mode"]);
  const authority = plan.authority;
  if (!same(derived.configuration, expected.configuration) || plan.recipeSha256 !== hash(expected.recipe)
    || authority.serverName !== expected.configuration.serverName || authority.port !== expected.configuration.port
    || authority.watchedContainerId !== expected.configuration.watchedContainerId
    || authority.authorityFingerprint !== expected.configuration.authorityFingerprint
    || !same(authority.tlsFiles, expected.configuration.privateFileIds.map((name) => ({ name,
      ref: `local/${plan.owner.projectId}/wud/${name}`, target: name,
      filePath: join(plan.owner.directory, "secrets", "wud", name), source: "owner" })))
    || !same(plan.effects, { credentialAuthority: "remote-docker-api-access",
      watchSelection: "only-containers-with-wud.watch=true", watchSelectionIsAcl: false,
      endpointAclVerified: false, transportVerified: false, mutatingOperations: expected.configuration.mutatingOperations })) fail();
  return structuredClone(claim);
}
