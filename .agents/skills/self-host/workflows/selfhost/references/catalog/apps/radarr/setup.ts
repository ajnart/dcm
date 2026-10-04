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

const APP_ID = "radarr";
const API_KEY_PATTERN = /^[0-9a-f]{32}$/;
const setupProof = createSetupProofRecorder();
const CREATE_ROOT_FOLDER = "radarr-create-root-folder";
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

function validRootFolderPath(value: unknown): value is string {
  return typeof value === "string" && value.length > "/data/".length
    && value.length <= 512 && value.startsWith("/data/") && !value.endsWith("/")
    && posix.normalize(value) === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function selectedRootFolder(context: SetupContext, saved: SetupCheckpoint | null): string | null {
  if (saved !== null && (saved.appId !== APP_ID || saved.projectRoot !== context.projectRoot)) {
    throw new Error("Radarr setup checkpoint belongs to a different app project");
  }
  const previous = saved?.data.rootFolderPath;
  if (previous !== undefined && !validRootFolderPath(previous)) {
    throw new Error("Radarr saved root folder is invalid; inspect before continuing");
  }
  if (saved !== null && ROOT_FOLDER_STAGES.includes(saved.stage) && previous === undefined) {
    throw new Error("Radarr root-folder checkpoint has no saved path; inspect before continuing");
  }
  if (!Object.hasOwn(context.inputs, "root-folder-path")) return previous ?? null;
  const requested = context.inputs["root-folder-path"];
  if (!validRootFolderPath(requested)) {
    throw new Error("Radarr root folder must be an exact directory under /data");
  }
  if (previous !== undefined && previous !== requested) {
    throw new Error("Radarr root folder differs from this project's saved selection; inspect before continuing");
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
  if (!Array.isArray(value)) throw new Error("Radarr root-folder inventory is invalid");
  const matches: Record<string, unknown>[] = [];
  for (const entry of value) {
    const folder = object(entry, "Radarr root folder");
    if (!Number.isSafeInteger(folder.id) || Number(folder.id) < 1
      || typeof folder.path !== "string" || typeof folder.accessible !== "boolean") {
      throw new Error("Radarr root-folder inventory has an invalid entry");
    }
    if (folder.path === path) matches.push(folder);
  }
  if (matches.length > 1) throw new Error("Radarr root-folder inventory has duplicate exact paths");
  if (matches.length === 0) return false;
  if (matches[0]?.accessible !== true) {
    throw new Error("Radarr selected root folder is not accessible inside /data");
  }
  return true;
}

function setupRecord(
  context: ReadContext,
  status: Record<string, unknown>,
  apiKeyFile: string,
  rootFolderPath: string | null = null,
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
  if (rootFolderPath !== null) {
    record.stage = "forms-login-and-root-folder-verified";
    record.rootFolderPath = rootFolderPath;
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
    throw new Error("Radarr did not require a Forms administrator login");
  }
  const response = await context.http.request({
    method: "POST",
    path: "/login",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: "admin", password }).toString(),
    approval: {
      action: "radarr-verify-forms-login",
      progress: "Verify the saved Radarr administrator password against the private login endpoint",
    },
  });
  if (response.status !== 302 || response.headers.get("location") !== "/") {
    throw new Error("Radarr rejected the saved Forms administrator login");
  }
  // The pinned controller issues a Forms identity only after checking this
  // username/password. API-key access alone cannot establish password ownership.
  const headers = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  const cookies = headers.map((header) => header.split(";", 1)[0] ?? "")
    .filter((value) => /^[a-z0-9]+Auth=[^;,\s\u0000-\u001f\u007f]+$/i.test(value));
  if (cookies.length !== 1) {
    throw new Error("Radarr did not establish an administrator session");
  }
  const authenticated = await context.http.request({
    method: "GET", path: "/", headers: { Accept: "text/html", Cookie: cookies[0]! },
  });
  if (authenticated.status !== 200) {
    throw new Error("Radarr saved administrator session did not pass readback");
  }
}

function verifiedCheckpoint(context: ReadContext, checkpoint: SetupCheckpoint | null,
  passwordFile: string, apiKeyFile: string): boolean {
  if (!checkpoint) return false;
  return checkpoint.appId === APP_ID && checkpoint.projectRoot === context.projectRoot
    && ["forms-login-verified", ...ROOT_FOLDER_STAGES].includes(checkpoint.stage)
    && checkpoint.data.passwordFile === passwordFile
    && checkpoint.data.apiKeyFile === apiKeyFile;
}

async function configureRootFolder(context: SetupContext, apiKey: string,
  saved: SetupCheckpoint, path: string): Promise<void> {
  if (saved.stage === "forms-login-verified") {
    saved = await context.checkpoint.compareAndSet({ expectedRevision: saved.revision,
      stage: "root-folder-selected", data: { ...saved.data, rootFolderPath: path } });
  }
  if (saved.data.rootFolderPath !== path || !ROOT_FOLDER_STAGES.includes(saved.stage)) {
    throw new Error("Radarr root-folder checkpoint differs; inspect before continuing");
  }
  if (saved.stage === "root-folder-selected"
    && saved.attemptedActions.includes(CREATE_ROOT_FOLDER)) {
    throw new Error("Radarr root-folder create was already attempted; inspect before continuing");
  }
  if (saved.stage === "root-folder-create-attempted"
    && !saved.attemptedActions.includes(CREATE_ROOT_FOLDER)) {
    throw new Error("Radarr root-folder create has no saved attempt; inspect before continuing");
  }
  let present = await rootFolderPresent(context, apiKey, path);
  if (!present) {
    if (saved.stage === "root-folder-create-attempted") {
      throw new Error("Radarr root-folder create was attempted but has no exact readback; never replay it");
    }
    if (saved.stage === "root-folder-verified") {
      throw new Error("Radarr verified root folder is absent; inspect before continuing");
    }
    const response = await context.http.request({
      method: "POST",
      path: "/api/v3/rootfolder",
      headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
      approval: { action: CREATE_ROOT_FOLDER, once: true,
        progress: `Create the selected Radarr root folder at ${path} once` },
      beforeSendCheckpoint: { expectedRevision: saved.revision,
        stage: "root-folder-create-attempted", data: saved.data },
    });
    if (response.status !== 201 || !response.ok) {
      throw new Error("Radarr root-folder creation did not return 201; inspect before retrying");
    }
    saved = await context.checkpoint.read() as SetupCheckpoint;
    if (saved?.stage !== "root-folder-create-attempted"
      || !saved.attemptedActions.includes(CREATE_ROOT_FOLDER)
      || saved.data.rootFolderPath !== path) {
      throw new Error("Radarr root-folder attempt checkpoint is missing; inspect before continuing");
    }
    present = await rootFolderPresent(context, apiKey, path);
  }
  if (!present) {
    throw new Error("Radarr root folder has no exact path readback; never replay creation");
  }
  if (saved.stage !== "root-folder-verified") {
    const verified = await context.checkpoint.compareAndSet({ expectedRevision: saved.revision,
      stage: "root-folder-verified", data: saved.data });
    if (verified.stage !== "root-folder-verified" || verified.data.rootFolderPath !== path
      || verified.revision !== saved.revision + 1) {
      throw new Error("Radarr root-folder verification checkpoint differs; inspect before continuing");
    }
  }
}

// Candidate sidecar only. Fresh-container acceptance remains required.
const adapter: SetupAdapter = {
  appId: APP_ID,
  compatibilityResult(record) {
    return setupProof.result(record);
  },
  inputDefinitions: [
    { key: "root-folder-path", label: "Movie root directory inside Radarr (/data/...)" },
  ],
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  healthSource: null,
  homarrIntegration: "Radarr",
  ready(record) {
    const authOnly = record.stage === "forms-login-verified";
    const withRootFolder = record.stage === "forms-login-and-root-folder-verified"
      && validRootFolderPath(record.rootFolderPath);
    return record.appId === APP_ID && (authOnly || withRootFolder)
      && record.adminUsername === "admin" && record.authenticationMethod === "forms"
      && record.authenticationRequired === "enabled"
      && typeof record.passwordFile === "string" && isAbsolute(record.passwordFile)
      && typeof record.apiKeyFile === "string" && isAbsolute(record.apiKeyFile);
  },
  async inspect(context) {
    if (context.appId !== APP_ID || !isAbsolute(context.projectRoot)) {
      throw new Error("Radarr inspection received a different app project");
    }
    const status = exactStatus(context, await context.status());
    const apiKey = await context.secrets.readApiKey();
    const apiKeyFile = await context.secrets.apiKeyPath();
    if (!validApiKey(apiKey) || typeof apiKeyFile !== "string" || !isAbsolute(apiKeyFile)
      || apiKeyFile !== join(status.privateFiles as string, `${APP_ID}-api-key`)) {
      throw new Error("Radarr has no matching private API key");
    }
    const config = hostConfig(await readJson(context, apiKey, {
      method: "GET",
      path: "/api/v3/config/host",
    }));
    if (!authConfigured(config)) throw new Error("Radarr Forms authentication policy is not configured");
    const saved = await context.checkpoint.read();
    if (!verifiedCheckpoint(context, saved, status.passwordFile as string, apiKeyFile)) {
      throw new Error("Radarr has no matching saved Forms login verification");
    }
    if (saved?.stage === "forms-login-verified") return setupRecord(context, status, apiKeyFile);
    if (saved?.stage !== "root-folder-verified" || !validRootFolderPath(saved.data.rootFolderPath)) {
      throw new Error("Radarr root folder has no completed checkpoint; resume its saved selection");
    }
    if (!await rootFolderPresent(context, apiKey, saved.data.rootFolderPath)) {
      throw new Error("Radarr saved root folder is absent; inspect the selected /data mount");
    }
    return setupRecord(context, status, apiKeyFile, saved.data.rootFolderPath);
  },
  async firstRun(context) {
    if (context.appId !== APP_ID || !isAbsolute(context.projectRoot)) {
      throw new Error("Radarr setup received a different app project");
    }
    const status = exactStatus(context, await context.status());
    let saved = await context.checkpoint.read();
    const rootFolderPath = selectedRootFolder(context, saved);
    const key = await context.secrets.readServiceConfigXmlApiKey();
    if (!validApiKey(key)) throw new Error("Radarr config.xml API key is invalid");
    const previousKey = await context.secrets.readApiKey();
    if (previousKey !== null && previousKey !== key) {
      throw new Error("Radarr API key changed; inspect before replacing the saved key");
    }
    const apiKeyFile = previousKey === null
      ? await context.secrets.writeApiKey(key)
      : await context.secrets.apiKeyPath();
    if (apiKeyFile !== join(status.privateFiles as string, `${APP_ID}-api-key`)) {
      throw new Error("Radarr private API key path is unavailable");
    }

    const password = await context.secrets.readAdminPassword();
    if (password.length < 32 || password.length > 128 || /[\r\n\u0000]/.test(password)) {
      throw new Error("Radarr managed administrator password is invalid");
    }
    const config = hostConfig(await readJson(context, key, {
      method: "GET",
      path: "/api/v3/config/host",
    }));
    let readback = config;
    let origin: "fresh" | "resume" | null = null;
    if (verifiedCheckpoint(context, saved, status.passwordFile as string, apiKeyFile)) origin = "resume";
    if (!authConfigured(config)) {
      if (saved !== null) {
        throw new Error("Radarr authentication differs after an attempted update; inspect before retrying");
      }
      if (config.authenticationMethod !== "none" || config.username !== "" || config.password !== "") {
        throw new Error("Radarr already has different authentication; inspect before changing it");
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
          action: "radarr-configure-forms-auth",
          once: true,
          progress: "Set Radarr Forms authentication to the private managed administrator credential",
        },
        beforeSendCheckpoint: { expectedRevision: null, stage: "auth-update-attempted",
          data: { passwordFile: status.passwordFile as string, apiKeyFile } },
      });
      if (response.status !== 202) {
        throw new Error("Radarr authentication update was not confirmed; inspect before retrying");
      }
      origin = "fresh";
      readback = hostConfig(await readJson(context, key, {
        method: "GET",
        path: "/api/v3/config/host",
      }));
    }
    if (readback.id !== config.id || !authConfigured(readback)) {
      throw new Error("Radarr authentication policy did not pass API readback");
    }
    await verifyFormsLogin(context, password);
    saved = await context.checkpoint.read();
    if (!verifiedCheckpoint(context, saved, status.passwordFile as string, apiKeyFile)) {
      if (saved !== null && (saved.stage !== "auth-update-attempted"
        || !saved.attemptedActions.includes("radarr-configure-forms-auth")
        || saved.data.passwordFile !== status.passwordFile
        || saved.data.apiKeyFile !== apiKeyFile)) {
        throw new Error("Radarr setup checkpoint differs; inspect before continuing");
      }
      saved = await context.checkpoint.compareAndSet({ expectedRevision: saved?.revision ?? null,
        stage: "forms-login-verified", data: { passwordFile: status.passwordFile as string, apiKeyFile } });
    }
    if (rootFolderPath === null) return setupProof.record(setupRecord(context, status, apiKeyFile), origin, "verified");
    await configureRootFolder(context, key, saved, rootFolderPath);
    return setupProof.record(setupRecord(context, status, apiKeyFile, rootFolderPath), origin, "verified");
  },
};

export default adapter;
