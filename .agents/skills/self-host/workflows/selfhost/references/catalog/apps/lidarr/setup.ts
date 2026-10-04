import { isAbsolute, join } from "node:path";

import { appliedStatus, type SetupAdapter, type SetupContext, type SetupInspectionContext, type SetupRecord } from "../../types/setup";

const APP_ID = "lidarr";
const API_KEY = /^[0-9a-f]{32}$/;

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Lidarr host configuration is invalid");
  }
  return value as Record<string, unknown>;
}

async function status(context: SetupContext | SetupInspectionContext): Promise<Record<string, unknown>> {
  const value = appliedStatus(context, await context.status());
  if (value.ownerKind !== "shared"
    || typeof value.privateFiles !== "string" || !isAbsolute(value.privateFiles)
    || typeof value.passwordFile !== "string" || !isAbsolute(value.passwordFile)) {
    throw new Error("Lidarr is not an exact running shared unit with a managed password");
  }
  return value;
}

async function host(context: SetupContext | SetupInspectionContext, key: string): Promise<Record<string, unknown>> {
  const response = await context.http.request({ method: "GET", path: "/api/v1/config/host",
    headers: { "X-Api-Key": key } });
  if (response.status !== 200) throw new Error("Lidarr host configuration could not be read");
  const config = object(await response.json());
  if (!Number.isSafeInteger(config.id) || Number(config.id) < 1
    || typeof config.authenticationMethod !== "string"
    || typeof config.authenticationRequired !== "string"
    || (config.username !== null && typeof config.username !== "string")) {
    throw new Error("Lidarr host configuration omitted authentication fields");
  }
  return config;
}

function forms(config: Record<string, unknown>): boolean {
  return config.authenticationMethod === "forms"
    && config.authenticationRequired === "enabled" && config.username === "admin";
}

function record(context: SetupContext | SetupInspectionContext,
  current: Record<string, unknown>, apiKeyFile: string): SetupRecord {
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: "forms-login-verified",
    adminUsername: "admin", authenticationMethod: "forms", authenticationRequired: "enabled",
    passwordFile: current.passwordFile as string, apiKeyFile };
}

async function verifyLogin(context: SetupContext, password: string): Promise<void> {
  const anonymous = await context.http.request({ method: "GET", path: "/",
    headers: { Accept: "text/html" } });
  const location = anonymous.headers.get("location");
  if (anonymous.status !== 302 || !location?.startsWith("/")
    || location.startsWith("//")
    || new URL(location, "http://127.0.0.1").pathname !== "/login") {
    throw new Error("Lidarr did not require a Forms administrator login");
  }
  const response = await context.http.request({ method: "POST", path: "/login",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: "admin", password }).toString(),
    approval: { action: "lidarr-verify-forms-login",
      progress: "Verify the saved Lidarr administrator password against its private login endpoint" } });
  if (response.status !== 302 || response.headers.get("location") !== "/") {
    throw new Error("Lidarr rejected the saved Forms administrator login");
  }
  // The pinned Forms controller issues this identity only after checking the
  // submitted password. API-key configuration readback cannot prove login.
  const headers = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  const cookies = headers.map((header) => header.split(";", 1)[0] ?? "")
    .filter((value) => /^[a-z0-9]+Auth=[^;,\s\u0000-\u001f\u007f]+$/i.test(value));
  if (cookies.length !== 1) throw new Error("Lidarr did not establish an administrator session");
  const authenticated = await context.http.request({ method: "GET", path: "/",
    headers: { Accept: "text/html", Cookie: cookies[0]! } });
  if (authenticated.status !== 200) {
    throw new Error("Lidarr saved administrator session did not pass readback");
  }
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  healthSource: null,
  homarrIntegration: "Lidarr",
  ready(value) {
    return value.appId === APP_ID && value.stage === "forms-login-verified"
      && value.adminUsername === "admin" && value.authenticationMethod === "forms"
      && value.authenticationRequired === "enabled"
      && typeof value.passwordFile === "string" && isAbsolute(value.passwordFile)
      && typeof value.apiKeyFile === "string" && isAbsolute(value.apiKeyFile);
  },
  async inspect(context) {
    if (context.appId !== APP_ID || !isAbsolute(context.projectRoot)) {
      throw new Error("Lidarr inspection received a different app project");
    }
    const current = await status(context);
    const key = await context.secrets.readApiKey();
    const path = await context.secrets.apiKeyPath();
    const expected = join(current.privateFiles as string, "lidarr-api-key");
    if (typeof key !== "string" || !API_KEY.test(key) || path !== expected) {
      throw new Error("Lidarr has no matching private API key");
    }
    if (!forms(await host(context, key))) throw new Error("Lidarr Forms authentication changed");
    const saved = await context.checkpoint.read();
    if (!saved || saved.stage !== "forms-login-verified"
      || saved.data.passwordFile !== current.passwordFile || saved.data.apiKeyFile !== expected) {
      throw new Error("Lidarr has no matching saved login verification");
    }
    return record(context, current, expected);
  },
  async firstRun(context) {
    if (context.appId !== APP_ID || !isAbsolute(context.projectRoot)) {
      throw new Error("Lidarr setup received a different app project");
    }
    const current = await status(context);
    const key = await context.secrets.readServiceConfigXmlApiKey();
    if (!API_KEY.test(key)) throw new Error("Lidarr config.xml API key is invalid");
    const previous = await context.secrets.readApiKey();
    if (previous !== null && previous !== key) {
      throw new Error("Lidarr API key changed; inspect before replacing the saved key");
    }
    if (previous === null) await context.secrets.writeApiKey(key);
    const path = await context.secrets.apiKeyPath();
    const expected = join(current.privateFiles as string, "lidarr-api-key");
    if (path !== expected || await context.secrets.readApiKey() !== key) {
      throw new Error("Lidarr private API key capture did not match its exact owned file");
    }
    const password = await context.secrets.readAdminPassword();
    if (password.length < 32 || password.length > 128 || /[\r\n\0]/.test(password)) {
      throw new Error("Lidarr managed administrator password is invalid");
    }
    const config = await host(context, key);
    const prior = await context.checkpoint.read();
    if (!forms(config)) {
      if (prior !== null || config.authenticationMethod !== "none"
        || (config.username && config.username !== "")) {
        throw new Error("Lidarr already has different authentication; inspect before changing it");
      }
      const response = await context.http.request({ method: "PUT",
        path: `/api/v1/config/host/${config.id}`,
        headers: { "X-Api-Key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, authenticationMethod: "forms",
          authenticationRequired: "enabled", username: "admin", password,
          passwordConfirmation: password }),
        approval: { action: "lidarr-configure-forms-auth", once: true,
          progress: "Set Lidarr Forms authentication to its saved administrator credential" },
        beforeSendCheckpoint: { expectedRevision: null, stage: "auth-update-attempted",
          data: { passwordFile: current.passwordFile as string, apiKeyFile: path } } });
      if (response.status !== 200 && response.status !== 202) {
        throw new Error("Lidarr authentication update was not confirmed; inspect before retrying");
      }
    }
    const readback = await host(context, key);
    if (readback.id !== config.id || !forms(readback)) {
      throw new Error("Lidarr authentication policy did not pass API readback");
    }
    await verifyLogin(context, password);
    const checkpoint = await context.checkpoint.read();
    if (checkpoint?.stage !== "forms-login-verified") {
      if (checkpoint !== null && (checkpoint.stage !== "auth-update-attempted"
        || !checkpoint.attemptedActions.includes("lidarr-configure-forms-auth")
        || checkpoint.data.passwordFile !== current.passwordFile
        || checkpoint.data.apiKeyFile !== path)) {
        throw new Error("Lidarr setup checkpoint differs; inspect before continuing");
      }
      await context.checkpoint.compareAndSet({ expectedRevision: checkpoint?.revision ?? null,
        stage: "forms-login-verified",
        data: { passwordFile: current.passwordFile as string, apiKeyFile: path } });
    } else if (checkpoint.data.passwordFile !== current.passwordFile
      || checkpoint.data.apiKeyFile !== path) {
      throw new Error("Lidarr setup checkpoint differs; inspect before continuing");
    }
    return record(context, current, path);
  },
};

export default adapter;
