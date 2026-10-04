import { Buffer } from "node:buffer";

import {
  appliedStatus,
  type SetupAdapter,
  type SetupContext,
  type SetupInspectionContext,
  type SetupRecord,
} from "../../types/setup";

const APP_ID = "adguard-home";
const VERSION = "v0.107.79";

// API contract: https://raw.githubusercontent.com/AdguardTeam/AdGuardHome/v0.107.79/openapi/openapi.yaml
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

async function verifyAdmin(context: SetupInspectionContext): Promise<SetupRecord | null> {
  const password = await context.secrets.readAdminPassword();
  if (!password || /[\r\n\u0000]/.test(password)) throw new Error("AdGuard Home administrator credential is invalid");
  const authorization = `Basic ${Buffer.from(`admin:${password}`, "utf8").toString("base64")}`;
  let response;
  try {
    response = await context.http.request({
      method: "GET", path: "/control/status", headers: { Authorization: authorization },
    });
  } catch {
    return null;
  }
  if (response.status !== 200) return null;
  let status;
  try {
    status = record(await response.json(), "AdGuard Home status");
  } catch {
    return null;
  }
  if (status.version !== VERSION || status.http_port !== 3000
    || status.dns_port !== 53 || status.running !== true) return null;
  return {
    appId: APP_ID, projectRoot: context.projectRoot, stage: "admin-verified",
    credentialRef: "app handoff", dnsPublished: false,
  };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  credentialCommand: "app handoff",
  apiKey: "not-created",
  healthSource: null,
  homarrIntegration: "AdGuard Home",
  ready(value) {
    return value.appId === APP_ID && value.stage === "admin-verified" && value.dnsPublished === false;
  },
  async inspect(context) {
    const verified = await verifyAdmin(context);
    if (verified) return verified;
    return { appId: APP_ID, projectRoot: context.projectRoot, stage: "pending", dnsPublished: false };
  },
  async firstRun(context: SetupContext) {
    if (context.appId !== APP_ID) throw new Error("AdGuard Home setup received a different app ID");
    appliedStatus(context, await context.status());
    const inspected = await verifyAdmin(context);
    if (inspected) return inspected;

    const checkpoint = await context.checkpoint.read();
    if (checkpoint !== null) {
      throw new Error("AdGuard Home first-install request may have been sent; inspect the exact instance before retrying");
    }
    const addresses = await context.http.request({ method: "GET", path: "/control/install/get_addresses" });
    if (addresses.status !== 200) {
      throw new Error("AdGuard Home is not in its fresh first-install state; inspect before setup");
    }
    const info = record(await addresses.json(), "AdGuard Home install addresses");
    if (info.version !== VERSION) throw new Error("AdGuard Home image version differs from the pinned API contract");

    const password = await context.secrets.readAdminPassword();
    if (!password || /[\r\n\u0000]/.test(password)) throw new Error("AdGuard Home administrator credential is invalid");
    const body = JSON.stringify({
      dns: { ip: "0.0.0.0", port: 53 },
      web: { ip: "0.0.0.0", port: 3000 },
      username: "admin", password,
    });
    const response = await context.http.request({
      method: "POST", path: "/control/install/configure",
      headers: { "Content-Type": "application/json" }, body,
      approval: {
        action: "adguard-home-first-admin", progress: "Create private AdGuard Home administrator", once: true,
      },
      beforeSendCheckpoint: { expectedRevision: null, stage: "configure-attempted" },
    });
    if (response.status !== 200) throw new Error("AdGuard Home first-install configuration failed; inspect before retrying");
    const verified = await verifyAdmin(context);
    if (!verified) throw new Error("AdGuard Home admin login or configuration could not be verified");
    return verified;
  },
};

export default adapter;
