import { isAbsolute, join, posix } from "node:path";

import {
  type SetupAdapter,
  type SetupCheckpoint,
  type SetupContext,
  type SetupHttpReadRequest,
  type SetupInspectionContext,
  type SetupRecord,
} from "../../types/setup";
import { createSetupProofRecorder } from "../../shared/setup-proof";

const APP_ID = "sonarr";
const API_KEY_PATTERN = /^[0-9a-f]{32}$/;
const setupProof = createSetupProofRecorder();
const CREATE_ROOT_FOLDER = "sonarr-create-root-folder";
const ROOT_FOLDER_STAGES = ["root-folder-selected", "root-folder-create-attempted", "root-folder-verified"];

type ReadContext = Pick<SetupInspectionContext, "appId" | "projectRoot" | "status" | "http" | "secrets" | "checkpoint">;
type HostConfig = Record<string, unknown> & { id: number };
type HttpResponse = Awaited<ReturnType<SetupContext["http"]["request"]>>;

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function exactStatus(context: ReadContext, value: unknown): Record<string, unknown> {
  const status = object(value, `${APP_ID} app status`);
  const runtime = object(status.runtime, `${APP_ID} runtime status`);
  if (status.command !== "app status" || status.appId !== APP_ID
    || status.projectRoot !== context.projectRoot || status.status !== "applied"
    || status.mutation !== false || runtime.state !== "running"
    || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)
    || typeof status.privateFiles !== "string" || !isAbsolute(status.privateFiles)) {
    throw new Error(`${APP_ID} is not a running, exact saved app project with a managed admin password`);
  }
  return status;
}

function hostConfig(value: unknown): HostConfig {
  const config = object(value, `${APP_ID} host config`);
  if (typeof config.id !== "number" || !Number.isSafeInteger(config.id) || config.id < 1) {
    throw new Error(`${APP_ID} returned an invalid host-config ID`);
  }
  return config as HostConfig;
}

function validApiKey(value: unknown): value is string {
  return typeof value === "string" && API_KEY_PATTERN.test(value);
}

function authConfigured(config: HostConfig): boolean {
  return config.authenticationMethod === "forms"
    && config.authenticationRequired === "enabled" && config.username === "admin";
}

function rootFolderPath(value: unknown): value is string {
  return typeof value === "string" && value.length > "/data/".length
    && value.length <= 512 && value.startsWith("/data/") && !value.endsWith("/")
    && posix.normalize(value) === value && !/[,\u0000-\u001f\u007f]/.test(value);
}

function savedRootFolderPath(checkpoint: SetupCheckpoint | null): string | null {
  if (!checkpoint) return null;
  const value = checkpoint.data.rootFolderPath;
  if (value === undefined) {
    if (ROOT_FOLDER_STAGES.includes(checkpoint.stage)) {
      throw new Error("Sonarr root-folder checkpoint has no saved path; inspect before continuing");
    }
    return null;
  }
  if (!ROOT_FOLDER_STAGES.includes(checkpoint.stage) || !rootFolderPath(value)
    || (checkpoint.stage === "root-folder-create-attempted"
      && !checkpoint.attemptedActions.includes(CREATE_ROOT_FOLDER))
    || (checkpoint.stage === "root-folder-selected"
      && checkpoint.attemptedActions.includes(CREATE_ROOT_FOLDER))) {
    throw new Error("Sonarr root-folder checkpoint differs; inspect before continuing");
  }
  return value;
}

function requestedRootFolderPath(context: SetupContext, checkpoint: SetupCheckpoint | null): string | null {
  const saved = savedRootFolderPath(checkpoint);
  if (!Object.hasOwn(context.inputs, "root-folder-path")) return saved;
  const requested = context.inputs["root-folder-path"];
  if (!rootFolderPath(requested)) {
    throw new Error("Sonarr root folder must be an exact directory under /data without commas or controls");
  }
  if (saved !== null && saved !== requested) {
    throw new Error("Sonarr root folder differs from this project's saved selection; inspect before continuing");
  }
  return requested;
}

async function readJson(
  context: ReadContext,
  apiKey: string,
  request: SetupHttpReadRequest,
): Promise<unknown> {
  let response: HttpResponse;
  try {
    response = await context.http.request({
      ...request,
      headers: { ...request.headers, "X-Api-Key": apiKey },
    });
  } catch {
    throw new Error(`${APP_ID} authenticated API inspection failed`);
  }
  if (!response.ok || response.status !== 200) {
    throw new Error(`${APP_ID} authenticated API inspection returned an unexpected status`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${APP_ID} returned invalid API JSON`);
  }
}

async function rootFolderPresent(context: ReadContext, apiKey: string, path: string): Promise<boolean> {
  const value = await readJson(context, apiKey, { method: "GET", path: "/api/v3/rootfolder" });
  if (!Array.isArray(value)) throw new Error("Sonarr returned an invalid root-folder list");
  let matches = 0;
  for (const item of value) {
    const folder = object(item, "Sonarr root-folder entry");
    if (typeof folder.path !== "string") throw new Error("Sonarr returned an invalid root-folder path");
    if (folder.path !== path) continue;
    if (typeof folder.id !== "number" || !Number.isSafeInteger(folder.id) || folder.id < 1
      || folder.accessible !== true) {
      throw new Error("Sonarr root folder is not accessible in the selected /data mount");
    }
    matches += 1;
  }
  if (matches > 1) throw new Error("Sonarr returned duplicate exact root folders; inspect before continuing");
  return matches === 1;
}

function setupRecord(
  context: ReadContext,
  status: Record<string, unknown>,
  apiKeyFile: string,
  rootPath: string | null = null,
): SetupRecord {
  const record: SetupRecord = {
    appId: APP_ID,
    projectRoot: context.projectRoot,
    stage: "forms-login-verified",
    adminUsername: "admin",
    authenticationMethod: "forms",
    authenticationRequired: "enabled",
    passwordFile: status.passwordFile,
    apiKeyFile,
  };
  if (rootPath !== null) {
    record.stage = "forms-login-and-root-folder-verified";
    record.rootFolderPath = rootPath;
  }
  return record;
}

async function verifyFormsLogin(context: SetupContext, password: string): Promise<void> {
  const anonymous = await context.http.request({
    method: "GET", path: "/", headers: { Accept: "text/html" },
  });
  const location = anonymous.headers.get("location");
  if (anonymous.status !== 302 || !location?.startsWith("/")
    || location.startsWith("//")
    || new URL(location, "http://127.0.0.1").pathname !== "/login") {
    throw new Error("Sonarr did not require a Forms administrator login");
  }
  const response = await context.http.request({
    method: "POST",
    path: "/login",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: "admin", password }).toString(),
    approval: {
      action: "sonarr-verify-forms-login",
      progress: "Verify the saved Sonarr administrator password against the private login endpoint",
    },
  });
  if (response.status !== 302 || response.headers.get("location") !== "/") {
    throw new Error("Sonarr rejected the saved Forms administrator login");
  }
  // The pinned controller issues a Forms identity only after checking this
  // username/password. API-key access alone cannot establish password ownership.
  const headers = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  const cookies = headers.map((header) => header.split(";", 1)[0] ?? "")
    .filter((value) => /^[a-z0-9]+Auth=[^;,\s\u0000-\u001f\u007f]+$/i.test(value));
  if (cookies.length !== 1) {
    throw new Error("Sonarr did not establish an administrator session");
  }
  const authenticated = await context.http.request({
    method: "GET", path: "/", headers: { Accept: "text/html", Cookie: cookies[0]! },
  });
  if (authenticated.status !== 200) {
    throw new Error("Sonarr saved administrator session did not pass readback");
  }
}

function verifiedCheckpoint(context: ReadContext, checkpoint: SetupCheckpoint | null,
  passwordFile: string, apiKeyFile: string): boolean {
  if (!checkpoint) return false;
  return checkpoint.appId === APP_ID && checkpoint.projectRoot === context.projectRoot
    && (checkpoint.stage === "forms-login-verified" || ROOT_FOLDER_STAGES.includes(checkpoint.stage))
    && checkpoint.data.passwordFile === passwordFile
    && checkpoint.data.apiKeyFile === apiKeyFile;
}

// Candidate sidecar only. Fresh-container acceptance remains required.
const adapter: SetupAdapter = {
  appId: APP_ID,
  compatibilityResult(record) {
    return setupProof.result(record);
  },
  inputDefinitions: [
    { key: "root-folder-path", label: "Television root directory inside Sonarr (/data/...)" },
  ],
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  healthSource: null,
  homarrIntegration: "Sonarr",
  ready(record) {
    const formsOnly = record.stage === "forms-login-verified";
    const withRootFolder = record.stage === "forms-login-and-root-folder-verified"
      && rootFolderPath(record.rootFolderPath);
    return record.appId === APP_ID && (formsOnly || withRootFolder)
      && record.adminUsername === "admin" && record.authenticationMethod === "forms"
      && record.authenticationRequired === "enabled"
      && typeof record.passwordFile === "string" && isAbsolute(record.passwordFile)
      && typeof record.apiKeyFile === "string" && isAbsolute(record.apiKeyFile);
  },
  async inspect(context) {
    if (context.appId !== APP_ID || !isAbsolute(context.projectRoot)) {
      throw new Error("Sonarr inspection received a different app project");
    }
    const status = exactStatus(context, await context.status());
    const apiKey = await context.secrets.readApiKey();
    const apiKeyFile = await context.secrets.apiKeyPath();
    if (!validApiKey(apiKey) || typeof apiKeyFile !== "string" || !isAbsolute(apiKeyFile)
      || apiKeyFile !== join(status.privateFiles as string, `${APP_ID}-api-key`)) {
      throw new Error("Sonarr has no matching private API key");
    }
    const config = hostConfig(await readJson(context, apiKey, {
      method: "GET",
      path: "/api/v3/config/host",
    }));
    if (!authConfigured(config)) throw new Error("Sonarr Forms authentication policy is not configured");
    const checkpoint = await context.checkpoint.read();
    if (!verifiedCheckpoint(context, checkpoint, status.passwordFile as string, apiKeyFile)) {
      throw new Error("Sonarr has no matching saved Forms login verification");
    }
    const rootPath = savedRootFolderPath(checkpoint);
    if (rootPath === null) return setupRecord(context, status, apiKeyFile);
    if (checkpoint?.stage !== "root-folder-verified") {
      throw new Error("Sonarr root-folder setup is not verified; inspect before continuing");
    }
    if (!await rootFolderPresent(context, apiKey, rootPath)) {
      throw new Error("Sonarr saved root folder is absent; inspect before continuing");
    }
    return setupRecord(context, status, apiKeyFile, rootPath);
  },
  async firstRun(context) {
    if (context.appId !== APP_ID || !isAbsolute(context.projectRoot)) {
      throw new Error("Sonarr setup received a different app project");
    }
    const status = exactStatus(context, await context.status());
    const prior = await context.checkpoint.read();
    const rootPath = requestedRootFolderPath(context, prior);
    const key = await context.secrets.readServiceConfigXmlApiKey();
    if (!validApiKey(key)) throw new Error("Sonarr config.xml API key is invalid");
    const previousKey = await context.secrets.readApiKey();
    if (previousKey !== null && previousKey !== key) {
      throw new Error("Sonarr API key changed; inspect before replacing the saved key");
    }
    const apiKeyFile = previousKey === null
      ? await context.secrets.writeApiKey(key)
      : await context.secrets.apiKeyPath();
    if (apiKeyFile !== join(status.privateFiles as string, `${APP_ID}-api-key`)) {
      throw new Error("Sonarr private API key path is unavailable");
    }

    const password = await context.secrets.readAdminPassword();
    if (password.length < 32 || password.length > 128 || /[\r\n\u0000]/.test(password)) {
      throw new Error("Sonarr managed administrator password is invalid");
    }
    const config = hostConfig(await readJson(context, key, {
      method: "GET",
      path: "/api/v3/config/host",
    }));
    let origin: "fresh" | "resume" | null = null;
    if (verifiedCheckpoint(context, prior, status.passwordFile as string, apiKeyFile)) origin = "resume";
    if (!authConfigured(config)) {
      if (prior !== null) {
        throw new Error("Sonarr authentication differs after an attempted update; inspect before retrying");
      }
      if (config.authenticationMethod !== "none" || config.username !== "" || config.password !== "") {
        throw new Error("Sonarr already has different authentication; inspect before changing it");
      }
      const payload = {
        ...config,
        id: config.id,
        authenticationMethod: "forms",
        authenticationRequired: "enabled",
        username: "admin",
        password,
        passwordConfirmation: password,
      };
      const response = await context.http.request({
        method: "PUT",
        path: `/api/v3/config/host/${config.id}`,
        headers: { "X-Api-Key": key, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        approval: {
          action: "sonarr-configure-forms-auth",
          once: true,
          progress: "Set Sonarr Forms authentication to the private managed administrator credential",
        },
        beforeSendCheckpoint: { expectedRevision: null, stage: "auth-update-attempted",
          data: { passwordFile: status.passwordFile as string, apiKeyFile } },
      });
      if (response.status !== 202) {
        throw new Error("Sonarr authentication update was not confirmed; inspect before retrying");
      }
      origin = "fresh";
    }
    let readback = config;
    if (!authConfigured(config)) {
      readback = hostConfig(await readJson(context, key, {
        method: "GET",
        path: "/api/v3/config/host",
      }));
    }
    if (readback.id !== config.id || !authConfigured(readback)) {
      throw new Error("Sonarr authentication policy did not pass API readback");
    }
    await verifyFormsLogin(context, password);
    let checkpoint = await context.checkpoint.read();
    if (!verifiedCheckpoint(context, checkpoint, status.passwordFile as string, apiKeyFile)) {
      if (checkpoint !== null && (checkpoint.stage !== "auth-update-attempted"
        || !checkpoint.attemptedActions.includes("sonarr-configure-forms-auth")
        || checkpoint.data.passwordFile !== status.passwordFile
        || checkpoint.data.apiKeyFile !== apiKeyFile)) {
        throw new Error("Sonarr setup checkpoint differs; inspect before continuing");
      }
      checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: checkpoint?.revision ?? null,
        stage: "forms-login-verified", data: { passwordFile: status.passwordFile as string, apiKeyFile } });
    }
    if (rootPath === null) return setupProof.record(setupRecord(context, status, apiKeyFile), origin, "verified");
    if (checkpoint?.stage === "forms-login-verified") {
      checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision,
        stage: "root-folder-selected", data: { ...checkpoint.data, rootFolderPath: rootPath } });
    }
    if (!checkpoint || savedRootFolderPath(checkpoint) !== rootPath) {
      throw new Error("Sonarr root-folder selection differs; inspect before continuing");
    }
    const present = await rootFolderPresent(context, key, rootPath);
    if (present) {
      if (checkpoint.stage !== "root-folder-verified") {
        checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision,
          stage: "root-folder-verified", data: checkpoint.data });
      }
      return setupProof.record(setupRecord(context, status, apiKeyFile, rootPath), origin, "verified");
    }
    if (checkpoint.stage !== "root-folder-selected") {
      if (checkpoint.stage === "root-folder-create-attempted") {
        throw new Error("Sonarr root-folder create was attempted but the path is absent; inspect, never replay POST");
      }
      throw new Error("Sonarr saved root folder is absent; inspect before changing it");
    }
    const response = await context.http.request({
      method: "POST",
      path: "/api/v3/rootfolder",
      headers: { "X-Api-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ path: rootPath }),
      approval: {
        action: CREATE_ROOT_FOLDER,
        once: true,
        progress: "Create the selected Sonarr television root folder inside /data",
      },
      beforeSendCheckpoint: { expectedRevision: checkpoint.revision,
        stage: "root-folder-create-attempted", data: checkpoint.data },
    });
    if (response.status !== 201) {
      throw new Error("Sonarr root-folder create was not confirmed; inspect, never replay POST");
    }
    if (!await rootFolderPresent(context, key, rootPath)) {
      throw new Error("Sonarr root-folder create did not pass exact-path readback; inspect, never replay POST");
    }
    checkpoint = await context.checkpoint.read();
    if (!checkpoint || checkpoint.stage !== "root-folder-create-attempted"
      || !checkpoint.attemptedActions.includes(CREATE_ROOT_FOLDER)
      || savedRootFolderPath(checkpoint) !== rootPath) {
      throw new Error("Sonarr root-folder attempt checkpoint differs; inspect before continuing");
    }
    await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision,
      stage: "root-folder-verified", data: checkpoint.data });
    return setupProof.record(setupRecord(context, status, apiKeyFile, rootPath), origin, "verified");
  },
};

export default adapter;
