import { isAbsolute } from "node:path";
import { appliedStatus, setupRecord, type SetupAdapter, type SetupContext } from "../../types/setup.ts";

const APP_ID = "zerotier";
const VERSION = "1.14.2";
const STAGE = "native-identity-and-api-verified";

async function nativeGet(context: SetupContext, path: "/status" | "/network" | "/controller/network", token?: string) {
  const argv = ["curl", "--silent", "--show-error", "--max-time", "8", "--noproxy", "*",
    "--write-out", "%{http_code}", "--config", "-", `http://127.0.0.1:9993${path}`];
  let stdin = "request = GET\n";
  if (token !== undefined) stdin += `header = "X-ZT1-Auth: ${token}"\n`;
  const result = await context.container.exec({ effect: "read", argv, stdin,
    privateFileRefs: ["service-api-token"],
    approval: { action: "zerotier-native-api-read",
      progress: "Read the exact container-local ZeroTier identity, membership or controller inventory without joining networks" } });
  if (result.exitCode !== 0 || !/\d{3}$/.test(result.stdout)) {
    throw new Error("ZeroTier native API read did not complete");
  }
  const status = Number(result.stdout.slice(-3));
  const body = result.stdout.slice(0, -3);
  if (status === 401) return { status, value: null };
  if (status !== 200) throw new Error("ZeroTier native API returned an unexpected status");
  let value: unknown;
  try { value = JSON.parse(body); }
  catch { throw new Error("ZeroTier native API returned invalid JSON"); }
  return { status, value };
}

const adapter: SetupAdapter = {
  appId: APP_ID, sharedOwner: true, credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding", homarrIntegration: null,
  healthSource: "Authenticated native /status and /controller/network inside the exact container; not network enrollment or peer routing",
  ready(record) {
    return record.appId === APP_ID && record.stage === STAGE
      && record.nativeApiVerified === true && record.controllerApiVerified === true
      && record.enrollmentVerified === false && record.peerReachabilityVerified === false
      && record.hostRoutingVerified === false && record.restartIdentityVerified === false
      && typeof record.apiKeyFile === "string" && isAbsolute(record.apiKeyFile);
  },
  async firstRun(context) {
    if (context.appId !== APP_ID || !isAbsolute(context.projectRoot)) {
      throw new Error("ZeroTier setup received a different project");
    }
    const owner = appliedStatus(context, await context.status());
    if (owner.ownerKind !== "shared" || owner.daemon !== true || owner.port !== null || owner.url !== null
      || owner.username !== null || owner.passwordFile !== null || owner.loginVia !== "api-token") {
      throw new Error("ZeroTier requires an exact portless shared daemon owner without a fabricated administrator");
    }
    const token = await context.secrets.readGeneratedApiToken();
    if (!/^[A-Za-z0-9]{32,128}$/.test(token)) throw new Error("ZeroTier saved native API token is invalid");
    const saved = await context.secrets.readApiKey();
    if (saved !== null && saved !== token) throw new Error("ZeroTier native token differs from the saved credential; inspect without replacement");
    for (const path of ["/status", "/controller/network"] as const) {
      if ((await nativeGet(context, path)).status !== 401) {
        throw new Error("ZeroTier accepted anonymous service or controller management");
      }
    }
    const node = setupRecord((await nativeGet(context, "/status", token)).value, "ZeroTier native status");
    if (node.version !== VERSION || typeof node.address !== "string" || !/^[0-9a-f]{10}$/.test(node.address)
      || typeof node.publicIdentity !== "string" || !node.publicIdentity.startsWith(`${node.address}:0:`)
      || typeof node.online !== "boolean") {
      throw new Error("ZeroTier native node identity or pinned version is invalid");
    }
    const checkpoint = await context.checkpoint.read();
    if (checkpoint && (checkpoint.stage !== STAGE || checkpoint.data.nodeAddress !== node.address
      || checkpoint.data.publicIdentity !== node.publicIdentity)) {
      throw new Error("ZeroTier node identity differs from its saved owner; do not reset or re-enroll");
    }
    const apiKeyFile = await context.secrets.writeApiKey(token);
    if (!checkpoint) await context.checkpoint.compareAndSet({ expectedRevision: null, stage: STAGE,
      data: { nodeAddress: node.address, publicIdentity: node.publicIdentity } });
    for (const path of ["/network", "/controller/network"] as const) {
      const inventory = (await nativeGet(context, path, token)).value;
      if (!Array.isArray(inventory) || inventory.length !== 0) {
        throw new Error("ZeroTier has existing memberships or controlled networks outside this bootstrap; review enrollment ownership");
      }
    }
    return { appId: APP_ID, projectRoot: context.projectRoot, stage: STAGE,
      nodeAddress: node.address, publicIdentity: node.publicIdentity, version: VERSION,
      nativeApiVerified: true, controllerApiVerified: true, apiKeyFile,
      overlayOnline: node.online, enrollmentStatus: "pending", enrollmentVerified: false,
      peerReachabilityVerified: false, hostRoutingVerified: false, restartIdentityVerified: false };
  },
};

export default adapter;
