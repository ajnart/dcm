import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";

import {
  appliedStatus,
  setupRecord,
  statusApproval,
  type SetupAdapter,
  type SetupContext,
  type SetupInspectionContext,
  type SetupRecord,
} from "../../types/setup";
import { createSetupProofRecorder } from "../../shared/setup-proof";

const APP_ID = "prowlarr";
const API_KEY_PATTERN = /^[0-9a-f]{32}$/;
const setupProof = createSetupProofRecorder();

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Prowlarr ${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function sharedStatus(context: SetupContext | SetupInspectionContext, value: unknown): SetupRecord {
  const status = setupRecord(value, "Prowlarr shared status");
  const runtime = setupRecord(status.runtime, "Prowlarr shared runtime");
  if (status.ownerKind !== "shared" || status.command !== "app status"
    || status.appId !== APP_ID || status.projectRoot !== context.projectRoot
    || status.status !== "applied" || status.mutation !== false
    || runtime.state !== "running" || typeof status.privateFiles !== "string"
    || !isAbsolute(status.privateFiles) || typeof status.passwordFile !== "string"
    || !isAbsolute(status.passwordFile)) {
    throw new Error("Prowlarr is not an exact running shared unit with a managed administrator password");
  }
  return status;
}

async function hostConfig(context: SetupContext | SetupInspectionContext, key: string): Promise<Record<string, unknown>> {
  const response = await context.http.request({ method: "GET", path: "/api/v1/config/host",
    headers: { "X-Api-Key": key } });
  if (response.status !== 200) throw new Error("Prowlarr host configuration could not be read");
  const config = object(await response.json(), "host configuration");
  if (!Number.isSafeInteger(config.id) || Number(config.id) < 1
    || typeof config.authenticationMethod !== "string"
    || typeof config.authenticationRequired !== "string"
    || (config.username !== null && typeof config.username !== "string")) {
    throw new Error("Prowlarr host configuration omitted required authentication fields");
  }
  return config;
}

function formsConfigured(config: Record<string, unknown>): boolean {
  return config.authenticationMethod === "forms"
    && config.authenticationRequired === "enabled" && config.username === "admin";
}

function sharedRecord(context: SetupContext | SetupInspectionContext,
  status: SetupRecord, apiKeyFile: string): SetupRecord {
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: "login-verified",
    passwordFile: status.passwordFile, apiKeyFile, loginVerified: true, apiVerified: true };
}

function cookie(response: Awaited<ReturnType<SetupContext["http"]["request"]>>): string {
  const headers = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  const cookies = headers.map((header) => header.split(";", 1)[0] ?? "")
    .filter((value) => /^[a-z0-9]+Auth=[^;,\s\u0000-\u001f\u007f]+$/i.test(value));
  if (cookies.length !== 1) {
    throw new Error("Prowlarr did not establish an administrator session");
  }
  return cookies[0]!;
}

function redirectPath(response: Awaited<ReturnType<SetupContext["http"]["request"]>>): string | null {
  const location = response.headers.get("location");
  if (!location?.startsWith("/") || location.startsWith("//")) return null;
  try { return new URL(location, "http://127.0.0.1").pathname; }
  catch { return null; }
}

async function verifySharedLogin(context: SetupContext, password: string): Promise<void> {
  const anonymous = await context.http.request({ method: "GET", path: "/",
    headers: { Accept: "text/html" } });
  if (![302, 303].includes(anonymous.status)
    || redirectPath(anonymous) !== "/login") {
    throw new Error("Prowlarr did not require a Forms administrator login");
  }
  const boundary = `selfhost-prowlarr-${createHash("sha256").update(context.projectRoot).digest("hex").slice(0, 24)}`;
  if (password.includes(boundary)) throw new Error("Prowlarr login boundary conflicts with the saved password");
  const form = `--${boundary}\r\nContent-Disposition: form-data; name="username"\r\n\r\nadmin\r\n`
    + `--${boundary}\r\nContent-Disposition: form-data; name="password"\r\n\r\n${password}\r\n`
    + `--${boundary}--\r\n`;
  const response = await context.http.request({ method: "POST", path: "/login",
    headers: { Accept: "text/html", "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: form,
    approval: { action: "prowlarr-verify-forms-login",
      progress: "Verify the saved Prowlarr administrator login on this private shared unit" } });
  if (![302, 303].includes(response.status)
    || redirectPath(response) === null
    || redirectPath(response) === "/login") {
    throw new Error("Prowlarr rejected the saved Forms administrator login");
  }
  const authenticated = await context.http.request({ method: "GET", path: "/",
    headers: { Accept: "text/html", Cookie: cookie(response) } });
  if (authenticated.status !== 200) {
    throw new Error("Prowlarr saved administrator session did not pass readback");
  }
}

async function inspectShared(context: SetupInspectionContext): Promise<SetupRecord> {
  const status = sharedStatus(context, await context.status());
  const key = await context.secrets.readApiKey();
  const path = await context.secrets.apiKeyPath();
  const expected = join(status.privateFiles as string, "prowlarr-api-key");
  if (typeof key !== "string" || !API_KEY_PATTERN.test(key) || path !== expected) {
    throw new Error("Prowlarr has no matching private API key");
  }
  const config = await hostConfig(context, key);
  if (!formsConfigured(config)) throw new Error("Prowlarr Forms authentication changed");
  const saved = await context.checkpoint.read();
  if (!saved || saved.appId !== APP_ID || saved.projectRoot !== context.projectRoot
    || saved.stage !== "forms-login-verified"
    || saved.data.passwordFile !== status.passwordFile
    || saved.data.apiKeyFile !== expected) {
    throw new Error("Prowlarr has no matching saved login verification");
  }
  // A matching checkpoint proves a prior login, not that the saved password
  // still works. Only the separately approved firstRun login can refresh it.
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: "api-config-verified",
    passwordFile: status.passwordFile, apiKeyFile: expected, apiVerified: true,
    ownerKind: "shared", privateFiles: status.privateFiles,
    configurationVerified: true, loginVerified: false, historicalLoginVerified: true };
}

async function setupShared(context: SetupContext, statusValue: unknown): Promise<SetupRecord> {
  const status = sharedStatus(context, statusValue);
  const key = await context.secrets.readServiceConfigXmlApiKey();
  if (!API_KEY_PATTERN.test(key)) throw new Error("Prowlarr config.xml API key is invalid");
  const previous = await context.secrets.readApiKey();
  if (previous !== null && previous !== key) {
    throw new Error("Prowlarr API key changed; inspect before replacing the saved key");
  }
  const path = previous === null
    ? await context.secrets.writeApiKey(key) : await context.secrets.apiKeyPath();
  if (path !== join(status.privateFiles as string, "prowlarr-api-key")) {
    throw new Error("Prowlarr private API key path is unavailable");
  }
  const password = await context.secrets.readAdminPassword();
  if (password.length < 32 || password.length > 128 || /[\r\n\0]/.test(password)) {
    throw new Error("Prowlarr managed administrator password is invalid");
  }
  const config = await hostConfig(context, key);
  const prior = await context.checkpoint.read();
  let origin: "fresh" | "resume" | null = null;
  if (prior?.appId === APP_ID && prior.projectRoot === context.projectRoot
    && prior.stage === "forms-login-verified" && prior.data.passwordFile === status.passwordFile
    && prior.data.apiKeyFile === path) origin = "resume";
  if (!formsConfigured(config)) {
    if (prior !== null) {
      throw new Error("Prowlarr authentication differs after an attempted update; inspect before retrying");
    }
    if (config.authenticationMethod !== "none" || config.username !== "" || config.password !== "") {
      throw new Error("Prowlarr already has different authentication; inspect before changing it");
    }
    const response = await context.http.request({ method: "PUT",
      path: `/api/v1/config/host/${config.id}`,
      headers: { "X-Api-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ ...config, authenticationMethod: "forms",
        authenticationRequired: "enabled", username: "admin", password,
        passwordConfirmation: password }),
      approval: { action: "prowlarr-configure-forms-auth", once: true,
        progress: "Set Prowlarr Forms authentication to its saved private administrator credential" },
      beforeSendCheckpoint: { expectedRevision: null, stage: "auth-update-attempted",
        data: { passwordFile: status.passwordFile as string, apiKeyFile: path } },
    });
    if (response.status !== 200 && response.status !== 202) {
      throw new Error("Prowlarr authentication update was not confirmed; inspect before retrying");
    }
    origin = "fresh";
  }
  if (!formsConfigured(config)) {
    const readback = await hostConfig(context, key);
    if (readback.id !== config.id || !formsConfigured(readback)) {
      throw new Error("Prowlarr authentication policy did not pass API readback");
    }
  }
  await verifySharedLogin(context, password);
  const checkpoint = await context.checkpoint.read();
  if (checkpoint !== null && (checkpoint.appId !== APP_ID
    || checkpoint.projectRoot !== context.projectRoot)) {
    throw new Error("Prowlarr setup checkpoint differs; inspect before continuing");
  }
  if (checkpoint?.stage !== "forms-login-verified") {
    if (checkpoint !== null && (checkpoint.stage !== "auth-update-attempted"
      || !checkpoint.attemptedActions.includes("prowlarr-configure-forms-auth")
      || checkpoint.data.passwordFile !== status.passwordFile
      || checkpoint.data.apiKeyFile !== path)) {
      throw new Error("Prowlarr setup checkpoint differs; inspect before continuing");
    }
    await context.checkpoint.compareAndSet({ expectedRevision: checkpoint?.revision ?? null,
      stage: "forms-login-verified",
      data: { passwordFile: status.passwordFile as string, apiKeyFile: path } });
  } else if (checkpoint.data.passwordFile !== status.passwordFile
    || checkpoint.data.apiKeyFile !== path) {
    throw new Error("Prowlarr setup checkpoint differs; inspect before continuing");
  }
  return setupProof.record(sharedRecord(context, status, path), origin, "verified");
}

function verified(status: SetupRecord): boolean {
  return status.prowlarrOnboardingStage === "login-verified"
    && status.username === "admin"
    && typeof status.passwordFile === "string" && isAbsolute(status.passwordFile)
    && typeof status.apiKeyFile === "string" && isAbsolute(status.apiKeyFile);
}

async function checkpoint(context: SetupContext, status: SetupRecord): Promise<SetupRecord> {
  if (!verified(status)) throw new Error("Prowlarr has no saved verified-admin checkpoint");
  const checked = setupRecord(await context.read("login-check"), "Prowlarr live login check");
  if (checked.command !== "app login-check" || checked.appId !== context.appId
    || checked.projectRoot !== context.projectRoot
    || checked.status !== "admin-and-api-verified" || checked.mutation !== false
    || checked.loginVerified !== true || checked.apiVerified !== true
    || checked.passwordFile !== status.passwordFile
    || checked.apiKeyFile !== status.apiKeyFile) {
    throw new Error("Prowlarr's saved administrator and API access could not be reverified");
  }
  return { appId: context.appId, projectRoot: context.projectRoot,
    stage: "login-verified", passwordFile: status.passwordFile,
    apiKeyFile: status.apiKeyFile, loginVerified: true, apiVerified: true };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  compatibilityResult(record) {
    return setupProof.result(record);
  },
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  healthSource: null,
  homarrIntegration: "prowlarr",
  ready(record) {
    return record.appId === this.appId && record.stage === "login-verified"
      && typeof record.passwordFile === "string" && isAbsolute(record.passwordFile)
      && typeof record.apiKeyFile === "string" && isAbsolute(record.apiKeyFile)
      && record.loginVerified === true && record.apiVerified === true;
  },
  apiReady(record) {
    return record.appId === this.appId && record.ownerKind === "shared"
      && record.stage === "api-config-verified" && record.apiVerified === true
      && record.configurationVerified === true
      && typeof record.privateFiles === "string" && isAbsolute(record.privateFiles)
      && record.apiKeyFile === join(record.privateFiles, "prowlarr-api-key");
  },
  async inspect(context) {
    if (context.appId !== APP_ID || !isAbsolute(context.projectRoot)) {
      throw new Error("Prowlarr inspection received a different app project");
    }
    return inspectShared(context);
  },
  async firstRun(context) {
    if (context.appId !== this.appId) throw new Error("Prowlarr setup received a different app ID");
    let status = appliedStatus(context, await context.status());
    if (status.ownerKind === "shared") return setupShared(context, status);
    if (verified(status)) return checkpoint(context, status);
    if (status.prowlarrOnboardingStage !== null && status.prowlarrOnboardingStage !== "attempted") {
      throw new Error("Prowlarr has an unrecognized onboarding checkpoint");
    }
    if (status.username !== "admin" || typeof status.passwordFile !== "string"
      || !isAbsolute(status.passwordFile)) throw new Error("Prowlarr has no managed administrator password");
    if (!verified(status)) {
      const approval = statusApproval(status, "onboard");
      await context.apply("onboard", approval,
        "Enable required Prowlarr Forms authentication and verify the exact administrator login");
      status = appliedStatus(context, await context.status());
    }
    return checkpoint(context, status);
  },
};

export default adapter;
