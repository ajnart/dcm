import { createHash } from "node:crypto";
import { appliedStatus, setupRecord, type SetupAdapter, type SetupContext, type SetupInspectionContext, type SetupRecord } from "../../types/setup.ts";
import { pangolinSetupComplete, pangolinTokenValidationRequest, pangolinTokenValid, pangolinFirstAdminRequest,
  pangolinFirstAdminResponse, pangolinLoginRequest, pangolinLoginResponse, pangolinOwnedAdminReadback,
  pangolinRootKeyRequest, pangolinRootKeyResponse, pangolinRootKeyReadback } from "./bootstrap.ts";

const COOKIE = "p_session_token";
const KEY_NAME = "Auto-Stack private administrative root key";
const STAGE = "administration-prepared";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
type Context = SetupContext | SetupInspectionContext;
function cookieHeader(cookies: Record<string, string>): Record<string, string> {
  if (Object.keys(cookies).length !== 1 || !/^[a-z2-7]{32}$/.test(cookies[COOKIE] ?? "")) throw new Error("Pangolin private session is missing or invalid");
  return { Cookie: `${COOKIE}=${cookies[COOKIE]}` };
}
async function owner(context: Context) {
  const status = appliedStatus(context, await context.status());
  if (context.appId !== "pangolin" || status.ownerKind !== "shared" || typeof status.username !== "string" || typeof status.passwordFile !== "string") {
    throw new Error("Pangolin requires its exact saved shared-owner administrator identity");
  }
  const derived = setupRecord(status.derivedRecipe, "Pangolin derived recipe");
  const input = setupRecord(derived.input, "Pangolin selection");
  const values = setupRecord(input.inputs, "Pangolin inputs");
  const config = setupRecord(derived.configuration, "Pangolin configuration");
  if (derived.appId !== "pangolin" || input.appId !== "pangolin" || derived.configurationFilesVerified !== true
    || derived.selectionFingerprint !== status.selectionFingerprint || !/^[0-9a-f]{64}$/.test(String(derived.bindingHash))
    || config.scope !== "administration-only" || config.email !== status.username || values.email !== status.username
    || config.canonicalOrigin !== values["canonical-origin"] || config.baseDomain !== values["base-domain"]
    || status.setupUrl !== config.canonicalOrigin) throw new Error("Pangolin needs its exact configured HTTPS origin and saved selection");
  return status;
}
async function identity(context: Context, email: string, headers: Record<string, string>, expectedId?: string) {
  const response = await context.http.request({ method: "GET", requireHttps: true, path: "/api/v1/user", headers });
  return pangolinOwnedAdminReadback(await response.json(), response.status, email, expectedId);
}
async function verify(context: Context): Promise<SetupRecord> {
  const status = await owner(context);
  const checkpoint = await context.checkpoint.read();
  if (!checkpoint || checkpoint.stage !== STAGE || checkpoint.data.email !== status.username
    || typeof checkpoint.data.userId !== "string" || typeof checkpoint.data.apiKeyId !== "string" || !/^[a-z0-9]{15}$/.test(checkpoint.data.apiKeyId)
    || typeof checkpoint.data.createdAt !== "string" || typeof checkpoint.data.lastChars !== "string") {
    throw new Error("Pangolin has no completed exact administrative checkpoint");
  }
  const headers = cookieHeader(await context.secrets.readSessionCookies());
  await identity(context, status.username as string, headers, checkpoint.data.userId);
  const key = await context.secrets.readApiKey();
  const path = await context.secrets.apiKeyPath();
  if (!key || !path || checkpoint.data.apiKeySha256 !== hash(key) || checkpoint.data.apiKeyFile !== path
    || !new RegExp(`^${checkpoint.data.apiKeyId}\\.[a-z2-7]{40}$`).test(key)) throw new Error("Pangolin saved root key is missing or differs; never recreate it");
  const response = await context.http.request({ method: "GET", requireHttps: true, path: `/api/v1/api-key/${checkpoint.data.apiKeyId}`, headers });
  pangolinRootKeyReadback(await response.json(), response.status, { apiKeyId: checkpoint.data.apiKeyId,
    name: KEY_NAME, lastChars: checkpoint.data.lastChars, createdAt: checkpoint.data.createdAt });
  return { appId: "pangolin", projectRoot: context.projectRoot, stage: STAGE, username: status.username, passwordFile: status.passwordFile, apiKeyFile: path,
    administratorIdentityVerified: true, rootKeyMetadataVerified: true, apiKeyAuthenticationVerified: false,
    organizationCreated: false, actionGrantsConfigured: false, resourceAccessVerified: false,
    tunnelEnrollment: "not-provided", publicEdge: "not-provided", restartPersistenceVerified: false };
}
const adapter: SetupAdapter = {
  appId: "pangolin", sharedOwner: true, credentialCommand: "app handoff", apiKey: "saved-by-onboarding", healthSource: null, homarrIntegration: null,
  ready(record) { return record.appId === "pangolin" && record.stage === STAGE && record.administratorIdentityVerified === true && record.rootKeyMetadataVerified === true; },
  inspect: verify,
  async firstRun(context) {
    const status = await owner(context);
    const email = status.username as string;
    let checkpoint = await context.checkpoint.read();
    if (checkpoint && (checkpoint.appId !== "pangolin" || checkpoint.projectRoot !== context.projectRoot || checkpoint.data.email !== email)) {
      throw new Error("Pangolin setup checkpoint belongs to another identity");
    }
    const initial = await context.http.request({ method: "GET", requireHttps: true, path: "/api/v1/auth/initial-setup-complete" });
    const complete = pangolinSetupComplete(await initial.json(), initial.status);
    if (complete && !checkpoint?.attemptedActions.includes("create-server-admin")) throw new Error("Pangolin already has an unowned administrator; no automatic adoption");
    const password = await context.secrets.readAdminPassword();
    if (!complete) {
      if (checkpoint?.attemptedActions.includes("create-server-admin")) throw new Error("Pangolin first-admin outcome is unresolved; never replay creation");
      const capability = await context.secrets.readBootstrapCapability();
      const validation = await context.http.request({ ...pangolinTokenValidationRequest(capability), requireHttps: true });
      const valid = pangolinTokenValid(await validation.json(), validation.status);
      if (!valid) throw new Error("Pangolin saved first-admin capability was rejected");
      if (!checkpoint) checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: null, stage: "owner-inspected", data: { email } });
      const response = await context.http.request({ ...pangolinFirstAdminRequest({ setupComplete: false, tokenValid: true,
        freshStateVerified: true, attempted: false, expectedRevision: checkpoint.revision, email, password, setupToken: capability }), requireHttps: true });
      pangolinFirstAdminResponse(await response.json(), response.status);
    }
    // Always verify the password with a cookie-free login, never a recent-session bypass.
    const login = await context.http.request({ ...pangolinLoginRequest(email, password), requireHttps: true });
    pangolinLoginResponse(await login.json(), login.status);
    const cookies = login.headers.getSetCookie?.() ?? [];
    const matches = cookies.filter((value) => value.startsWith(`${COOKIE}=`));
    if (matches.length !== 1 || !/;\s*Secure(?:;|$)/i.test(matches[0]!) || !/;\s*HttpOnly(?:;|$)/i.test(matches[0]!)) throw new Error("Pangolin did not return a secure private session");
    const cookie = matches[0]!.split(";", 1)[0]!.slice(COOKIE.length + 1);
    const headers = cookieHeader({ [COOKIE]: cookie });
    await context.secrets.writeSessionCookies({ [COOKIE]: cookie });
    const admin = await identity(context, email, headers);
    checkpoint = await context.checkpoint.read();
    if (!checkpoint) throw new Error("Pangolin durable administrator checkpoint is missing");
    if (checkpoint.stage === STAGE) return verify(context);
    if (checkpoint.attemptedActions.includes("create-root-api-key") || await context.secrets.readApiKey()) throw new Error("Pangolin root-key creation is unresolved; reconcile privately without replay");
    const request = pangolinRootKeyRequest({ ownedAdmin: admin, rootKeyApproved: true, attempted: false,
      expectedRevision: checkpoint.revision, savedKeyPresent: false, name: KEY_NAME });
    const response = await context.http.request({ ...request, requireHttps: true, headers: { ...request.headers, ...headers } });
    const key = pangolinRootKeyResponse(await response.json(), response.status, KEY_NAME);
    const combined = `${key.apiKeyId}.${key.apiKey}`;
    const file = await context.secrets.writeApiKey(combined);
    checkpoint = await context.checkpoint.read();
    if (!checkpoint?.attemptedActions.includes("create-root-api-key")) throw new Error("Pangolin root-key durable pre-send checkpoint is missing");
    await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision, stage: STAGE,
      data: { email, userId: admin.userId, apiKeyId: key.apiKeyId, lastChars: key.lastChars, createdAt: key.createdAt,
        apiKeyFile: file, apiKeySha256: hash(combined) } });
    return verify(context);
  },
};
export default adapter;
