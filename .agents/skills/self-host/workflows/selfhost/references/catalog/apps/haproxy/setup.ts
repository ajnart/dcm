import { Buffer } from "node:buffer";
import { appliedStatus, setupRecord, type SetupAdapter, type SetupContext,
  type SetupInspectionContext, type SetupRecord } from "../../types/setup";
import { HAPROXY_CONFIG_PATH, type HaproxyConfigurationBinding } from "./configuration.ts";

const STATS_PATH = "/_auto-stack/stats";

export function checkedHaproxyBinding(value: unknown): HaproxyConfigurationBinding {
  const binding = setupRecord(value, "HAProxy reviewed configuration binding");
  if (Object.keys(binding).sort().join(",") !== "configSha256,configurationFingerprint,ownerFingerprint,statsBackendName,targetAppId,targetFingerprint,targetPort"
    || typeof binding.targetAppId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(binding.targetAppId)
    || binding.targetAppId === "haproxy" || binding.targetAppId.length > 47
    || !Number.isInteger(binding.targetPort) || (binding.targetPort as number) < 1 || (binding.targetPort as number) > 65535
    || ["configurationFingerprint", "ownerFingerprint", "targetFingerprint", "configSha256"]
      .some((key) => typeof binding[key] !== "string" || !/^[0-9a-f]{64}$/.test(binding[key] as string))
    || binding.statsBackendName !== `selected-${(binding.targetFingerprint as string).slice(0, 24)}`) {
    throw new Error("HAProxy reviewed configuration binding differs");
  }
  return binding as HaproxyConfigurationBinding;
}

/** Deliberately only authenticated statistics and selected TCP check readback.
 * UP does not prove an HTTP request reached the intended application.
 */
export function verifyHaproxyStats(csv: string, binding: HaproxyConfigurationBinding): void {
  if (Buffer.byteLength(csv) > 262144 || /[\r\0]/.test(csv)) throw new Error("HAProxy stats response is invalid");
  const lines = csv.trimEnd().split("\n");
  if (lines.length < 2 || lines.length > 512 || !lines[0]!.startsWith("# ")) {
    throw new Error("HAProxy stats CSV header is unavailable");
  }
  const columns = lines[0]!.slice(2).split(",");
  const px = columns.indexOf("pxname"), server = columns.indexOf("svname"), status = columns.indexOf("status");
  if (px < 0 || server < 0 || status < 0 || new Set(columns.filter(Boolean)).size !== columns.filter(Boolean).length) {
    throw new Error("HAProxy stats columns differ");
  }
  const rows = lines.slice(1).map((line) => line.split(","));
  if (rows.some((row) => row.length !== columns.length)) throw new Error("HAProxy stats rows differ");
  const matching = rows.filter((row) => row[px] === binding.statsBackendName && row[server] === binding.targetAppId);
  if (matching.length !== 1 || matching[0]![status] !== "UP") {
    throw new Error("HAProxy selected backend TCP healthcheck is not uniquely UP");
  }
}

export async function readHaproxyConfiguration(context: SetupInspectionContext,
  binding: HaproxyConfigurationBinding): Promise<SetupRecord> {
  checkedHaproxyBinding(binding);
  if (context.appId !== "haproxy") throw new Error("HAProxy setup app owner differs");
  appliedStatus(context, await context.status());
  const anonymous = await context.http.request({ method: "GET", path: STATS_PATH });
  if (anonymous.status !== 401) throw new Error("HAProxy statistics did not reject anonymous access");
  const password = await context.secrets.readAdminPassword();
  if (!password || password.length > 1024 || /[\r\n\0]/.test(password)) throw new Error("HAProxy saved statistics password is invalid");
  const authorization = `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;
  const authenticated = await context.http.request({ method: "GET", path: `${STATS_PATH};csv`,
    headers: { Authorization: authorization } });
  if (authenticated.status !== 200) throw new Error("HAProxy saved statistics administrator did not authenticate");
  verifyHaproxyStats(await authenticated.text(), binding);
  return { appId: "haproxy", projectRoot: context.projectRoot, stage: "private-stats-and-target-check-ready",
    ...binding, adminUsername: "admin", anonymousStatsDenied: true, authenticatedStatsVerified: true,
    selectedBackendTcpCheckVerified: true, forwardedTrafficVerified: false,
    restartPersistenceVerified: false, apiKeyCreated: false };
}

async function bindingFromOwner(context: Pick<SetupInspectionContext, "appId" | "projectRoot" | "status">) {
  const status = appliedStatus(context, await context.status());
  // The central generated-recipe owner must provide this persisted, approved
  // binding. Caller inputs or a newly guessed backend are not an alternative.
  if (status.derivedRecipe === undefined) return checkedHaproxyBinding(status.haproxyConfiguration);
  const derived = setupRecord(status.derivedRecipe, "HAProxy saved derived recipe metadata");
  if (Object.keys(derived).sort().join(",") !== "appId,bindingHash,configuration,configurationFilesVerified,input,recipeSha256,selectionFingerprint,sourceSha256"
    || derived.appId !== "haproxy"
    || derived.configurationFilesVerified !== true
    || status.ownerKind !== "shared" || status.selectionFingerprint !== derived.selectionFingerprint
    || ["bindingHash", "recipeSha256", "selectionFingerprint", "sourceSha256"]
      .some((key) => typeof derived[key] !== "string" || !/^[0-9a-f]{64}$/.test(derived[key] as string))) {
    throw new Error("HAProxy saved derived recipe metadata differs");
  }
  const input = setupRecord(derived.input, "HAProxy saved derived recipe input");
  const inputs = setupRecord(input.inputs, "HAProxy saved target input");
  const binding = checkedHaproxyBinding(derived.configuration);
  if (Object.keys(input).sort().join(",") !== "appId,inputs" || input.appId !== "haproxy"
    || Object.keys(inputs).join(",") !== "target-app-id" || inputs["target-app-id"] !== binding.targetAppId) {
    throw new Error("HAProxy saved target input differs from its reviewed configuration");
  }
  if (status.haproxyConfiguration !== undefined
    && JSON.stringify(checkedHaproxyBinding(status.haproxyConfiguration)) !== JSON.stringify(binding)) {
    throw new Error("HAProxy legacy and derived configuration bindings differ");
  }
  return binding;
}

const adapter: SetupAdapter = {
  appId: "haproxy", sharedOwner: true, credentialCommand: "app handoff",
  apiKey: "not-created", healthSource: "Authenticated HAProxy statistics and selected backend TCP check only", homarrIntegration: null,
  async firstRun(context: SetupContext) {
    const binding = await bindingFromOwner(context);
    const validated = await context.container.exec({ effect: "read",
      argv: ["haproxy", "-c", "-f", HAPROXY_CONFIG_PATH],
      approval: { action: "haproxy-validate-owned-config", progress: "Validate the reviewed HAProxy configuration in the exact owned container" } });
    if (validated.exitCode !== 0) throw new Error("HAProxy reviewed configuration did not validate");
    return { ...await readHaproxyConfiguration(context, binding), syntaxVerified: true };
  },
  async inspect(context) { return readHaproxyConfiguration(context, await bindingFromOwner(context)); },
  ready(record) {
    return record.appId === "haproxy" && record.stage === "private-stats-and-target-check-ready"
      && record.anonymousStatsDenied === true && record.authenticatedStatsVerified === true
      && record.selectedBackendTcpCheckVerified === true && record.forwardedTrafficVerified === false
      && record.apiKeyCreated === false;
  },
};

export default adapter;
