import { createHash, X509Certificate } from "node:crypto";
import { join } from "node:path";
import { HomarrAttachClient } from "../homarr-attach.ts";
import { withSharedProjectMutationLock } from "./batch-mutation-lock.ts";
import { loadSharedProjectState } from "./shared-project-state.ts";
import { resolveSharedHttpsTarget, readSharedHttpsTargetCa } from "./shared-https-target.ts";
import { loadSharedPrivateHttpsTransportProof, validateSharedPrivateHttpsTransportProof,
  loadSharedPrivateHttpsBinding, readSharedHttpsPrivateFile,
  writeSharedHttpsPrivateFile } from "./shared-private-https-state.ts";
import { sharedUnitRecipeCheck, sharedUnitSecretHandoff } from "./shared-unit-setup.ts";
import { resolveSharedAppMetadata } from "./resolved-app.ts";
import { setupContractSha256 } from "./setup-contract.ts";

type Entry = Record<string, any>;
type Dependencies = {
  recipeFor: Parameters<typeof sharedUnitSecretHandoff>[3];
  approvalFor: Parameters<typeof sharedUnitSecretHandoff>[4];
  appFor(appId: string): Entry;
};
type CertificateMetadata = { fileName: string; sha256: string; fingerprint256: string;
  ca: true; validFrom: string; validTo: string };
function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function fail(message: string): never { throw new Error(`Shared Homarr trust: ${message}`); }
function metadata(value: unknown): CertificateMetadata {
  const item = value as CertificateMetadata;
  if (!item || typeof item !== "object" || Array.isArray(item)
    || Object.keys(item).sort().join(",") !== "ca,fileName,fingerprint256,sha256,validFrom,validTo"
    || typeof item.fileName !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256)
    || !/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(item.fingerprint256)
    || item.ca !== true || typeof item.validFrom !== "string" || typeof item.validTo !== "string"
    || !Number.isFinite(Date.parse(item.validFrom)) || !Number.isFinite(Date.parse(item.validTo))) {
    fail("certificate API metadata differs from the bounded contract");
  }
  return { fileName: item.fileName, sha256: item.sha256, fingerprint256: item.fingerprint256,
    ca: true, validFrom: item.validFrom, validTo: item.validTo };
}

/** Add only this owner's verified exported root. No arbitrary path, key rotation,
 * Compose edit, restart, client trust change or integration acceptance. */
export async function sharedHomarrTrust(root: string, projectId: string, appId: string,
  approval: string | null, dependencies: Dependencies): Promise<Entry> {
  async function inspect() {
    const directory = join(root, ".selfhost", "shared", projectId);
    const state = await loadSharedProjectState(directory, projectId);
    if (!state || state.project.directory !== directory || state.project.root !== join(root, ".selfhost", "shared")
      || state.checkpoint.phase !== "completed" || !state.units.homarr || !state.units[appId]) {
      fail("requires completed saved Homarr and HTTPS target units");
    }
    if (sharedUnitRecipeCheck(state, "homarr", dependencies.recipeFor) !== "matches-saved-selection") {
      fail("Homarr recipe differs from its saved owner; inspect separately");
    }
    const target = await resolveSharedHttpsTarget(state, dependencies.recipeFor("caddy").recipe, appId);
    const binding = await loadSharedPrivateHttpsBinding(directory, dependencies.recipeFor("caddy").recipe);
    const proof = await loadSharedPrivateHttpsTransportProof(directory, state.recordHash);
    await validateSharedPrivateHttpsTransportProof(directory, proof);
    const routeProofs = proof.proofs.filter((item) => item.appId === appId);
    if (proof.projectId !== projectId || proof.bindingHash !== target.bindingHash
      || proof.caSha256 !== target.caSha256 || routeProofs.length !== 1
      || routeProofs[0]!.verified !== true || routeProofs[0]!.url !== target.origin
      || routeProofs[0]!.hostname !== target.hostname || routeProofs[0]!.method !== "curl-cacert-resolve"
      || !Number.isInteger(routeProofs[0]!.httpStatus) || routeProofs[0]!.httpStatus! < 100
      || routeProofs[0]!.httpStatus! > 599 || !Number.isFinite(Date.parse(routeProofs[0]!.verifiedAt))) {
      fail("requires current exact-owner CA and selected route transport proof");
    }
    const certificate = await readSharedHttpsTargetCa(target);
    const parsed = new X509Certificate(certificate);
    const fileName = `selfhost-${projectId}-${target.caSha256.slice(0, 16)}.crt`;
    const desired: CertificateMetadata = { fileName, sha256: target.caSha256,
      fingerprint256: parsed.fingerprint256, ca: true,
      validFrom: new Date(parsed.validFrom).toISOString(), validTo: new Date(parsed.validTo).toISOString() };
    const services = state.manifest.services.filter((item: Entry) => item.id === "homarr");
    if (services.length !== 1) fail("saved Homarr frontend is ambiguous");
    const caddy = state.manifest.services.filter((item: Entry) => item.id === "caddy");
    const aliasBound = binding.caddyRouteAliases === "owner-front-v1" && caddy.length === 1
      && caddy[0]!.networks.includes("front") && services[0]!.networks.includes("front")
      && caddy[0]!.networkAliases?.some((item: Entry) => item.network === "front" && item.alias === target.hostname);
    const homarr = resolveSharedAppMetadata("homarr", dependencies.appFor("homarr"),
      dependencies.recipeFor("homarr").recipe, services[0]);
    if (!homarr.browserUrl) fail("saved Homarr frontend is unavailable");
    const owner = await sharedUnitSecretHandoff(root, projectId, "homarr",
      dependencies.recipeFor, dependencies.approvalFor);
    if (typeof owner.apiKey !== "string" || !owner.apiKey) fail("complete the saved Homarr API-key checkpoint first");
    const client = new HomarrAttachClient(homarr.browserUrl, owner.apiKey);
    const identity = { schemaVersion: 1, projectId, ownerRevision: state.revision,
      ownerRecordHash: state.recordHash, manifestHash: state.manifestHash,
      target, transportProofSha256: hash(proof), certificate: desired,
      homarrOrigin: homarr.browserUrl, homarrKeyFingerprint: hash(owner.apiKey),
      executableContractSha256: await setupContractSha256("homarr", Object.keys(state.units)) };
    const attemptName = `private-homarr-trust-attempt-${hash([projectId, target.caSha256])}.json`;
    const attemptPath = join(directory, attemptName);
    let attempt: Entry | null = null;
    try { attempt = JSON.parse((await readSharedHttpsPrivateFile(attemptPath, 65536)).toString("utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") fail("saved trust attempt requires private inspection");
    }
    if (attempt && (Object.keys(attempt).sort().join(",") !== "identity,kind,reviewSha256,schemaVersion"
      || attempt.schemaVersion !== 1 || attempt.kind !== "shared-homarr-trust-attempt"
      || !attempt.identity || typeof attempt.identity !== "object" || Array.isArray(attempt.identity)
      || Object.keys(attempt.identity).sort().join(",") !== Object.keys(identity).sort().join(",")
      || attempt.identity.schemaVersion !== 1 || attempt.identity.projectId !== projectId
      || attempt.identity.target?.projectId !== projectId
      || attempt.identity.target?.caSha256 !== target.caSha256
      || hash(metadata(attempt.identity.certificate)) !== hash(desired)
      || attempt.reviewSha256 !== hash({ identity: attempt.identity, existing: null }))) {
      fail("prior trust checkpoint is invalid or differs from this project and CA; inspect without replay");
    }
    // Source/key/owner drift must forbid writes, but cannot forbid a fresh,
    // authenticated readback of the independently validated unchanged root.
    const staleAttempt = attempt !== null && hash(attempt.identity) !== hash(identity);
    let existing: CertificateMetadata | null;
    try {
      const response = await client.query("certificates.getCertificate", { fileName });
      existing = null;
      if (response !== null) existing = metadata(response);
    } catch (error) {
      let status = "blocked-certificate-api";
      if (error instanceof Error && /HTTP (404|405);/.test(error.message)) status = "unsupported-certificate-api";
      return { blocked: { status, projectId, appId, ownerRecordHash: state.recordHash,
        manifestHash: state.manifestHash, approval: null, mutation: false,
        detail: "The saved Homarr image did not provide the required authenticated certificate read API; trust remains unverified.",
        requiredApi: ["certificates.getCertificate", "certificates.ensureRootCertificate"],
        certificate: desired, staleAttempt, acceptanceVerified: false } };
    }
    if (existing && hash(existing) !== hash(desired)) fail("deterministic certificate name is occupied by different metadata; no overwrite is allowed");
    let token: string | null = null;
    let status = "certificate-readback-verified";
    if (!existing) {
      status = "planned";
      token = `SHARED-HOMARR-TRUST:${projectId}:${hash({ identity, existing })}`;
      if (attempt) {
        status = "uncertain-trust-attempt-inspect-required";
        if (staleAttempt) status = "stale-trust-attempt-inspect-required";
        token = null;
      }
    }
    const report = { status, projectId, appId, mutation: false, approval: token,
      certificate: desired, existingCertificate: existing, ownerRecordHash: state.recordHash,
      manifestHash: state.manifestHash, homarrOrigin: homarr.browserUrl,
      ...(attempt && { attemptPath }), staleAttempt, trustStoreReadbackVerified: existing !== null,
      effects: ["Explicitly widens TLS trust across Homarr server requests to certificates issued by this same-owner root CA; host and client trust stores remain unchanged"],
      containerRouteBinding: "unsupported-alias-free-route",
      ...(aliasBound && { containerRouteBinding: "source-bound-route-unverified" }),
      homarrTlsConnectivityVerified: false,
      clientTrustVerified: false, integrationAcceptanceVerified: false, acceptanceVerified: false };
    return { report, token, identity, directory, attemptName, attempt, client, certificate, desired, existing };
  }
  const initial = await inspect();
  if (initial.blocked) return initial.blocked;
  if (!approval) return initial.report!;
  return withSharedProjectMutationLock(root, projectId, [], async () => {
    const fresh = await inspect();
    if (fresh.blocked) return fresh.blocked;
    // Matching existing certificate is a direct readback-only no-op, including
    // reconciliation after a request whose outcome was lost. Never resend it.
    if (fresh.existing) return { ...fresh.report, reconciled: fresh.attempt !== null };
    if (!fresh.token || approval !== fresh.token) fail("approval is stale or prior write uncertain; re-plan and inspect before writes");
    const attemptPath = await writeSharedHttpsPrivateFile(fresh.directory!, fresh.attemptName!,
      Buffer.from(JSON.stringify({ schemaVersion: 1, kind: "shared-homarr-trust-attempt",
        identity: fresh.identity, reviewSha256: hash({ identity: fresh.identity, existing: null }) }) + "\n"));
    // The owner lock spans a final reconstruction, immutable checkpoint and one
    // mutation. Local state/CA/key/source changes must invalidate this attempt.
    const checked = await inspect();
    if (checked.blocked || hash(checked.identity) !== hash(fresh.identity) || checked.existing) {
      fail("trust review changed after checkpoint; inspect the retained attempt without replay");
    }
    try {
      const result = await fresh.client!.mutate("certificates.ensureRootCertificate",
        { fileName: fresh.desired!.fileName, certificate: fresh.certificate!.toString("utf8") }) as Entry;
      if (!result || Object.keys(result).sort().join(",") !== "certificate,created"
        || typeof result.created !== "boolean" || hash(metadata(result.certificate)) !== hash(fresh.desired)) {
        fail("certificate mutation returned invalid metadata");
      }
      const readback = metadata(await fresh.client!.query("certificates.getCertificate", { fileName: fresh.desired!.fileName }));
      if (hash(readback) !== hash(fresh.desired)) fail("certificate readback differs");
      const completed = await inspect();
      if (completed.blocked || hash(completed.identity) !== hash(fresh.identity)
        || hash(completed.existing) !== hash(fresh.desired)) fail("owner or certificate changed during readback");
      return { ...fresh.report, status: "certificate-readback-verified", mutation: result.created,
        approval: null, existingCertificate: readback, trustStoreReadbackVerified: true, attemptPath };
    } catch (error) {
      if (error instanceof Error && /Homarr certificates\.ensureRootCertificate: HTTP (404|405);/.test(error.message)) {
        return { ...fresh.report, status: "unsupported-certificate-api", mutation: false,
          approval: null, trustStoreReadbackVerified: false, attemptPath,
          requiredApi: "certificates.ensureRootCertificate",
          detail: "The saved Homarr image rejected the required certificate mutation endpoint. The attempt remains retained; no trust or retry is approved." };
      }
      return { ...fresh.report, status: "uncertain-trust-attempt-inspect-required", mutation: true,
        approval: null, trustStoreReadbackVerified: false, attemptPath,
        detail: "Certificate mutation may have been accepted. Re-plan for read-only reconciliation; an absent certificate is not automatically retried." };
    }
  });
}
