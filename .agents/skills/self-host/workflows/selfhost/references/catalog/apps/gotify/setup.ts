import { Buffer } from "node:buffer";
import { isAbsolute, join } from "node:path";

import {
  appliedStatus,
  type SetupAdapter,
  type SetupCompatibilityResult,
  type SetupCheckpoint,
  type SetupCheckpointUpdate,
  type SetupContext,
  type SetupHttpReadRequest,
  type SetupInspectionContext,
  type SetupRecord,
} from "../../types/setup";

const APP_ID = "gotify";
const SERVER_VERSION = "3.1.1";
const APPLICATION_NAME = "Auto-Stack";
const CREATE_ACTION = "gotify-create-application";
const API_KEY_BASENAME = "gotify-api-key";
const liveCompatibility = new WeakMap<SetupRecord, SetupCompatibilityResult>();

function liveRecord(record: SetupRecord, resumed: boolean): SetupRecord {
  if (resumed) {
    const result: SetupCompatibilityResult = { origin: "resume", credentialReadback: "verified" };
    record.setupCompatibility = result;
    liveCompatibility.set(record, result);
  }
  return record;
}

// Every route and response shape below is pinned to the official v3.1.1 API spec:
// https://raw.githubusercontent.com/gotify/server/v3.1.1/docs/spec.json

type CheckpointValue = string | number | boolean | null;
type CheckpointData = Record<string, CheckpointValue>;

type GotifySetupContext = SetupContext;
type GotifyReadContext = Pick<SetupInspectionContext, "appId" | "projectRoot" | "http">;
type GotifyResponse = Awaited<ReturnType<SetupContext["http"]["request"]>>;

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function checkpointData(value: unknown): CheckpointData {
  const data = object(value, "Gotify setup checkpoint data");
  const checked: CheckpointData = {};
  for (const [key, entry] of Object.entries(data)) {
    if (typeof entry === "string" || typeof entry === "boolean" || entry === null) {
      checked[key] = entry;
      continue;
    }
    if (typeof entry === "number" && Number.isFinite(entry)) {
      checked[key] = entry;
      continue;
    }
    throw new Error("Gotify setup checkpoint data contains an unsupported value");
  }
  return checked;
}

function validateCheckpoint(context: GotifyReadContext, value: unknown): SetupCheckpoint | null {
  if (value === null) return null;
  const checkpoint = object(value, "Gotify setup checkpoint");
  const allowedStages = [
    "admin-verified",
    "application-create-attempted",
    "application-response-validated",
    "application-token-saved",
  ];
  if (checkpoint.schemaVersion !== 1 || checkpoint.appId !== APP_ID
    || checkpoint.projectRoot !== context.projectRoot
    || !Number.isSafeInteger(checkpoint.revision) || Number(checkpoint.revision) < 0
    || typeof checkpoint.stage !== "string" || !allowedStages.includes(checkpoint.stage)
    || !Array.isArray(checkpoint.attemptedActions)
    || !checkpoint.attemptedActions.every((item) => typeof item === "string")) {
    throw new Error("Gotify setup checkpoint does not match this app project");
  }
  return {
    schemaVersion: 1,
    appId: APP_ID,
    projectRoot: context.projectRoot,
    revision: Number(checkpoint.revision),
    stage: checkpoint.stage,
    attemptedActions: checkpoint.attemptedActions as string[],
    data: checkpointData(checkpoint.data),
  };
}

function applicationId(data: CheckpointData): number {
  const value = data.applicationId;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error("Gotify has no verified application ID in its private setup checkpoint");
  }
  return value;
}

function privatePath(status: Record<string, unknown>, fileName: string): string {
  if (typeof status.privateFiles !== "string" || !isAbsolute(status.privateFiles)) {
    throw new Error("Gotify has no validated private-files directory in saved app status");
  }
  return join(status.privateFiles, fileName);
}

function basicAuthorization(username: string, password: string): string {
  if (username !== "admin" || password.length < 1 || password.length > 1024
    || /[\r\n\u0000]/.test(password)) {
    throw new Error("Gotify has no valid saved administrator credential");
  }
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

async function readJson(
  context: GotifyReadContext,
  options: SetupHttpReadRequest,
  message: string,
): Promise<unknown> {
  let response: GotifyResponse;
  try {
    response = await context.http.request(options);
  } catch {
    throw new Error(message);
  }
  if (!response.ok || response.status !== 200) throw new Error(message);
  try {
    return await response.json();
  } catch {
    throw new Error(message);
  }
}

async function verifyServer(context: GotifyReadContext): Promise<void> {
  const version = object(await readJson(context, {
    method: "GET",
    path: "/version",
  }, "Gotify version verification failed"), "Gotify version response");
  if (version.version !== SERVER_VERSION) {
    throw new Error("Gotify API setup is pinned to server version 3.1.1");
  }
}

async function verifyAdmin(context: GotifyReadContext, authorization: string): Promise<number> {
  const user = object(await readJson(context, {
    method: "GET",
    path: "/current/user",
    headers: { Authorization: authorization },
  }, "Gotify administrator login could not be verified"), "Gotify current-user response");
  if (user.name !== "admin" || user.admin !== true || typeof user.id !== "number"
    || !Number.isSafeInteger(user.id) || user.id < 1) {
    throw new Error("The saved Gotify account is not the expected administrator");
  }
  return user.id;
}

function verifySavedAdmin(checkpoint: SetupCheckpoint, adminUserId: number): void {
  if (checkpoint.data.adminUserId !== adminUserId) {
    throw new Error("Gotify's saved administrator identity changed; inspect before continuing");
  }
}

type ExistingApplication = { id: number; name: string };

async function applications(
  context: GotifyReadContext,
  authorization: string,
): Promise<ExistingApplication[]> {
  const value = await readJson(context, {
    method: "GET",
    path: "/application",
    headers: { Authorization: authorization },
  }, "Gotify application inventory could not be verified");
  if (!Array.isArray(value)) throw new Error("Gotify returned an invalid application inventory");
  const output: ExistingApplication[] = [];
  for (const item of value) {
    const application = object(item, "Gotify application inventory entry");
    if (typeof application.id !== "number" || !Number.isSafeInteger(application.id)
      || application.id < 1 || typeof application.name !== "string"
      || application.name.length < 1 || application.name.length > 512) {
      throw new Error("Gotify returned an invalid application inventory entry");
    }
    // Deliberately copy only ID and name. API tokens are never checkpointed or returned.
    output.push({ id: application.id, name: application.name });
  }
  return output;
}

function assertExpectedApplication(
  inventory: ExistingApplication[],
  data: CheckpointData,
): number {
  const id = applicationId(data);
  if (data.applicationName !== APPLICATION_NAME) {
    throw new Error("Gotify's saved application name does not match its setup checkpoint");
  }
  const matches = inventory.filter((application) => application.name === APPLICATION_NAME);
  if (matches.length !== 1 || matches[0].id !== id) {
    throw new Error("Gotify's saved application changed; inspect it before continuing");
  }
  return id;
}

function validApplicationToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 8192
    && value.trim() === value && !/[\r\n\u0000]/.test(value);
}

async function saveCheckpoint(
  context: GotifySetupContext,
  current: SetupCheckpoint | null,
  stage: string,
  data: CheckpointData,
): Promise<SetupCheckpoint> {
  const expectedRevision = current?.revision ?? null;
  try {
    const next = await context.checkpoint.compareAndSet({
      expectedRevision,
      stage,
      data,
    });
    const checked = validateCheckpoint(context, next);
    const nextRevision = (expectedRevision ?? 0) + 1;
    if (checked === null || checked.stage !== stage || checked.revision !== nextRevision) {
      throw new Error("checkpoint stage mismatch");
    }
    return checked;
  } catch {
    throw new Error("Gotify setup checkpoint could not be durably saved; inspect before retrying");
  }
}

function setupRecord(
  context: GotifyReadContext,
  appFile: string,
  applicationIdValue: number,
  adminUserId: number,
): SetupRecord {
  return {
    appId: APP_ID,
    projectRoot: context.projectRoot,
    stage: "admin-and-api-key-saved",
    adminUsername: "admin",
    adminUserId,
    serverVersion: SERVER_VERSION,
    applicationId: applicationIdValue,
    applicationName: APPLICATION_NAME,
    apiKeyFile: appFile,
  };
}

// This is only a candidate sidecar. Keep Gotify inspect-only until the shared CLI route
// and a fresh-instance acceptance run prove the complete lifecycle.
const adapter: SetupAdapter = {
  appId: APP_ID,
  compatibilityResult(record) {
    return liveCompatibility.get(record) ?? null;
  },
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  healthSource: null,
  homarrIntegration: "gotify",
  ready(record) {
    return record.appId === APP_ID && record.stage === "admin-and-api-key-saved"
      && record.adminUsername === "admin" && record.serverVersion === SERVER_VERSION
      && typeof record.adminUserId === "number" && Number.isSafeInteger(record.adminUserId)
      && record.adminUserId > 0
      && typeof record.applicationId === "number"
      && Number.isSafeInteger(record.applicationId)
      && record.applicationId > 0 && record.applicationName === APPLICATION_NAME
      && typeof record.apiKeyFile === "string" && isAbsolute(record.apiKeyFile);
  },
  async inspect(context) {
    if (context.appId !== APP_ID || !isAbsolute(context.projectRoot)) {
      throw new Error("Gotify inspection received a different app project");
    }
    const status = appliedStatus(context, await context.status());
    const checkpoint = validateCheckpoint(context, await context.checkpoint.read());
    await verifyServer(context);
    const password = await context.secrets.readAdminPassword();
    const authorization = basicAuthorization("admin", password);
    const adminUserId = await verifyAdmin(context, authorization);
    if (checkpoint?.stage !== "application-token-saved"
      || !checkpoint.attemptedActions.includes(CREATE_ACTION)) {
      throw new Error("Gotify has no completed one-time application checkpoint");
    }
    verifySavedAdmin(checkpoint, adminUserId);
    const id = assertExpectedApplication(
      await applications(context, authorization), checkpoint.data,
    );
    const apiKeyFile = privatePath(status, API_KEY_BASENAME);
    const apiKey = await context.secrets.readApiKey();
    if (!validApplicationToken(apiKey)
      || await context.secrets.apiKeyPath() !== apiKeyFile
      || checkpoint.data.apiKeyFile !== apiKeyFile) {
      throw new Error("Gotify has no matching private application token");
    }
    return setupRecord(context, apiKeyFile, id, adminUserId);
  },
  async firstRun(context) {
    if (context.appId !== APP_ID || !isAbsolute(context.projectRoot)) {
      throw new Error("Gotify setup received a different app project");
    }
    const status = appliedStatus(context, await context.status());
    let checkpoint = validateCheckpoint(context, await context.checkpoint.read());
    const resumed = checkpoint?.stage === "application-token-saved";

    let password: string;
    try {
      password = await context.secrets.readAdminPassword();
    } catch {
      throw new Error("Gotify's saved administrator password could not be read");
    }
    const authorization = basicAuthorization("admin", password);

    await verifyServer(context);
    const adminUserId = await verifyAdmin(context, authorization);

    if (checkpoint !== null) verifySavedAdmin(checkpoint, adminUserId);
    const savedApiKey = await context.secrets.readApiKey();
    const savedApiKeyPath = await context.secrets.apiKeyPath();
    const expectedApiKeyFile = privatePath(status, API_KEY_BASENAME);

    if (checkpoint?.stage === "application-create-attempted") {
      if (!checkpoint.attemptedActions.includes(CREATE_ACTION)
        || checkpoint.data.applicationName !== APPLICATION_NAME) {
        throw new Error("Gotify's application-create checkpoint is inconsistent; inspect manually");
      }
      // v3.1.1 strips tokens from GET /application and exposes no publisher-token
      // readback route. A private file alone cannot bind an uncertain create to
      // that application, so it must not promote this stage to verified.
      throw new Error("Gotify application creation may already have occurred; inspect manually and never retry it");
    }

    if (checkpoint?.stage === "application-response-validated"
      || checkpoint?.stage === "application-token-saved") {
      if (!checkpoint.attemptedActions.includes(CREATE_ACTION)) {
        throw new Error("Gotify's saved token checkpoint has no matching one-time create action");
      }
      const id = assertExpectedApplication(
        await applications(context, authorization), checkpoint.data,
      );
      if (savedApiKey === null || !validApplicationToken(savedApiKey)
        || savedApiKeyPath !== expectedApiKeyFile) {
        throw new Error("Gotify's one-time application token is missing; inspect it manually");
      }
      if (checkpoint.stage === "application-response-validated") {
        checkpoint = await saveCheckpoint(context, checkpoint, "application-token-saved", {
          ...checkpoint.data,
          apiKeyFile: expectedApiKeyFile,
        });
      }
      if (checkpoint.data.apiKeyFile !== expectedApiKeyFile) {
        throw new Error("Gotify's saved application-token path changed; inspect manually");
      }
      return liveRecord(setupRecord(context, expectedApiKeyFile, id, adminUserId), resumed);
    }

    if (checkpoint !== null && checkpoint.stage !== "admin-verified") {
      throw new Error("Gotify has an unrecognized application-token checkpoint");
    }
    if (checkpoint !== null && (checkpoint.data.adminUsername !== "admin"
      || checkpoint.data.serverVersion !== SERVER_VERSION
      || checkpoint.attemptedActions.includes(CREATE_ACTION))) {
      throw new Error("Gotify's administrator checkpoint is inconsistent; inspect manually");
    }
    if (savedApiKey !== null || savedApiKeyPath !== null) {
      throw new Error("Gotify has an application token without a matching setup checkpoint; inspect manually");
    }

    const inventory = await applications(context, authorization);
    const collisions = inventory.filter((application) => application.name === APPLICATION_NAME);
    if (collisions.length > 0) {
      throw new Error("A Gotify application named Auto-Stack already exists; inspect before setup");
    }

    if (checkpoint === null) {
      checkpoint = await saveCheckpoint(context, null, "admin-verified", {
        adminUsername: "admin",
        adminUserId,
        serverVersion: SERVER_VERSION,
      });
    }
    if (checkpoint.attemptedActions.includes(CREATE_ACTION)) {
      throw new Error("Gotify application creation was already attempted; inspect manually");
    }

    const response = await context.http.request({
      method: "POST",
      path: "/application",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: APPLICATION_NAME }),
      approval: {
        action: CREATE_ACTION,
        progress: "Create the Gotify Auto-Stack application once and capture its one-time token",
        once: true,
      },
      beforeSendCheckpoint: {
        expectedRevision: checkpoint.revision,
        stage: "application-create-attempted",
        data: { applicationName: APPLICATION_NAME, adminUserId },
      },
    });
    if (!response.ok || response.status !== 200) {
      throw new Error("Gotify application creation has an ambiguous outcome; inspect manually and do not retry");
    }

    let created: Record<string, unknown>;
    try {
      created = object(await response.json(), "Gotify application create response");
    } catch {
      throw new Error("Gotify application creation has an ambiguous outcome; inspect manually and do not retry");
    }
    if (created.name !== APPLICATION_NAME || typeof created.id !== "number"
      || !Number.isSafeInteger(created.id) || created.id < 1
      || !validApplicationToken(created.token)) {
      throw new Error("Gotify did not return a verifiable one-time token; inspect manually and do not retry");
    }

    const attemptedCheckpoint = validateCheckpoint(context, await context.checkpoint.read());
    if (attemptedCheckpoint === null || attemptedCheckpoint.stage !== "application-create-attempted"
      || !attemptedCheckpoint.attemptedActions.includes(CREATE_ACTION)
      || attemptedCheckpoint.data.applicationName !== APPLICATION_NAME) {
      throw new Error("Gotify's durable create-attempt checkpoint is missing; token capture stopped");
    }
    verifySavedAdmin(attemptedCheckpoint, adminUserId);
    let apiKeyFile: string;
    try {
      apiKeyFile = await context.secrets.writeApiKey(created.token);
    } catch {
      const recovered = await context.secrets.readApiKey();
      const recoveredPath = await context.secrets.apiKeyPath();
      if (recovered !== created.token || recoveredPath !== expectedApiKeyFile) {
        throw new Error("Gotify's one-time token could not be confirmed in its private file; inspect manually");
      }
      apiKeyFile = expectedApiKeyFile;
    }
    if (apiKeyFile !== expectedApiKeyFile
      || await context.secrets.apiKeyPath() !== expectedApiKeyFile) {
      throw new Error("Gotify's API-key file is outside its expected private path; inspect manually");
    }
    if (await context.secrets.readApiKey() !== created.token) {
      throw new Error("Gotify's captured application token does not match its private file; inspect manually");
    }

    checkpoint = await saveCheckpoint(context, attemptedCheckpoint, "application-response-validated", {
      adminUserId,
      applicationId: created.id,
      applicationName: APPLICATION_NAME,
    });
    checkpoint = await saveCheckpoint(context, checkpoint, "application-token-saved", {
      adminUserId,
      applicationId: created.id,
      applicationName: APPLICATION_NAME,
      apiKeyFile,
    });
    if (checkpoint.data.apiKeyFile !== expectedApiKeyFile) {
      throw new Error("Gotify's API-key path was not saved in its setup checkpoint");
    }
    assertExpectedApplication(await applications(context, authorization), checkpoint.data);
    // Startup-password login cannot prove a virgin seeded owner. Fresh setup
    // stays unwitnessed; this record also makes no publisher-delivery claim.
    return setupRecord(context, apiKeyFile, created.id, adminUserId);
  },
};

export default adapter;
