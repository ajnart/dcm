import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import type { SharedProjectState } from "./shared-project-state.ts";
import { loadSharedPrestartAuthoritySource, loadSharedProjectState } from "./shared-project-state.ts";
import { sharedPrestartContext, sharedPrestartContracts, assertSharedPrestartAuthority } from "./shared-prestart.ts";
import { readSharedHttpsPrivateFile } from "./shared-private-https-state.ts";
import { assertDockerApiAuthorityBinding, DockerApiAuthorityError, planDockerApiAuthority,
  type DockerApiAuthorityInput } from "./docker-api-authority.ts";
import { persistDockerApiAuthorityIntent, loadDockerApiAuthorityIntent,
  readDockerApiAuthorityRecord, saveDockerApiAuthorityRecord } from "./docker-api-authority-state.ts";
import { dockerApiAuthorityProbeApproval, probeDockerApiAuthority, requireDockerApiAuthorityForStart,
  observeDockerApiContainerImage, requestDockerApiIdentity, type DockerApiAuthorityObservation,
  type DockerApiContainerImageObservation } from "./docker-api-authority-probe.ts";

/** Supplied by the shared owner's replayed recipe/source, never by CLI JSON.
 * The source owner remains immutable across the controlled add journal. */
export type SharedDockerAuthorityBinding = {
  directory: string;
  owner: DockerApiAuthorityInput["owner"];
  consumer: DockerApiAuthorityInput["consumer"];
};
export type SharedDockerAuthorityFacilities = {
  /** Reload the shared journal, replay the source/recipe and executable contract. */
  revalidate(): Promise<void>;
  now?: () => number;
};
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function stale(): never { throw new DockerApiAuthorityError("stale-intent"); }
function assertBinding(input: DockerApiAuthorityInput, binding: SharedDockerAuthorityBinding): void {
  for (const key of ["projectId", "revision", "recordSha256", "manifestSha256"] as const) {
    if (input.owner[key] !== binding.owner[key]) stale();
  }
  assertDockerApiAuthorityBinding(input, binding.consumer);
}
function inputName(binding: SharedDockerAuthorityBinding): string {
  const { owner, consumer } = binding;
  return `docker-api-authority-${consumer.appId}-${hash({ owner: { projectId: owner.projectId,
    revision: owner.revision, recordSha256: owner.recordSha256, manifestSha256: owner.manifestSha256 },
  consumer: { appId: consumer.appId, recipeSha256: consumer.recipeSha256, setupSha256: consumer.setupSha256,
    images: [...consumer.images].sort((a, b) => a.serviceId.localeCompare(b.serviceId)) } })}-input.json`;
}

/** Explicit non-secret owner choices only. The caller cannot provide saved
 * journal hashes, recipe hashes, executable hashes, observations or readiness. */
export async function readSharedDockerAuthorityChoices(path: string,
  binding: SharedDockerAuthorityBinding, nowMs = Date.now()): Promise<DockerApiAuthorityInput> {
  if (!isAbsolute(path) || resolve(path) !== path) throw new DockerApiAuthorityError("invalid-input");
  try {
    const value = JSON.parse((await readSharedHttpsPrivateFile(path, 16384)).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join(",") !== ["schemaVersion", "id", "mode", "endpoint", "identities",
        "credentialRefs", "expectedAuthorizationPolicySha256", "expiresAt"].sort().join(",")) {
      throw new DockerApiAuthorityError("invalid-input");
    }
    return planSharedDockerAuthority(binding, { ...value, owner: binding.owner,
      consumer: binding.consumer }, nowMs).input;
  } catch { throw new DockerApiAuthorityError("invalid-input"); }
}

/** Read-only review. An intent token cannot authorize the live mTLS probe. */
export function planSharedDockerAuthority(binding: SharedDockerAuthorityBinding,
  input: DockerApiAuthorityInput, nowMs = Date.now()) {
  const plan = planDockerApiAuthority(input, nowMs);
  assertBinding(plan.input, binding);
  return { ...plan, probeApproval: dockerApiAuthorityProbeApproval(plan.input, nowMs),
    credentialFilesRead: false, networkRequest: false, applicationSetupReady: false };
}

/** Called under the shared mutation lock after exact owner replay. Immutable
 * non-secret selection is retained only alongside separately approved intent.
 * Changed selections are not silently replaced; partial artifacts fail closed. */
export async function applySharedDockerAuthority(binding: SharedDockerAuthorityBinding,
  input: DockerApiAuthorityInput, approval: string, facilities: SharedDockerAuthorityFacilities) {
  const now = facilities.now ?? Date.now;
  const review = planSharedDockerAuthority(binding, input, now());
  if (approval !== review.approval) throw new DockerApiAuthorityError("approval-required");
  await facilities.revalidate();
  const existing = await readDockerApiAuthorityRecord(binding.directory, binding.owner.projectId, inputName(binding));
  if (existing && JSON.stringify(existing) !== JSON.stringify(review.input)) stale();
  const intent = await persistDockerApiAuthorityIntent(binding.directory, review.input, approval, now());
  await facilities.revalidate();
  await saveDockerApiAuthorityRecord(binding.directory, binding.owner.projectId, inputName(binding), review.input);
  return { intent, input: await loadSharedDockerAuthorityInput(binding, now()),
    probeApproval: dockerApiAuthorityProbeApproval(review.input, now()), applicationSetupReady: false };
}

/** Never discovers targets from observations or accepts caller status as evidence. */
export async function loadSharedDockerAuthorityInput(binding: SharedDockerAuthorityBinding,
  nowMs = Date.now()): Promise<DockerApiAuthorityInput> {
  const value = await readDockerApiAuthorityRecord(binding.directory, binding.owner.projectId, inputName(binding));
  if (!value) throw new DockerApiAuthorityError("missing-intent");
  // Validate the retained payload at a time inside its original lifetime before
  // distinguishing expiry from malformed or altered intent records.
  const expiresAt = Date.parse((value as DockerApiAuthorityInput).expiresAt);
  if (Number.isFinite(expiresAt) && expiresAt <= nowMs) {
    const expired = planDockerApiAuthority(value as DockerApiAuthorityInput, expiresAt - 1).input;
    assertBinding(expired, binding);
    await loadDockerApiAuthorityIntent(binding.directory, expired, expiresAt - 1);
    throw new DockerApiAuthorityError("expired-intent");
  }
  const input = planDockerApiAuthority(value as DockerApiAuthorityInput, nowMs).input;
  assertBinding(input, binding);
  await loadDockerApiAuthorityIntent(binding.directory, input, nowMs);
  return input;
}

/** No credentials are read and no network request is sent without the exact
 * separate probe approval and a persisted, owner-bound intent. */
export async function probeSharedDockerAuthority(binding: SharedDockerAuthorityBinding,
  approval: string, facilities: SharedDockerAuthorityFacilities & {
    transport?: Parameters<typeof probeDockerApiAuthority>[3]["transport"];
  }): Promise<DockerApiAuthorityObservation> {
  const now = facilities.now ?? Date.now;
  await facilities.revalidate();
  const input = await loadSharedDockerAuthorityInput(binding, now());
  return probeDockerApiAuthority(binding.directory, input, approval, {
    ...facilities,
    async revalidate() {
      await facilities.revalidate();
      const current = await loadSharedDockerAuthorityInput(binding, now());
      if (JSON.stringify(current) !== JSON.stringify(input)) stale();
    },
  });
}

/** Management-only connection proof. Consent alone and inventory mTLS without
 * trusted deny-write policy proof remain unusable for start/setup. */
export async function requireBoundSharedDockerAuthorityForStart(binding: SharedDockerAuthorityBinding,
  facilities: SharedDockerAuthorityFacilities & { transport?: typeof requestDockerApiIdentity }): Promise<DockerApiAuthorityObservation> {
  const now = facilities.now ?? Date.now;
  await facilities.revalidate();
  const input = await loadSharedDockerAuthorityInput(binding, now());
  const observation = await requireDockerApiAuthorityForStart(binding.directory, input, now());
  await facilities.revalidate();
  const current = await (facilities.transport ?? requestDockerApiIdentity)(binding.directory, input, facilities.revalidate);
  if (current.httpStatus !== 200 || current.engineId !== input.endpoint.expectedEngineId
    || current.peerCertificateSha256 !== input.identities.peerCertificateSha256) throw new DockerApiAuthorityError("probe-failed");
  await facilities.revalidate();
  if (JSON.stringify(await loadSharedDockerAuthorityInput(binding, now())) !== JSON.stringify(input)) stale();
  return observation;
}

/** The immutable prepared introduction is authority's source; the current
 * journal remains the mutation/revalidation boundary. App-changing transitions
 * cannot inherit an old image/recipe authority binding. */
export async function sharedUnitDockerAuthorityBinding(state: SharedProjectState, appId: string): Promise<SharedDockerAuthorityBinding> {
  const context = await sharedPrestartContext(state, appId);
  if (!context.derived || state.checkpoint.phase === "inspect-required") stale();
  const source = await loadSharedPrestartAuthoritySource(state, appId);
  const contract = sharedPrestartContracts(state.manifest, state.units[appId]).find((row) => row.appId === appId);
  if (!contract) stale();
  const images = state.units[appId]!.map((serviceId) => {
    const service = state.manifest.services.find((row: Record<string, any>) => row.id === serviceId);
    if (!service || typeof service.image !== "string") stale();
    return { serviceId, image: service.image as string };
  }).sort((a, b) => a.serviceId.localeCompare(b.serviceId));
  return { directory: state.project.directory,
    owner: { projectId: source.project.id, revision: source.revision, recordSha256: source.recordHash,
      manifestSha256: source.manifestHash },
    consumer: { appId, recipeSha256: context.derived.derived.recipeSha256,
      setupSha256: contract.sourceSha256, images } };
}
export async function assertSharedUnitDockerAuthorityInput(state: SharedProjectState, appId: string,
  input: DockerApiAuthorityInput): Promise<void> {
  const binding = await sharedUnitDockerAuthorityBinding(state, appId);
  assertBinding(input, binding);
  await assertSharedPrestartAuthority(state, appId, input);
}
export async function requireSharedDockerAuthorityForStart(state: SharedProjectState, appId: string,
  revalidate: () => Promise<void>): Promise<DockerApiAuthorityObservation> {
  const binding = await sharedUnitDockerAuthorityBinding(state, appId);
  const input = await loadSharedDockerAuthorityInput(binding);
  await assertSharedUnitDockerAuthorityInput(state, appId, input);
  return requireBoundSharedDockerAuthorityForStart(binding, { async revalidate() {
    await revalidate();
    const current = await loadSharedProjectState(state.project.directory, state.project.id);
    if (!current || current.recordHash !== state.recordHash
      || JSON.stringify(await sharedUnitDockerAuthorityBinding(current, appId)) !== JSON.stringify(binding)) stale();
  } });
}
/** Code-owned no-argument setup observation producer. The selected identifier
 * comes from the replayed derived app recipe, not caller status or adapter JSON. */
export async function sharedUnitObserveContainerImage(state: SharedProjectState, appId: string): Promise<DockerApiContainerImageObservation> {
  const context = await sharedPrestartContext(state, appId);
  const binding = await sharedUnitDockerAuthorityBinding(state, appId);
  const selected = context.derived?.derived.configuration.watchedContainerId;
  if (typeof selected !== "string" || !/^[0-9a-f]{64}$/.test(selected)) stale();
  const input = await loadSharedDockerAuthorityInput(binding);
  await assertSharedUnitDockerAuthorityInput(state, appId, input);
  return observeSharedDockerContainerImage(binding, selected, { async revalidate() {
    await context.revalidate();
    if (JSON.stringify(await sharedUnitDockerAuthorityBinding(state, appId)) !== JSON.stringify(binding)) stale();
  } });
}

/** The setup context owns this callback. Its selected ID is recipe-derived;
 * adapters cannot select another target or submit serialized Docker evidence. */
export async function observeSharedDockerContainerImage(binding: SharedDockerAuthorityBinding,
  selectedContainerId: string, facilities: SharedDockerAuthorityFacilities & {
    transport?: Parameters<typeof observeDockerApiContainerImage>[3]["transport"];
  }): Promise<DockerApiContainerImageObservation> {
  const now = facilities.now ?? Date.now;
  await facilities.revalidate();
  const input = await loadSharedDockerAuthorityInput(binding, now());
  return observeDockerApiContainerImage(binding.directory, input, selectedContainerId, {
    ...facilities,
    async revalidate() {
      await facilities.revalidate();
      const current = await loadSharedDockerAuthorityInput(binding, now());
      if (JSON.stringify(current) !== JSON.stringify(input)) stale();
    },
  });
}
