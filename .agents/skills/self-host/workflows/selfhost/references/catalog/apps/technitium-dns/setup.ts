import { join } from "node:path";
import { appliedStatus, setupRecord, type SetupAdapter, type SetupContext, type SetupRecord } from "../../types/setup";

const APP_ID = "technitium-dns";
const TOKEN_NAME = "Auto-Stack owner administration";
const CREATE_ACTION = "technitium-create-owner-api-token";

// v15.5.1 (4323993c2dd6cbe828d2fd3b239c401a526f58fc): DnsWebService.cs
// maps admin/sessions/createToken to GET+POST; Extensions.cs reads form data;
// WebServiceAuthApi.CreateApiToken persists ApiToken sessions and returns the new token.
// This is an explicitly reviewed admin-privilege token, not a least-privilege integration key.
// https://github.com/TechnitiumSoftware/DnsServer/tree/v15.5.1

async function verifyAdmin(context: SetupContext): Promise<string> {
  const password = await context.secrets.readAdminPassword();
  // 48 bytes of entropy require 65 base-62 characters in the shared generator.
  if (!/^[A-Za-z0-9]{65}$/.test(password)) {
    throw new Error("Technitium has no valid generated administrator password");
  }

  const login = await context.http.request({
    method: "POST",
    path: "/api/user/login",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ user: "admin", pass: password }).toString(),
    approval: { action: "technitium-admin-login", progress: "Verify the saved Technitium administrator password privately" },
  });
  if (!login.ok || login.status !== 200) throw new Error("Technitium rejected the saved administrator password");
  const payload = await login.json();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Technitium returned an invalid login response");
  const auth = payload as Record<string, unknown>;
  if (auth.status !== "ok" || auth.username !== "admin" || typeof auth.token !== "string" || !auth.token) {
    throw new Error("Technitium did not return an administrator session");
  }

  await profile(context, auth.token);
  return auth.token;
}

async function profile(context: SetupContext, token: string): Promise<SetupRecord> {
  const result = await context.http.request({
    method: "GET",
    path: "/api/user/profile/get",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!result.ok || result.status !== 200) throw new Error("Technitium did not authorize the administrator profile readback");
  const details = await result.json();
  if (!details || typeof details !== "object" || Array.isArray(details)) throw new Error("Technitium returned an invalid profile");
  const response = (details as Record<string, unknown>).response;
  if ((details as Record<string, unknown>).status !== "ok" || !response || typeof response !== "object"
    || Array.isArray(response) || (response as Record<string, unknown>).username !== "admin") {
    throw new Error("Technitium did not return the administrator profile");
  }
  return response as SetupRecord;
}

async function saveOwnerToken(context: SetupContext, status: SetupRecord, session: string): Promise<SetupRecord> {
  let checkpoint = await context.checkpoint.read();
  if (checkpoint && (checkpoint.schemaVersion !== 1 || checkpoint.appId !== APP_ID
    || checkpoint.projectRoot !== context.projectRoot || !Number.isSafeInteger(checkpoint.revision)
    || checkpoint.revision < 1 || !["owner-token-reviewed", "owner-token-attempted", "owner-token-saved"].includes(checkpoint.stage)
    || checkpoint.data.adminUsername !== "admin" || checkpoint.data.tokenName !== TOKEN_NAME
    || Object.keys(checkpoint.data).some((name) => !["adminUsername", "tokenName"].includes(name))
    || !Array.isArray(checkpoint.attemptedActions)
    || !checkpoint.attemptedActions.every((action) => action === CREATE_ACTION))) {
    throw new Error("Technitium owner token checkpoint does not match this project");
  }
  let key = await context.secrets.readApiKey();
  if (key && !checkpoint) throw new Error("Technitium saved API key has no owner token provenance; inspect before continuing");
  if (!key) {
    if (checkpoint && (checkpoint.stage !== "owner-token-reviewed" || checkpoint.attemptedActions.includes(CREATE_ACTION))) {
      throw new Error("Technitium token creation was attempted but its private output is unavailable; inspect the owned token before recovery, never create a duplicate");
    }
    const admin = await profile(context, session);
    if (!Array.isArray(admin.sessions)) throw new Error("Technitium session inventory is unavailable");
    if (admin.sessions.some((item) => setupRecord(item, "Technitium session").tokenName === TOKEN_NAME)) {
      throw new Error("Technitium already has the owned token name but no saved key; inspect before recovery");
    }
    if (!checkpoint) {
      checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: null, stage: "owner-token-reviewed",
        data: { adminUsername: "admin", tokenName: TOKEN_NAME } });
    }
    const result = await context.http.request({
      method: "POST", path: "/api/admin/sessions/createToken",
      headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ user: "admin", tokenName: TOKEN_NAME }).toString(),
      approval: { action: CREATE_ACTION, progress: "Create one permanent owner-administration API token with full admin privileges", once: true },
      beforeSendCheckpoint: { expectedRevision: checkpoint.revision, stage: "owner-token-attempted", data: checkpoint.data },
    });
    if (!result.ok || result.status !== 200) throw new Error("Technitium owner token creation failed; inspect before recovery");
    const payload = setupRecord(await result.json(), "Technitium token creation");
    const response = setupRecord(payload.response, "Technitium created token");
    if (payload.status !== "ok" || response.username !== "admin" || response.tokenName !== TOKEN_NAME
      || typeof response.token !== "string" || !/^[a-f0-9]{64}$/.test(response.token)) {
      throw new Error("Technitium owner token response is invalid; inspect before recovery");
    }
    key = response.token;
    await context.secrets.writeApiKey(key);
    if (await context.secrets.readApiKey() !== key) throw new Error("Technitium owner token private capture failed; inspect before recovery");
    checkpoint = await context.checkpoint.read();
  }
  if (!key || !/^[a-f0-9]{64}$/.test(key)) throw new Error("Technitium saved owner API token is invalid");
  const owner = await profile(context, key);
  if (!Array.isArray(owner.sessions)) throw new Error("Technitium owner API token session readback is unavailable");
  const owned = owner.sessions.map((item) => setupRecord(item, "Technitium token session"))
    .filter((item) => item.tokenName === TOKEN_NAME);
  if (owned.length !== 1 || owned[0].username !== "admin" || owned[0].type !== "ApiToken"
    || owned[0].isCurrentSession !== true || owned[0].partialToken !== key.slice(0, 16)) {
    throw new Error("Technitium saved key is not the unique permanent owned administrator API token");
  }
  const apiKeyFile = await context.secrets.apiKeyPath();
  if (typeof status.privateFiles !== "string" || !status.privateFiles.startsWith("/")
    || apiKeyFile !== join(status.privateFiles, `${APP_ID}-api-key`)) {
    throw new Error("Technitium API token is not captured in the exact owner-private file");
  }
  if (!checkpoint || !["owner-token-attempted", "owner-token-saved"].includes(checkpoint.stage)
    || !checkpoint.attemptedActions.includes(CREATE_ACTION)) throw new Error("Technitium owner token creation provenance is unavailable");
  if (checkpoint.stage !== "owner-token-saved") {
    await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision, stage: "owner-token-saved", data: checkpoint.data });
  }
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: "admin-and-api-key-saved",
    adminUsername: "admin", tokenName: TOKEN_NAME, apiKeyFile, dnsPublished: false };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  healthSource: null,
  homarrIntegration: "Technitium DNS",
  ready(record) {
    return record.appId === APP_ID && record.stage === "admin-and-api-key-saved"
      && record.adminUsername === "admin" && record.tokenName === TOKEN_NAME
      && typeof record.apiKeyFile === "string" && record.dnsPublished === false;
  },
  async firstRun(context) {
    if (context.appId !== APP_ID) throw new Error("Technitium setup received a different app ID");
    const status = appliedStatus(context, await context.status());
    const session = await verifyAdmin(context);
    return saveOwnerToken(context, status, session);
  },
};

export default adapter;
