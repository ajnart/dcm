import { isAbsolute, join } from "node:path";

import { appliedStatus, setupRecord, type SetupAdapter, type SetupCheckpoint,
  type SetupInspectionContext, type SetupRecord } from "../../types/setup";
import { createSetupProofRecorder } from "../../shared/setup-proof";

// Pinned Grafana v13.2.2 current service-account API, not deprecated API keys:
// https://github.com/grafana/grafana/blob/v13.2.2/pkg/services/serviceaccounts/api/api.go
// https://github.com/grafana/grafana/blob/v13.2.2/pkg/services/serviceaccounts/api/token.go
// https://github.com/grafana/grafana/blob/v13.2.2/pkg/api/user.go
// https://github.com/grafana/grafana/blob/v13.2.2/pkg/services/user/identity.go
const ACCOUNT = "Auto-Stack Readonly";
const TOKEN = "Auto-Stack Readonly Token";
const CREATE_ACCOUNT = "grafana-create-service-account";
const CREATE_TOKEN = "grafana-create-service-account-token";
type ReadContext = SetupInspectionContext;
const proof = createSetupProofRecorder();

function id(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error("Grafana identity is invalid");
  return value;
}

async function json(context: ReadContext, path: string, authorization: string, query?: Record<string, string>) {
  const response = await context.http.request({ method: "GET", path, query, headers: { Authorization: authorization } });
  if (response.status !== 200) throw new Error("Grafana authenticated readback failed");
  return response.json();
}

function checkpoint(context: ReadContext, value: SetupCheckpoint | null): SetupCheckpoint | null {
  if (value === null) return null;
  if (value.schemaVersion !== 1 || value.appId !== "grafana" || value.projectRoot !== context.projectRoot
    || !Number.isSafeInteger(value.revision) || value.revision < 0
    || !["admin-verified", "service-account-attempted", "service-account-saved", "token-attempted", "api-key-saved"].includes(value.stage)
    || !Array.isArray(value.attemptedActions)
    || !value.attemptedActions.every((action) => [CREATE_ACCOUNT, CREATE_TOKEN].includes(action))) {
    throw new Error("Grafana owner checkpoint is inconsistent; inspect manually");
  }
  setupRecord(value.data, "Grafana checkpoint data");
  return value;
}

async function identity(context: ReadContext) {
  const status = appliedStatus(context, await context.status());
  if (status.username !== "admin" || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)
    || typeof status.privateFiles !== "string" || !isAbsolute(status.privateFiles)) {
    throw new Error("Grafana has no exact private-file administrator checkpoint");
  }
  const password = await context.secrets.readAdminPassword();
  if (password.length < 1 || password.length > 1024 || /[\r\n\u0000]/.test(password)) throw new Error("Grafana administrator credential is invalid");
  const authorization = `Basic ${Buffer.from(`admin:${password}`, "utf8").toString("base64")}`;
  const user = setupRecord(await json(context, "/api/user", authorization), "Grafana administrator");
  if (user.login !== "admin" || user.isGrafanaAdmin !== true || user.isDisabled === true) throw new Error("Grafana administrator login failed");
  return { authorization, adminId: id(user.id), orgId: id(user.orgId), passwordFile: status.passwordFile,
    apiKeyFile: join(status.privateFiles, "grafana-api-key") };
}

function assertOwner(saved: SetupCheckpoint, owner: Awaited<ReturnType<typeof identity>>) {
  if (saved.data.adminId !== owner.adminId || saved.data.orgId !== owner.orgId || saved.data.passwordFile !== owner.passwordFile
    || saved.data.accountName !== ACCOUNT || saved.data.tokenName !== TOKEN || saved.data.role !== "Viewer"
    || saved.data.secondsToLive !== 0 || !saved.attemptedActions.includes(CREATE_ACCOUNT)) {
    throw new Error("Grafana machine credential checkpoint does not match this owner");
  }
}

async function account(context: ReadContext, saved: SetupCheckpoint, authorization: string) {
  const result = setupRecord(await json(context, `/api/serviceaccounts/${id(saved.data.accountId)}`, authorization), "Grafana service account");
  if (result.id !== saved.data.accountId || result.name !== ACCOUNT || result.orgId !== saved.data.orgId
    || result.role !== "Viewer" || result.isDisabled !== false || typeof result.login !== "string") {
    throw new Error("Grafana owned Viewer service account changed; inspect manually");
  }
  return result;
}

async function tokens(context: ReadContext, saved: SetupCheckpoint, authorization: string) {
  const result = await json(context, `/api/serviceaccounts/${id(saved.data.accountId)}/tokens`, authorization);
  if (!Array.isArray(result)) throw new Error("Grafana token inventory is invalid");
  return result.map((entry) => setupRecord(entry, "Grafana token"));
}

async function verifyKey(context: ReadContext, saved: SetupCheckpoint, owner: Awaited<ReturnType<typeof identity>>) {
  assertOwner(saved, owner);
  if (!saved.attemptedActions.includes(CREATE_TOKEN)) throw new Error("Grafana token has no create provenance");
  const serviceAccount = await account(context, saved, owner.authorization);
  const inventory = await tokens(context, saved, owner.authorization);
  if (inventory.length !== 1 || inventory[0].name !== TOKEN || inventory[0].hasExpired !== false
    || inventory[0].expiration !== null || inventory[0].isRevoked === true) throw new Error("Grafana retained token metadata changed; inspect manually");
  const tokenId = id(inventory[0].id);
  if (saved.data.tokenId !== undefined && saved.data.tokenId !== tokenId) throw new Error("Grafana retained token identity changed");
  const key = await context.secrets.readApiKey();
  if (typeof key !== "string" || !/^glsa_[A-Za-z0-9_]{20,512}$/.test(key)
    || await context.secrets.apiKeyPath() !== owner.apiKeyFile) throw new Error("Grafana one-time token is missing; inspect manually, never recreate automatically");
  const user = setupRecord(await json(context, "/api/user", `Bearer ${key}`), "Grafana token identity");
  // v13 non-user /api/user UID is GetID(): the typed numeric identity, not the user's UID.
  if (user.uid !== `service-account:${id(saved.data.accountId)}` || user.orgId !== owner.orgId || user.login !== serviceAccount.login
    || user.isGrafanaAdmin !== false || user.isDisabled === true) throw new Error("Grafana token did not authenticate the owned service account");
  return tokenId;
}

function result(context: ReadContext, apiKeyFile: string): SetupRecord {
  return { appId: context.appId, projectRoot: context.projectRoot, stage: "api-key-saved", credentialRef: apiKeyFile,
    apiKeyRef: apiKeyFile, apiKeyScope: "organization Viewer", apiKeyExpires: null };
}

const adapter: SetupAdapter = {
  appId: "grafana",
  compatibilityResult(record) { return proof.result(record); },
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  healthSource: null,
  homarrIntegration: null,
  ready(record) {
    return record.appId === this.appId && record.stage === "api-key-saved"
      && typeof record.credentialRef === "string" && isAbsolute(record.credentialRef) && record.apiKeyRef === record.credentialRef;
  },
  async inspect(context) {
    const owner = await identity(context);
    const saved = checkpoint(context, await context.checkpoint.read());
    if (saved?.stage !== "api-key-saved" || saved.data.apiKeyFile !== owner.apiKeyFile) throw new Error("Grafana has no completed machine credential checkpoint");
    await verifyKey(context, saved, owner);
    return result(context, owner.apiKeyFile);
  },
  async firstRun(context) {
    if (context.appId !== this.appId || !isAbsolute(context.projectRoot)) throw new Error("Grafana setup received a different app project");
    const owner = await identity(context);
    let saved = checkpoint(context, await context.checkpoint.read());
    const unconfiguredEntry = saved === null;
    if (saved?.stage === "service-account-attempted") throw new Error("Grafana service-account creation may have occurred; inspect manually, never retry automatically");
    if (saved?.stage === "token-attempted" || saved?.stage === "api-key-saved") {
      const tokenId = await verifyKey(context, saved, owner);
      if (saved.stage === "api-key-saved" && saved.data.apiKeyFile !== owner.apiKeyFile) throw new Error("Grafana saved key path changed");
      if (saved.stage === "token-attempted") await context.checkpoint.compareAndSet({ expectedRevision: saved.revision,
        stage: "api-key-saved", data: { ...saved.data, tokenId, apiKeyFile: owner.apiKeyFile } });
      let origin: "resume" | null = null;
      if (saved.stage === "api-key-saved") origin = "resume";
      return proof.record(result(context, owner.apiKeyFile), origin, "verified");
    }
    if (await context.secrets.readApiKey() !== null || await context.secrets.apiKeyPath() !== null) throw new Error("Grafana has a key without a matching create checkpoint; inspect manually");
    if (saved === null || saved.stage === "admin-verified") {
      // Accept an empty legacy admin checkpoint, or our exact review checkpoint after deferred approval.
      if (saved !== null && (saved.attemptedActions.length !== 0 || (Object.keys(saved.data).length !== 0
        && (saved.data.adminId !== owner.adminId || saved.data.orgId !== owner.orgId
          || saved.data.passwordFile !== owner.passwordFile || saved.data.accountName !== ACCOUNT
          || saved.data.tokenName !== TOKEN || saved.data.role !== "Viewer" || saved.data.secondsToLive !== 0)))) {
        throw new Error("Grafana legacy administrator checkpoint needs manual inspection");
      }
      const inventory = setupRecord(await json(context, "/api/serviceaccounts/search", owner.authorization,
        { query: ACCOUNT, perpage: "1000", page: "1" }), "Grafana service-account inventory");
      if (!Array.isArray(inventory.serviceAccounts) || inventory.totalCount !== 0 || inventory.serviceAccounts.length !== 0) throw new Error("A pre-existing Grafana service account matches the owned name; inspect before setup");
      saved = await context.checkpoint.compareAndSet({ expectedRevision: saved?.revision ?? null, stage: "admin-verified",
        data: { adminId: owner.adminId, orgId: owner.orgId, passwordFile: owner.passwordFile,
          accountName: ACCOUNT, tokenName: TOKEN, role: "Viewer", secondsToLive: 0 } });
      const response = await context.http.request({ method: "POST", path: "/api/serviceaccounts",
        headers: { Authorization: owner.authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ name: ACCOUNT, role: "Viewer", isDisabled: false }),
        approval: { action: CREATE_ACCOUNT, once: true, progress: "Create the owned Grafana organization Viewer service account once" },
        beforeSendCheckpoint: { expectedRevision: saved.revision, stage: "service-account-attempted", data: saved.data } });
      if (response.status !== 201) throw new Error("Grafana service-account create outcome is uncertain; inspect manually");
      const created = setupRecord(await response.json(), "Grafana service-account creation");
      if (created.name !== ACCOUNT || created.orgId !== owner.orgId || created.role !== "Viewer" || created.isDisabled !== false) throw new Error("Grafana service-account creation identity is invalid; inspect manually");
      saved = checkpoint(context, await context.checkpoint.read());
      if (saved?.stage !== "service-account-attempted") throw new Error("Grafana durable account attempt is missing");
      assertOwner(saved, owner);
      saved = await context.checkpoint.compareAndSet({ expectedRevision: saved.revision, stage: "service-account-saved", data: { ...saved.data, accountId: id(created.id) } });
    }
    if (saved.stage !== "service-account-saved") throw new Error("Grafana service-account checkpoint is invalid");
    assertOwner(saved, owner);
    if (saved.attemptedActions.includes(CREATE_TOKEN)) throw new Error("Grafana token creation was already attempted");
    await account(context, saved, owner.authorization);
    if ((await tokens(context, saved, owner.authorization)).length !== 0) throw new Error("Grafana owned service account has an unrelated token; inspect manually");
    const response = await context.http.request({ method: "POST", path: `/api/serviceaccounts/${id(saved.data.accountId)}/tokens`,
      headers: { Authorization: owner.authorization, "Content-Type": "application/json" }, body: JSON.stringify({ name: TOKEN, secondsToLive: 0 }),
      approval: { action: CREATE_TOKEN, once: true, progress: "Create and privately save the Grafana Viewer token once (no expiry)" },
      beforeSendCheckpoint: { expectedRevision: saved.revision, stage: "token-attempted", data: saved.data } });
    if (response.status !== 200) throw new Error("Grafana token create outcome is uncertain; inspect manually");
    const created = setupRecord(await response.json(), "Grafana token creation");
    const tokenId = id(created.id);
    if (created.name !== TOKEN || typeof created.key !== "string" || !/^glsa_[A-Za-z0-9_]{20,512}$/.test(created.key)) throw new Error("Grafana one-time token response is invalid; inspect manually");
    // Capture once-returned output before any subsequent metadata write or network request.
    const apiKeyFile = await context.secrets.writeApiKey(created.key);
    if (apiKeyFile !== owner.apiKeyFile || await context.secrets.readApiKey() !== created.key) throw new Error("Grafana private token capture failed; inspect manually");
    saved = checkpoint(context, await context.checkpoint.read());
    if (saved?.stage !== "token-attempted") throw new Error("Grafana durable token attempt is missing");
    if (await verifyKey(context, saved, owner) !== tokenId) throw new Error("Grafana returned token differs from retained metadata");
    await context.checkpoint.compareAndSet({ expectedRevision: saved.revision, stage: "api-key-saved", data: { ...saved.data, tokenId, apiKeyFile } });
    // Only an empty entry followed by both acknowledged creations in this call
    // proves fresh setup. Recovery/legacy/deferred entry states stay uncredited.
    let origin: "fresh" | null = null;
    if (unconfiguredEntry) origin = "fresh";
    return proof.record(result(context, apiKeyFile), origin, "verified");
  },
};

export default adapter;
