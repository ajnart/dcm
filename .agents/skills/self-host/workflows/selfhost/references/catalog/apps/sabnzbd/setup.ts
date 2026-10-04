import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";

import {
  appliedStatus,
  type SetupAdapter,
  type SetupCheckpoint,
  type SetupContext,
  type SetupHttpResponse,
  type SetupRecord,
} from "../../types/setup";

// The form POST route and response shapes are from SABnzbd 5.1.3's api.py,
// interface.py, cfg.py, and the upstream 5.1 API reference.
const APP_ID = "sabnzbd";
const VERSION = "5.1.3";
const TEMPORARY = "/data/usenet/incomplete";
const COMPLETE = "/data/usenet/complete";
const STAGES = new Set(["username-attempted", "username-verified",
  "password-attempted", "admin-verified"]);
type Setting = "username" | "password" | "download_dir" | "complete_dir";

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`SABnzbd ${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function savedCheckpoint(context: SetupContext, value: unknown, keyHash: string): SetupCheckpoint | null {
  if (value === null) return null;
  const checkpoint = object(value, "setup checkpoint");
  const data = object(checkpoint.data, "checkpoint data");
  if (checkpoint.schemaVersion !== 1 || checkpoint.appId !== APP_ID
    || checkpoint.projectRoot !== context.projectRoot
    || !Number.isSafeInteger(checkpoint.revision) || Number(checkpoint.revision) < 1
    || !STAGES.has(String(checkpoint.stage)) || data.keyHash !== keyHash
    || data.version !== VERSION || !Array.isArray(checkpoint.attemptedActions)) {
    throw new Error("SABnzbd setup checkpoint does not match this app and API key");
  }
  if (!checkpoint.attemptedActions.includes("sab-set-username")
    || (["password-attempted", "admin-verified"].includes(String(checkpoint.stage))
      && !checkpoint.attemptedActions.includes("sab-set-password"))) {
    throw new Error("SABnzbd setup checkpoint is missing first-admin credential-write provenance; inspect before retrying");
  }
  return checkpoint as SetupCheckpoint;
}

async function advance(context: SetupContext, saved: SetupCheckpoint | null,
  stage: string, keyHash: string): Promise<SetupCheckpoint> {
  const next = await context.checkpoint.compareAndSet({
    expectedRevision: saved?.revision ?? null, stage,
    data: { version: VERSION, keyHash },
  });
  const checked = savedCheckpoint(context, next, keyHash);
  if (!checked || checked.stage !== stage || checked.revision !== (saved?.revision ?? 0) + 1) {
    throw new Error("SABnzbd setup checkpoint was not saved; inspect before retrying");
  }
  return checked;
}

async function version(context: SetupContext): Promise<void> {
  const response = await context.http.request({ method: "GET", path: "/api",
    query: { mode: "version" } });
  if (response.status !== 200 || !response.ok) {
    throw new Error("SABnzbd's pinned API is not ready");
  }
  const result = object(await response.json(), "version response");
  if (result.version !== VERSION) {
    throw new Error("SABnzbd runtime version differs from the pinned 5.1.3 setup route");
  }
}

async function form(context: SetupContext, fields: Record<string, string>,
  action: string, progress: string, attempt?: { saved: SetupCheckpoint | null; stage: string; keyHash: string },
): Promise<SetupHttpResponse> {
  const request = {
    method: "POST" as const, path: "/api",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
    approval: { action, progress, once: attempt !== undefined },
    ...(attempt ? { beforeSendCheckpoint: {
      expectedRevision: attempt.saved?.revision ?? null, stage: attempt.stage,
      data: { version: VERSION, keyHash: attempt.keyHash },
    } } : {}),
  };
  return context.http.request(request);
}

async function json(response: SetupHttpResponse, label: string): Promise<Record<string, unknown>> {
  if (response.status !== 200 || !response.ok) {
    throw new Error(`SABnzbd ${label} returned no successful API response`);
  }
  const result = object(await response.json(), `${label} response`);
  if (result.status === false || Object.hasOwn(result, "error")) {
    throw new Error(`SABnzbd ${label} was rejected; inspect the saved checkpoint`);
  }
  return result;
}

function configValue(result: Record<string, unknown>, setting: Setting): string {
  const config = object(result.config, "config readback");
  const misc = object(config.misc, "misc readback");
  const value = misc[setting];
  if (typeof value !== "string") {
    throw new Error(`SABnzbd did not return the ${setting} setting`);
  }
  return value;
}

async function readSetting(context: SetupContext, key: string, setting: Setting): Promise<string> {
  const response = await form(context, { mode: "get_config", section: "misc",
    keyword: setting, apikey: key }, `sab-read-${setting.replaceAll("_", "-")}`,
  `Read back only SABnzbd's ${setting} setting`);
  return configValue(await json(response, `${setting} read`), setting);
}

async function setSetting(context: SetupContext, key: string, setting: Setting, value: string,
  attempt?: { saved: SetupCheckpoint | null; stage: string; keyHash: string }): Promise<void> {
  const response = await form(context, { mode: "set_config", section: "misc",
    keyword: setting, value, apikey: key }, `sab-set-${setting.replaceAll("_", "-")}`,
  `Set SABnzbd ${setting} on the exact owned project`, attempt);
  const result = await json(response, `${setting} update`);
  if (setting !== "password" && configValue(result, setting) !== value) {
    throw new Error(`SABnzbd did not save the requested ${setting}; inspect before retrying`);
  }
}

async function keyWorks(context: SetupContext, key: string): Promise<void> {
  const response = await form(context, { mode: "auth", key }, "sab-verify-api-key",
    "Verify the freshly read SABnzbd API key without putting it in the URL");
  const result = await json(response, "API-key authorization");
  if (result.auth !== "apikey") {
    throw new Error("SABnzbd did not authorize the owned full API key");
  }
}

async function loginWorks(context: SetupContext, password: string): Promise<boolean> {
  const response = await context.http.request({ method: "POST", path: "/login/",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: "admin", password }).toString(),
    approval: { action: "sab-verify-admin", progress: "Verify the generated SABnzbd WebUI administrator login" },
  });
  // LoginPage also redirects already-authenticated or unprotected clients.
  // Only a successful credential check mints this fresh cookie/salt pair.
  const cookies = response.headers.getSetCookie?.() ?? [];
  return (response.status === 302 || response.status === 303)
    && response.headers.get("location") === "/"
    && cookies.some((cookie) => /^login_cookie=[0-9a-f]{40}(?:;|$)/.test(cookie))
    && cookies.some((cookie) => /^login_salt=[0-9]+(?:;|$)/.test(cookie));
}

async function verifyAdmin(context: SetupContext, key: string, password: string): Promise<void> {
  const mask = await readSetting(context, key, "password");
  if (!/^\*+$/.test(mask) || !await loginWorks(context, password)) {
    throw new Error("SABnzbd's generated administrator password was not verified");
  }
}

async function ensurePath(context: SetupContext, key: string, setting: "download_dir" | "complete_dir",
  desired: string, upstreamDefault: string): Promise<void> {
  const current = await readSetting(context, key, setting);
  if (current === desired) return;
  if (current !== upstreamDefault) {
    throw new Error(`SABnzbd has a different ${setting}; preserve it and inspect before changing paths`);
  }
  // Setting the same path after an uncertain response is safe only after the
  // current value has been read back. SABnzbd may reject a non-empty queue.
  await setSetting(context, key, setting, desired);
  if (await readSetting(context, key, setting) !== desired) {
    throw new Error(`SABnzbd ${setting} did not read back exactly`);
  }
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  healthSource: null,
  homarrIntegration: "sabNzbd",
  ready(record) {
    return record.appId === APP_ID && record.stage === "admin-api-paths-saved"
      && record.adminUsername === "admin" && typeof record.apiKeyFile === "string"
      && isAbsolute(record.apiKeyFile) && record.temporaryDirectory === TEMPORARY
      && record.completeDirectory === COMPLETE && record.provider === "owner-input-required"
      && record.pathVerification === "api-readback-only";
  },
  async firstRun(context): Promise<SetupRecord> {
    if (context.appId !== APP_ID || !isAbsolute(context.projectRoot)) {
      throw new Error("SABnzbd setup received a different app project");
    }
    const status = appliedStatus(context, await context.status());
    if (typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)) {
      throw new Error("SABnzbd has no exact generated administrator password file");
    }
    await version(context);
    const key = await context.secrets.readSabnzbdConfigIniApiKey();
    if (!/^[0-9a-f]{32}$/.test(key)) throw new Error("SABnzbd's full API key is unavailable");
    const keyHash = createHash("sha256").update(key).digest("hex");
    const existing = await context.secrets.readApiKey();
    if (existing !== null && existing !== key) {
      throw new Error("SABnzbd's saved API key differs from its owned config; inspect before rotation");
    }
    await context.secrets.checkSabnzbdSetupSafety();
    const password = await context.secrets.readAdminPassword();
    if (password.length < 16 || password.length > 8192) {
      throw new Error("SABnzbd has no valid generated administrator password");
    }
    let saved = savedCheckpoint(context, await context.checkpoint.read(), keyHash);
    // Preserve the generated key privately before any authenticated readback,
    // including interrupted onboarding that must be inspected rather than replayed.
    const apiKeyFile = await context.secrets.writeApiKey(key);
    if (!isAbsolute(apiKeyFile)) throw new Error("SABnzbd API-key handoff was not saved privately");
    await keyWorks(context, key);
    const username = await readSetting(context, key, "username");
    if (username !== "" && username !== "admin") {
      throw new Error("SABnzbd has a different WebUI administrator; inspect before changing it");
    }
    if (saved === null && username === "admin") {
      throw new Error("SABnzbd has an unowned administrator; first-admin provenance is missing");
    }
    if (saved === null && await readSetting(context, key, "password") !== "") {
      throw new Error("SABnzbd has an unowned WebUI password; preserve it and inspect before setup");
    }
    if (saved !== null && saved.stage !== "username-attempted" && username !== "admin") {
      throw new Error("SABnzbd administrator changed after its credential checkpoint; inspect before proceeding");
    }
    if (saved === null && username === "") {
      await setSetting(context, key, "username", "admin",
        { saved, stage: "username-attempted", keyHash });
      saved = savedCheckpoint(context, await context.checkpoint.read(), keyHash);
    }
    if (saved?.stage === "username-attempted") {
      if (await readSetting(context, key, "username") !== "admin") {
        throw new Error("SABnzbd username update is uncertain; do not replay it");
      }
      saved = await advance(context, saved, "username-verified", keyHash);
    }
    if (saved?.stage === "username-verified") {
      await setSetting(context, key, "password", password,
        { saved, stage: "password-attempted", keyHash });
      saved = savedCheckpoint(context, await context.checkpoint.read(), keyHash);
    }
    if (saved?.stage === "password-attempted") {
      await verifyAdmin(context, key, password);
      saved = await advance(context, saved, "admin-verified", keyHash);
    }
    if (saved?.stage !== "admin-verified") {
      throw new Error("SABnzbd has no verified administrator checkpoint");
    }
    if (await readSetting(context, key, "username") !== "admin") {
      throw new Error("SABnzbd administrator changed after setup; inspect before proceeding");
    }
    await verifyAdmin(context, key, password);
    await ensurePath(context, key, "download_dir", TEMPORARY, "Downloads/incomplete");
    await ensurePath(context, key, "complete_dir", COMPLETE, "Downloads/complete");
    return { appId: APP_ID, projectRoot: context.projectRoot,
      stage: "admin-api-paths-saved", adminUsername: "admin", apiKeyFile,
      temporaryDirectory: TEMPORARY, completeDirectory: COMPLETE,
      provider: "owner-input-required", pathVerification: "api-readback-only" };
  },
};

export default adapter;
