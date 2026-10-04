import { Buffer } from "node:buffer";
import { isAbsolute } from "node:path";

import {
  appliedStatus,
  type SetupAdapter,
  type SetupContext,
  type SetupInspectionContext,
  type SetupRecord,
} from "../../types/setup";

const APP_ID = "syncthing";

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Syncthing ${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function apiKey(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(value)) {
    throw new Error("Syncthing returned no valid private API key");
  }
  return value;
}

function basic(password: string): string {
  if (password.length < 32 || password.length > 1024 || /[\r\n\u0000]/.test(password)) {
    throw new Error("Syncthing has no valid saved administrator password");
  }
  return `Basic ${Buffer.from(`admin:${password}`, "utf8").toString("base64")}`;
}

type ReadContext = Pick<SetupInspectionContext, "appId" | "projectRoot" | "status" | "http" | "secrets">;

async function savedOwner(context: ReadContext): Promise<SetupRecord> {
  if (context.appId !== APP_ID) throw new Error("Syncthing setup received a different app ID");
  const status = appliedStatus(context, await context.status());
  if (status.username !== "admin" || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)) {
    throw new Error("Syncthing has no exact saved administrator credential");
  }
  return status;
}

async function config(context: ReadContext, key: string): Promise<Record<string, unknown>> {
  const response = await context.http.request({
    method: "GET", path: "/rest/config/gui", headers: { "X-API-Key": key },
  });
  if (response.status !== 200) throw new Error("Syncthing GUI configuration could not be verified");
  return record(await response.json(), "GUI configuration");
}

async function verify(context: ReadContext): Promise<SetupRecord> {
  const status = await savedOwner(context);
  const key = apiKey(await context.secrets.readApiKey());
  const password = await context.secrets.readAdminPassword();
  const gui = await config(context, key);
  if (gui.user !== "admin" || gui.sendBasicAuthPrompt !== true
    || typeof gui.password !== "string" || !/^\$2[aby]\$/.test(gui.password)) {
    throw new Error("Syncthing saved GUI authentication is not the reviewed administrator");
  }
  const unauthenticated = await context.http.request({ method: "GET", path: "/" });
  if (unauthenticated.status !== 401) {
    throw new Error("Syncthing GUI did not deny unauthenticated access");
  }
  const authenticated = await context.http.request({
    method: "GET", path: "/", headers: { Authorization: basic(password) },
  });
  if (authenticated.status !== 200) {
    throw new Error("Syncthing did not accept the saved administrator password");
  }
  return {
    appId: APP_ID,
    projectRoot: context.projectRoot,
    stage: "admin-and-key-verified",
    adminUsername: "admin",
    credentialRef: status.passwordFile,
    anonymousGuiDenied: true,
    apiKeyVerified: true,
    peerSyncVerified: false,
  };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  sharedOwner: true,
  async firstRun(context: SetupContext): Promise<SetupRecord> {
    await savedOwner(context);
    const versionResponse = await context.http.request({ method: "GET", path: "/rest/noauth/health" });
    if (versionResponse.status !== 200 || record(await versionResponse.json(), "health").status !== "OK") {
      throw new Error("Syncthing's private GUI is not healthy");
    }

    const saved = await context.secrets.readApiKey();
    const checkpoint = await context.checkpoint.read();
    if (checkpoint !== null && (checkpoint.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot
      || checkpoint.stage !== "admin-write-attempted" || !checkpoint.attemptedActions.includes("syncthing-set-admin"))) {
      throw new Error("Syncthing has an unexpected administrator checkpoint");
    }
    if (saved !== null && checkpoint !== null) return verify(context);
    if (saved === null && checkpoint !== null) {
      throw new Error("Syncthing attempted setup has no saved API key; inspect before retrying");
    }

    let key: string;
    if (saved !== null) {
      key = apiKey(saved);
    } else {
      // The official CLI uses the image's own config to authenticate against its live REST API.
      // The transport binds this command to the exact owned running container and redacts stdout.
      const extracted = await context.container.exec({
        effect: "read",
        argv: ["/bin/syncthing", "cli", "config", "gui", "apikey", "get"],
        approval: { action: "syncthing-read-own-api-key", progress: "Read only the exact owned Syncthing GUI API key." },
      });
      if (extracted.exitCode !== 0) throw new Error("Syncthing could not read its own API key");
      key = apiKey(extracted.stdout.trim());
    }
    const gui = await config(context, key);
    if (gui.user !== "" || gui.password !== "") {
      throw new Error("Syncthing already has GUI credentials; do not replace an existing administrator");
    }
    if (saved === null) await context.secrets.writeApiKey(key);

    const password = await context.secrets.readAdminPassword();
    basic(password);
    await context.http.request({
      method: "PATCH",
      path: "/rest/config/gui",
      headers: { "X-API-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ user: "admin", password, sendBasicAuthPrompt: true }),
      approval: { action: "syncthing-set-admin", progress: "Set the saved Syncthing administrator login.", once: true },
      beforeSendCheckpoint: { expectedRevision: null, stage: "admin-write-attempted" },
    });
    return verify(context);
  },
  inspect: verify,
  ready(status): boolean {
    return status.appId === APP_ID && status.stage === "admin-and-key-verified"
      && status.adminUsername === "admin" && status.anonymousGuiDenied === true
      && status.apiKeyVerified === true;
  },
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  healthSource: "https://docs.syncthing.net/rest/noauth-health-get.html",
  homarrIntegration: null,
};

export default adapter;
