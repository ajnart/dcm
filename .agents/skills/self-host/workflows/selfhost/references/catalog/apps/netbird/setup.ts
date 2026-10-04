import { createHash, randomBytes } from "node:crypto";
import { isAbsolute } from "node:path";
import { appliedStatus, setupRecord, type SetupAdapter, type SetupContext, type SetupInspectionContext,
  type SetupHttpRequest, type SetupRecord } from "../../types/setup.ts";
import { compileNetbirdConfiguration } from "./configuration.ts";
import { netbirdFirstOwnerRequest, netbirdFirstOwnerResponse } from "./bootstrap.ts";
import { netbirdOwnerLoginRequest, netbirdOwnerPasswordRequest, netbirdOwnerTokenRequest,
  netbirdOwnerTokenResponse, netbirdOwnerReadback, netbirdSetupPatReadback } from "./login-contract.ts";

const CREATE = "netbird-create-first-owner";
async function configuration(context: SetupContext | SetupInspectionContext) {
  const status = appliedStatus(context, await context.status());
  const derived = setupRecord(status.derivedRecipe, "NetBird derived recipe");
  const input = setupRecord(derived.input, "NetBird selection");
  const values = setupRecord(input.inputs, "NetBird inputs");
  const saved = setupRecord(derived.configuration, "NetBird configuration");
  const compiled = compileNetbirdConfiguration({ canonicalOrigin: values["canonical-origin"] as string,
    trustedProxyAddress: values["trusted-proxy-address"] as string, ownerEmail: values["owner-email"] as string });
  const expected = { ...compiled.requirements, ownerEmail: values["owner-email"], selectionFingerprint: compiled.selectionFingerprint };
  let setupOrigin: string | null = null;
  if (typeof status.setupUrl === "string") setupOrigin = new URL(status.setupUrl).origin;
  if (context.appId !== "netbird" || status.ownerKind !== "shared" || derived.appId !== "netbird"
    || input.appId !== "netbird" || derived.configurationFilesVerified !== true
    || derived.selectionFingerprint !== status.selectionFingerprint
    || typeof derived.bindingHash !== "string" || !/^[0-9a-f]{64}$/.test(derived.bindingHash)
    || setupOrigin !== values["canonical-origin"]
    || JSON.stringify(saved) !== JSON.stringify(expected)) throw new Error("NetBird has no exact saved shared configuration and canonical HTTPS route");
  return { canonicalOrigin: values["canonical-origin"] as string, ownerEmail: values["owner-email"] as string,
    selectionFingerprint: compiled.selectionFingerprint, bindingHash: derived.bindingHash };
}
function request(input: Pick<SetupHttpRequest, "method" | "path" | "headers" | "body">): SetupHttpRequest {
  const url = new URL(input.path, "https://adapter.invalid");
  const result: SetupHttpRequest = { ...input, requireHttps: true, path: url.pathname };
  if (url.search) result.query = Object.fromEntries(url.searchParams);
  return result;
}
async function owner(context: SetupContext | SetupInspectionContext, authorization: string, email: string, userId?: string) {
  const response = await context.http.request({ method: "GET", requireHttps: true, path: "/api/users/current",
    headers: { Authorization: authorization } });
  if (!response.ok || response.status !== 200) throw new Error("NetBird rejected the saved owner credential");
  return netbirdOwnerReadback(await response.json(), { email, userId });
}
async function verify(context: SetupContext | SetupInspectionContext, config: Awaited<ReturnType<typeof configuration>>,
  freshPasswordOwner?: string): Promise<SetupRecord> {
  const checkpoint = await context.checkpoint.read();
  const key = await context.secrets.readApiKey();
  if (!checkpoint || checkpoint.appId !== "netbird" || checkpoint.projectRoot !== context.projectRoot
    || checkpoint.data.selectionFingerprint !== config.selectionFingerprint || checkpoint.data.bindingHash !== config.bindingHash
    || !checkpoint.attemptedActions.includes(CREATE) || !key || typeof checkpoint.data.completedAt !== "number") {
    throw new Error("NetBird has no retained one-time owner/PAT evidence; reconcile without replaying setup");
  }
  const identity = await owner(context, `Token ${key}`, config.ownerEmail, checkpoint.data.userId as string);
  const response = await context.http.request({ method: "GET", requireHttps: true,
    path: `/api/users/${encodeURIComponent(identity.userId)}/tokens`, headers: { Authorization: `Token ${key}` } });
  if (!response.ok || response.status !== 200) throw new Error("NetBird PAT metadata readback failed");
  const pat = netbirdSetupPatReadback(await response.json(), { userId: identity.userId,
    attemptedAt: checkpoint.data.attemptedAt as number, completedAt: checkpoint.data.completedAt,
    now: Date.now() });
  const credentialRef = await context.secrets.apiKeyPath();
  if (!credentialRef || !isAbsolute(credentialRef)) throw new Error("NetBird has no private PAT path");
  return { appId: "netbird", projectRoot: context.projectRoot, stage: "owner-and-pat-verified",
    ...identity, ...pat, ...config, credentialRef, ownerIdentityVerified: true, patVerified: true,
    // Persisted login history never becomes current password proof during inspection.
    passwordLoginVerified: freshPasswordOwner === identity.userId,
    tokenRotation: "pending", effectiveProxyTrust: "pending", nativeGrpc: "pending", webSocket: "pending", peerEnrollment: "pending",
    intendedClientAccess: "pending", restartPersistence: "pending", externalSso: "not-configured" };
}
async function login(context: SetupContext, config: Awaited<ReturnType<typeof configuration>>, userId: string) {
  // Every transient OIDC value stays in the exact owner-private session, never
  // public checkpoint data. A lost exchange starts a new login, not a replay.
  let session = await context.secrets.readSetupSession();
  let checkpoint = (await context.checkpoint.read())!;
  const action = (phase: string, state: string) => `netbird-owner-login-${phase}-${createHash("sha256").update(state).digest("hex").slice(0, 16)}`;
  if (session && (!session.state || !["begin", "password", "token"].includes(session.phase!)
    || session.canonicalOrigin !== config.canonicalOrigin || session.userId !== userId)) {
    throw new Error("NetBird private login session does not match this owner");
  }
  if (session && checkpoint.attemptedActions.includes(action(session.phase!, session.state!))) session = null;
  if (!session) {
    session = { canonicalOrigin: config.canonicalOrigin, userId, phase: "begin", state: randomBytes(32).toString("base64url"),
      nonce: randomBytes(32).toString("base64url"), verifier: randomBytes(48).toString("base64url") };
    await context.secrets.writeSetupSession(session);
    await context.secrets.writeSessionCookies({});
  }
  const attempt = { canonicalOrigin: config.canonicalOrigin, state: session.state!, nonce: session.nonce!, verifier: session.verifier! };
  const cookies = await context.secrets.readSessionCookies();
  async function exchange(input: SetupHttpRequest, phase: string) {
    input.headers = { ...input.headers };
    if (Object.keys(cookies).length) input.headers.Cookie = Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; ");
    checkpoint = (await context.checkpoint.read())!;
    input.approval = { action: action(phase, attempt.state), once: true, progress: "Verify the retained owner with a fresh private local password login" };
    input.beforeSendCheckpoint = { expectedRevision: checkpoint.revision, stage: "owner-login-exchange-attempted", data: checkpoint.data };
    const response = await context.http.request(input);
    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      const pair = cookie.split(";", 1)[0]!; const index = pair.indexOf("=");
      if (index <= 0) throw new Error("NetBird returned an invalid private session cookie");
      cookies[pair.slice(0, index)] = pair.slice(index + 1);
    }
    await context.secrets.writeSessionCookies(cookies);
    return response;
  }
  if (session.phase === "begin") {
    const first = await exchange(request(netbirdOwnerLoginRequest(attempt)), "begin");
    session = { ...session, phase: "password", location: first.headers.get("location")!, status: String(first.status) };
    // Validate the retained redirect before allowing another reviewed exchange.
    netbirdOwnerPasswordRequest({ ...attempt, status: first.status, location: session.location!,
      email: config.ownerEmail, password: await context.secrets.readAdminPassword() });
    await context.secrets.writeSetupSession(session);
  }
  if (session.phase === "password") {
    const second = await exchange(request(netbirdOwnerPasswordRequest({ ...attempt, status: Number(session.status),
      location: session.location!, email: config.ownerEmail, password: await context.secrets.readAdminPassword() })), "password");
    session = { ...session, phase: "token", location: second.headers.get("location")!, status: String(second.status) };
    netbirdOwnerTokenRequest({ ...attempt, status: second.status, location: session.location! });
    await context.secrets.writeSetupSession(session);
  }
  const third = await exchange(request(netbirdOwnerTokenRequest({ ...attempt, status: Number(session.status),
    location: session.location! })), "token");
  if (!third.ok || third.status !== 200) throw new Error("NetBird owner password login token exchange failed");
  const token = netbirdOwnerTokenResponse(await third.json());
  await owner(context, `Bearer ${token.accessToken}`, config.ownerEmail, userId);
  await context.secrets.writeSetupSession(null);
  await context.secrets.writeSessionCookies({});
  return userId;
}
const adapter: SetupAdapter = {
  appId: "netbird", sharedOwner: true, credentialCommand: "app handoff", apiKey: "saved-by-onboarding",
  healthSource: null, homarrIntegration: null,
  ready(record) { return record.appId === "netbird" && record.stage === "owner-and-pat-verified"
    && record.role === "owner" && record.passwordLoginVerified === true && typeof record.credentialRef === "string"; },
  async firstRun(context) {
    const config = await configuration(context);
    let checkpoint = await context.checkpoint.read();
    if (checkpoint && (checkpoint.data.selectionFingerprint !== config.selectionFingerprint || checkpoint.data.bindingHash !== config.bindingHash)) {
      throw new Error("NetBird checkpoint belongs to a different selection or owner");
    }
    const response = await context.http.request({ method: "GET", requireHttps: true, path: "/api/instance" });
    if (!response.ok || response.status !== 200) throw new Error("NetBird instance inspection failed");
    const instance = setupRecord(await response.json(), "NetBird instance");
    if (typeof instance.setup_required !== "boolean") throw new Error("NetBird instance returned invalid setup state");
    const key = await context.secrets.readApiKey();
    if (key && instance.setup_required) throw new Error("NetBird retained PAT conflicts with the fresh instance; reconcile ownership");
    if (!key) {
      if (checkpoint?.attemptedActions.includes(CREATE)) throw new Error("NetBird owner setup was attempted without retained PAT; do not replay");
      const prepared = netbirdFirstOwnerRequest({ instance, attempted: false, email: config.ownerEmail,
        password: await context.secrets.readAdminPassword(), setupPatEnabled: true });
      if (!checkpoint) checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: null,
        stage: "configuration-bound", data: { ...config, attemptedAt: Date.now() } });
      const created = await context.http.request({ ...request(prepared), approval: { action: CREATE, once: true,
        progress: "Create one NetBird local owner and retain its one-day administrative PAT privately" },
        beforeSendCheckpoint: { expectedRevision: checkpoint.revision, stage: "owner-create-attempted", data: checkpoint.data } });
      if (!created.ok || created.status !== 200) throw new Error("NetBird owner setup outcome is unresolved; do not replay");
      const parsed = netbirdFirstOwnerResponse(await created.json(), config.ownerEmail, true);
      await context.secrets.writeApiKey(parsed.personalAccessToken!);
      checkpoint = (await context.checkpoint.read())!;
      checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision, stage: "owner-created",
        data: { ...checkpoint.data, userId: parsed.userId, completedAt: Date.now(), passwordLoginVerified: false } });
    }
    const retained = await verify(context, config);
    const freshPasswordOwner = await login(context, config, retained.userId as string);
    checkpoint = (await context.checkpoint.read())!;
    await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision, stage: "owner-login-verified",
      data: { ...checkpoint.data, passwordLoginVerified: true } });
    return verify(context, config, freshPasswordOwner);
  },
  async inspect(context) { return verify(context, await configuration(context)); },
};
export default adapter;
