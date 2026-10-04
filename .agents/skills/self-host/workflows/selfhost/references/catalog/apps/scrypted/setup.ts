import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { generatedPrivateFileLength } from "../../types/private-file";
import { appliedStatus, setupRecord, type SetupAdapter, type SetupContext,
  type SetupRecord } from "../../types/setup";

const APP_ID = "scrypted";
const USERNAME = "admin";
const PASSWORD_PATTERN = new RegExp(`^[A-Za-z0-9]{${generatedPrivateFileLength(48, "alphanumeric")}}$`);

function identity(value: unknown, label: string): SetupRecord {
  const record = setupRecord(value, label);
  if (record.error !== undefined || record.username !== USERNAME
    || typeof record.authorization !== "string"
    || !/^Bearer [^\r\n]{32,8192}$/.test(record.authorization)) {
    throw new Error("Scrypted did not authenticate the saved administrator");
  }
  return record;
}

async function durableToken(context: SetupContext, authorization: string): Promise<string> {
  // GET /login can consume reset-login and erase users. Never issue it while
  // that marker exists, and do not misclassify this upstream route as read-only.
  const marker = await context.container.exec({ effect: "read",
    argv: ["test", "!", "-e", "/server/volume/reset-login"],
    approval: { action: "scrypted-check-reset-marker",
      progress: "Confirm no Scrypted reset-login marker exists before credential readback" } });
  if (marker.exitCode !== 0) throw new Error("Scrypted reset-login marker is present; stop for inspection");
  const response = await context.http.request({ method: "GET", path: "/login",
    headers: { Authorization: authorization },
    approval: { action: "scrypted-read-durable-token",
      progress: "Read the saved Scrypted owner token; this route can consume a reset-login marker and reset users if one appears concurrently" } });
  if (response.status === 401) {
    await context.secrets.writeSessionCookies({});
    throw new Error("Scrypted setup session is unauthorized; inspect before authenticating again");
  }
  if (response.status !== 200) throw new Error("Scrypted durable token readback failed");
  const payload = setupRecord(await response.json(), "Scrypted durable identity");
  // The pinned HTTP route returns 200 with this exact error for an expired or
  // restart-invalidated bearer. Uncertainty must preserve the saved session.
  if (payload.error === "Not logged in.") {
    await context.secrets.writeSessionCookies({});
    throw new Error("Scrypted setup session is unauthorized; inspect before authenticating again");
  }
  const account = identity(payload, "Scrypted durable identity");
  if (typeof account.token !== "string" || !/^[0-9a-f]{32}$/.test(account.token)) {
    throw new Error("Scrypted did not return its durable user token");
  }
  return account.token;
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  sharedOwner: true,
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  healthSource: null,
  homarrIntegration: null,
  ready(record) {
    return record.appId === APP_ID && record.stage === "admin-token-verified"
      && record.adminLoginVerified === true && record.apiKeyVerified === true
      && typeof record.credentialRef === "string" && isAbsolute(record.credentialRef)
      && typeof record.apiKeyFile === "string" && isAbsolute(record.apiKeyFile);
  },
  async firstRun(context) {
    if (context.appId !== APP_ID) throw new Error("Scrypted setup received a different app");
    const status = appliedStatus(context, await context.status());
    if (status.ownerKind !== "shared" || status.username !== USERNAME
      || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)
      || typeof status.selectionFingerprint !== "string"
      || !/^[0-9a-f]{64}$/.test(status.selectionFingerprint)) {
      throw new Error("Scrypted has no exact shared administrator credential");
    }
    const password = await context.secrets.readAdminPassword();
    if (!PASSWORD_PATTERN.test(password)) throw new Error("Scrypted saved password is invalid");
    let checkpoint = await context.checkpoint.read();
    if (checkpoint && (checkpoint.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot
      || !["account-attempted", "admin-token-verified"].includes(checkpoint.stage)
      || !checkpoint.attemptedActions.includes("scrypted-create-first-admin")
      || checkpoint.data.unitFingerprint !== status.selectionFingerprint
      || checkpoint.data.credentialRef !== status.passwordFile)) {
      throw new Error("Scrypted checkpoint differs from the saved owner");
    }
    const passwordDigest = createHash("sha256").update(password).digest("hex");
    const session = await context.secrets.readSessionCookies();
    let account: SetupRecord | undefined;
    if (Object.keys(session).length > 0) {
      if (!checkpoint || Object.keys(session).some((key) => !["authorization-base64", "password-digest"].includes(key))
        || session["password-digest"] !== passwordDigest
        || !/^[A-Za-z0-9_-]{32,8192}$/.test(session["authorization-base64"] ?? "")) {
        throw new Error("Scrypted saved setup session differs from the exact administrator");
      }
      const authorization = Buffer.from(session["authorization-base64"], "base64url").toString("utf8");
      if (Buffer.from(authorization).toString("base64url") !== session["authorization-base64"]) {
        throw new Error("Scrypted saved setup session encoding is invalid");
      }
      account = identity({ username: USERNAME, authorization }, "Scrypted saved password session");
    }
    if (!checkpoint) {
      // Empty credentials cannot create or change a user in pinned 0.147.0.
      const probe = await context.http.request({ method: "POST", path: "/login",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "", password: "" }),
        approval: { action: "scrypted-inspect-first-login",
          progress: "Inspect Scrypted first-run state with empty rejected credentials" } });
      if (probe.status !== 200) throw new Error("Scrypted first-run inspection failed");
      const state = setupRecord(await probe.json(), "Scrypted first-run state");
      if (state.hasLogin !== false || state.error !== "Username and password must not be empty.") {
        throw new Error("Scrypted already has an account or unknown first-run state; do not adopt it");
      }
    }
    const request = { method: "POST" as const, path: "/login",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: USERNAME, password }) };
    let response;
    if (!checkpoint) {
      response = await context.http.request({ ...request,
        approval: { action: "scrypted-create-first-admin", once: true,
          progress: "Create the first Scrypted administrator on the private bridge instance" },
        beforeSendCheckpoint: { expectedRevision: null, stage: "account-attempted",
          data: { unitFingerprint: status.selectionFingerprint, credentialRef: status.passwordFile } } });
      checkpoint = await context.checkpoint.read();
    } else {
      // An attempted creation is never replayed after an ambiguous response.
      // Only login to a proven existing account may be retried.
      const probe = await context.http.request({ method: "POST", path: "/login",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "", password: "" }),
        approval: { action: "scrypted-inspect-first-login",
          progress: "Inspect whether the attempted Scrypted administrator now exists" } });
      if (probe.status !== 200 || setupRecord(await probe.json(), "Scrypted resume state").hasLogin !== true) {
        throw new Error("Scrypted creation outcome remains unresolved; do not replay it");
      }
      response = await context.http.request({ ...request,
        approval: { action: "scrypted-verify-admin-login",
          progress: "Verify the saved Scrypted administrator password without changing it" } });
    }
    if (!checkpoint) throw new Error("Scrypted account outcome is unresolved");
    if (account) {
      // A retained bearer proves a session, not that the saved password still
      // works. Verify fresh login above, but keep the reviewed bearer stable.
      if (!response || response.status !== 200) throw new Error("Scrypted saved password login was not verified");
      identity(await response.json(), "Scrypted saved password login");
    }
    if (!account) {
      if (!response || response.status !== 200) throw new Error("Scrypted account outcome is unresolved");
      account = identity(await response.json(), "Scrypted password login");
      // First creation returns the durable token already. Capture it before
      // any further request or private-session write can fail.
      if (account.token !== undefined) {
        if (typeof account.token !== "string" || !/^[0-9a-f]{32}$/.test(account.token)) {
          throw new Error("Scrypted first-owner token is invalid; do not replay creation");
        }
        await context.secrets.writeApiKey(account.token);
      }
      const encoded = Buffer.from(account.authorization as string).toString("base64url");
      if (encoded.length > 8192) throw new Error("Scrypted setup session exceeds its private bound");
      await context.secrets.writeSessionCookies({ "authorization-base64": encoded, "password-digest": passwordDigest });
    }
    const saved = await context.secrets.readApiKey();
    let authorization = account.authorization as string;
    if (saved !== null) {
      if (!/^[0-9a-f]{32}$/.test(saved)) throw new Error("Scrypted saved durable token is invalid");
      authorization = `Bearer ${saved}`;
    }
    const token = await durableToken(context, authorization);
    if (saved !== null && saved !== token) throw new Error("Scrypted durable token differs from the saved owner key");
    const apiKeyFile = await context.secrets.writeApiKey(token);
    const readback = await durableToken(context, `Bearer ${token}`);
    if (readback !== token) throw new Error("Scrypted saved durable token failed identity readback");
    if (checkpoint.stage === "admin-token-verified" && checkpoint.data.apiKeyRef !== apiKeyFile) {
      throw new Error("Scrypted credential file differs from the verified checkpoint");
    }
    if (checkpoint.stage !== "admin-token-verified") {
      await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision,
        stage: "admin-token-verified", data: { unitFingerprint: status.selectionFingerprint,
          credentialRef: status.passwordFile, apiKeyRef: apiKeyFile } });
    }
    return { appId: APP_ID, projectRoot: context.projectRoot, stage: "admin-token-verified",
      credentialRef: status.passwordFile, apiKeyFile, adminLoginVerified: true,
      apiKeyVerified: true, adminRoleEvidence: "source-inferred-first-owner",
      adminRoleReadbackVerified: false, cameraVerified: false, restartPersistenceVerified: false };
  },
};

export default adapter;
