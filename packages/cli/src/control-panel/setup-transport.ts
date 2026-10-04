import { assertPrivatePath, protectPrivatePath, ownedByCurrentUser, privateMode } from "../lib/platform-private.ts";
import { request as nodeHttpRequest } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type {
  SetupCheckpoint,
  SetupCheckpointUpdate,
  SetupContainerCommand,
  SetupContainerResult,
  SetupPassboltRegistration,
  SetupHttpMethod,
  SetupHttpRequest,
  SetupHttpResponse,
  SetupJmapRequest,
  SetupJmapCapture,
  SetupRecord,
  SetupPeerTarget,
  SetupWebSocketRequest,
  SetupWarriorSnapshotRequest,
} from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { authenticatedJsonCommand, warriorIdleOpeningSnapshot } from "./setup-websocket.ts";
import { assertSabnzbdSetupSafety, SABNZBD_API_KEY_AWK, SABNZBD_SETUP_SAFETY_AWK } from "./sabnzbd-ini.ts";
import { privateCurlResponse } from "./setup-private-curl.ts";
import { readSharedHttpsTargetCa, type SharedHttpsTarget } from "../lib/shared-https-target.ts";
import { bootstrapPasswordProfile, parseBootstrapPassword } from "../lib/bootstrap-password-profile.ts";
import { socketIoApprovalEvent, socketIoIntentProfile } from "../lib/setup-socketio-profile.ts";
import { checkedBootstrapCapability } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/private-file.ts";
import { privateOpenPgpCustody, inspectPrivateOpenPgpPublicKey, readSavedPrivateOpenPgpIdentity } from "../lib/private-openpgp.ts";
import type { PrivateOpenPgpContext, SetupCrypto } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/private-openpgp.ts";
import { assertPassboltEmptyOrganization, compilePassboltRegistration, parsePassboltEnrollmentOutput } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/passbolt/configuration.ts";

type ApprovalQueue = { tail: Promise<void> };

type SetupTransportFacilities = {
  appId: string;
  projectRoot: string;
  readStatus(): Promise<unknown>;
  readHandoff(): Promise<unknown>;
  /** Actual owner resolver, not an adapter-supplied file path or validation flag. */
  verifyMutableConfigs?(): Promise<void>;
  /** Internal saved-selection resolver; never a status flag or adapter-supplied declaration. */
  resolveBootstrapCapabilityRecipe?(): Promise<unknown>;
  resolvePrivateOpenPgpContext?(): Promise<PrivateOpenPgpContext>;
  /** Internal exact-owner resolver; never supplied by an application adapter or status payload. */
  resolveHttpsTarget?(): Promise<SharedHttpsTarget | null>;
  /** Internal exact completed-owner resolver; adapters supply only a peer app ID. */
  resolvePeerTarget?(appId: string): Promise<SetupPeerTarget>;
  approve(action: string, token: string, progress: string): Promise<boolean>;
  approvalQueue: ApprovalQueue;
  inputDigest?: string;
  checkpointNamespace?: "acceptance";
  registerSecret(value: string): void;
  redact(value: string): string;
};

type SavedProject = {
  ownerKind: "standalone" | "shared";
  ownerRevision: number | null;
  manifestHash: string | null;
  ownerRecordHash: string | null;
  selectionFingerprint: string | null;
  ownerPhase: string | null;
  privateFileIds: readonly string[];
  port: number | null;
  projectId: string;
  dockerContext: string | null;
  composeTarget: string;
  appDirectory: string;
  privateFiles: string;
  passwordFile: string | null;
  tokenFile: string | null;
  origin: string | null;
  approval: string;
  checkpointNamespace?: "acceptance";
  httpsTarget?: SharedHttpsTarget;
};
type HttpSavedProject = SavedProject & { port: number; origin: string };

export class SetupTransportDeferred extends Error {}

const maxRequestBytes = 256 * 1024;
const maxResponseBytes = 1024 * 1024;
const maxCheckpointBytes = 64 * 1024;
const safeName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const projectName = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const methods = new Set<SetupHttpMethod>(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);

function fail(message: string): never {
  throw new Error(message);
}

function ownsPath(path: string, directory: string, label: string): void {
  let metadata;
  try {
    metadata = lstatSync(path);
    if (process.platform === "win32") assertPrivatePath(path, metadata.isDirectory() ? 0o700 : 0o600);
  } catch {
    fail(`${label} is unavailable; inspect the saved app project`);
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()
    || !ownedByCurrentUser(metadata) || !privateMode(metadata, 0o700)
    || realpathSync(path) !== path || (directory !== path && dirname(path) !== directory)) {
    fail(`${label} is not an exact owner-only directory`);
  }
}

function privateFile(path: string, directory: string, label: string): void {
  let metadata;
  try {
    metadata = lstatSync(path);
    if (process.platform === "win32") assertPrivatePath(path, metadata.isDirectory() ? 0o700 : 0o600);
  } catch {
    fail(`${label} is unavailable; inspect the saved app project`);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || !ownedByCurrentUser(metadata) || !privateMode(metadata, 0o600)
    || dirname(path) !== directory || realpathSync(path) !== path) {
    fail(`${label} is not an exact owner-only file`);
  }
}

function entryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    fail("A saved setup file could not be inspected safely");
  }
}

function externalAdminStatus(status: SetupRecord, appId: string): boolean {
  return appId === "seerr" && status.ownerKind === "shared"
    && status.loginVia === "jellyfin" && status.passwordFile === null;
}

function noAccountStatus(status: SetupRecord): boolean {
  return status.ownerKind === "shared" && status.loginVia === "none"
    && status.username === null && status.passwordFile === null;
}

function externalSecretStatus(status: SetupRecord): boolean {
  return status.ownerKind === "shared" && status.loginVia === "external-secret"
    && status.username === null && status.passwordFile === null;
}

function gpgClientStatus(status: SetupRecord): boolean {
  return status.ownerKind === "shared" && status.loginVia === "gpg-client-enrollment"
    && status.username === null && status.passwordFile === null;
}

function generatedApiTokenStatus(status: SetupRecord): boolean {
  return status.ownerKind === "shared" && status.loginVia === "api-token"
    && status.username === null && status.passwordFile === null;
}

function savedProject(value: unknown, handoffValue: unknown, appId: string,
  projectRoot: string, containerOnly = false): SavedProject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("Saved app status is unavailable; no setup request was sent");
  }
  const status = value as SetupRecord;
  const runtime = status.runtime && typeof status.runtime === "object"
    && !Array.isArray(status.runtime) ? status.runtime as SetupRecord : {};
  const connector = containerOnly && status.status === "connector-applied-unverified";
  const daemon = containerOnly && status.daemon === true && status.status === "applied";
  const portless = connector || daemon;
  if (status.command !== "app status" || status.appId !== appId || status.projectRoot !== projectRoot
    || (status.status !== "applied" && !connector) || status.mutation !== false || runtime.state !== "running") {
    fail("The exact saved app project is not confirmed running; no setup request was sent");
  }
  const projectId = status.projectId;
  const ownerKind = status.ownerKind === "shared" ? "shared" : "standalone";
  const port = status.port;
  const composeTarget = status.composeTarget;
  const dockerContext = status.dockerContext;
  const approval = status.applyApproval;
  if (projectId === null || projectId === undefined || (!portless && (port === null || port === undefined))
    || composeTarget === null || composeTarget === undefined || approval === null || approval === undefined) {
    throw new SetupTransportDeferred("No exact applied app origin is available; API setup was deferred");
  }
  if (typeof projectId !== "string" || !projectName.test(projectId)
    || (!portless && (!Number.isInteger(port) || Number(port) < 1024 || Number(port) > 65535))
    || typeof composeTarget !== "string"
    || dirname(composeTarget) !== join(projectRoot, ".selfhost",
      ownerKind === "shared" ? "shared" : "apps", projectId)
    || !/^compose\.[0-9a-f]{16}\.yaml$/.test(basename(composeTarget))
    || typeof approval !== "string"
    || !(ownerKind === "shared"
      ? new RegExp(`^SHARED-APPLY:${projectId}:[0-9a-f]{64}$`).test(approval)
      : new RegExp(`^APP-APPLY:${appId}:[0-9a-f]{64}$`).test(approval))) {
    fail("Saved app origin or apply identity is not trustworthy; no setup request was sent");
  }
  const ownerRevision = status.ownerRevision;
  const manifestHash = status.manifestHash;
  const ownerRecordHash = status.ownerRecordHash;
  const selectionFingerprint = status.selectionFingerprint;
  if (selectionFingerprint !== undefined && (typeof selectionFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(selectionFingerprint))) {
    fail("Saved app selection fingerprint is not trustworthy; no setup request was sent");
  }
  if (ownerRecordHash !== undefined && (typeof ownerRecordHash !== "string" || !/^[0-9a-f]{64}$/.test(ownerRecordHash))) {
    fail("Saved shared-owner record hash is not trustworthy; no setup request was sent");
  }
  if (connector && (ownerKind !== "shared" || status.connector !== true
    || status.frontendSharing !== "owner-front" || status.ownerPhase !== "completed"
    || typeof ownerRecordHash !== "string" || port !== null || status.url !== null
    || status.passwordFile !== null || typeof status.privateFiles !== "string")) {
    fail("Container setup needs the exact completed portless shared connector owner");
  }
  if (daemon && (ownerKind !== "shared" || status.ownerPhase !== "completed"
    || typeof ownerRecordHash !== "string" || port !== null || status.url !== null
    || !generatedApiTokenStatus(status) || typeof status.privateFiles !== "string")) {
    fail("Container setup needs the exact completed private daemon and generated token owner");
  }
  const privateFileIds = status.privateFileIds ?? [];
  if (!Array.isArray(privateFileIds) || privateFileIds.length > 32
    || privateFileIds.some((id: unknown) => typeof id !== "string" || !safeName.test(id))
    || new Set(privateFileIds).size !== privateFileIds.length) {
    fail("Saved declared private-file identities are invalid");
  }
  if (ownerKind === "shared" && (!Number.isSafeInteger(ownerRevision) || Number(ownerRevision) < 1
    || typeof manifestHash !== "string" || !/^[0-9a-f]{64}$/.test(manifestHash))) {
    fail("Saved shared-owner revision or manifest hash is not trustworthy; no setup request was sent");
  }
  if (ownerKind === "standalone" && (status.ownerKind !== undefined
    || ownerRevision !== undefined || manifestHash !== undefined)) {
    fail("Saved standalone app origin contains an unexpected owner identity");
  }
  if (dockerContext !== null && dockerContext !== undefined
    && (typeof dockerContext !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(dockerContext))) {
    fail("Saved Docker context is not trustworthy; no setup request was sent");
  }
  const appDirectory = dirname(composeTarget);
  let origin: string | null = null;
  if (!portless) origin = `http://127.0.0.1:${port}`;
  if (!portless && typeof status.url !== "string") {
    throw new SetupTransportDeferred("No trusted loopback origin is available; API setup was deferred");
  }
  if (status.url !== origin) {
    fail("Saved app origin does not match its exact loopback port; no setup request was sent");
  }
  const expectedPrivateFiles = ownerKind === "shared"
    ? join(appDirectory, "secrets", appId) : join(appDirectory, "secrets");
  let privateFiles = status.privateFiles;
  if (privateFiles !== undefined && privateFiles !== null && privateFiles !== expectedPrivateFiles) {
    fail("Saved app private-file reference does not match its exact project; no setup request was sent");
  }
  let passwordFile = status.passwordFile;
  const generatedApiToken = generatedApiTokenStatus(status);
  const passwordOptional = connector || externalAdminStatus(status, appId) || noAccountStatus(status)
    || externalSecretStatus(status) || gpgClientStatus(status) || generatedApiToken;
  if ((passwordFile === undefined || (passwordFile === null && !passwordOptional))
    || privateFiles === undefined || privateFiles === null) {
    if (!handoffValue || typeof handoffValue !== "object" || Array.isArray(handoffValue)) {
      throw new SetupTransportDeferred("No trusted private-file reference is available; API setup was deferred");
    }
    const handoff = handoffValue as SetupRecord;
    const reportedPassword = handoff.passwordFile ?? handoff.credentialFile;
    if (handoff.command !== "app handoff" || handoff.appId !== appId
      || handoff.mutation !== false || handoff.secretful !== false || handoff.url !== origin
      || typeof reportedPassword !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(basename(reportedPassword))) {
      throw new SetupTransportDeferred("No trusted private-file reference is available; API setup was deferred");
    }
    if (privateFiles === undefined || privateFiles === null) privateFiles = dirname(reportedPassword);
    if (passwordFile === undefined || passwordFile === null) passwordFile = reportedPassword;
  }
  if (typeof privateFiles !== "string" || privateFiles !== expectedPrivateFiles) {
    fail("Saved app private-file reference does not match its exact project; no setup request was sent");
  }
  if (passwordFile !== null && passwordFile !== undefined
    && (typeof passwordFile !== "string" || typeof privateFiles !== "string"
      || dirname(passwordFile) !== privateFiles
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(basename(passwordFile)))) {
    fail("Saved administrator password reference is not trustworthy; no setup request was sent");
  }
  ownsPath(appDirectory, dirname(appDirectory), "Saved app directory");
  if (ownerKind === "shared") ownsPath(dirname(privateFiles), appDirectory, "Saved shared secrets directory");
  ownsPath(privateFiles, dirname(privateFiles), "Saved app private-files directory");
  let tokenFile: string | null = null;
  if (generatedApiToken) {
    const handoff = handoffValue as SetupRecord | null;
    if (typeof status.tokenFile !== "string" || dirname(status.tokenFile) !== privateFiles
      || !safeName.test(basename(status.tokenFile))
      || !handoff || handoff.command !== "app handoff" || handoff.appId !== appId
      || handoff.ownerKind !== "shared" || handoff.projectRoot !== projectRoot
      || handoff.projectId !== projectId || handoff.ownerRevision !== ownerRevision
      || handoff.manifestHash !== manifestHash || handoff.mutation !== false
      || handoff.secretful !== false || handoff.url !== origin
      || handoff.loginVia !== "api-token" || handoff.username !== null
      || handoff.passwordFile !== null || handoff.privateFiles !== privateFiles
      || handoff.tokenFile !== status.tokenFile) {
      fail("Saved generated API-token reference does not match its exact shared project");
    }
    tokenFile = status.tokenFile;
    privateFile(tokenFile, privateFiles, "Saved generated API token");
  }
  return { ownerKind, ownerRevision: ownerKind === "shared" ? Number(ownerRevision) : null,
    manifestHash: ownerKind === "shared" ? manifestHash as string : null,
    ownerRecordHash: typeof ownerRecordHash === "string" ? ownerRecordHash : null,
    selectionFingerprint: typeof selectionFingerprint === "string" ? selectionFingerprint : null,
    ownerPhase: typeof status.ownerPhase === "string" ? status.ownerPhase : null,
    privateFileIds: [...privateFileIds], port: portless ? null : Number(port), projectId, dockerContext: dockerContext ?? null,
    composeTarget, appDirectory, privateFiles,
    passwordFile: typeof passwordFile === "string" ? passwordFile : null, tokenFile, origin, approval };
}

function secretText(value: string, label: string): string {
  if (value.length < 4 || value.length > 8192 || /[\r\n\0]/.test(value)) {
    fail(`${label} has an invalid format`);
  }
  return value;
}

function adminCaptureFormat(value: SetupContainerCommand["captureAdminPassword"]): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("Administrator password capture format is invalid");
  }
  if (value.format === "whole-stdout" && Object.keys(value).length === 1) return;
  if (value.format === "one-line" && Object.keys(value).length === 3
    && typeof value.prefix === "string" && typeof value.suffix === "string"
    && value.prefix.length >= 1 && value.prefix.length <= 128
    && value.suffix.length >= 1 && value.suffix.length <= 128
    && /^[\x20-\x7e]+$/.test(value.prefix) && /^[\x20-\x7e]+$/.test(value.suffix)) return;
  fail("Administrator password capture format is invalid");
}

function capturedAdminPassword(bytes: Buffer,
  format: NonNullable<SetupContainerCommand["captureAdminPassword"]>): string {
  const output = bytes.toString("utf8");
  if (!Buffer.from(output, "utf8").equals(bytes)) {
    fail("Generated administrator password output is invalid; inspect the saved checkpoint");
  }
  let password: string;
  if (format.format === "whole-stdout") {
    password = output.replace(/\r?\n$/, "");
  } else {
    const matches = output.split(/\r?\n/).filter((line) =>
      line.startsWith(format.prefix) && line.endsWith(format.suffix));
    if (matches.length !== 1) {
      fail("A unique generated administrator password was not found; inspect the saved checkpoint");
    }
    password = matches[0]!.slice(format.prefix.length, -format.suffix.length);
  }
  if (Buffer.byteLength(password, "utf8") > 8192 || /[\x00-\x1f\x7f]/.test(password)) {
    fail("Generated administrator password is invalid; inspect the saved checkpoint");
  }
  return secretText(password, "Generated administrator password");
}

function replaceAdminPassword(saved: SavedProject, expected: string, password: string): void {
  if (!saved.passwordFile) fail("No trusted saved admin-password file is available");
  const current = readOwnedText(saved.passwordFile, saved.privateFiles, "Saved admin password");
  if (createHash("sha256").update(current).digest("hex") !== expected) {
    fail("Saved admin password changed during capture; inspect the saved checkpoint");
  }
  const temporary = join(saved.privateFiles,
    `.admin-password-${process.pid}-${randomBytes(8).toString("hex")}.tmp`);
  let temporaryExists = false;
  try {
    const descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
      | (constants.O_NOFOLLOW ?? 0), 0o600);
    temporaryExists = true;
    try {
      protectPrivatePath(temporary, 0o600);
      writeFileSync(descriptor, password);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    const latest = readOwnedText(saved.passwordFile, saved.privateFiles, "Saved admin password");
    if (createHash("sha256").update(latest).digest("hex") !== expected) {
      fail("Saved admin password changed during capture; inspect the saved checkpoint");
    }
    renameSync(temporary, saved.passwordFile);
    temporaryExists = false;
    if (process.platform !== "win32") {
      const directory = openSync(saved.privateFiles, constants.O_RDONLY);
    try { fsyncSync(directory); } finally { closeSync(directory); }
    }
  } catch {
    fail("Generated administrator password could not be saved; inspect the saved checkpoint");
  } finally {
    if (temporaryExists) {
      try { unlinkSync(temporary); } catch { /* Preserve the original fail-closed result. */ }
    }
  }
}

function openOwnedFile(path: string, directory: string, label: string, maxBytes: number): number {
  privateFile(path, directory, label);
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const metadata = fstatSync(descriptor);
    const named = lstatSync(path);
  if (process.platform === "win32") assertPrivatePath(path, (named.isDirectory() ? 0o700 : 0o600));
    if (!metadata.isFile() || metadata.nlink !== 1 || !ownedByCurrentUser(metadata)
      || !privateMode(metadata, 0o600) || metadata.size < 1 || metadata.size > maxBytes
      || named.isSymbolicLink() || named.dev !== metadata.dev || named.ino !== metadata.ino) {
      fail(`${label} is not a valid owner-only file`);
    }
    return descriptor;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function readOwnedText(path: string, directory: string, label: string, maxBytes = 8192): string {
  const descriptor = openOwnedFile(path, directory, label, maxBytes);
  try {
    const bytes = readFileSync(descriptor);
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) fail(`${label} is not valid UTF-8`);
    return text;
  } finally {
    closeSync(descriptor);
  }
}

function collectSensitiveValues(value: unknown, redactor: (value: string) => void,
  key = "", depth = 0): void {
  if (depth > 8) return;
  if (typeof value === "string") {
    if (/(?:password|token|api.?key|secret|credential|authorization|cookie)/i.test(key)) redactor(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 128)) collectSensitiveValues(item, redactor, key, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [childKey, child] of Object.entries(value as Record<string, unknown>).slice(0, 128)) {
    collectSensitiveValues(child, redactor, childKey, depth + 1);
  }
}

function dataRecord(value: unknown, registerSecret: (value: string) => void):
  Record<string, string | number | boolean | null> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail("Setup checkpoint data must be a flat JSON object");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 64) fail("Setup checkpoint contains too many fields");
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, child] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)
      || ["constructor", "prototype"].includes(key.toLowerCase())
      || key === "__proto__"
      || (/(?:password|token|secret|api.?key|credential)/i.test(key)
        && !/(?:file|path|ref)$/i.test(key))) {
      fail("Setup checkpoint contains a disallowed field name");
    }
    if (child === null || typeof child === "boolean") result[key] = child;
    else if (typeof child === "number" && Number.isFinite(child)) result[key] = child;
    else if (typeof child === "string" && child.length <= 4096 && !/[\0]/.test(child)) {
      registerSecret(child);
      result[key] = child;
    } else fail("Setup checkpoint contains a disallowed field value");
  }
  return result;
}

type CheckpointLocation = Pick<SavedProject, "appDirectory" | "checkpointNamespace">;

function checkpointPath(project: CheckpointLocation, appId: string): string {
  return join(project.appDirectory, `${checkpointPrefix(project)}-${appId}.json`);
}

function checkpointPrefix(project: CheckpointLocation): string {
  if (project.checkpointNamespace === "acceptance") return "acceptance";
  return "first-run";
}

function namespaceIdentity(project: SavedProject): { checkpointNamespace?: "acceptance" } {
  if (project.checkpointNamespace === "acceptance") return { checkpointNamespace: "acceptance" };
  return {};
}

function readCheckpoint(project: CheckpointLocation, appId: string,
  projectRoot: string, registerSecret: (value: string) => void): SetupCheckpoint | null {
  const path = checkpointPath(project, appId);
  if (!entryExists(path)) return null;
  const raw = readOwnedText(path, project.appDirectory, "Saved setup checkpoint", maxCheckpointBytes);
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { fail("Saved setup checkpoint is invalid; inspect it before continuing"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("Saved setup checkpoint is invalid; inspect it before continuing");
  }
  const checkpoint = value as Record<string, unknown>;
  const actions = checkpoint.attemptedActions;
  if (checkpoint.schemaVersion !== 1 || checkpoint.appId !== appId
    || checkpoint.projectRoot !== projectRoot || !Number.isSafeInteger(checkpoint.revision)
    || Number(checkpoint.revision) < 1 || typeof checkpoint.stage !== "string"
    || !safeName.test(checkpoint.stage) || !Array.isArray(actions) || actions.length > 64
    || actions.some((action) => typeof action !== "string" || !safeName.test(action))
    || new Set(actions).size !== actions.length) {
    fail("Saved setup checkpoint does not match the exact app project; inspect before continuing");
  }
  const data = dataRecord(checkpoint.data, registerSecret);
  const expectedKeys = ["schemaVersion", "appId", "projectRoot", "revision", "stage", "attemptedActions", "data"];
  if (Object.keys(checkpoint).length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.hasOwn(checkpoint, key))) {
    fail("Saved setup checkpoint contains unexpected fields; inspect before continuing");
  }
  return { schemaVersion: 1, appId, projectRoot, revision: Number(checkpoint.revision),
    stage: checkpoint.stage, attemptedActions: actions as string[], data };
}

type RecoveryReference = { path: string; state: "missing" | "invalid" | "present" };
export type SetupRecoverySummary = {
  status: "saved-context" | "needs-inspection";
  checkpoint: RecoveryReference & { revision?: number; stage?: string; attemptedActions?: string[] };
  sessionCookies: RecoveryReference;
  setupAttempt: RecoveryReference;
  snapshotOnly: true; liveProof: false; browserProfile: false;
  sessionEnvelopeVerified: false; replayAuthorized: false;
};

/** Owner-derived references and sanitized checkpoint chronology only. Session
 * envelopes remain unread; presence never authorizes replay or proves login. */
export function readSetupRecoverySummary(project: Pick<SavedProject, "appDirectory" | "privateFiles">,
  appId: string, projectRoot: string): SetupRecoverySummary {
  if (!safeName.test(appId) || !isAbsolute(projectRoot) || resolve(projectRoot) !== projectRoot
    || !projectName.test(basename(project.appDirectory))
    || dirname(project.appDirectory) !== join(projectRoot, ".selfhost", "shared")
    || project.privateFiles !== join(project.appDirectory, "secrets", appId)) {
    fail("Setup recovery needs exact shared app-owned paths");
  }
  const checkpoint: SetupRecoverySummary["checkpoint"] = { path: checkpointPath(project, appId), state: "invalid" };
  const sessionCookies: RecoveryReference = { path: join(project.privateFiles, "session-cookies.json"), state: "invalid" };
  const setupAttempt: RecoveryReference = { path: join(project.privateFiles, "setup-attempt.json"), state: "invalid" };
  const summary: SetupRecoverySummary = { status: "needs-inspection", checkpoint, sessionCookies, setupAttempt,
    snapshotOnly: true, liveProof: false, browserProfile: false, sessionEnvelopeVerified: false, replayAuthorized: false };
  try {
    ownsPath(project.appDirectory, dirname(project.appDirectory), "Saved app directory");
    ownsPath(dirname(project.privateFiles), project.appDirectory, "Saved shared secrets directory");
    ownsPath(project.privateFiles, dirname(project.privateFiles), "Saved app private-files directory");
  } catch { return summary; }
  try {
    const saved = readCheckpoint(project, appId, projectRoot, () => {});
    checkpoint.state = "missing";
    if (saved) {
      if (saved.stage.length > 128 || saved.attemptedActions.some((action) => action.length > 128)) {
        checkpoint.state = "invalid";
      } else Object.assign(checkpoint, { state: "present", revision: saved.revision,
        stage: saved.stage, attemptedActions: [...saved.attemptedActions] });
    }
  } catch { /* Invalid recovery does not hide an otherwise valid credential handoff. */ }
  for (const reference of [sessionCookies, setupAttempt]) {
    try {
      if (!entryExists(reference.path)) { reference.state = "missing"; continue; }
      const descriptor = openOwnedFile(reference.path, project.privateFiles, "Saved recovery reference", maxCheckpointBytes);
      closeSync(descriptor);
      reference.state = "present";
    } catch { /* Metadata only; no session payload or raw failure crosses the handoff. */ }
  }
  if (checkpoint.state === "present" && [sessionCookies, setupAttempt].every((reference) => reference.state !== "invalid")) {
    summary.status = "saved-context";
  }
  return summary;
}

function writeCheckpoint(project: SavedProject, appId: string, projectRoot: string,
  update: SetupCheckpointUpdate, onceAction: string | null,
  registerSecret: (value: string) => void): SetupCheckpoint {
  const path = checkpointPath(project, appId);
  const lockPath = join(project.appDirectory, `${checkpointPrefix(project)}-${appId}.lock`);
  let lock: number;
  try {
    lock = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
      | (constants.O_NOFOLLOW ?? 0), 0o600);
  } catch {
    fail("A setup checkpoint lock is present; inspect the exact app project before continuing");
  }
  try {
    protectPrivatePath(lockPath, 0o600);
    writeFileSync(lock, `${process.pid}\n`);
    fsyncSync(lock);
    const current = readCheckpoint(project, appId, projectRoot, registerSecret);
    if (update.expectedRevision !== (current?.revision ?? null)) {
      fail("Setup checkpoint changed; inspect the exact app before continuing");
    }
    if (onceAction !== null && current?.attemptedActions.includes(onceAction)) {
      fail("This one-time setup action was already attempted; inspect it instead of replaying it");
    }
    const stage = update.stage;
    if (typeof stage !== "string" || !safeName.test(stage)) {
      fail("Setup checkpoint stage is invalid");
    }
    const data = dataRecord(update.data, registerSecret);
    const attemptedActions = [...(current?.attemptedActions ?? [])];
    if (onceAction !== null) attemptedActions.push(onceAction);
    const next: SetupCheckpoint = { schemaVersion: 1, appId, projectRoot,
      revision: (current?.revision ?? 0) + 1, stage, attemptedActions, data };
    const temporary = join(project.appDirectory,
      `.${checkpointPrefix(project)}-${appId}-${process.pid}-${randomBytes(8).toString("hex")}.tmp`);
    let temporaryExists = false;
    try {
      const descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
        | (constants.O_NOFOLLOW ?? 0), 0o600);
      temporaryExists = true;
      try {
        protectPrivatePath(temporary, 0o600);
        writeFileSync(descriptor, `${JSON.stringify(next)}\n`);
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      const existing = entryExists(path);
      if (existing) privateFile(path, project.appDirectory, "Saved setup checkpoint");
      renameSync(temporary, path);
      temporaryExists = false;
      if (process.platform !== "win32") {
        const directory = openSync(project.appDirectory, constants.O_RDONLY);
      try { fsyncSync(directory); } finally { closeSync(directory); }
      }
    } finally {
      if (temporaryExists) unlinkSync(temporary);
    }
    return next;
  } finally {
    closeSync(lock);
    unlinkSync(lockPath);
  }
}

function validatePath(path: string): void {
  if (typeof path !== "string" || path.length < 2 || path.length > 2048
    || !path.startsWith("/") || path.startsWith("//") || path.includes("?")
    || path.includes("#") || path.includes("\\") || path.includes("%")
    || !/^\/[A-Za-z0-9_./;-]+\/?$/.test(path)
    || path.split("/").some((segment) => [".", ".."].includes(segment.split(";")[0]!))) {
    fail("Setup HTTP accepts only a fixed path on the saved private origin");
  }
}

function requestTarget(path: string, query: SetupHttpRequest["query"]): string {
  validatePath(path);
  if (query === undefined) return path;
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    fail("Setup HTTP query must be a bounded map of non-secret values");
  }
  const entries = Object.entries(query).sort(([left], [right]) => {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
  if (entries.length === 0 || entries.length > 16) {
    fail("Setup HTTP query needs one to sixteen non-secret parameters");
  }
  const params = new URLSearchParams();
  for (const [name, value] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name)
      || /(?:password|passwd|token|key|secret|credential|cookie|auth|session)/i.test(name)
      || typeof value !== "string" || value.length > 1024 || /[\r\n\0]/.test(value)) {
      fail("Setup HTTP query contains an unsafe parameter");
    }
    params.append(name, value);
  }
  const target = `${path}?${params.toString()}`;
  if (target.length > 2048) fail("Setup HTTP query exceeds the bounded target length");
  return target;
}

function requestHeaders(value: Record<string, string> | undefined,
  registerSecret: (value: string) => void): Record<string, string> {
  const entries = Object.entries(value ?? {});
  if (entries.length > 16) fail("Setup HTTP contains too many headers");
  const headers: Record<string, string> = Object.create(null);
  headers.Accept = "application/json";
  for (const [name, raw] of entries) {
    const lower = name.toLowerCase();
    if (!/^[A-Za-z0-9-]+$/.test(name) || typeof raw !== "string"
      || raw.length > 8192 || /[\r\n\0]/.test(raw)
      || ["host", "connection", "keep-alive", "transfer-encoding", "content-length", "upgrade",
        "proxy-authorization", "proxy-connection", "te", "trailer", "expect",
        "x-http-method-override", "x-method-override", "x-original-method",
        "x-original-url", "x-rewrite-url"].includes(lower)
      || lower.startsWith("x-forwarded-")) {
      fail("Setup HTTP contains an unsafe header");
    }
    if (Object.keys(headers).some((existing) => existing.toLowerCase() === lower)) {
      delete headers[Object.keys(headers).find((existing) => existing.toLowerCase() === lower)!];
    }
    headers[name] = raw;
    if (/(?:authorization|token|api.?key|secret|password|cookie|credential)/i.test(name)) registerSecret(raw);
  }
  return headers;
}

function bodyBytes(body: SetupHttpRequest["body"], registerSecret: (value: string) => void): Buffer | undefined {
  if (body === undefined) return undefined;
  if (typeof body !== "string" && !(body instanceof Uint8Array)) {
    fail("Setup HTTP request body has an unsupported format");
  }
  const bytes = Buffer.from(body);
  if (bytes.byteLength > maxRequestBytes) fail("Setup HTTP request body exceeds the bounded size");
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      collectSensitiveValues(parsed, registerSecret);
    } catch { /* Non-JSON request bodies remain in memory only. */ }
  }
  return bytes;
}

/** One private response policy for both owned HTTP and pinned HTTPS wire transports. */
function setupResponse(status: number, bytes: Buffer,
  responseHeaders: Record<string, string | string[] | undefined>,
  registerSecret: (value: string) => void, requestOrigin: string): SetupHttpResponse {
  const text = bytes.toString("utf8");
  if (text.length > 0 && text.length <= 8192) registerSecret(text);
  for (const [name, value] of Object.entries(responseHeaders)) {
    if (value === undefined) continue;
    if (/(?:set-cookie|authorization|token|api.?key|secret|password|credential)/i.test(name)) {
      for (const item of Array.isArray(value) ? value : [value]) registerSecret(item);
    }
  }
  try { collectSensitiveValues(JSON.parse(text), registerSecret); } catch { /* Keep bodies private. */ }
  const safeHeaders = new Map<string, string>();
  const contentType = responseHeaders["content-type"];
  if (typeof contentType === "string") safeHeaders.set("content-type", contentType);
  // Native GPGAuth protocol headers remain private to the adapter. Never expose
  // arbitrary X-* headers or the upstream debug header (which can include tokens).
  for (const name of ["x-gpgauth-verify-response", "x-gpgauth-user-auth-token", "x-gpgauth-progress", "x-gpgauth-authenticated"]) {
    const value = responseHeaders[name];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length < 1 || value.length > 65536 || /[\x00-\x1f\x7f]/.test(value)) {
      fail("Private GPGAuth response header was invalid; payload withheld");
    }
    if (name === "x-gpgauth-progress" && !["stage0", "stage1", "stage2", "complete"].includes(value)) fail("Private GPGAuth stage was invalid");
    if (name === "x-gpgauth-authenticated" && !["true", "false"].includes(value)) fail("Private GPGAuth status was invalid");
    if (!["x-gpgauth-progress", "x-gpgauth-authenticated"].includes(name)) registerSecret(value);
    safeHeaders.set(name, value);
  }
  // Download identity stays private, but adapters must see the actual metadata
  // rather than treating a stripped partial response as a complete original.
  for (const name of ["content-disposition", "content-range"]) {
    const value = responseHeaders[name];
    if (value === undefined) continue;
    let maximum = 2048;
    if (name === "content-range") maximum = 256;
    if (typeof value !== "string" || value.length < 1 || value.length > maximum
      || /[\u0000-\u001f\u007f]/.test(value)) {
      fail("Local setup download metadata was invalid; payload withheld");
    }
    registerSecret(value);
    safeHeaders.set(name, value);
  }
  const contentLength = responseHeaders["content-length"];
  if (contentLength !== undefined) {
    if (typeof contentLength !== "string" || !/^[0-9]{1,16}$/.test(contentLength)
      || !Number.isSafeInteger(Number(contentLength))) {
      fail("Local setup download metadata was invalid; payload withheld");
    }
    safeHeaders.set("content-length", contentLength);
  }
  const challenge = responseHeaders["www-authenticate"];
  if (typeof challenge === "string" && challenge.length >= 1 && challenge.length <= 2048
    && !/[\u0000-\u001f\u007f]/.test(challenge)) safeHeaders.set("www-authenticate", challenge);
  const location = responseHeaders.location;
  if (typeof location === "string" && location.length <= 2048
    && !/[\u0000-\u001f\u007f\\]/.test(location)) {
    if (location.startsWith("/") && !location.startsWith("//")) {
      registerSecret(location);
      for (const value of new URL(location, requestOrigin).searchParams.values()) registerSecret(value);
      safeHeaders.set("location", location);
    } else {
      try {
        const redirect = new URL(location);
        if (redirect.origin === requestOrigin && !redirect.username && !redirect.password
          && !redirect.hash && !redirect.pathname.startsWith("//")) {
          // Expose only an owned path, never a new transport target or an automatic follow.
          const ownedLocation = `${redirect.pathname}${redirect.search}`;
          registerSecret(ownedLocation);
          for (const value of redirect.searchParams.values()) registerSecret(value);
          safeHeaders.set("location", ownedLocation);
        }
      } catch { /* Withhold malformed and foreign redirect targets. */ }
    }
  }
  const cookieHeaders = responseHeaders["set-cookie"];
  let rawCookies: string[] = [];
  if (Array.isArray(cookieHeaders)) rawCookies = cookieHeaders;
  else if (typeof cookieHeaders === "string") rawCookies = [cookieHeaders];
  let safeCookies: string[] = [];
  if (rawCookies.length <= 16 && rawCookies.every((cookie) =>
    cookie.length >= 1 && cookie.length <= 8192 && !/[\r\n]/.test(cookie))) safeCookies = rawCookies;
  if (safeCookies.length === 1) safeHeaders.set("set-cookie", safeCookies[0]!);
  return { status, ok: status >= 200 && status < 300,
    headers: { get(name) { return safeHeaders.get(String(name).toLowerCase()) ?? null; },
      getSetCookie() { return [...safeCookies]; } },
    async json() { try { return JSON.parse(text); }
      catch { throw new Error("Local setup response was not valid JSON; payload withheld"); } },
    async text() { return text; }, async arrayBuffer() { return Uint8Array.from(bytes).buffer; } };
}

function responseFor(project: HttpSavedProject, method: SetupHttpMethod, path: string,
  headers: Record<string, string>, body: Buffer | undefined,
  registerSecret: (value: string) => void, mayHaveMutated: boolean,
  timeoutMs: number): Promise<SetupHttpResponse> {
  return new Promise((resolve, reject) => {
    let completed = false;
    let received = 0;
    const chunks: Buffer[] = [];
    const req = nodeHttpRequest({ hostname: "127.0.0.1", port: project.port, method, path,
      headers, agent: false }, (res) => {
      res.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received += buffer.byteLength;
        if (received > maxResponseBytes) {
          req.destroy();
          if (!completed) {
            completed = true;
            reject(new Error("Local setup response exceeded the bounded size; inspect its checkpoint"));
          }
          return;
        }
        chunks.push(buffer);
      });
      res.on("error", () => {
        if (completed) return;
        completed = true;
        reject(new Error("Local setup response was interrupted; inspect its checkpoint"));
      });
      res.on("end", () => {
        if (completed) return;
        completed = true;
        try {
          resolve(setupResponse(res.statusCode ?? 0, Buffer.concat(chunks), res.headers,
            registerSecret, project.origin));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", () => {
      if (completed) return;
      completed = true;
      reject(new Error(mayHaveMutated
        ? "Local setup request outcome is unknown; inspect its saved checkpoint before retrying"
        : "Local setup read failed; inspect the exact app project"));
    });
    const deadline = setTimeout(() => req.destroy(new Error("timeout")), timeoutMs);
    req.once("close", () => clearTimeout(deadline));
    if (body) req.end(body);
    else req.end();
  });
}

async function serializedApproval<T>(queue: ApprovalQueue, action: () => Promise<T>): Promise<T> {
  const previous = queue.tail;
  let release = () => {};
  queue.tail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try { return await action(); }
  finally { release(); }
}

function fingerprint(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function approvalHttpIdentity(appId: string, input: SetupHttpRequest, target: string, body: Buffer | undefined) {
  const identity = { path: target, bodySha256: body ? createHash("sha256").update(body).digest("hex") : null };
  if (appId === "homarr" && input.method === "POST" && input.path === "/api/auth/callback/credentials"
    && input.approval?.action === "homarr-verify-admin") {
    const contentType = Object.entries(input.headers ?? {})
      .find(([name]) => name.toLowerCase() === "content-type")?.[1];
    if (!body || contentType !== "application/x-www-form-urlencoded"
      || (input.query && Object.keys(input.query).length !== 0)) {
      fail("Homarr administrator verification needs its exact credentials form");
    }
    const form = new URLSearchParams(body.toString("utf8"));
    const fields = ["name", "password", "csrfToken", "callbackUrl"];
    if ([...form.keys()].length !== fields.length || fields.some((field) => form.getAll(field).length !== 1)
      || !/^[A-Za-z0-9_-]{8,4096}$/.test(form.get("csrfToken")!)) {
      fail("Homarr administrator verification form has invalid or duplicate fields");
    }
    // CSRF is a fresh exchange challenge, not saved login intent. Never alter the wire form.
    const login = fields.filter((field) => field !== "csrfToken").map((field) => [field, form.get(field)]);
    return { path: target, bodySha256: createHash("sha256").update(JSON.stringify(login)).digest("hex") };
  }
  if (input.method !== "POST" || input.path !== "/socket.io/"
    || input.query?.EIO !== "4" || input.query?.transport !== "polling"
    || typeof input.query?.sid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(input.query.sid)
    || Object.keys(input.query).length !== 3 || !body) return identity;
  const profile = socketIoIntentProfile(appId);
  if (!profile) return identity;
  const event = socketIoApprovalEvent(profile, body.toString("utf8"), input.approval?.action);
  if (!event) return identity;
  // Session and acknowledgment IDs are exchange-local, not reviewed application intent.
  // Keep the real target/frame for the wire; bind approval to the full event, arguments, and auth headers.
  const headers = Object.entries(input.headers ?? {})
    .map(([name, value]) => [name.toLowerCase(), value]).sort(([left], [right]) => left!.localeCompare(right!));
  return { path: requestTarget(input.path, { EIO: "4", transport: "polling" }),
    bodySha256: createHash("sha256").update(JSON.stringify({ event, headers })).digest("hex") };
}

export function createSetupTransportFacilities(options: SetupTransportFacilities): {
  crypto: SetupCrypto;
  http: { request(request: SetupHttpRequest): Promise<SetupHttpResponse> };
  jmap: { request(request: SetupJmapRequest): Promise<{ status: number; json: unknown }>;
    captured(): Promise<SetupJmapCapture>; bootstrapRejectionPassword(): Promise<string>; restartBootstrap(): Promise<void> };
  webSocket: { request(request: SetupWebSocketRequest): Promise<unknown>;
    warriorIdleSnapshot(request: SetupWarriorSnapshotRequest): Promise<readonly unknown[]> };
  container: { exec(command: SetupContainerCommand): Promise<SetupContainerResult> };
  passbolt: import("../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts").SetupContext["passbolt"];
  peers: { resolveTarget(appId: string): Promise<SetupPeerTarget["target"]> };
  checkpoint: {
    read(): Promise<SetupCheckpoint | null>;
    compareAndSet(next: SetupCheckpointUpdate): Promise<SetupCheckpoint>;
  };
  secrets: {
    verifyMutableConfigs(): Promise<void>;
    readSessionCookies(): Promise<Record<string, string>>;
    writeSessionCookies(cookies: Readonly<Record<string, string>>): Promise<void>;
    readSetupSession(): Promise<Record<string, string> | null>;
    writeSetupSession(value: Readonly<Record<string, string>> | null): Promise<void>;
    readAdminPassword(): Promise<string>;
    readBootstrapCapability(): Promise<string>;
    readGeneratedApiToken(): Promise<string>;
    readServiceConfigXmlApiKey(): Promise<string>;
    readSabnzbdConfigIniApiKey(): Promise<string>;
    checkSabnzbdSetupSafety(): Promise<void>;
    readBootstrapPassword(): Promise<string>;
    readQbittorrentTemporaryPassword(): Promise<string>;
    apiKeyPath(): Promise<string | null>;
    readApiKey(): Promise<string | null>;
    writeApiKey(value: string): Promise<string>;
  };
} {
  const checkpointNamespace = options.checkpointNamespace;
  if (checkpointNamespace !== undefined && checkpointNamespace !== "acceptance") {
    fail("Setup transport checkpoint namespace is invalid");
  }
  async function project(): Promise<HttpSavedProject>;
  async function project(containerOnly: true): Promise<SavedProject>;
  async function project(containerOnly = false): Promise<SavedProject> {
    const status = await options.readStatus();
    const needsHandoff = Boolean(status && typeof status === "object"
      && (generatedApiTokenStatus(status as SetupRecord) || !(status as SetupRecord).privateFiles
        || (!(status as SetupRecord).passwordFile
          && !(containerOnly && (status as SetupRecord).status === "connector-applied-unverified")
          && !externalAdminStatus(status as SetupRecord, options.appId)
          && !externalSecretStatus(status as SetupRecord)
          && !gpgClientStatus(status as SetupRecord)
          && !noAccountStatus(status as SetupRecord))));
    const handoff = needsHandoff ? await options.readHandoff() : null;
    const saved = savedProject(status, handoff, options.appId, options.projectRoot, containerOnly);
    if (!containerOnly && options.resolveHttpsTarget) {
      const target = await options.resolveHttpsTarget();
      if (target) {
        if (saved.ownerKind !== "shared" || target.appId !== options.appId
          || target.projectId !== saved.projectId || target.ownerRevision !== saved.ownerRevision
          || target.manifestHash !== saved.manifestHash
          || target.caPath !== join(saved.appDirectory, "private-https-root.crt")) {
          fail("Shared HTTPS setup target does not match the exact saved app owner; no request was sent");
        }
        await readSharedHttpsTargetCa(target);
        saved.httpsTarget = structuredClone(target);
      }
    }
    if (checkpointNamespace === "acceptance") saved.checkpointNamespace = "acceptance";
    return saved;
  }

  async function readCurrentCheckpoint(saved: SavedProject): Promise<SetupCheckpoint | null> {
    return readCheckpoint(saved, options.appId, options.projectRoot, options.registerSecret);
  }

  async function sendResponse(saved: HttpSavedProject, method: SetupHttpMethod, path: string,
    headers: Record<string, string>, body: Buffer | undefined, mayHaveMutated: boolean,
    timeoutMs: number): Promise<SetupHttpResponse> {
    if (!saved.httpsTarget) {
      return responseFor(saved, method, path, headers, body, options.registerSecret, mayHaveMutated, timeoutMs);
    }
    const response = await privateCurlResponse(saved.httpsTarget, method, path, headers, body,
      saved.privateFiles, timeoutMs, async () => {
        const current = await project();
        if (fingerprint(current) !== fingerprint(saved)) {
          fail("Shared HTTPS setup owner or target changed before send; no request was sent");
        }
      });
    return setupResponse(response.status, response.bytes, response.headers,
      options.registerSecret, saved.httpsTarget.origin);
  }

  async function compareAndSet(update: SetupCheckpointUpdate,
    onceAction: string | null = null): Promise<SetupCheckpoint> {
    const saved = await project(true);
    return writeCheckpoint(saved, options.appId, options.projectRoot,
      update, onceAction, options.registerSecret);
  }

  async function resolveTarget(appId: string): Promise<SetupPeerTarget["target"]> {
    if (!safeName.test(appId) || appId.length > 47 || appId === options.appId || !options.resolvePeerTarget) {
      fail("Peer target resolution needs a different selected app and an exact shared-owner resolver");
    }
    const saved = await project(true);
    if (saved.ownerKind !== "shared" || saved.ownerPhase !== "completed" || !saved.ownerRecordHash) {
      fail("Peer targets need an exact completed shared owner record");
    }
    function checked(result: SetupPeerTarget): SetupPeerTarget["target"] {
      const target = result?.target;
      if (!target || result.ownerRevision !== saved.ownerRevision
        || result.ownerRecordHash !== saved.ownerRecordHash || result.manifestHash !== saved.manifestHash
        || target.appId !== appId || target.serviceId !== appId || target.hostname !== appId
        || target.projectId !== saved.projectId || target.frontNetworkId !== "front"
        || target.frontNetworkName !== `${saved.projectId}-front`
        || !["127.0.0.1", "::1"].includes(target.hostIp)
        || !Number.isInteger(target.targetPort) || target.targetPort < 1 || target.targetPort > 65535
        || !Number.isInteger(target.publishedPort) || target.publishedPort < 1024 || target.publishedPort > 65535
        || !/^[^\s@]+@sha256:[0-9a-f]{64}$/.test(target.image)
        || ![target.selectionFingerprint, target.ownerFingerprint, target.targetFingerprint]
          .every((hash) => typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash))) {
        fail("Resolved peer frontend differs from the exact saved shared owner");
      }
      return structuredClone(target);
    }
    const target = checked(await options.resolvePeerTarget(appId));
    const confirmed = await project(true);
    if (fingerprint(confirmed) !== fingerprint(saved)
      || fingerprint(checked(await options.resolvePeerTarget(appId))) !== fingerprint(target)) {
      fail("Shared owner or peer target changed during resolution");
    }
    return target;
  }

  async function request(input: SetupHttpRequest, jmap?: {
    endpoint: "recovery" | "https"; origin?: string; readOnly: boolean; beforeSend?: () => Promise<void>;
  }): Promise<SetupHttpResponse> {
    if (!input || typeof input !== "object" || !methods.has(input.method)) {
      fail("Setup HTTP method is not allowed");
    }
    if (input.requireHttps !== undefined && input.requireHttps !== true) {
      fail("Setup HTTP HTTPS requirement must be true when supplied");
    }
    const requireHttps = input.requireHttps === true;
    const target = requestTarget(input.path, input.query);
    for (const name of ["state", "nonce", "code", "code_challenge", "code_verifier"]) {
      const value = input.query?.[name];
      if (typeof value === "string") options.registerSecret(value);
    }
    async function selectedProject(): Promise<HttpSavedProject> {
      const selected = await project();
      if (jmap) {
        if (selected.ownerKind !== "shared" || selected.ownerPhase !== "completed") {
          fail("JMAP requires an exact completed shared owner");
        }
        if (jmap.endpoint === "https" && (!selected.httpsTarget || selected.httpsTarget.origin !== jmap.origin)) {
          fail("JMAP canonical HTTPS origin differs from the saved owner route");
        }
        if (jmap.endpoint === "recovery") delete selected.httpsTarget;
      }
      if (requireHttps && !selected.httpsTarget) {
        fail("Setup HTTP requires the exact saved HTTPS target; HTTP fallback is forbidden");
      }
      return selected;
    }
    const saved = await selectedProject();
    const headers = requestHeaders(input.headers, options.registerSecret);
    const body = bodyBytes(input.body, options.registerSecret);
    const timeoutMs = input.timeoutMs ?? 15_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
      fail("Setup HTTP timeout must be between 1 and 120 seconds");
    }
    const safeMethod = input.method === "GET" || input.method === "HEAD";
    const socketControl = input.method === "POST" && input.effect === "socketio-control";
    if (input.effect !== undefined && !socketControl) {
      fail("Setup HTTP control effect is limited to Socket.IO polling POST exchanges");
    }
    if (socketControl && (input.path !== "/socket.io/" || input.query?.EIO !== "4"
      || input.query?.transport !== "polling" || typeof input.query?.sid !== "string"
      || !/^[A-Za-z0-9_-]{1,128}$/.test(input.query.sid)
      || Object.keys(input.query).length !== 3
      || (body?.toString("utf8") !== "40" && body?.toString("utf8") !== "3"))) {
      fail("Setup HTTP Socket.IO control frame is not an exact polling connect or pong");
    }
    const approval = input.approval;
    if (socketControl && approval !== undefined) {
      fail("Setup HTTP Socket.IO control frame cannot carry a mutation approval");
    }
    const isReadOnly = (safeMethod || socketControl || jmap?.readOnly === true) && approval === undefined;
    if (!isReadOnly && (!approval || !safeName.test(approval.action)
      || typeof approval.progress !== "string" || approval.progress.length < 1
      || approval.progress.length > 2000)) {
      fail("Mutating setup HTTP needs an exact reviewed action approval");
    }
    if (input.method === "HEAD" && approval !== undefined) {
      fail("Setup HTTP does not permit a side-effecting HEAD request");
    }
    if (isReadOnly && (approval !== undefined || input.beforeSendCheckpoint !== undefined)) {
      fail("Read-only setup HTTP cannot carry a mutation checkpoint or approval");
    }
    if (safeMethod && body !== undefined) {
      fail("GET and HEAD setup requests cannot carry a request body");
    }
    if (input.beforeSendCheckpoint !== undefined && (!approval || approval.once !== true)) {
      fail("Pre-send checkpoints are limited to explicitly one-time setup actions");
    }
    if (approval?.once === true && input.beforeSendCheckpoint === undefined) {
      fail("One-time setup mutations must checkpoint their attempt before sending");
    }
    if (approval?.once !== true && input.beforeSendCheckpoint !== undefined) {
      fail("Pre-send checkpoint needs a one-time setup action");
    }
    if (isReadOnly) {
      return sendResponse(saved, input.method, target, headers, body, false,
        timeoutMs);
    }

    const refreshed = await serializedApproval(options.approvalQueue, async () => {
      const current = await readCurrentCheckpoint(saved);
      const attemptedActions = current?.attemptedActions ?? [];
      if (approval!.once && attemptedActions.includes(approval!.action)) {
        fail("This one-time setup action was already attempted; inspect it instead of replaying it");
      }
      const contentType = Object.entries(headers)
        .find(([name]) => name.toLowerCase() === "content-type")?.[1] ?? null;
      const identity = approvalHttpIdentity(options.appId, input, target, body);
      // NextAuth credentials login already binds the exact saved password and
      // normalizes its transient CSRF fields; that cookie isn't authorization.
      // Other cookies/bearers are part of the approved mutation identity.
      const approvalHeaders = Object.entries(headers)
        .map(([name, value]) => [name.toLowerCase(), value] as const)
        .filter(([name]) => !(name === "cookie" && options.appId === "homarr"
          && approval!.action === "homarr-verify-admin"
          && input.method === "POST" && input.path === "/api/auth/callback/credentials"))
        .sort(([left], [right]) => left.localeCompare(right));
      const token = `APP-SETUP-${approval!.action.toUpperCase()}:${options.appId}:${fingerprint({
        version: 2, appId: options.appId, projectRoot: options.projectRoot,
        projectId: saved.projectId, applyApproval: saved.approval, origin: saved.httpsTarget?.origin ?? saved.origin,
        ownerKind: saved.ownerKind, ownerRevision: saved.ownerRevision,
        manifestHash: saved.manifestHash,
        ...(saved.httpsTarget && { httpsTarget: saved.httpsTarget }),
        inputDigest: options.inputDigest ?? null,
        ...namespaceIdentity(saved),
        method: input.method, path: identity.path, contentType,
        headersSha256: fingerprint(approvalHeaders),
        timeoutMs,
        requireHttps,
        bodySha256: identity.bodySha256,
        checkpoint: current, beforeSendCheckpoint: input.beforeSendCheckpoint ?? null,
      })}`;
      const progress = options.redact(approval!.progress);
      const approved = await options.approve(approval!.action, token,
        `${input.method} ${input.path}${input.query ? ` (query: ${Object.keys(input.query).sort().join(", ")})` : ""}\n${progress}`);
      if (!approved) {
        throw new SetupTransportDeferred("Setup approval was declined; no HTTP request was sent");
      }

      // Re-read both project and checkpoint after review; stale approval cannot authorize a changed state.
      const confirmed = await selectedProject();
      if (confirmed.projectId !== saved.projectId || confirmed.port !== saved.port
        || confirmed.approval !== saved.approval || confirmed.origin !== saved.origin
        || confirmed.ownerKind !== saved.ownerKind
        || confirmed.ownerRevision !== saved.ownerRevision
        || confirmed.manifestHash !== saved.manifestHash
        || fingerprint(confirmed.httpsTarget ?? null) !== fingerprint(saved.httpsTarget ?? null)) {
        fail("Saved app identity changed during approval; no HTTP request was sent");
      }
      const latest = await readCurrentCheckpoint(confirmed);
      if (fingerprint(latest) !== fingerprint(current)) {
        fail("Setup checkpoint changed during approval; no HTTP request was sent");
      }
      if (input.beforeSendCheckpoint) {
        const expectedRevision = input.beforeSendCheckpoint.expectedRevision;
        if (expectedRevision !== (current?.revision ?? null)) {
          fail("One-time setup checkpoint does not match current saved progress");
        }
        await compareAndSet(input.beforeSendCheckpoint, approval!.once ? approval!.action : null);
      }
      if (jmap?.beforeSend) await jmap.beforeSend();
      const beforeWire = await selectedProject();
      if (fingerprint(beforeWire) !== fingerprint(confirmed)) {
        fail("Saved JMAP app owner changed before send; no request was sent");
      }
      return confirmed;
    });
    return sendResponse(refreshed, input.method, target, headers, body, true,
      timeoutMs);
  }

  async function jmapRequest(input: SetupJmapRequest): Promise<{ status: number; json: unknown }> {
    if (options.appId !== "stalwart-mail" || !input || input.path !== "/api"
      || !["recovery", "https"].includes(input.endpoint)
      || !["read", "write"].includes(input.effect) || typeof input.body !== "string"
      || Buffer.byteLength(input.body) > maxRequestBytes
      || Object.keys(input).some((key) => !["endpoint", "origin", "path", "authorization", "body", "effect", "beforeSend", "capture"].includes(key))) {
      fail("JMAP accepts only the pinned Stalwart management contract");
    }
    let envelope: Record<string, any>;
    try { envelope = JSON.parse(input.body); } catch { fail("JMAP envelope is invalid"); }
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)
      || Object.keys(envelope).sort().join(",") !== "methodCalls,using"
      || JSON.stringify(envelope.using) !== JSON.stringify(["urn:ietf:params:jmap:core", "urn:stalwart:jmap"])
      || !Array.isArray(envelope.methodCalls) || envelope.methodCalls.length !== 1) fail("JMAP envelope is invalid");
    const call = envelope.methodCalls[0];
    if (!Array.isArray(call) || call.length !== 3 || call[2] !== "c1"
      || !call[1] || typeof call[1] !== "object" || Array.isArray(call[1])) fail("JMAP call is invalid");
    const reads = ["x:Bootstrap/get", "x:SystemSettings/get", "x:Domain/get", "x:Account/get", "x:NetworkListener/get", "x:ApiKey/get"];
    const writes = ["x:Bootstrap/set", "x:ApiKey/set", "x:NetworkListener/set"];
    const readOnly = reads.includes(call[0]);
    let expectedEffect = "write";
    if (readOnly) expectedEffect = "read";
    if ((!readOnly && !writes.includes(call[0])) || input.effect !== expectedEffect
      || (readOnly && (input.beforeSend !== undefined || input.capture !== undefined))
      || (!readOnly && typeof input.beforeSend !== "function")) fail("JMAP method effect or pre-send checkpoint is invalid");
    if (input.capture !== undefined && !((call[0] === "x:Bootstrap/set" && input.capture === "administrator")
      || (call[0] === "x:ApiKey/set" && input.capture === "management-key"))) fail("JMAP credential capture differs from its pinned method");
    if (call[0] === "x:NetworkListener/set" && JSON.stringify(call[1]) !== JSON.stringify({ create: { selfhost: {
      name: "selfhost-management", protocol: "http", bind: { "[::]:8080": true }, useTls: false, tlsImplicit: false,
    } } })) fail("JMAP listener writes accept only the pinned HTTP-only management policy");
    let captureOwner: HttpSavedProject | null = null;
    let expectedPasswordHash: string | null = null;
    if (input.capture) {
      captureOwner = await project();
      if (captureOwner.ownerKind !== "shared" || !captureOwner.passwordFile || !captureOwner.selectionFingerprint) fail("JMAP capture requires the exact shared administrator selection owner");
      expectedPasswordHash = createHash("sha256").update(readOwnedText(captureOwner.passwordFile, captureOwner.privateFiles, "Saved admin password")).digest("hex");
      if (entryExists(join(captureOwner.privateFiles, `stalwart-${input.capture}-capture.json`))) fail("A once-returned JMAP credential was already captured; reconcile instead of recreating it");
    }
    if (typeof input.authorization !== "string" || !/^(?:Basic [A-Za-z0-9+/=]+|Bearer API_[A-Za-z0-9_-]+)$/.test(input.authorization)) {
      fail("JMAP requires bounded private administrator authentication");
    }
    const requestInput: SetupHttpRequest = { method: "POST", path: "/api",
      headers: { Authorization: input.authorization, "Content-Type": "application/json" }, body: input.body };
    if (!readOnly) {
      const current = await readCurrentCheckpoint(await project());
      let action = "stalwart-bootstrap";
      if (call[0] === "x:ApiKey/set") action = "stalwart-management-key";
      if (call[0] === "x:NetworkListener/set") action = "stalwart-management-listener";
      requestInput.approval = { action, progress: `Pinned Stalwart ${call[0]}; once-returned administrator credential, no replay`, once: true };
      requestInput.beforeSendCheckpoint = { expectedRevision: current?.revision ?? null,
        stage: `${action}-attempted`, data: current?.data ?? {} };
    }
    const response = await request(requestInput, { endpoint: input.endpoint, origin: input.origin, readOnly, beforeSend: input.beforeSend });
    let json: unknown = null;
    if (response.status === 200) json = await response.json();
    if (input.capture && response.status === 200) {
      // No await after receiving the parsed once-returned credential until both payload and receipt are fsynced.
      const envelope = json as Record<string, any>;
      const calls = envelope?.methodResponses;
      if (!Array.isArray(calls) || calls.length !== 1 || calls[0]?.[0] !== call[0] || calls[0]?.[2] !== "c1") fail("JMAP capture response differs from its exact method");
      const result = calls[0][1];
      let credential: Record<string, any>;
      if (input.capture === "administrator") credential = result?.updated?.singleton;
      else credential = result?.created?.selfhost;
      if (typeof credential?.secret === "string") options.registerSecret(credential.secret);
      if (input.capture === "administrator") {
        if (!/^[A-Za-z0-9]{16}$/.test(credential?.secret ?? "") || credential?.username !== `admin@${call[1]?.update?.singleton?.defaultDomain}`
          || Object.keys(result.notUpdated ?? {}).length !== 0) fail("Bootstrap response has no exact private administrator credential");
        replaceAdminPassword(captureOwner!, expectedPasswordHash!, credential.secret);
      } else {
        if (!/^API_[A-Za-z0-9_-]{38}$/.test(credential?.secret ?? "") || typeof credential?.id !== "string"
          || !credential.id || credential.id.length > 128 || Object.keys(result.notCreated ?? {}).length !== 0) fail("API-key response has no exact private management credential");
        captureJmapFile(captureOwner!, "stalwart-mail-api-key", credential.secret);
      }
      captureJmapFile(captureOwner!, `stalwart-${input.capture}-capture.json`, JSON.stringify({
        schemaVersion: 1, appId: options.appId, projectId: captureOwner!.projectId, selectionFingerprint: captureOwner!.selectionFingerprint,
        kind: input.capture, secretSha256: fingerprint(credential.secret),
        identity: credential.username ?? credential.id,
      }));
    }
    return { status: response.status, json };
  }

  function captureJmapFile(saved: SavedProject, name: string, value: string): void {
    const descriptor = openSync(join(saved.privateFiles, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      protectPrivatePath(join(saved.privateFiles, name), 0o600); writeFileSync(descriptor, value); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    if (process.platform !== "win32") {
      const directory = openSync(saved.privateFiles, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(directory); } finally { closeSync(directory); }
    }
  }

  async function jmapCaptured(): Promise<SetupJmapCapture> {
    if (options.appId !== "stalwart-mail") fail("JMAP capture is only available for Stalwart");
    const saved = await project();
    const result: SetupJmapCapture = { administrator: false, managementKeyId: null };
    if (saved.httpsTarget) result.httpsOrigin = saved.httpsTarget.origin;
    const transitionStatus = await options.readStatus() as SetupRecord;
    if (transitionStatus.environmentTransition?.name === "STALWART_RECOVERY_MODE"
      && transitionStatus.environmentTransition.value === null) {
      const id = ownedContainerId(saved);
      const format = 'absent{{range .Config.Env}}{{$parts := split . "="}}{{if or (eq (index $parts 0) "STALWART_RECOVERY_MODE") (eq (index $parts 0) "STALWART_RECOVERY_ADMIN")}}present{{end}}{{end}}';
      const inspected = spawnSync("docker", ["--context", saved.dockerContext!, "container", "inspect", "--format", format, id],
        { encoding: "utf8", timeout: 15000, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"] });
      if (inspected.error || inspected.status !== 0 || inspected.stdout.trim() !== "absent"
        || fingerprint(await project()) !== fingerprint(saved) || ownedContainerId(saved) !== id) {
        fail("Stalwart recovery variables are not proven absent from the exact running owner");
      }
      result.recoveryEnvironmentAbsent = true;
    }
    for (const kind of ["administrator", "management-key"] as const) {
      const receipt = join(saved.privateFiles, `stalwart-${kind}-capture.json`);
      if (!entryExists(receipt)) continue;
      let value: Record<string, any>;
      try { value = JSON.parse(readOwnedText(receipt, saved.privateFiles, "JMAP capture receipt")); }
      catch { fail("JMAP capture receipt is invalid; reconcile its uncertain outcome"); }
      if (value.schemaVersion !== 1 || value.appId !== options.appId || value.projectId !== saved.projectId
        || !saved.selectionFingerprint || value.selectionFingerprint !== saved.selectionFingerprint
        || value.kind !== kind || typeof value.identity !== "string") fail("JMAP capture receipt differs from its saved app selection owner");
      let credentialPath = join(saved.privateFiles, "stalwart-mail-api-key");
      if (kind === "administrator") credentialPath = saved.passwordFile!;
      const secret = readOwnedText(credentialPath, saved.privateFiles, "Captured JMAP credential");
      options.registerSecret(secret);
      if (value.secretSha256 !== fingerprint(secret)) fail("Captured JMAP credential changed; reconcile instead of replaying");
      if (kind === "administrator") result.administrator = true;
      else result.managementKeyId = value.identity;
    }
    return result;
  }

  async function bootstrapRejectionPassword(): Promise<string> {
    if (options.appId !== "stalwart-mail") fail("Bootstrap rejection proof is only available for Stalwart");
    const saved = await project();
    let value: Record<string, any>;
    try { value = JSON.parse(readOwnedText(join(saved.privateFiles, "stalwart-bootstrap-rejection.json"), saved.privateFiles, "Saved bootstrap rejection proof")); }
    catch { fail("Saved bootstrap rejection proof is invalid; preserve captures and inspect without recreating credentials"); }
    if (Object.keys(value).sort().join(",") !== "appId,password,projectId,schemaVersion,selectionFingerprint,username"
      || value.schemaVersion !== 1 || value.appId !== options.appId || value.projectId !== saved.projectId
      || !saved.selectionFingerprint || value.selectionFingerprint !== saved.selectionFingerprint
      || value.username !== "admin" || !/^[A-Za-z0-9]{16}$/.test(value.password ?? "")) fail("Saved bootstrap rejection proof differs from its exact app selection");
    options.registerSecret(value.password);
    return value.password;
  }

  async function restartBootstrap(): Promise<void> {
    if (options.appId !== "stalwart-mail" || !(await jmapCaptured()).administrator) fail("Stalwart restart requires a captured permanent administrator");
    const action = "stalwart-activate-captured-administrator";
    const saved = await project(true);
    if (saved.ownerKind !== "shared" || !saved.dockerContext || !options.verifyMutableConfigs || Object.hasOwn(process.env, "DOCKER_HOST")
      || Object.hasOwn(process.env, "DOCKER_CONTEXT")) fail("Stalwart activation requires its exact local shared owner");
    await serializedApproval(options.approvalQueue, async () => {
      const current = await readCurrentCheckpoint(saved);
      if (current?.attemptedActions.includes(action)) fail("Stalwart activation was already attempted; verify instead of restarting again");
      const token = `APP-SETUP-${action.toUpperCase()}:${options.appId}:${fingerprint({ version: 1, action, saved,
        inputDigest: options.inputDigest ?? null, checkpoint: current })}`;
      if (!await options.approve(action, token, "Restart only the exact owned Stalwart service to activate its captured administrator; retain recovery mode and no mail ports")) {
        throw new SetupTransportDeferred("Stalwart activation approval was declined; no restart ran");
      }
      if (fingerprint(await project(true)) !== fingerprint(saved)
        || fingerprint(await readCurrentCheckpoint(saved)) !== fingerprint(current)) fail("Stalwart owner changed before activation");
      const id = ownedContainerId(saved);
      await compareAndSet({ expectedRevision: current?.revision ?? null, stage: "stalwart-activation-attempted",
        data: current?.data ?? {} }, action);
      await options.verifyMutableConfigs!();
      if (fingerprint(await project(true)) !== fingerprint(saved) || ownedContainerId(saved) !== id) fail("Stalwart owner changed before restart");
      const restarted = spawnSync("docker", ["--context", saved.dockerContext!, "compose", "--project-name", saved.projectId,
        "--file", saved.composeTarget, "restart", "--no-deps", options.appId], {
        timeout: 30_000, maxBuffer: 64 * 1024, stdio: ["ignore", "pipe", "pipe"] });
      if (restarted.error || restarted.status !== 0) fail("Stalwart activation outcome is uncertain; retain capture and inspect without replay");
    });
  }

  async function warriorIdleSnapshot(input: SetupWarriorSnapshotRequest): Promise<readonly unknown[]> {
    if (options.appId !== "archive-team-warrior" || !input || typeof input !== "object"
      || Array.isArray(input) || Object.keys(input).sort().join(",") !== "authorization,path"
      || input.path !== "/000/auto-stack/websocket" || typeof input.authorization !== "string"
      || !/^Basic [A-Za-z0-9+/]+={0,2}$/.test(input.authorization) || input.authorization.length > 2048) {
      fail("Warrior snapshot accepts only the owned private read-only opening exchange");
    }
    options.registerSecret(input.authorization);
    const saved = await project();
    return warriorIdleOpeningSnapshot(saved.origin, input.authorization);
  }

  async function webSocketRequest(input: SetupWebSocketRequest): Promise<unknown> {
    if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).some((key) => !["path","accessToken","type","payload","approval","beforeSendCheckpoint"].includes(key))
      || options.appId !== "home-assistant" || input.path !== "/api/websocket"
      || !["auth/current_user","auth/long_lived_access_token"].includes(input.type)) {
      fail("Setup WebSocket accepts only the owned Home Assistant authentication commands");
    }
    if (typeof input.accessToken !== "string") fail("Setup WebSocket access token is invalid");
    const accessToken = secretText(input.accessToken,"Setup WebSocket access token");
    options.registerSecret(accessToken);
    const payload = input.payload ?? {};
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("Setup WebSocket payload is invalid");
    const readOnly = input.type === "auth/current_user";
    if (readOnly && (Object.keys(payload).length || input.approval !== undefined || input.beforeSendCheckpoint !== undefined)) {
      fail("Setup WebSocket owner inspection cannot carry payload, approval or mutation checkpoint");
    }
    if (!readOnly && (Object.keys(payload).sort().join(",") !== "client_name,lifespan"
      || typeof payload.client_name !== "string" || payload.client_name.length < 1 || payload.client_name.length > 128
      || /[\u0000-\u001f\u007f]/.test(payload.client_name)
      || !Number.isSafeInteger(payload.lifespan) || Number(payload.lifespan) < 1 || Number(payload.lifespan) > 3650)) {
      fail("Setup WebSocket token payload must have one bounded client name and lifespan");
    }
    const command = JSON.stringify({id:1,type:input.type,...payload});
    if (Buffer.byteLength(command) > maxRequestBytes) fail("Setup WebSocket command exceeds its bound");
    const saved = await project();
    if (readOnly) return authenticatedJsonCommand(saved.origin,accessToken,command,options.registerSecret);
    const approval = input.approval;
    if (!approval || !safeName.test(approval.action) || approval.once !== true
      || typeof approval.progress !== "string" || approval.progress.length < 1 || approval.progress.length > 2000
      || !input.beforeSendCheckpoint) fail("Setup WebSocket token creation requires one-time approval and pre-send checkpoint");
    const confirmed = await serializedApproval(options.approvalQueue,async () => {
      const current = await readCurrentCheckpoint(saved);
      if (current?.attemptedActions.includes(approval.action)) fail("This one-time WebSocket action was already attempted; inspect instead of replaying");
      const token = `APP-SETUP-${approval.action.toUpperCase()}:${options.appId}:${fingerprint({
        version:1, appId:options.appId,projectRoot:options.projectRoot, projectId:saved.projectId,
        applyApproval:saved.approval, origin:saved.origin, ownerKind:saved.ownerKind,
        ownerRevision:saved.ownerRevision,manifestHash:saved.manifestHash,inputDigest:options.inputDigest ?? null,
        ...namespaceIdentity(saved),
        protocol:"authenticated-json-websocket",path:input.path,commandSha256:fingerprint(command),
        accessTokenSha256:fingerprint(accessToken), checkpoint:current,beforeSendCheckpoint:input.beforeSendCheckpoint,
      })}`;
      if (!await options.approve(approval.action,token,options.redact(`WebSocket ${input.path} ${input.type}\n${approval.progress}`))) {
        throw new SetupTransportDeferred("Setup approval was declined; no WebSocket command was sent");
      }
      const latestProject = await project();
      if (fingerprint(latestProject) !== fingerprint(saved)) fail("Saved app identity changed during WebSocket approval");
      const latest = await readCurrentCheckpoint(latestProject);
      if (fingerprint(latest) !== fingerprint(current)
        || input.beforeSendCheckpoint!.expectedRevision !== (current?.revision ?? null)) fail("Setup checkpoint changed during WebSocket approval");
      await compareAndSet(input.beforeSendCheckpoint!,approval.action);
      return latestProject;
    });
    return authenticatedJsonCommand(confirmed.origin,accessToken,command,options.registerSecret);
  }

  async function verifyMutableConfigs(): Promise<void> {
    const saved = await project();
    if (saved.ownerKind !== "shared" || !options.verifyMutableConfigs) {
      fail("Saved mutable configuration requires its exact shared owner validator");
    }
    await options.verifyMutableConfigs();
    if (fingerprint(await project()) !== fingerprint(saved)) {
      fail("Saved app identity changed during mutable configuration validation");
    }
  }

  async function readAdminPassword(): Promise<string> {
    const saved = await project();
    if (!saved.passwordFile) fail("No trusted saved admin-password file is available");
    let value = readOwnedText(saved.passwordFile, saved.privateFiles, "Saved admin password");
    if (value.endsWith("\r\n")) value = value.slice(0, -2);
    else if (value.endsWith("\n")) value = value.slice(0, -1);
    const secret = secretText(value, "Saved admin password");
    options.registerSecret(secret);
    return secret;
  }

  async function readGeneratedApiToken(): Promise<string> {
    const saved = await project(true);
    if (saved.ownerKind !== "shared" || !saved.tokenFile) {
      fail("No trusted saved generated API-token file is available");
    }
    const secret = secretText(readOwnedText(saved.tokenFile, saved.privateFiles,
      "Saved generated API token"), "Saved generated API token");
    if (!/^[A-Za-z0-9_-]+$/.test(secret)) fail("Saved generated API token has an invalid format");
    options.registerSecret(secret);
    return secret;
  }

  async function readBootstrapCapability(): Promise<string> {
    const saved = await project();
    if (saved.ownerKind !== "shared" || !options.resolveBootstrapCapabilityRecipe) {
      fail("Bootstrap capability needs its exact saved shared recipe resolver");
    }
    const value = await options.resolveBootstrapCapabilityRecipe();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail("Bootstrap capability saved recipe is invalid");
    }
    const recipe = value as Record<string, any>;
    const declaration = checkedBootstrapCapability(recipe);
    if (recipe.appId !== options.appId || recipe.schemaVersion !== 2 || recipe.kind !== "multi-service-compose"
      || !declaration || !saved.privateFileIds.includes(declaration.id)
      || saved.passwordFile === join(saved.privateFiles, declaration.id)
      || saved.tokenFile === join(saved.privateFiles, declaration.id)) {
      fail("Bootstrap capability differs from its exact saved recipe identity");
    }
    const secret = readOwnedText(join(saved.privateFiles, declaration.id), saved.privateFiles,
      "Saved bootstrap capability", 32);
    if (!/^[0-9a-f]{32}$/.test(secret)) fail("Saved bootstrap capability has an invalid format");
    if (fingerprint(await project()) !== fingerprint(saved)
      || fingerprint(await options.resolveBootstrapCapabilityRecipe()) !== fingerprint(recipe)) {
      fail("Saved bootstrap capability owner changed during readback");
    }
    options.registerSecret(secret);
    return secret;
  }

  function ownedContainerId(saved: SavedProject): string {
    if (!saved.dockerContext || Object.hasOwn(process.env, "DOCKER_HOST")
      || Object.hasOwn(process.env, "DOCKER_CONTEXT")) {
      fail("The exact saved local Docker context is unavailable for container setup");
    }
    privateFile(saved.composeTarget, saved.appDirectory, "Saved Compose file");
    const base = ["--context", saved.dockerContext];
    const service = spawnSync("docker", [...base, "compose", "--project-name", saved.projectId,
      "--file", saved.composeTarget, "ps", "-q", options.appId], {
      encoding: "utf8", timeout: 15_000, maxBuffer: 64 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const id = service.stdout?.trim();
    if (service.error || service.status !== 0 || !/^[0-9a-f]{64}$/.test(id ?? "")) {
      fail("The exact app container could not be identified");
    }
    const inspected = spawnSync("docker", [...base, "container", "inspect", "--format",
      '{{.Id}}|{{.State.Running}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}|{{index .Config.Labels "com.docker.compose.project.working_dir"}}|{{index .Config.Labels "com.docker.compose.oneoff"}}', id], {
      encoding: "utf8", timeout: 15_000, maxBuffer: 64 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (inspected.error || inspected.status !== 0) {
      fail("The exact app container could not be inspected");
    }
    const fields = inspected.stdout.trim().split("|");
    const [observedId, running, projectId, serviceId, configFiles, workingDir, oneoff] = fields;
    if (fields.length !== 7 || observedId !== id || running !== "true" || projectId !== saved.projectId
      || serviceId !== options.appId || configFiles !== saved.composeTarget
      || workingDir !== saved.appDirectory || oneoff !== "False") {
      fail("The current app container does not match its saved Compose owner");
    }
    return id!;
  }

  async function exec(command: SetupContainerCommand, passboltRegistration?: ReturnType<typeof compilePassboltRegistration>): Promise<SetupContainerResult> {
    if (!command || typeof command !== "object") fail("Setup container command is invalid");
    const fixedPassboltIdentity = passboltRegistration !== undefined;
    if (fixedPassboltIdentity && (options.appId !== "passbolt" || command.effect !== "write"
      || JSON.stringify(command.argv) !== JSON.stringify(passboltRegistration.argv)
      || command.stdin !== undefined || command.captureAdminPassword !== undefined
      || command.privateFileRefs !== undefined)) {
      fail("Passbolt registration accepts only the source-bound public identity argv");
    }
    adminCaptureFormat(command.captureAdminPassword);
    if (command.stdin !== undefined && (typeof command.stdin !== "string"
      || command.stdin.length > 8192 || /\0/.test(command.stdin))) {
      fail("Setup container input is invalid");
    }
    const stdin = command.stdin ?? "";
    if (command.stdin !== undefined && stdin.trim().length < 4) {
      fail("Private container input is too short to protect from argument leakage");
    }
    if (stdin.trim().length >= 4) options.registerSecret(stdin.trim());
    if (!Array.isArray(command.argv) || command.argv.length < 1 || command.argv.length > 16
      || command.argv.some((part) => typeof part !== "string" || part.length < 1
        || part.length > 2048 || /[\0\r\n]/.test(part)
        || (!fixedPassboltIdentity && options.redact(part) !== part))) {
      fail("Setup container command has invalid or secret-bearing arguments");
    }
    const approval = command.approval;
    if (!approval || !safeName.test(approval.action)
      || typeof approval.progress !== "string" || approval.progress.length < 1
      || approval.progress.length > 2000) {
      fail("Setup container command needs an exact reviewed action approval");
    }
    if (command.effect === "write") {
      if (approval.once !== true || command.beforeSendCheckpoint === undefined) {
        fail("Container writes must be one-time and checkpoint before execution");
      }
    } else if (command.effect === "read") {
      if (approval.once === true || command.beforeSendCheckpoint !== undefined
        || command.captureAdminPassword !== undefined) {
        fail("Read-only container verification cannot carry a write checkpoint");
      }
    } else {
      fail("Setup container command needs a declared read or write effect");
    }
    const saved = await project(true);
    const refs = command.privateFileRefs ?? [];
    if (!Array.isArray(refs) || refs.length > 16 || new Set(refs).size !== refs.length
      || refs.some((name) => typeof name !== "string" || !safeName.test(name)
        || !saved.privateFileIds.includes(name))) {
      fail("Container private-file references must name declared exact owner-private files");
    }
    function privateHashes(owner: SavedProject): Record<string, string> {
      const hashes: Record<string, string> = {};
      for (const name of [...refs].sort()) {
        if (!owner.privateFileIds.includes(name)) fail("Container private-file declaration changed before execution");
        const value = readOwnedText(join(owner.privateFiles, name), owner.privateFiles, "Declared container private input");
        options.registerSecret(value);
        hashes[name] = createHash("sha256").update(value).digest("hex");
      }
      return hashes;
    }
    const privateFileHashes = privateHashes(saved);
    let expectedPasswordHash: string | null = null;
    if (command.captureAdminPassword !== undefined) {
      if (!saved.passwordFile) fail("No trusted saved admin-password file is available");
      expectedPasswordHash = createHash("sha256").update(readOwnedText(saved.passwordFile,
        saved.privateFiles, "Saved admin password")).digest("hex");
    }
    const confirmed = await serializedApproval(options.approvalQueue, async () => {
      const current = await readCurrentCheckpoint(saved);
      if (approval.once && current?.attemptedActions.includes(approval.action)) {
        fail("This one-time container action was already attempted; inspect it instead of replaying it");
      }
      const token = `APP-SETUP-${approval.action.toUpperCase()}:${options.appId}:${fingerprint({
        version: 1, appId: options.appId, projectRoot: options.projectRoot,
        projectId: saved.projectId, applyApproval: saved.approval,
        dockerContext: saved.dockerContext, composeTarget: saved.composeTarget,
        ownerKind: saved.ownerKind, ownerRevision: saved.ownerRevision,
        manifestHash: saved.manifestHash, ownerRecordHash: saved.ownerRecordHash,
        inputDigest: options.inputDigest ?? null,
        privateFileHashes,
        ...namespaceIdentity(saved),
        effect: command.effect, argv: command.argv,
        captureAdminPassword: command.captureAdminPassword ?? null,
        passboltRegistration: passboltRegistration ?? null,
        expectedPasswordHash,
        stdinSha256: createHash("sha256").update(stdin).digest("hex"),
        checkpoint: current, beforeSendCheckpoint: command.beforeSendCheckpoint ?? null,
      })}`;
      const approved = await options.approve(approval.action, token,
        `Exact owned container ${options.appId}\nExecutable: ${command.argv[0]} (${command.argv.length - 1} argument(s))\n${options.redact(approval.progress)}`);
      if (!approved) throw new SetupTransportDeferred("Container setup approval was declined; no command ran");
      const latestProject = await project(true);
      if (fingerprint(latestProject) !== fingerprint(saved)
        || fingerprint(privateHashes(latestProject)) !== fingerprint(privateFileHashes)) {
        fail("Saved app identity changed during container approval; no command ran");
      }
      const latest = await readCurrentCheckpoint(latestProject);
      if (fingerprint(latest) !== fingerprint(current)) {
        fail("Setup checkpoint changed during container approval; no command ran");
      }
      if (expectedPasswordHash !== null) {
        if (!latestProject.passwordFile || latestProject.passwordFile !== saved.passwordFile
          || createHash("sha256").update(readOwnedText(latestProject.passwordFile,
            latestProject.privateFiles, "Saved admin password")).digest("hex") !== expectedPasswordHash) {
          fail("Saved admin password changed during approval; no command ran");
        }
      }
      const id = ownedContainerId(latestProject);
      if (passboltRegistration) {
        // This fixed native read is covered by the exact source-bound approval.
        // Never expose its stdout/stderr: a nonempty organization contains PII.
        const freshness = spawnSync("docker", ["--context", latestProject.dockerContext!, "container", "exec", "-i",
          "--user", "www-data", id, ...passboltRegistration.freshnessArgv], {
          input: "", timeout: 15_000, maxBuffer: 64 * 1024, stdio: ["pipe", "pipe", "pipe"],
        });
        if (freshness.error || freshness.status !== 0 || (freshness.stderr?.length ?? 0) !== 0) {
          fail("Passbolt empty-organization verification failed; no administrator was registered");
        }
        assertPassboltEmptyOrganization((freshness.stdout ?? Buffer.alloc(0)).toString("utf8"));
      }
      if (command.beforeSendCheckpoint) {
        if (command.beforeSendCheckpoint.expectedRevision !== (current?.revision ?? null)) {
          fail("One-time container checkpoint does not match saved progress");
        }
        await compareAndSet(command.beforeSendCheckpoint, approval.once ? approval.action : null);
      }
      return { saved: latestProject, id };
    });
    const sendOwner = await project(true);
    if (fingerprint(sendOwner) !== fingerprint(confirmed.saved)
      || fingerprint(privateHashes(sendOwner)) !== fingerprint(privateFileHashes)
      || ownedContainerId(sendOwner) !== confirmed.id) {
      fail("Exact container or private-file input changed before execution; inspect its checkpoint");
    }
    const id = confirmed.id;
    const userArguments: string[] = [];
    if (passboltRegistration) userArguments.push("--user", "www-data");
    const result = spawnSync("docker", ["--context", confirmed.saved.dockerContext!, "container", "exec", "-i", ...userArguments,
      id, ...command.argv], {
      input: stdin, timeout: 15_000, maxBuffer: 64 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (result.error || !Number.isInteger(result.status)) {
      fail("Exact container command outcome is unknown; inspect the saved checkpoint before retrying");
    }
    const stdoutBytes = result.stdout ?? Buffer.alloc(0);
    if (stdoutBytes.length > 64 * 1024) fail("Exact container command returned too much output");
    if (passboltRegistration) {
      if (result.status !== 0) fail("Passbolt registration failed; inspect the attempted checkpoint without replay");
      const invitation = parsePassboltEnrollmentOutput(stdoutBytes.toString("utf8"), passboltRegistration.canonicalOrigin);
      const parsed = new URL(invitation.enrollmentUrl);
      const token = parsed.pathname.split("/").at(-1)!;
      options.registerSecret(invitation.enrollmentUrl);
      options.registerSecret(token);
      const path = join(confirmed.saved.privateFiles, "passbolt-enrollment.json");
      // No await or output between one-time stdout capture and durable custody.
      const descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        protectPrivatePath(path, 0o600);
        writeFileSync(descriptor, JSON.stringify({ schemaVersion: 1, projectId: confirmed.saved.projectId,
          selectionFingerprint: confirmed.saved.selectionFingerprint,
          canonicalOrigin: passboltRegistration.canonicalOrigin, email: passboltRegistration.expectedEmail,
          userId: invitation.userId, token }));
        fsyncSync(descriptor);
      } finally { closeSync(descriptor); }
      if (process.platform !== "win32") {
        const directory = openSync(confirmed.saved.privateFiles, constants.O_RDONLY);
      try { fsyncSync(directory); } finally { closeSync(directory); }
      }
      return { exitCode: 0, stdout: "" };
    }
    if (command.captureAdminPassword !== undefined) {
      if (result.status !== 0) {
        fail("Administrator password generation failed; inspect the saved checkpoint");
      }
      const password = capturedAdminPassword(stdoutBytes, command.captureAdminPassword);
      options.registerSecret(password);
      replaceAdminPassword(confirmed.saved, expectedPasswordHash!, password);
      return { exitCode: 0, stdout: "" };
    }
    const stdout = stdoutBytes.toString("utf8");
    if (stdout.trim().length >= 4) options.registerSecret(stdout.trim());
    return { exitCode: result.status!, stdout };
  }

  async function readPassboltInvitation(): Promise<{ userId: string; token: string } | null> {
    const saved = await project(true);
    if (options.appId !== "passbolt" || saved.ownerKind !== "shared" || options.checkpointNamespace) fail("Private enrollment is restricted to the shared Passbolt owner");
    const path = join(saved.privateFiles, "passbolt-enrollment.json");
    if (!entryExists(path)) return null;
    const bytes = readOwnedText(path, saved.privateFiles, "Private Passbolt invitation");
    let record: Record<string, unknown>;
    try { record = JSON.parse(bytes); } catch { fail("Private Passbolt invitation is invalid"); }
    if (Object.keys(record).sort().join(",") !== "canonicalOrigin,email,projectId,schemaVersion,selectionFingerprint,token,userId"
      || record.schemaVersion !== 1 || record.projectId !== saved.projectId
      || record.selectionFingerprint !== saved.selectionFingerprint
      || typeof record.canonicalOrigin !== "string" || typeof record.email !== "string"
      || typeof record.userId !== "string" || typeof record.token !== "string") fail("Private Passbolt invitation differs from its saved owner");
    const canonical = await project();
    if (!canonical.httpsTarget || canonical.httpsTarget.origin !== record.canonicalOrigin) fail("Private Passbolt invitation origin changed");
    parsePassboltEnrollmentOutput(`${record.canonicalOrigin}/setup/start/${record.userId}/${record.token}`, record.canonicalOrigin);
    options.registerSecret(record.token);
    const checkpoint = await readCurrentCheckpoint(saved);
    if (!checkpoint || checkpoint.data.email !== record.email || checkpoint.data.canonicalOrigin !== record.canonicalOrigin) fail("Private Passbolt invitation identity changed");
    return { userId: record.userId, token: record.token };
  }

  async function registerPassboltFirstAdmin(input: SetupPassboltRegistration) {
    if (options.appId !== "passbolt" || options.checkpointNamespace || await readPassboltInvitation()) fail("Passbolt registration requires one new owned invitation");
    const saved = await project();
    if (saved.ownerKind !== "shared" || !saved.httpsTarget || saved.httpsTarget.origin !== input.canonicalOrigin
      || !options.resolveBootstrapCapabilityRecipe) fail("Passbolt registration requires its approved shared HTTPS owner");
    const recipe = await options.resolveBootstrapCapabilityRecipe() as Record<string, any>;
    if (recipe?.appId !== "passbolt" || recipe.onboarding?.kind !== "gpg-client-enrollment"
      || recipe.services?.find((service: any) => service.id === "passbolt")?.imageTag !== "docker.io/passbolt/passbolt:5.16.0-1-ce") fail("Passbolt registration requires its exact pinned native recipe");
    const registration = compilePassboltRegistration(input, input.canonicalOrigin);
    await exec({ effect: "write", argv: registration.argv,
      approval: { action: "passbolt-register-first-admin", progress: "Privately verify an empty organization using pinned users_index, then register the exact first Passbolt administrator and capture its one-time invitation", once: true },
      beforeSendCheckpoint: input.beforeSendCheckpoint }, registration);
    const invitation = await readPassboltInvitation();
    if (!invitation) fail("Passbolt invitation was not captured; do not replay registration");
    return invitation;
  }

  async function readServiceConfigXmlApiKey(): Promise<string> {
    const saved = await project();
    if (!saved.dockerContext || Object.hasOwn(process.env, "DOCKER_HOST")
      || Object.hasOwn(process.env, "DOCKER_CONTEXT")) {
      fail("The exact saved local Docker context is unavailable for config.xml key reading");
    }
    privateFile(saved.composeTarget, saved.appDirectory, "Saved Compose file");
    const command = "sed -n 's:.*<ApiKey>\\([^<]*\\)</ApiKey>.*:\\1:p' /config/config.xml";
    const result = spawnSync("docker", ["--context", saved.dockerContext,
      "compose", "--project-name", saved.projectId, "--file", saved.composeTarget,
      "exec", "-T", options.appId, "sh", "-c", command], {
      encoding: "utf8", timeout: 15_000, maxBuffer: 64 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error || result.status !== 0) {
      fail("The exact owned service config.xml API key could not be read");
    }
    const key = result.stdout.trim().toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(key)) {
      fail("The exact owned service config.xml API key is not ready");
    }
    options.registerSecret(key);
    return key;
  }

  async function readSabnzbdIni(awk: string): Promise<string> {
    if (options.appId !== "sabnzbd") fail("INI API-key reading is limited to SABnzbd");
    const saved = await project();
    if (!saved.dockerContext || Object.hasOwn(process.env, "DOCKER_HOST")
      || Object.hasOwn(process.env, "DOCKER_CONTEXT")) {
      fail("The exact saved local Docker context is unavailable for SABnzbd config reading");
    }
    privateFile(saved.composeTarget, saved.appDirectory, "Saved Compose file");
    const result = spawnSync("docker", ["--context", saved.dockerContext,
      "compose", "--project-name", saved.projectId, "--file", saved.composeTarget,
      "exec", "-T", "sabnzbd", "awk", awk,
      "/config/sabnzbd.ini"], {
      encoding: "utf8", timeout: 15_000, maxBuffer: 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error || result.status !== 0) {
      fail("The exact owned SABnzbd config INI fields could not be read");
    }
    return result.stdout.trim();
  }

  async function readSabnzbdConfigIniApiKey(): Promise<string> {
    const key = await readSabnzbdIni(SABNZBD_API_KEY_AWK);
    if (!/^[0-9a-f]{32}$/.test(key)) {
      fail("The exact owned SABnzbd config INI API key is not ready");
    }
    options.registerSecret(key);
    return key;
  }

  async function checkSabnzbdSetupSafety(): Promise<void> {
    assertSabnzbdSetupSafety(await readSabnzbdIni(SABNZBD_SETUP_SAFETY_AWK));
  }

  async function readBootstrapPassword(): Promise<string> {
    const profile = bootstrapPasswordProfile(options.appId);
    if (!profile) {
      fail("Bootstrap password reading has no allowlisted profile for this app");
    }
    const saved = await project();
    if (!saved.dockerContext || Object.hasOwn(process.env, "DOCKER_HOST")
      || Object.hasOwn(process.env, "DOCKER_CONTEXT")) {
      fail("The exact saved local Docker context is unavailable for bootstrap inspection");
    }
    privateFile(saved.composeTarget, saved.appDirectory, "Saved Compose file");
    const baseArgs = ["--context", saved.dockerContext];
    const service = spawnSync("docker", [...baseArgs,
      "compose", "--project-name", saved.projectId, "--file", saved.composeTarget,
      "ps", "-q", options.appId], {
      encoding: "utf8", timeout: 15_000, maxBuffer: 64 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const id = service.stdout?.trim();
    if (service.error || service.status !== 0 || !/^[0-9a-f]{64}$/.test(id ?? "")) {
      fail("The exact bootstrap container could not be identified");
    }
    const inspected = spawnSync("docker", [...baseArgs, "container", "inspect", "--format",
      '{{.Id}}|{{.State.StartedAt}}|{{.State.Running}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}|{{index .Config.Labels "com.docker.compose.project.working_dir"}}', id], {
      encoding: "utf8", timeout: 15_000, maxBuffer: 64 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (inspected.error || inspected.status !== 0) {
      fail("The exact bootstrap container startup could not be inspected");
    }
    const inspectedFields = inspected.stdout.trim().split("|");
    const [observedId, startedAt, running, projectId, serviceId, configFiles, workingDir] = inspectedFields;
    const startedMs = Date.parse(startedAt ?? "");
    if (inspectedFields.length !== 7 || observedId !== id || running !== "true" || projectId !== saved.projectId
      || serviceId !== options.appId || configFiles !== saved.composeTarget
      || workingDir !== saved.appDirectory || !Number.isFinite(startedMs)
      || startedMs > Date.now() + 5_000 || startedMs < 1_577_836_800_000) {
      fail("The current bootstrap process does not match its saved Compose project");
    }
    const logs = spawnSync("docker", [...baseArgs, "container", "logs", "--since", startedAt,
      "--timestamps", id], {
      encoding: "utf8", timeout: 15_000, maxBuffer: 256 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (logs.error || logs.status !== 0) {
      fail("Current-start bootstrap logs could not be inspected privately");
    }
    const confirmed = spawnSync("docker", [...baseArgs, "container", "inspect", "--format",
      '{{.Id}}|{{.State.StartedAt}}|{{.State.Running}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}|{{index .Config.Labels "com.docker.compose.project.working_dir"}}', id], {
      encoding: "utf8", timeout: 15_000, maxBuffer: 64 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (confirmed.error || confirmed.status !== 0 || confirmed.stdout.trim() !== inspected.stdout.trim()) {
      fail("Bootstrap container identity or current start changed during private log inspection");
    }
    const currentLogs = `${logs.stdout ?? ""}\n${logs.stderr ?? ""}`;
    if (Buffer.byteLength(currentLogs) > 256 * 1024) fail("Private bootstrap logs exceed the capture bound");
    const timestamp = (value: string): bigint => {
      const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
      const millis = Date.parse(value);
      if (!match || !Number.isFinite(millis)
        || new Date(millis).toISOString().slice(0, 19) !== match[1]) {
        fail("Private bootstrap timestamp is invalid");
      }
      return BigInt(Date.parse(`${match[1]}Z`)) * 1_000_000n
        + BigInt((match[2] ?? "").padEnd(9, "0"));
    };
    const start = timestamp(startedAt!);
    const upperBound = BigInt(Date.now() + 5_000) * 1_000_000n;
    const lines = currentLogs.replace(/\u001b\[[0-9;]*m/g, "").split(/\r?\n/)
      .filter((line) => line.length > 0).map((line) => {
        const separator = line.indexOf(" ");
        if (separator < 1) fail("Private bootstrap log line has no Docker timestamp");
        const at = timestamp(line.slice(0, separator));
        if (at < start || at > upperBound) fail("Private bootstrap log line is outside the current start");
        return { at, text: line.slice(separator + 1) };
      }).sort((left, right) => {
        if (left.at < right.at) return -1;
        if (left.at > right.at) return 1;
        return 0;
      });
    const password = parseBootstrapPassword(profile, lines.map((line) => line.text), options.registerSecret);
    if (options.appId === "stalwart-mail") {
      if (!saved.selectionFingerprint) fail("Stalwart bootstrap rejection proof needs its exact selected recipe");
      const path = join(saved.privateFiles, "stalwart-bootstrap-rejection.json");
      if (entryExists(path)) {
        if (await bootstrapRejectionPassword() !== password) fail("Stalwart bootstrap process changed; preserve prior rejection proof and inspect");
      } else {
        captureJmapFile(saved, "stalwart-bootstrap-rejection.json", JSON.stringify({ schemaVersion: 1, appId: options.appId,
          projectId: saved.projectId, selectionFingerprint: saved.selectionFingerprint, username: "admin", password }));
      }
    }
    return password;
  }

  async function readQbittorrentTemporaryPassword(): Promise<string> {
    if (options.appId !== "qbittorrent") fail("Temporary WebUI password reading is limited to qBittorrent");
    return readBootstrapPassword();
  }

  async function enrollmentSessionBinding(saved: SavedProject): Promise<Record<string, unknown>> {
    if (!gpgClientStatus(await options.readStatus() as SetupRecord)) return { inputDigest: options.inputDigest ?? null };
    const { profile, confirm, saved: enrollmentOwner } = await openPgpOwner();
    if (fingerprint(enrollmentOwner) !== fingerprint(saved)) fail("Client enrollment session owner changed");
    await confirm();
    return { enrollment: { sourceUrl: profile.sourceUrl, recipeHash: profile.recipeHash,
      canonicalOrigin: profile.canonicalOrigin, name: profile.identity.name, email: profile.identity.email } };
  }

  async function sessionIdentity(saved: SavedProject): Promise<string> {
    return fingerprint({ version: 1, appId: options.appId, projectRoot: options.projectRoot,
      projectId: saved.projectId, origin: saved.origin, approval: saved.approval,
      ownerKind: saved.ownerKind,
      ...(saved.httpsTarget && { httpsTarget: saved.httpsTarget }),
      ...namespaceIdentity(saved),
      composeTarget: saved.composeTarget, ...await enrollmentSessionBinding(saved) });
  }

  function sessionCookies(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).length > 32) fail("Private setup-session cookies are invalid");
    const cookies: Record<string, string> = Object.create(null);
    for (const [name, cookie] of Object.entries(value)) {
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(name)
        || typeof cookie !== "string" || cookie.length > 8192 || /[^\x21-\x7e]|[;,\\"]/.test(cookie)) {
        fail("Private setup-session cookie has an invalid name or value");
      }
      options.registerSecret(cookie);
      cookies[name] = cookie;
    }
    if (Buffer.byteLength(JSON.stringify(cookies)) > 32768) fail("Private setup-session cookies exceed the limit");
    return cookies;
  }

  async function readSavedSession(saved: SavedProject): Promise<Record<string, string>> {
    let sessionName = "session-cookies.json";
    if (saved.checkpointNamespace === "acceptance") sessionName = "acceptance-session-cookies.json";
    const path = join(saved.privateFiles, sessionName);
    if (!entryExists(path)) return {};
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(readOwnedText(path, saved.privateFiles, "Private setup-session cookies", 65536));
    } catch {
      fail("Private setup-session cookies could not be read safely");
    }
    if (!record || record.schemaVersion !== 1 || record.identity !== await sessionIdentity(saved)) {
      fail("Private setup-session cookies belong to a different app owner or origin");
    }
    return sessionCookies(record.cookies);
  }

  async function readSessionCookies(): Promise<Record<string, string>> {
    return readSavedSession(await project());
  }

  async function writeSessionCookies(value: Readonly<Record<string, string>>): Promise<void> {
    const saved = await project();
    const cookies = sessionCookies(value);
    let sessionName = "session-cookies.json";
    if (saved.checkpointNamespace === "acceptance") sessionName = "acceptance-session-cookies.json";
    const path = join(saved.privateFiles, sessionName);
    await readSavedSession(saved);
    const identity = await sessionIdentity(saved);
    const temporary = join(saved.privateFiles, `.session-cookies-${process.pid}-${randomBytes(8).toString("hex")}.tmp`);
    let temporaryExists = false;
    try {
      const descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
        | (constants.O_NOFOLLOW ?? 0), 0o600);
      temporaryExists = true;
      try {
        protectPrivatePath(temporary, 0o600);
        writeFileSync(descriptor, JSON.stringify({ schemaVersion: 1, identity, cookies }));
        fsyncSync(descriptor);
      } finally { closeSync(descriptor); }
      const confirmed = await project();
      if (fingerprint(confirmed) !== fingerprint(saved) || await sessionIdentity(confirmed) !== identity) {
        fail("Saved app owner or enrollment identity changed before cookie persistence");
      }
      if (entryExists(path)) privateFile(path, saved.privateFiles, "Private setup-session cookies");
      renameSync(temporary, path);
      temporaryExists = false;
      if (process.platform !== "win32") {
        const directory = openSync(saved.privateFiles, constants.O_RDONLY);
      try { fsyncSync(directory); } finally { closeSync(directory); }
      }
    } catch {
      fail("Private setup-session cookies could not be saved safely");
    } finally {
      if (temporaryExists) {
        try { unlinkSync(temporary); } catch { /* Preserve the original failure. */ }
      }
    }
  }

  async function setupSessionIdentity(saved: SavedProject): Promise<string> {
    return fingerprint({ version: 1, appId: options.appId, projectRoot: options.projectRoot,
      projectId: saved.projectId, ownerKind: saved.ownerKind, origin: saved.origin,
      selectionFingerprint: saved.selectionFingerprint ?? saved.approval,
      httpsOrigin: saved.httpsTarget?.origin ?? null,
      ...await enrollmentSessionBinding(saved), ...namespaceIdentity(saved) });
  }

  function setupSessionValue(value: unknown): Record<string, string> | null {
    if (value === null) return null;
    if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).length > 32) fail("Private setup-attempt material is invalid");
    const data: Record<string, string> = Object.create(null);
    for (const [key, item] of Object.entries(value)) {
      if (!/^[a-z][A-Za-z0-9_-]{0,63}$/.test(key)
        || ["constructor", "prototype", "__proto__"].includes(key)
        || typeof item !== "string" || item.length > 8192 || /[\u0000-\u001f\u007f]/.test(item)) {
        fail("Private setup-attempt material has invalid fields");
      }
      options.registerSecret(item);
      data[key] = item;
    }
    if (Buffer.byteLength(JSON.stringify(data)) > 32768) fail("Private setup-attempt material exceeds the limit");
    return data;
  }

  async function readSetupSessionRecord(saved: SavedProject): Promise<Record<string, string> | null> {
    const path = join(saved.privateFiles, "setup-attempt.json");
    if (!entryExists(path)) return null;
    let record: Record<string, unknown>;
    try { record = JSON.parse(readOwnedText(path, saved.privateFiles, "Private setup-attempt material", 65536)); }
    catch { fail("Private setup-attempt material could not be read safely"); }
    if (!record || Object.keys(record).sort().join(",") !== "data,identity,schemaVersion"
      || record.schemaVersion !== 1 || record.identity !== await setupSessionIdentity(saved)) {
      fail("Private setup-attempt material belongs to a different app owner or origin");
    }
    return setupSessionValue(record.data);
  }

  async function readSetupSession(): Promise<Record<string, string> | null> {
    return readSetupSessionRecord(await project());
  }

  async function writeSetupSession(value: Readonly<Record<string, string>> | null): Promise<void> {
    const saved = await project();
    if (saved.checkpointNamespace === "acceptance") fail("Inspection cannot replace setup-attempt material");
    const data = setupSessionValue(value);
    const previous = await readSetupSessionRecord(saved);
    const identity = await setupSessionIdentity(saved);
    const path = join(saved.privateFiles, "setup-attempt.json");
    const temporary = join(saved.privateFiles, `.setup-attempt-${process.pid}-${randomBytes(8).toString("hex")}.tmp`);
    let temporaryExists = false;
    try {
      const descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
        | (constants.O_NOFOLLOW ?? 0), 0o600);
      temporaryExists = true;
      try {
        protectPrivatePath(temporary, 0o600);
        writeFileSync(descriptor, JSON.stringify({ schemaVersion: 1, identity, data }));
        fsyncSync(descriptor);
      } finally { closeSync(descriptor); }
      const confirmed = await project();
      if (fingerprint(confirmed) !== fingerprint(saved)
        || await setupSessionIdentity(confirmed) !== identity
        || fingerprint(await readSetupSessionRecord(confirmed)) !== fingerprint(previous)) {
        fail("Saved app owner or private setup attempt changed before persistence");
      }
      if (entryExists(path)) privateFile(path, saved.privateFiles, "Private setup-attempt material");
      renameSync(temporary, path);
      temporaryExists = false;
      if (process.platform !== "win32") {
        const directory = openSync(saved.privateFiles, constants.O_RDONLY);
      try { fsyncSync(directory); } finally { closeSync(directory); }
      }
    } catch { fail("Private setup-attempt material could not be saved safely"); }
    finally {
      if (temporaryExists) {
        try { unlinkSync(temporary); } catch { /* Preserve the original failure. */ }
      }
    }
  }

  async function readApiKey(): Promise<string | null> {
    const saved = await project(true);
    const name = saved.ownerKind === "standalone" && options.appId === "paperless-ngx"
      ? "paperless-api-token" : `${options.appId}-api-key`;
    const path = join(saved.privateFiles, name);
    if (!entryExists(path)) return null;
    const secret = secretText(readOwnedText(path, saved.privateFiles, "Saved app API key"), "Saved app API key");
    options.registerSecret(secret);
    return secret;
  }

  async function apiKeyPath(): Promise<string | null> {
    const saved = await project(true);
    const name = saved.ownerKind === "standalone" && options.appId === "paperless-ngx"
      ? "paperless-api-token" : `${options.appId}-api-key`;
    const path = join(saved.privateFiles, name);
    if (!entryExists(path)) return null;
    privateFile(path, saved.privateFiles, "Saved app API key");
    return path;
  }

  async function writeApiKey(value: string): Promise<string> {
    const saved = await project(true);
    const secret = secretText(value, "New app API key");
    options.registerSecret(secret);
    const path = join(saved.privateFiles, `${options.appId}-api-key`);
    const temporary = join(saved.privateFiles,
      `.${options.appId}-api-key-${process.pid}-${randomBytes(8).toString("hex")}.tmp`);
    let temporaryExists = false;
    try {
      const descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
        | (constants.O_NOFOLLOW ?? 0), 0o600);
      temporaryExists = true;
      try {
        protectPrivatePath(temporary, 0o600);
        writeFileSync(descriptor, secret);
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      try {
        linkSync(temporary, path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          fail("App API key could not be saved to its owner-only file");
        }
        unlinkSync(temporary);
        temporaryExists = false;
        const existing = secretText(readOwnedText(path, saved.privateFiles, "Saved app API key"), "Saved app API key");
        if (existing !== secret) fail("A different app API key is already saved; inspect before replacing it");
        return path;
      }
      unlinkSync(temporary);
      temporaryExists = false;
      if (process.platform !== "win32") {
        const directory = openSync(saved.privateFiles, constants.O_RDONLY);
      try { fsyncSync(directory); } finally { closeSync(directory); }
      }
      return path;
    } catch {
      fail("App API key could not be saved to its owner-only file");
    } finally {
      if (temporaryExists) {
        try { unlinkSync(temporary); } catch { /* Preserve the original fail-closed result. */ }
      }
    }
  }

  async function openPgpOwner() {
    const saved = await project();
    if (saved.ownerKind !== "shared" || !saved.httpsTarget || !options.resolvePrivateOpenPgpContext) {
      fail("Client OpenPGP custody requires its exact approved shared HTTPS owner");
    }
    const resolved = await options.resolvePrivateOpenPgpContext();
    const fields = Object.keys(resolved).filter((key) => key !== "identity").sort().join(",");
    if (fields !== "canonicalOrigin,recipeHash,sourceUrl"
      || resolved.canonicalOrigin !== saved.httpsTarget.origin) {
      fail("Client OpenPGP custody differs from its saved HTTPS origin");
    }
    const binding = {
      projectRoot: options.projectRoot, projectId: saved.projectId, appId: options.appId,
      canonicalOrigin: resolved.canonicalOrigin, sourceUrl: resolved.sourceUrl, recipeHash: resolved.recipeHash,
    };
    let identity = resolved.identity;
    let checkpoint: SetupCheckpoint | null = null;
    if (!identity) identity = await readSavedPrivateOpenPgpIdentity(saved.privateFiles, binding) ?? undefined;
    if (!identity) {
      checkpoint = await readCurrentCheckpoint(saved);
      const choices = checkpoint?.data;
      if (!choices || choices.canonicalOrigin !== resolved.canonicalOrigin
        || typeof choices.email !== "string" || typeof choices.firstName !== "string"
        || typeof choices.lastName !== "string") {
        fail("Client OpenPGP identity needs its exact saved custody or reviewed enrollment checkpoint");
      }
      identity = { name: `${choices.firstName} ${choices.lastName}`, email: choices.email };
    }
    const profile = { ...resolved, identity };
    const owner = privateOpenPgpCustody(saved.privateFiles, { ...binding, identity });
    const confirm = async () => {
      if (fingerprint(await project()) !== fingerprint(saved)
        || fingerprint(await options.resolvePrivateOpenPgpContext!()) !== fingerprint(resolved)
        || (checkpoint && fingerprint(await readCurrentCheckpoint(saved)) !== fingerprint(checkpoint))) {
        fail("Client OpenPGP saved owner changed during private operation");
      }
    };
    return { owner, profile, confirm, saved };
  }

  return {
    crypto: {
      async ensureClientKey(identity) {
        const { owner, profile, confirm } = await openPgpOwner();
        if (!identity || Object.keys(identity).sort().join(",") !== "email,name"
          || identity.name !== profile.identity.name || identity.email !== profile.identity.email) {
          fail("Client OpenPGP identity differs from approved owner inputs");
        }
        const key = await owner.ensureClientKey();
        await confirm();
        return key;
      },
      async inspectPublicKey(input) {
        const { confirm } = await openPgpOwner();
        const key = await inspectPrivateOpenPgpPublicKey(input);
        await confirm();
        return key;
      },
      async encryptSign(input) {
        const { owner, confirm } = await openPgpOwner();
        options.registerSecret(input.text);
        const armored = await owner.encryptSign(input);
        options.registerSecret(armored);
        await confirm();
        return armored;
      },
      async decryptVerify(input) {
        const { owner, confirm } = await openPgpOwner();
        options.registerSecret(input.armored);
        const plaintext = await owner.decryptVerify(input);
        options.registerSecret(plaintext);
        await confirm();
        return plaintext;
      },
    },
    http: { request: (input) => request(input) },
    jmap: { request: jmapRequest, captured: jmapCaptured, bootstrapRejectionPassword, restartBootstrap },
    webSocket: { request: webSocketRequest, warriorIdleSnapshot },
    container: { exec: (command) => exec(command) },
    passbolt: { readInvitation: readPassboltInvitation, registerFirstAdmin: registerPassboltFirstAdmin },
    peers: { resolveTarget },
    checkpoint: {
      async read() { return readCurrentCheckpoint(await project(true)); },
      async compareAndSet(next) { return compareAndSet(next); },
    },
    secrets: { verifyMutableConfigs, readSessionCookies, writeSessionCookies, readSetupSession, writeSetupSession, readAdminPassword, readBootstrapCapability, readGeneratedApiToken, readServiceConfigXmlApiKey, readSabnzbdConfigIniApiKey,
      checkSabnzbdSetupSafety,
      readBootstrapPassword,
      readQbittorrentTemporaryPassword,
      apiKeyPath, readApiKey, writeApiKey },
  };
}
