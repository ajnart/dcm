import { isAbsolute } from "node:path";
import { appliedStatus, setupRecord, type SetupAdapter, type SetupContext,
  type SetupInspectionContext, type SetupRecord } from "../../types/setup";
import { compileHeadscaleConfiguration } from "./config";

const APP_ID = "headscale";
const CREATE_ACTION = "headscale-create-api-key";
const KEY = /^hskey-api-[A-Za-z0-9_-]{12}-[A-Za-z0-9_-]{64}$/;

async function ownedConfiguration(context: SetupContext | SetupInspectionContext) {
  if (context.appId !== APP_ID) throw new Error("Headscale setup received a different app ID");
  const status = appliedStatus(context, await context.status());
  // Shared status replays the saved derived selection and verifies retained
  // generated files. The canonical identity does not prove a working TLS route.
  const derived = setupRecord(status.derivedRecipe, "Headscale saved derived recipe");
  const input = setupRecord(derived.input, "Headscale derived input");
  const inputs = setupRecord(input.inputs, "Headscale selected configuration inputs");
  const saved = setupRecord(derived.configuration, "Headscale pre-start configuration");
  if (status.ownerKind !== "shared" || derived.appId !== APP_ID || input.appId !== APP_ID
    || derived.configurationFilesVerified !== true
    || derived.selectionFingerprint !== status.selectionFingerprint
    || typeof derived.bindingHash !== "string" || !/^[0-9a-f]{64}$/.test(derived.bindingHash)
    || typeof derived.selectionFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(derived.selectionFingerprint)
    || inputs["canonical-origin"] !== saved.canonicalOrigin
    || inputs["magic-dns-domain"] !== saved.magicDnsDomain) {
    throw new Error("Headscale has no exact saved shared configuration binding");
  }
  if (typeof saved.canonicalOrigin !== "string" || typeof saved.magicDnsDomain !== "string") {
    throw new Error("Headscale has no approved canonical configuration");
  }
  const compiled = compileHeadscaleConfiguration(saved.canonicalOrigin, saved.magicDnsDomain);
  if (JSON.stringify(saved) !== JSON.stringify(compiled)) {
    throw new Error("Headscale retained configuration differs from its approved selection");
  }
  return { ...compiled, bindingHash: derived.bindingHash };
}

async function verifyKey(context: SetupContext | SetupInspectionContext, key: string,
  configuration: Awaited<ReturnType<typeof ownedConfiguration>>): Promise<SetupRecord> {
  if (!KEY.test(key)) throw new Error("Headscale saved API key has an invalid pinned format");
  const response = await context.http.request({ method: "GET", path: "/api/v1/apikey",
    headers: { Authorization: `Bearer ${key}` } });
  if (!response.ok || response.status !== 200) throw new Error("Headscale rejected the saved API key");
  const payload = setupRecord(await response.json(), "Headscale API key metadata");
  const prefix = `${key.slice(0, 22)}-***`;
  if (!Array.isArray(payload.apiKeys) || !payload.apiKeys.some((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return (value as Record<string, unknown>).prefix === prefix;
  })) throw new Error("Headscale did not read back the saved API key identity");
  const credentialRef = await context.secrets.apiKeyPath();
  if (!credentialRef || !isAbsolute(credentialRef)) throw new Error("Headscale API key has no private owner path");
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: "api-key-verified", credentialRef,
    configSha256: configuration.configSha256, selectionFingerprint: configuration.selectionFingerprint,
    bindingHash: configuration.bindingHash, canonicalOrigin: configuration.canonicalOrigin,
    adminUsername: null, adminPassword: null, canonicalTls: "pending",
    clientEnrollment: "pending", restartPersistence: "pending" };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  sharedOwner: true,
  credentialCommand: "app handoff", apiKey: "saved-by-onboarding",
  healthSource: "https://raw.githubusercontent.com/juanfont/headscale/v0.29.4/cmd/headscale/cli/health.go",
  homarrIntegration: null,
  ready(record) {
    return record.appId === APP_ID && record.stage === "api-key-verified" && record.adminUsername === null
      && record.adminPassword === null && record.canonicalTls === "pending"
      && typeof record.credentialRef === "string" && isAbsolute(record.credentialRef)
      && typeof record.configSha256 === "string" && /^[0-9a-f]{64}$/.test(record.configSha256)
      && typeof record.selectionFingerprint === "string" && /^[0-9a-f]{64}$/.test(record.selectionFingerprint)
      && typeof record.bindingHash === "string" && /^[0-9a-f]{64}$/.test(record.bindingHash);
  },
  async firstRun(context) {
    const configuration = await ownedConfiguration(context);
    let checkpoint = await context.checkpoint.read();
    if (checkpoint && (checkpoint.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot
      || checkpoint.data.selectionFingerprint !== configuration.selectionFingerprint
      || checkpoint.data.bindingHash !== configuration.bindingHash)) {
      throw new Error("Headscale setup checkpoint belongs to a different configuration or owner");
    }
    let key = await context.secrets.readApiKey();
    if (key) {
      if (!checkpoint || !checkpoint.attemptedActions.includes(CREATE_ACTION)) {
        throw new Error("Headscale API key has no owned creation checkpoint");
      }
      return verifyKey(context, key, configuration);
    }
    if (checkpoint?.attemptedActions.includes(CREATE_ACTION)) {
      throw new Error("Headscale API-key creation was attempted without a saved key; operator reconciliation is required");
    }
    const existing = await context.container.exec({ effect: "read", argv: ["/ko-app/headscale", "apikeys", "list", "--output", "json"],
      approval: { action: "headscale-inspect-api-keys", progress: "Inspect API-key metadata in the exact owned Headscale container" } });
    if (existing.exitCode !== 0) throw new Error("Headscale API-key inspection failed");
    let metadata: unknown;
    try { metadata = JSON.parse(existing.stdout); }
    catch { throw new Error("Headscale API-key inspection returned invalid metadata"); }
    if (!Array.isArray(metadata) || metadata.length !== 0) {
      throw new Error("Headscale has pre-existing API keys; reconcile ownership before creating one");
    }
    if (!checkpoint) checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: null, stage: "configuration-bound",
      data: { selectionFingerprint: configuration.selectionFingerprint, bindingHash: configuration.bindingHash } });
    const result = await context.container.exec({ effect: "write", argv: ["/ko-app/headscale", "apikeys", "create", "--expiration", "90d"],
      approval: { action: CREATE_ACTION, once: true, progress: "Create one private 90-day Headscale administrative API key" },
      beforeSendCheckpoint: { expectedRevision: checkpoint.revision, stage: "api-key-create-attempted",
        data: { selectionFingerprint: configuration.selectionFingerprint, bindingHash: configuration.bindingHash } } });
    if (result.exitCode !== 0) throw new Error("Headscale API-key creation has an unresolved outcome");
    key = result.stdout.replace(/\r?\n$/, "");
    if (!KEY.test(key)) throw new Error("Headscale API-key creation returned invalid private output; reconcile without replay");
    await context.secrets.writeApiKey(key);
    return verifyKey(context, key, configuration);
  },
  async inspect(context) {
    const configuration = await ownedConfiguration(context);
    const checkpoint = await context.checkpoint.read();
    const key = await context.secrets.readApiKey();
    if (!checkpoint || checkpoint.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot
      || checkpoint.data.selectionFingerprint !== configuration.selectionFingerprint
      || checkpoint.data.bindingHash !== configuration.bindingHash
      || !checkpoint.attemptedActions.includes(CREATE_ACTION) || !key) {
      throw new Error("Headscale has no owned saved API-key creation evidence");
    }
    return verifyKey(context, key, configuration);
  },
};

export default adapter;
