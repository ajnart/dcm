import { appliedStatus, setupRecord, type SetupAdapter, type SetupContext, type SetupRecord } from "../../types/setup";

// Pinned contracts: v2.1.3/server-source-code/internal/{handler/auth.go,
// handler/settings.go,server/router.go}. Dashboard setup never enrolls a host.
const PREFIX = "/api/v1";
const TOKEN_NAME = "selfhost-homarr";
type CredentialPair = { apiKey: string; apiSecret: string };

function credentialPair(value: unknown): CredentialPair {
  const pair = setupRecord(value, "PatchMon saved credential pair");
  if (Object.keys(pair).sort().join(",") !== "apiKey,apiSecret"
    || typeof pair.apiKey !== "string" || !/^patchmon_ae_[0-9a-f]{32}$/.test(pair.apiKey)
    || typeof pair.apiSecret !== "string" || !/^[0-9a-f]{64}$/.test(pair.apiSecret)) {
    throw new Error("PatchMon has an invalid saved Homarr credential pair");
  }
  return { apiKey: pair.apiKey, apiSecret: pair.apiSecret };
}

async function homarrCredential(context: SetupContext, jwt: string, adminId: string, record: SetupRecord): Promise<SetupRecord> {
  let saved = await context.checkpoint.read();
  const authority = context.inputs["credential-authority"] || saved?.data.integrationAuthority;
  if (authority !== "stats-and-enrollment") {
    return { ...record, stage: "credential-authority-required", credentialAuthorityRequired: "stats-and-enrollment" };
  }
  if (saved?.data.integrationAuthority !== undefined && saved.data.integrationAuthority !== authority) {
    throw new Error("PatchMon credential authority changed on resume");
  }
  const headers = { Authorization: `Bearer ${jwt}`, Accept: "application/json" };
  const inventoryResponse = await context.http.request({ method: "GET", path: `${PREFIX}/auto-enrollment/tokens`, headers });
  if (inventoryResponse.status !== 200) throw new Error("PatchMon credential inventory failed");
  const inventory = await inventoryResponse.json();
  if (!Array.isArray(inventory) || inventory.length > 10000) throw new Error("PatchMon credential inventory was invalid");
  const matches = inventory.map((entry) => setupRecord(entry, "PatchMon credential inventory item"))
    .filter((entry) => entry.token_name === TOKEN_NAME);
  if (matches.length > 1) throw new Error("PatchMon has ambiguous Homarr credentials");
  const privateValue = await context.secrets.readApiKey();
  let pair: CredentialPair;
  if (privateValue === null) {
    if (saved?.attemptedActions.includes("patchmon-create-homarr-token") || saved?.data.integrationCreateAttempted === true) {
      throw new Error("PatchMon token creation was attempted but its one-time secret was not saved; reconcile or revoke manually, never replay");
    }
    if (matches.length > 0) throw new Error("PatchMon has an unowned Homarr token; refusing adoption");
    const response = await context.http.request({
      method: "POST", path: `${PREFIX}/auto-enrollment/tokens`,
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ token_name: TOKEN_NAME, metadata: { integration_type: "gethomepage" },
        max_hosts_per_day: 1, allowed_ip_ranges: [] }),
      approval: { action: "patchmon-create-homarr-token", once: true,
        progress: "Create a private Homarr stats credential that upstream also allows to enroll at most one host per day; no host is enrolled" },
      beforeSendCheckpoint: { expectedRevision: saved?.revision ?? null, stage: "homarr-token-create-requested",
        data: { ...saved?.data, integrationCreateAttempted: true, integrationAuthority: authority, integrationName: TOKEN_NAME } },
    });
    if (response.status !== 201) throw new Error("PatchMon one-time token creation was not confirmed; do not replay");
    const token = setupRecord(setupRecord(await response.json(), "PatchMon token creation").token, "PatchMon created token");
    if (token.token_name !== TOKEN_NAME || typeof token.id !== "string" || !/^[0-9a-f-]{36}$/.test(token.id)) {
      throw new Error("PatchMon returned an unexpected token identity; its one-time secret is unresolved");
    }
    pair = credentialPair({ apiKey: token.token_key, apiSecret: token.token_secret });
    // Existing atomic mode-0600 writer saves the pair together; no independent
    // key/secret writes can leave a half-written handoff. Never return the JSON.
    await context.secrets.writeApiKey(JSON.stringify(pair));
    saved = await context.checkpoint.read();
    await context.checkpoint.compareAndSet({ expectedRevision: saved?.revision ?? null,
      stage: "homarr-token-saved", data: { ...saved?.data, integrationId: token.id } });
  } else {
    try { pair = credentialPair(JSON.parse(privateValue)); }
    catch { throw new Error("PatchMon saved Homarr credential pair is malformed"); }
    if (!saved?.data.integrationCreateAttempted || saved.data.integrationName !== TOKEN_NAME) {
      throw new Error("PatchMon saved credentials have no owned creation checkpoint");
    }
  }
  const readback = await context.http.request({ method: "GET", path: `${PREFIX}/auto-enrollment/tokens`, headers });
  if (readback.status !== 200) throw new Error("PatchMon Homarr token readback failed");
  const values = await readback.json();
  if (!Array.isArray(values) || values.length > 10000) throw new Error("PatchMon Homarr token readback was invalid");
  const found = values.map((entry) => setupRecord(entry, "PatchMon token readback"))
    .filter((entry) => entry.token_name === TOKEN_NAME && entry.token_key === pair.apiKey);
  if (found.length !== 1) throw new Error("PatchMon saved Homarr token was absent or ambiguous");
  const token = found[0];
  const metadata = setupRecord(token.metadata, "PatchMon token metadata");
  const creator = setupRecord(token.users, "PatchMon token owner");
  saved = await context.checkpoint.read();
  if (typeof token.id !== "string" || !/^[0-9a-f-]{36}$/.test(token.id)
    || token.is_active !== true || token.expires_at !== null || token.max_hosts_per_day !== 1
    || !Array.isArray(token.allowed_ip_ranges) || token.allowed_ip_ranges.length !== 0
    || metadata.integration_type !== "gethomepage" || Object.keys(metadata).length !== 1
    || token.scopes !== null || creator.id !== adminId || creator.username !== "admin"
    || (saved?.data.integrationId !== undefined && saved.data.integrationId !== token.id)) {
    throw new Error("PatchMon Homarr token identity, owner or authority drifted");
  }
  const stats = await context.http.request({ method: "GET", path: `${PREFIX}/gethomepage/stats`,
    headers: { Accept: "application/json", Authorization: `Basic ${Buffer.from(`${pair.apiKey}:${pair.apiSecret}`).toString("base64")}` },
    // The upstream auth middleware updates last_used_at even for this GET.
    approval: { action: "patchmon-verify-homarr-token", progress: "Verify the saved private Homarr credential against statistics; upstream records token use" },
  });
  if (stats.status !== 200) throw new Error("PatchMon rejected the saved Homarr credential pair");
  const data = setupRecord(await stats.json(), "PatchMon Homarr statistics");
  for (const key of ["total_hosts", "hosts_needing_updates", "security_updates", "up_to_date_hosts",
    "hosts_with_security_updates", "recent_updates_24h", "total_outdated_packages", "total_repos"]) {
    if (typeof data[key] !== "number" || !Number.isFinite(data[key]) || (data[key] as number) < 0) {
      throw new Error("PatchMon returned invalid Homarr statistics");
    }
  }
  if (typeof data.last_updated !== "string" || !Number.isFinite(Date.parse(data.last_updated))) {
    throw new Error("PatchMon returned no valid Homarr statistics timestamp");
  }
  if (data.os_distribution !== undefined && (!Array.isArray(data.os_distribution)
    || data.os_distribution.some((entry) => !entry || typeof entry !== "object"
      || typeof entry.name !== "string" || typeof entry.count !== "number"
      || !Number.isFinite(entry.count) || entry.count < 0
      || (entry.os_type !== undefined && typeof entry.os_type !== "string")
      || (entry.os_version !== undefined && typeof entry.os_version !== "string")))) {
    throw new Error("PatchMon returned invalid Homarr OS distribution");
  }
  if (saved?.stage !== "homarr-credential-verified" || saved.data.integrationId !== token.id
    || saved.data.integrationAuthority !== authority) {
    await context.checkpoint.compareAndSet({ expectedRevision: saved?.revision ?? null, stage: "homarr-credential-verified",
      data: { ...saved?.data, integrationId: token.id, integrationAuthority: authority } });
  }
  return { ...record, stage: "homarr-credential-verified", apiKeyCreated: true,
    apiKeyRef: "app handoff", credentialFormat: "api-key-secret-json", credentialAuthority: authority };
}

function checkedPassword(password: string): string {
  // The recipe's 32 random bytes plus base64: prefix fit bcrypt's 72-byte limit
  // and retain upstream's default complexity policy rather than disabling it.
  if (password.length < 32 || password.length > 72 || !/^[\x21-\x7e]+$/.test(password)
    || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)
    || !/[^A-Za-z0-9]/.test(password)) {
    throw new Error("PatchMon requires a saved password satisfying the pinned default policy");
  }
  return password;
}

async function verify(context: SetupContext, email: string): Promise<SetupRecord> {
  const session = await context.secrets.readSessionCookies();
  let jwt = session.token;
  let profile;
  let retainedSession = false;
  if (jwt !== undefined) {
    if (jwt.length > 8192 || !/^[A-Za-z0-9_.-]{16,}$/.test(jwt)) {
      throw new Error("PatchMon has an invalid saved setup session");
    }
    profile = await context.http.request({
      method: "GET", path: `${PREFIX}/auth/profile`, headers: { Authorization: `Bearer ${jwt}` },
    });
    if (profile.status === 401) {
      // Only definitive authentication failure invalidates this exact-owner
      // session. A timeout, 403 or server error must not churn approval hashes.
      await context.secrets.writeSessionCookies({});
      jwt = undefined;
      profile = undefined;
    } else if (profile.status !== 200) {
      throw new Error("PatchMon saved-session readback is uncertain; session preserved");
    } else retainedSession = true;
  }
  if (jwt === undefined) {
    const password = checkedPassword(await context.secrets.readAdminPassword());
    const login = await context.http.request({
      method: "POST", path: `${PREFIX}/auth/login`,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password }),
      approval: { action: "patchmon-admin-login", progress: "Authenticate the saved PatchMon dashboard administrator" },
    });
    if (login.status !== 200) throw new Error("PatchMon rejected the saved administrator; setup is not replayed");
    const data = setupRecord(await login.json(), "PatchMon login");
    if (typeof data.token !== "string" || data.token.length > 8192 || !/^[A-Za-z0-9_.-]{16,}$/.test(data.token)) {
      throw new Error("PatchMon did not return a valid short-lived login token");
    }
    jwt = data.token;
    profile = await context.http.request({
      method: "GET", path: `${PREFIX}/auth/profile`, headers: { Authorization: `Bearer ${jwt}` },
    });
  }
  if (!profile || profile.status !== 200) throw new Error("PatchMon administrator profile readback failed");
  const user = setupRecord(setupRecord(await profile.json(), "PatchMon profile").user, "PatchMon administrator");
  if (user.username !== "admin" || user.email !== email || user.role !== "superadmin" || user.is_active !== true
    || user.has_password !== true
    || typeof user.id !== "string" || !user.id) throw new Error("PatchMon returned a different administrator identity");
  const saved = await context.checkpoint.read();
  if (saved?.data.adminId !== undefined && saved.data.adminId !== user.id) {
    throw new Error("PatchMon administrator identity changed since setup");
  }
  if (retainedSession) {
    const password = checkedPassword(await context.secrets.readAdminPassword());
    const fresh = await context.http.request({ method: "POST", path: `${PREFIX}/auth/login`,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password }),
      approval: { action: "patchmon-admin-login", progress: "Verify the saved PatchMon administrator password by fresh login" } });
    if (fresh.status !== 200) throw new Error("PatchMon rejected the saved administrator; setup is not replayed");
    const data = setupRecord(await fresh.json(), "PatchMon fresh login");
    if (typeof data.token !== "string" || data.token.length > 8192 || !/^[A-Za-z0-9_.-]{16,}$/.test(data.token)) {
      throw new Error("PatchMon did not return a valid short-lived login token");
    }
    const identity = await context.http.request({ method: "GET", path: `${PREFIX}/auth/profile`,
      headers: { Authorization: `Bearer ${data.token}` } });
    if (identity.status !== 200) throw new Error("PatchMon fresh administrator profile readback failed; retained session preserved");
    const freshUser = setupRecord(setupRecord(await identity.json(), "PatchMon fresh profile").user, "PatchMon fresh administrator");
    if (freshUser.id !== user.id || freshUser.username !== "admin" || freshUser.email !== email
      || freshUser.role !== "superadmin" || freshUser.is_active !== true || freshUser.has_password !== true) {
      throw new Error("PatchMon fresh password login differs from the retained administrator");
    }
  }
  // Persist only after exact owner readback. This bounded session is neither a
  // durable API key nor ordinary checkpoint data, and keeps deferred approvals
  // stable across CLI invocations while it remains authenticated.
  await context.secrets.writeSessionCookies({ token: jwt });
  if (saved?.data.email !== email || saved.data.adminId !== user.id) {
    await context.checkpoint.compareAndSet({ expectedRevision: saved?.revision ?? null,
      stage: "admin-login-verified", data: { ...saved?.data, email, adminId: user.id } });
  }
  const record = { appId: "patchmon", projectRoot: context.projectRoot, stage: "admin-login-verified",
    adminUsername: "admin", adminEmail: email, credentialRef: "app handoff",
    hostEnrollment: "not-authorized", apiKeyCreated: false };
  return homarrCredential(context, jwt, user.id, record);
}

const adapter: SetupAdapter = {
  appId: "patchmon",
  sharedOwner: true,
  inputDefinitions: [{ key: "admin-email", label: "Administrator email" },
    { key: "credential-authority", label: "Homarr token also permits host enrollment: explicitly choose stats-and-enrollment" }],
  peerEffects: [{ peerAppId: "homarr", description: "Optional stats token also permits one host enrollment per day; requires explicit credential-authority=stats-and-enrollment choice and exact token approval." }],
  credentialCommand: "app handoff", apiKey: "saved-by-onboarding", healthSource: "/health", homarrIntegration: "PatchMon",
  ready(record) { return record.appId === "patchmon" && record.stage === "homarr-credential-verified"
    && record.adminUsername === "admin" && record.credentialRef === "app handoff"
    && record.hostEnrollment === "not-authorized" && record.apiKeyCreated === true
    && record.credentialAuthority === "stats-and-enrollment"; },
  async firstRun(context) {
    if (context.appId !== "patchmon") throw new Error("PatchMon setup received a different app ID");
    appliedStatus(context, await context.status());
    const saved = await context.checkpoint.read();
    if (saved && (saved.appId !== "patchmon" || saved.projectRoot !== context.projectRoot
      || !["admin-create-requested", "admin-login-verified", "homarr-token-create-requested",
        "homarr-token-saved", "homarr-credential-verified"].includes(saved.stage))) {
      throw new Error("PatchMon has an unrecognized first-admin checkpoint");
    }
    const email = context.inputs["admin-email"] || saved?.data.email;
    if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("PatchMon requires an owner-selected administrator email");
    }
    if (saved?.data.email !== undefined && saved.data.email !== email) throw new Error("PatchMon administrator email changed on resume");
    const health = await context.http.request({ method: "GET", path: "/health", headers: { Accept: "application/json" } });
    if (health.status !== 200) throw new Error("PatchMon database and Redis health could not be confirmed");
    const components = setupRecord(await health.json(), "PatchMon health");
    if (components.status !== "ok" || components.database !== "ok" || components.redis !== "ok") {
      throw new Error("PatchMon did not verify its database and authenticated Redis");
    }
    const state = await context.http.request({ method: "GET", path: `${PREFIX}/settings/login-settings` });
    if (state.status !== 200) throw new Error("PatchMon first-run inspection failed");
    const settings = setupRecord(await state.json(), "PatchMon login settings");
    if (typeof settings.hasAdminUsers !== "boolean") throw new Error("PatchMon did not report first-admin state");
    if (!settings.hasAdminUsers) {
      if (saved?.attemptedActions.includes("patchmon-create-admin") || saved?.stage === "admin-create-requested") {
        throw new Error("PatchMon first-admin write was attempted; inspect manually instead of replaying");
      }
      const password = checkedPassword(await context.secrets.readAdminPassword());
      const created = await context.http.request({
        method: "POST", path: `${PREFIX}/auth/setup-admin`, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: "Dashboard", lastName: "Administrator", username: "admin", email, password }),
        approval: { action: "patchmon-create-admin", progress: "Create only the private PatchMon dashboard administrator", once: true },
        beforeSendCheckpoint: { expectedRevision: saved?.revision ?? null, stage: "admin-create-requested", data: { email } },
      });
      if (created.status !== 201) throw new Error("PatchMon first-admin creation was not confirmed; inspect before resuming");
    } else if (!saved) {
      throw new Error("PatchMon already has an administrator not proven to belong to this setup");
    }
    // The login JWT is only an owner-bound private setup session, never an API key.
    return verify(context, email);
  },
};

export default adapter;
