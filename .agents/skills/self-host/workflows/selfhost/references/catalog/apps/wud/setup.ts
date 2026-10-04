import { Buffer } from "node:buffer";
import { appliedStatus, setupRecord, type SetupAdapter, type SetupInspectionContext } from "../../types/setup.ts";
import { compileWudRecipe, WUD_DOCKER_SOURCE } from "./configuration.ts";
import { checkedWudInputs } from "./authority.ts";
import { generatedPrivateFileLength } from "../../types/private-file.ts";

async function verify(context: SetupInspectionContext) {
  if (context.appId !== "wud") throw new Error("WUD app owner differs");
  const status = appliedStatus(context, await context.status());
  const derived = setupRecord(status.derivedRecipe, "WUD retained derived recipe");
  const input = setupRecord(derived.input, "WUD retained selection");
  const inputs = setupRecord(input.inputs, "WUD remote watcher choices");
  if (status.ownerKind !== "shared" || input.appId !== "wud" || derived.appId !== "wud"
    || Object.keys(input).sort().join(",") !== "appId,inputs"
    || ["bindingHash", "recipeSha256", "sourceSha256", "selectionFingerprint"].some((key) =>
      typeof derived[key] !== "string" || !/^[0-9a-f]{64}$/.test(derived[key] as string))
    || status.selectionFingerprint !== derived.selectionFingerprint) {
    throw new Error("WUD retained selection differs from its shared owner");
  }
  checkedWudInputs(inputs);
  const expected = compileWudRecipe(inputs["docker-server-name"] as string,
    inputs["docker-port"] as string, inputs["watched-container-id"] as string,
    inputs["docker-authority-mode"] as string | undefined).configuration;
  if (JSON.stringify(derived.configuration) !== JSON.stringify(expected)) {
    throw new Error("WUD retained remote watcher configuration differs");
  }
  // The authority owner replays the saved recipe and validates its driver's
  // branded result before exposing this no-argument callback across bundles.
  if (!context.observeContainerImage) throw new Error("WUD owner Docker image observation route is unavailable");
  const source = await context.observeContainerImage();
  const observedAt = Date.parse(source.observedAt);
  if (source.kind !== "docker-api-container-image-observation" || source.authorityMode !== "docker-management-mtls"
    || source.containerId !== expected.watchedContainerId || source.authorizationVerified !== false
    || !/^[0-9a-f]{64}$/.test(source.authorityFingerprint)
    || !/^sha256:[0-9a-f]{64}$/.test(source.imageId)
    || !Number.isFinite(observedAt) || observedAt > Date.now() || Date.now() - observedAt > 300000
    || inputs["docker-authority-mode"] !== source.authorityMode) {
    throw new Error("WUD owner Docker authority mode differs from its retained recipe");
  }
  const anonymous = await context.http.request({ method: "GET", path: "/api/containers" });
  if (anonymous.status !== 401) throw new Error("WUD inventory did not deny anonymous access");
  const password = await context.secrets.readAdminPassword();
  if (password.length !== generatedPrivateFileLength(48, "alphanumeric")
    || !/^[A-Za-z0-9]+$/.test(password)) throw new Error("WUD saved administrator password differs");
  const headers = { Authorization: `Basic ${Buffer.from(`admin:${password}`).toString("base64")}` };
  const identity = await context.http.request({ method: "GET", path: "/auth/user", headers });
  if (identity.status !== 200) throw new Error("WUD saved administrator did not authenticate");
  const user = setupRecord(await identity.json(), "WUD administrator readback");
  if (user.username !== "admin" || user.role !== "admin" || user.provider !== "local") {
    throw new Error("WUD administrator identity differs");
  }
  const response = await context.http.request({ method: "GET", path: "/api/containers", headers });
  if (response.status !== 200) throw new Error("WUD authenticated inventory unavailable");
  const containers = await response.json();
  if (!Array.isArray(containers) || containers.length !== 1) {
    throw new Error("WUD selected single-container watched scope differs or is not observed yet");
  }
  const container = setupRecord(containers[0], "WUD watched container");
  const image = setupRecord(container.image, "WUD watched image");
  if (container.id !== expected.watchedContainerId || container.watcher !== "approved"
    || container.error !== undefined || typeof image.id !== "string" || !/^sha256:[0-9a-f]{64}$/.test(image.id)
    || typeof image.name !== "string" || image.name.length === 0) {
    throw new Error("WUD authorized container image inventory differs");
  }
  if (image.id !== source.imageId) throw new Error("WUD selected image differs from the approved Docker engine readback");
  return { appId: "wud", projectRoot: context.projectRoot, stage: "ready-management-authority",
    authorityFingerprint: expected.authorityFingerprint, watchedContainerId: expected.watchedContainerId,
    observedImageId: image.id,
    adminUsername: "admin", anonymousInventoryDenied: true, administratorVerified: true,
    selectedInventoryObserved: true, dockerAuthorizationVerified: false,
    sourceImageVerified: true, dockerManagementConnectionVerified: true,
    authorityVerified: false, usableForApplicationSetup: true,
    currentScanVerified: false, restartPersistenceVerified: false, apiKeyCreated: false };
}

const adapter: SetupAdapter = {
  appId: "wud", sharedOwner: true, credentialCommand: "app handoff", apiKey: "not-created",
  healthSource: WUD_DOCKER_SOURCE, homarrIntegration: "What's Up Docker",
  firstRun: verify, inspect: verify,
  // Management consent never becomes a least-privilege or persistence claim.
  ready(record) {
    return record.stage === "ready-management-authority" && record.administratorVerified === true
      && record.anonymousInventoryDenied === true && record.selectedInventoryObserved === true
      && record.sourceImageVerified === true && record.dockerManagementConnectionVerified === true
      && record.dockerAuthorizationVerified === false && record.authorityVerified === false
      && record.usableForApplicationSetup === true;
  },
};
export default adapter;
