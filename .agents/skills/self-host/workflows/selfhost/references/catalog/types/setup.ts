/** Per-app first-run logic lives beside its manifest and Compose recipe. */
import type { SharedServiceTarget } from "../../../../../../../../packages/cli/src/lib/shared-service-target.ts";
import type { DockerApiContainerImageObservation } from "../../../../../../../../packages/cli/src/lib/docker-api-authority-probe.ts";

/** Internal resolver evidence; application adapters receive only its target. */
export type SetupPeerTarget = { target: SharedServiceTarget; ownerRevision: number;
  ownerRecordHash: string; manifestHash: string };

export type SetupRecord = Record<string, unknown>;

/** Read-only shared-owner receipt; never carries a credential payload or job result. */
export type SetupManualJobPreparation = {
  appId: string; projectRoot: string; projectDirectory: string;
  ownerRevision: number; ownerRecordHash: string; sourceSha256: string; recipeSha256: string;
  service: Record<string, any>;
  credentialFiles: Array<{ id: string; path: string; source: "generated" | "owner"; verified: true }>;
  configFiles: Array<{ id: string; path: string; sha256: string; verified: true }>;
  ownerBindingVerified: true; generatedFilesVerified: true; executed: false;
};

export type SetupCheckpoint = {
  schemaVersion: 1;
  appId: string;
  projectRoot: string;
  revision: number;
  stage: string;
  attemptedActions: string[];
  data: Record<string, string | number | boolean | null>;
};

export type SetupCheckpointUpdate = {
  expectedRevision: number | null;
  stage: string;
  data?: Record<string, string | number | boolean | null>;
};

export type SetupHttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";

export type SetupHttpApproval = {
  action: string;
  progress: string;
  once?: boolean;
};

export type SetupHttpRequest = {
  method: SetupHttpMethod;
  /** Refuse loopback HTTP fallback; requires the exact saved shared HTTPS route and CA. */
  requireHttps?: true;
  /** A path on the exact saved private origin; absolute URLs and inline query strings are rejected. */
  path: string;
  /** Non-secret query values only. The transport validates and encodes these, never accepts a raw URL. */
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  /** Bounded request timeout; use a longer value only for a pinned slow setup action. */
  timeoutMs?: number;
  /** Exact Engine.IO polling namespace-connect or pong frame only; never an application event. */
  effect?: "socketio-control";
  /** Required for every write, including an upstream GET that changes state. */
  approval?: SetupHttpApproval;
  /** For one-time mutations, persisted after approval and before any request bytes are sent. */
  beforeSendCheckpoint?: SetupCheckpointUpdate;
};

export type SetupHttpResponse = {
  status: number;
  ok: boolean;
  headers: {
    get(name: string): string | null;
    /** Exact loopback response cookies, bounded and kept out of ordinary reports. */
    getSetCookie?(): string[];
  };
  json(): Promise<unknown>;
  text(): Promise<string>;
  /** Original bounded response bytes; each call returns an independent private copy. */
  arrayBuffer(): Promise<ArrayBuffer>;
};

/** Pinned Stalwart 0.16.24 management exchange; never arbitrary POST-as-read. */
export type SetupJmapRequest = {
  endpoint: "recovery" | "https";
  origin?: string;
  path: "/api";
  authorization: string;
  body: string;
  effect: "read" | "write";
  /** Owner journal checkpoint, after exact approval and transport no-replay checkpoint. */
  beforeSend?: () => Promise<void>;
  /** Pinned transport-owned synchronous once-returned credential capture, never arbitrary response selectors. */
  capture?: "administrator" | "management-key";
};
export type SetupJmapCapture = { administrator: boolean; managementKeyId: string | null; httpsOrigin?: string; recoveryEnvironmentAbsent?: boolean };

/** Inspection cannot authorize a JMAP write or carry a mutation checkpoint. */
export type SetupJmapReadRequest = Omit<SetupJmapRequest, "effect" | "beforeSend" | "capture"> & { effect: "read" };

export type SetupHttpReadRequest = Pick<SetupHttpRequest, "path" | "query" | "headers" | "requireHttps"> & {
  method: "GET" | "HEAD";
};

export type SetupContainerCommand = {
  /** Read-only verification or a one-time write; the adapter must use a fixed upstream command. */
  effect: "read" | "write";
  /** Argv for the exact app service in the saved Compose owner. Never put a secret in argv. */
  argv: string[];
  /** Private stdin only; it is hashed in approval and never included in progress text. */
  stdin?: string;
  /** Declared filenames in this app's exact owner-private directory. Bytes are privately hashed into approval, never returned. */
  privateFileRefs?: readonly string[];
  approval: SetupHttpApproval;
  /** Required for one-time container mutations, before any command bytes are sent. */
  beforeSendCheckpoint?: SetupCheckpointUpdate;
  /** Capture an app-generated password only when the pre-generated password was not injected into the running app. One-time writes only; raw output is never returned. */
  captureAdminPassword?: { format: "whole-stdout" } | {
    format: "one-line";
    prefix: string;
    suffix: string;
  };
};

export type SetupContainerResult = { exitCode: number; stdout: string };
export type SetupPassboltRegistration = { email: string; firstName: string; lastName: string;
  canonicalOrigin: string; beforeSendCheckpoint: SetupCheckpointUpdate };

/** One authenticated JSON command, not a subscription or arbitrary WebSocket channel. */
export type SetupWebSocketRequest = {
  path: "/api/websocket";
  accessToken: string;
  type: "auth/current_user" | "auth/long_lived_access_token";
  payload?: Record<string, unknown>;
  approval?: SetupHttpApproval;
  beforeSendCheckpoint?: SetupCheckpointUpdate;
};

export type SetupWebSocketReadRequest = Omit<SetupWebSocketRequest,
  "type" | "payload" | "approval" | "beforeSendCheckpoint"> & { type: "auth/current_user" };

/** Receive only the pinned Warrior SockJS opening snapshot; no application frame is sent. */
export type SetupWarriorSnapshotRequest = {
  path: "/000/auto-stack/websocket";
  authorization: string;
};

export type SetupContext = {
  crypto: import("./private-openpgp.ts").SetupCrypto;
  manualJob: { inspect(): Promise<SetupManualJobPreparation> };
  appId: string;
  projectRoot: string;
  /** Apps in the exact installed shared owner, including peers not yet configured. */
  installedAppIds: readonly string[];
  /** Reviewed, non-secret choices for this app. A first-run adapter must persist choices before dependent writes. */
  inputs: Readonly<Record<string, string>>;
  status(): Promise<unknown>;
  /** Exact recipe-selected Docker image, minted and validated by the authority owner. */
  observeContainerImage?(): Promise<DockerApiContainerImageObservation>;
  /** No-argument owner gate; never accepts caller same-host or daemon evidence. */
  requireSameDaemonDirectory?(): Promise<void>;
  read(action: string, args?: string[]): Promise<unknown>;
  apply(action: string, approval: string, progress: string, args?: string[]): Promise<unknown>;
  http: { request(request: SetupHttpRequest): Promise<SetupHttpResponse> };
  jmap: { request(request: SetupJmapRequest): Promise<{ status: number; json: unknown }>;
    captured(): Promise<SetupJmapCapture>;
    bootstrapRejectionPassword(): Promise<string>;
    restartBootstrap(): Promise<void> };
  webSocket: { request(request: SetupWebSocketRequest): Promise<unknown>;
    warriorIdleSnapshot(request: SetupWarriorSnapshotRequest): Promise<readonly unknown[]> };
  container: { exec(command: SetupContainerCommand): Promise<SetupContainerResult> };
  /** Exact pinned Passbolt registration; private token never enters public stdout. */
  passbolt: {
    readInvitation(): Promise<{ userId: string; token: string } | null>;
    registerFirstAdmin(input: SetupPassboltRegistration): Promise<{ userId: string; token: string }>;
  };
  checkpoint: {
    read(): Promise<SetupCheckpoint | null>;
    compareAndSet(next: SetupCheckpointUpdate): Promise<SetupCheckpoint>;
  };
  secrets: {
    /** Validate only this app's saved mutable configuration; never initialize or replace it. */
    verifyMutableConfigs(): Promise<void>;
    /** Private setup-session cookies bound to this exact app owner and origin; never checkpoint or report. */
    readSessionCookies(): Promise<Record<string, string>>;
    writeSessionCookies(cookies: Readonly<Record<string, string>>): Promise<void>;
    /** Private, bounded attempt material (for example OAuth state/PKCE), never public checkpoints. */
    readSetupSession(): Promise<Record<string, string> | null>;
    writeSetupSession(value: Readonly<Record<string, string>> | null): Promise<void>;
    readAdminPassword(): Promise<string>;
    /** Read the exact declared private bootstrap capability, never an administrator or API key. */
    readBootstrapCapability(): Promise<string>;
    /** Read only this shared app's declared generated token from its exact owner-only file. */
    readGeneratedApiToken(): Promise<string>;
    /** Read the fresh API key from this app's exact owned /config/config.xml container. */
    readServiceConfigXmlApiKey(): Promise<string>;
    /** Read only [misc] api_key from this SABnzbd service's exact owned /config/sabnzbd.ini. */
    readSabnzbdConfigIniApiKey(): Promise<string>;
    /** Refuse SABnzbd credential submission outside its pinned private login and logging contract. */
    checkSabnzbdSetupSafety(): Promise<void>;
    /** Transport-owned qBittorrent/Frigate profile; exact current-start logs stay private. No caller pattern or path. */
    readBootstrapPassword(): Promise<string>;
    /** Read only this qBittorrent container's current-start temporary WebUI password. */
    readQbittorrentTemporaryPassword(): Promise<string>;
    apiKeyPath(): Promise<string | null>;
    readApiKey(): Promise<string | null>;
    writeApiKey(value: string): Promise<string>;
  };
  peers: {
    /** Resolve only a selected frontend in this completed shared owner; never accepts a URL. */
    resolveTarget(appId: string): Promise<SharedServiceTarget>;
    /** Inspect only a verified app in this exact shared Compose owner. Never returns a secret value. */
    inspectVerified(appId: string): Promise<SetupRecord>;
    /** Release a verified administrator only from a peer in this exact shared Compose owner. */
    readVerifiedAdmin(appId: "jellyfin"): Promise<{ username: "admin"; password: string }>;
  };
};

/** The inspection surface has no write, approval, or arbitrary CLI-action method. */
export type SetupInspectionContext = {
  manualJob: { inspect(): Promise<SetupManualJobPreparation> };
  appId: string;
  projectRoot: string;
  status(): Promise<unknown>;
  observeContainerImage?(): Promise<DockerApiContainerImageObservation>;
  requireSameDaemonDirectory?(): Promise<void>;
  http: { request(request: SetupHttpReadRequest): Promise<SetupHttpResponse> };
  jmap: { request(request: SetupJmapReadRequest): Promise<{ status: number; json: unknown }>;
    captured(): Promise<SetupJmapCapture>; bootstrapRejectionPassword(): Promise<string> };
  webSocket: { request(request: SetupWebSocketReadRequest): Promise<unknown>;
    warriorIdleSnapshot(request: SetupWarriorSnapshotRequest): Promise<readonly unknown[]> };
  checkpoint: { read(): Promise<SetupCheckpoint | null> };
  secrets: {
    verifyMutableConfigs(): Promise<void>;
    /** Read-only private session retrieval, still bound to this exact owner/origin. */
    readSessionCookies(): Promise<Record<string, string>>;
    readAdminPassword(): Promise<string>;
    apiKeyPath(): Promise<string | null>;
    readApiKey(): Promise<string | null>;
  };
};

export type SetupCompatibilityResult = {
  origin: "fresh" | "resume";
  credentialReadback: "verified" | "no-account-verified";
};

export type SetupAdapter = {
  appId: string;
  /** False while this app's proven first-run route still requires a standalone owner. */
  sharedOwner?: boolean;
  /** App-owned setup choices; the shared CLI validates these without an app-specific command branch. */
  inputDefinitions?: readonly { key: string; label: string }[];
  /** Optional setup ordering edges, used only when the named app is selected in the same shared run. */
  setupAfter?: readonly string[];
  /** Informational review effects when another app is installed in the same shared owner. */
  peerEffects?: readonly { peerAppId: string; description: string }[];
  firstRun(context: SetupContext): Promise<SetupRecord>;
  inspect?(context: SetupInspectionContext): Promise<SetupRecord>;
  ready(status: SetupRecord): boolean;
  /** Read-only API credential proof, distinct from saved administrator password proof. Defaults to ready. */
  apiReady?(status: SetupRecord): boolean;
  /** App-owned current-invocation proof, not readiness or serialized checkpoint flags.
   * Use shared/setup-proof.ts only after positive credential/no-account readback.
   * Inspection and interrupted creation cannot establish fresh setup chronology.
   */
  compatibilityResult?(record: SetupRecord): SetupCompatibilityResult | null;
  credentialCommand: "app handoff";
  apiKey: "saved-by-onboarding" | "not-created";
  healthSource: string | null;
  homarrIntegration: string | null;
};

export function setupRecord(value: unknown, label: string): SetupRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} returned an invalid checkpoint`);
  }
  return value as SetupRecord;
}

export function appliedStatus(context: Pick<SetupInspectionContext, "appId" | "projectRoot">, value: unknown): SetupRecord {
  const status = setupRecord(value, `${context.appId} status`);
  const runtime = setupRecord(status.runtime, `${context.appId} runtime`);
  if (status.command !== "app status" || status.appId !== context.appId
    || status.projectRoot !== context.projectRoot || status.status !== "applied"
    || status.mutation !== false || runtime.state !== "running") {
    throw new Error(`${context.appId} is not a running, exact saved app project`);
  }
  return status;
}

export function statusApproval(status: SetupRecord, key: string): string {
  const approvals = setupRecord(status.approvals, "app approvals");
  const token = approvals[key];
  if (typeof token !== "string" || token.length > 512 || !/^[A-Z][A-Z0-9-]*:[a-z0-9-]+:[0-9a-f]{64}$/.test(token)) {
    throw new Error(`The exact ${key} approval is unavailable`);
  }
  return token;
}
