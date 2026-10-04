import { isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { appliedStatus, setupRecord, type SetupAdapter, type SetupContext,
  type SetupRecord } from "../../types/setup";

const APP_ID = "linkwarden";
const USERNAME = "admin";

// v2.16.3's Dockerfile ships /data/packages/prisma and its generated
// @prisma/client dependency. The registration route has no first-user guard;
// inspect the exact owned app database before sending any signup write.
const EMPTY_USER_COUNT = "const {createRequire}=require('node:module');"
  + "const {PrismaClient}=createRequire('/data/packages/prisma/package.json')('@prisma/client');"
  + "const db=new PrismaClient({log:[]});"
  + "(async()=>{try{const count=await db.user.count();process.stdout.write(JSON.stringify({count}));}"
  + "catch{process.exitCode=1;}finally{await db.$disconnect().catch(()=>{process.exitCode=1;});}})();";

async function requireEmptyUsers(context: SetupContext): Promise<void> {
  const read = await context.container.exec({ effect: "read", argv: ["node", "-e", EMPTY_USER_COUNT],
    approval: { action: "linkwarden-inspect-empty-users",
      progress: "Check the exact owned Linkwarden database is empty before first-account creation" } });
  if (read.exitCode !== 0) throw new Error("Linkwarden first-user inventory is unavailable; no signup was sent");
  let value: unknown;
  try { value = JSON.parse(read.stdout); } catch { throw new Error("Linkwarden returned an invalid first-user inventory"); }
  const state = setupRecord(value, "Linkwarden first-user inventory");
  if (state.count !== 0) {
    throw new Error("Linkwarden already has users or unknown first-owner state; no signup was sent");
  }
}

async function verifySavedKey(context: SetupContext): Promise<string> {
  const savedKey = await context.secrets.readApiKey();
  if (savedKey === null) throw new Error("Linkwarden API token was not saved");
  const keyRead = await context.http.request({ method: "GET", path: "/api/v1/users/me",
    headers: { Authorization: `Bearer ${savedKey}` } });
  if (keyRead.status !== 200) throw new Error("Saved Linkwarden API token cannot read back the owner");
  const keyIdentity = setupRecord(await keyRead.json(), "Linkwarden token identity");
  const user = setupRecord(keyIdentity.response, "Linkwarden token user");
  if (user.username !== USERNAME || user.id !== 1) {
    throw new Error("Saved Linkwarden API token belongs to a different user");
  }
  const path = await context.secrets.apiKeyPath();
  if (typeof path !== "string" || !isAbsolute(path)) throw new Error("Linkwarden token has no private file");
  return path;
}

async function login(context: SetupContext, password: string): Promise<string> {
  const digest = createHash("sha256").update(password).digest("hex");
  const saved = await context.secrets.readSessionCookies();
  if (Object.keys(saved).some((key) => !["bearer", "password_digest"].includes(key))
    || (Object.keys(saved).length > 0 && saved.password_digest !== digest)) {
    throw new Error("Linkwarden private setup session differs from its saved password");
  }
  if (saved.bearer) await readLoginOwner(context, saved.bearer, true);
  const response = await context.http.request({ method: "POST", path: "/api/v1/session",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password }),
    approval: { action: "linkwarden-verify-admin-login",
      progress: "Verify the saved Linkwarden administrator credential" } });
  if (response.status !== 200) throw new Error("Saved Linkwarden administrator login failed");
  const body = setupRecord(await response.json(), "Linkwarden session");
  const result = setupRecord(body.response, "Linkwarden session response");
  if (typeof result.token !== "string" || result.token.length < 32 || result.token.length > 8192
    || /[^\x21-\x7e]|[;,\\"]/.test(result.token)) {
    throw new Error("Linkwarden session did not return a bounded bearer token");
  }
  const bearer = result.token;
  await readLoginOwner(context, bearer, false);
  // Preserve the bearer bound to any already-reviewed API-token write.
  if (saved.bearer) return saved.bearer;
  await context.secrets.writeSessionCookies({ bearer, password_digest: digest });
  return bearer;
}

async function readLoginOwner(context: SetupContext, bearer: string, retained: boolean): Promise<void> {
  if (bearer.length < 32 || bearer.length > 8192 || /[^\x21-\x7e]|[;,\\"]/.test(bearer)) {
    throw new Error("Linkwarden saved private bearer is invalid");
  }
  const me = await context.http.request({ method: "GET", path: "/api/v1/users/me",
    headers: { Authorization: `Bearer ${bearer}` } });
  if (me.status === 401) {
    // A rejected fresh proof must not erase the original pending-write session.
    if (retained) await context.secrets.writeSessionCookies({});
    throw new Error("Linkwarden private setup session expired or was rejected; use a new approved login on the next run");
  }
  if (me.status !== 200) throw new Error("Linkwarden administrator identity readback failed");
  const identity = setupRecord(await me.json(), "Linkwarden identity");
  const user = setupRecord(identity.response, "Linkwarden user");
  if (user.username !== USERNAME || user.id !== 1) {
    throw new Error("Linkwarden saved login did not identify the managed administrator");
  }
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  sharedOwner: true,
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  healthSource: null,
  homarrIntegration: null,
  ready(record) {
    return record.appId === APP_ID && record.stage === "registration-closed-verified"
      && record.registrationClosed === true && record.adminLoginVerified === true
      && record.apiKeyVerified === true && typeof record.credentialRef === "string"
      && isAbsolute(record.credentialRef) && typeof record.apiKeyFile === "string"
      && isAbsolute(record.apiKeyFile);
  },
  async firstRun(context) {
    if (context.appId !== APP_ID) throw new Error("Linkwarden setup received a different app");
    const status = appliedStatus(context, await context.status());
    if (status.ownerKind !== "shared" || status.username !== USERNAME
      || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)
      || typeof status.manifestHash !== "string"
      || typeof status.selectionFingerprint !== "string"
      || !/^[a-f0-9]{64}$/.test(status.selectionFingerprint)) {
      throw new Error("Linkwarden has no exact shared administrator credential");
    }
    const password = await context.secrets.readAdminPassword();
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(password)) {
      throw new Error("Linkwarden saved administrator password is invalid");
    }
    let checkpoint = await context.checkpoint.read();
    if (checkpoint && (checkpoint.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot
      || !["account-attempted", "account-verified", "token-attempted",
        "closure-probe-attempted", "closed-verified"].includes(checkpoint.stage))) {
      throw new Error("Linkwarden has an unexpected first-run checkpoint");
    }
    if (!checkpoint) {
      await requireEmptyUsers(context);
      const response = await context.http.request({ method: "POST", path: "/api/v1/users",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: USERNAME, password }),
        approval: { action: "linkwarden-create-first-account", once: true,
          progress: "Create the first Linkwarden account on the private instance" },
        beforeSendCheckpoint: { expectedRevision: null, stage: "account-attempted" } });
      if (response.status !== 201) {
        throw new Error("Linkwarden first-account outcome is uncertain; inspect before retrying");
      }
      const signup = setupRecord(await response.json(), "Linkwarden first-account response");
      const created = setupRecord(signup.response, "Linkwarden created user");
      if (created.username !== USERNAME || created.id !== 1) {
        throw new Error("Linkwarden signup did not create the first owner; inspect before retrying");
      }
      checkpoint = await context.checkpoint.read();
    }
    if (!checkpoint) throw new Error("Linkwarden first-account attempt has no saved checkpoint");
    const bearer = await login(context, password);
    if (checkpoint.stage === "closure-probe-attempted") {
      throw new Error("Anonymous registration probe outcome is uncertain; inspect before retrying");
    }
    const transition = status.environmentTransition === null ? null
      : setupRecord(status.environmentTransition, "Linkwarden owner transition");
    if (transition) {
      if (transition.serviceId !== APP_ID || transition.name !== "NEXT_PUBLIC_DISABLE_REGISTRATION"
        || transition.value !== "true" || transition.manifestHash !== status.manifestHash
        || transition.revision !== status.ownerRevision
        || !Number.isSafeInteger(status.ownerRevision)) {
        throw new Error("Linkwarden registration closure is not the exact saved owner revision");
      }
      const apiKeyFile = await verifySavedKey(context);
      if (checkpoint.stage === "closed-verified") {
        let sameSelection = checkpoint.data.selectionFingerprint === status.selectionFingerprint;
        if (checkpoint.data.selectionFingerprint === undefined) {
          sameSelection = checkpoint.data.ownerManifestHash === status.manifestHash;
        }
        if (!sameSelection || checkpoint.data.identity !== USERNAME
          || checkpoint.data.credentialRef !== status.passwordFile
          || checkpoint.data.apiKeyRef !== apiKeyFile
          || checkpoint.data.registrationDenied !== true) {
          throw new Error("Linkwarden closure proof differs from the current owner or credentials");
        }
      } else if (checkpoint.stage === "account-verified") {
        const probe = await context.http.request({ method: "POST", path: "/api/v1/users",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "selfhostclosureprobe", password }),
          approval: { action: "linkwarden-prove-registration-closed", once: true,
            progress: "Prove anonymous registration is denied. If closure failed, this creates an extra account requiring manual cleanup." },
          beforeSendCheckpoint: { expectedRevision: checkpoint.revision,
            stage: "closure-probe-attempted" } });
        if (probe.status !== 400) {
          throw new Error("Linkwarden did not deny anonymous registration; inspect for an extra account");
        }
        const denied = setupRecord(await probe.json(), "Linkwarden registration denial");
        if (denied.response !== "Registration is disabled.") {
          throw new Error("Linkwarden denial was not the pinned registration-closed response");
        }
        checkpoint = await context.checkpoint.read();
        if (!checkpoint || checkpoint.stage !== "closure-probe-attempted") {
          throw new Error("Linkwarden registration probe lost its checkpoint");
        }
        checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision,
          stage: "closed-verified", data: { ownerManifestHash: status.manifestHash,
            selectionFingerprint: status.selectionFingerprint,
            identity: USERNAME, credentialRef: status.passwordFile, apiKeyRef: apiKeyFile,
            registrationDenied: true } });
      } else {
        throw new Error("Linkwarden owner transitioned before account and key proof completed");
      }
      return { appId: APP_ID, projectRoot: context.projectRoot, stage: "registration-closed-verified",
        credentialRef: status.passwordFile, apiKeyFile,
        registrationClosed: true, adminLoginVerified: true, apiKeyVerified: true };
    }
    if (checkpoint.stage === "closed-verified") {
      throw new Error("Saved Linkwarden closure proof has no matching owner transition");
    }
    if (checkpoint.stage === "account-attempted") {
      checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision,
        stage: "account-verified", data: { ownerManifestHash: status.manifestHash,
          identity: USERNAME, credentialRef: status.passwordFile } });
    }
    let existing = await context.secrets.readApiKey();
    if (checkpoint.stage === "token-attempted") {
      if (existing === null) {
        throw new Error("Linkwarden token creation was attempted without a saved key; inspect before retrying");
      }
      checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision,
        stage: "account-verified", data: { ownerManifestHash: status.manifestHash,
          identity: USERNAME, credentialRef: status.passwordFile } });
    }
    if (existing === null) {
      const tokenResponse = await context.http.request({ method: "POST", path: "/api/v1/tokens",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
        // Pinned v2.16.3 TokenExpiry.never is 4.
        body: JSON.stringify({ name: "selfhost-managed", expires: 4 }),
        approval: { action: "linkwarden-create-api-token", once: true,
          progress: "Create and privately save one Linkwarden API token" },
        beforeSendCheckpoint: { expectedRevision: checkpoint.revision, stage: "token-attempted" } });
      if (tokenResponse.status !== 200 && tokenResponse.status !== 201) {
        throw new Error("Linkwarden token outcome is uncertain; inspect before retrying");
      }
      const tokenBody = setupRecord(await tokenResponse.json(), "Linkwarden token creation");
      const token = setupRecord(tokenBody.response, "Linkwarden token response");
      if (typeof token.secretKey !== "string" || token.secretKey.length < 32
        || token.secretKey.length > 8192) throw new Error("Linkwarden one-time API token is invalid");
      await context.secrets.writeApiKey(token.secretKey);
      existing = token.secretKey;
      checkpoint = await context.checkpoint.read();
      if (!checkpoint || checkpoint.stage !== "token-attempted") {
        throw new Error("Linkwarden token attempt lost its checkpoint");
      }
      checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision,
        stage: "account-verified", data: { ownerManifestHash: status.manifestHash,
          identity: USERNAME, credentialRef: status.passwordFile } });
    }
    const apiKeyFile = await verifySavedKey(context);
    if (checkpoint.data.apiKeyRef !== apiKeyFile
      || checkpoint.data.selectionFingerprint !== status.selectionFingerprint
      || checkpoint.data.ownerManifestHash !== status.manifestHash
      || checkpoint.data.identity !== USERNAME
      || checkpoint.data.credentialRef !== status.passwordFile) {
      checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision,
        stage: "account-verified", data: { ownerManifestHash: status.manifestHash,
          selectionFingerprint: status.selectionFingerprint,
          identity: USERNAME, credentialRef: status.passwordFile, apiKeyRef: apiKeyFile } });
    }
    return { appId: APP_ID, projectRoot: context.projectRoot, stage: "account-verified-registration-open",
      credentialRef: status.passwordFile, apiKeyFile,
      registrationClosed: false, adminLoginVerified: true, apiKeyVerified: true };
  },
};

export default adapter;
