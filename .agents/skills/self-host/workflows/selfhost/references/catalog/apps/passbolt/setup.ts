import { randomUUID } from "node:crypto";
import { appliedStatus, setupRecord, type SetupAdapter, type SetupContext, type SetupHttpResponse } from "../../types/setup.ts";
import { compilePassboltRegistration } from "./configuration.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const READY = "gpg-administrator-verified";
function fail(): never { throw new Error("Passbolt enrollment differs from the exact saved owner; inspect before retrying"); }
function body(value: unknown) {
  const response = setupRecord(value, "Passbolt private response");
  if (setupRecord(response.header, "Passbolt response header").status !== "success") fail();
  return setupRecord(response.body, "Passbolt response body");
}
async function saveCookies(context: SetupContext, response: SetupHttpResponse) {
  const cookies = await context.secrets.readSessionCookies();
  for (const header of response.headers.getSetCookie?.() ?? []) {
    const pair = header.split(";", 1)[0]!, at = pair.indexOf("=");
    const name = pair.slice(0, at), value = pair.slice(at + 1);
    if (!["passbolt_session", "CAKEPHP", "PHPSESSID", "csrfToken"].includes(name)
      || !/^[A-Za-z0-9._~%+-]{1,4096}$/.test(value)
      || (name !== "csrfToken" && !/;\s*secure(?:;|$)/i.test(header))) fail();
    cookies[name] = value;
  }
  await context.secrets.writeSessionCookies(cookies);
}
async function headers(context: SetupContext) {
  const cookies = await context.secrets.readSessionCookies();
  const result: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  const values = Object.entries(cookies);
  if (values.some(([name, value]) => !["passbolt_session", "CAKEPHP", "PHPSESSID", "csrfToken"].includes(name)
    || !/^[A-Za-z0-9._~%+-]{1,4096}$/.test(value))) fail();
  if (values.length) result.Cookie = values.map(([name, value]) => `${name}=${value}`).join("; ");
  if (cookies.csrfToken) result["X-CSRF-Token"] = decodeURIComponent(cookies.csrfToken);
  return result;
}
type Owner = { id: string; email: string; fingerprint: string };
async function owner(context: SetupContext, expected: Owner) {
  const response = await context.http.request({ method: "GET", path: "/users/me.json", requireHttps: true, headers: await headers(context) });
  if ([401, 403].includes(response.status)) return false;
  if (response.status !== 200) fail();
  const user = body(await response.json());
  if (user.id !== expected.id || user.username !== expected.email || user.active !== true
    || setupRecord(user.role, "Passbolt role").name !== "admin"
    || setupRecord(user.gpgkey, "Passbolt key").fingerprint !== expected.fingerprint) fail();
  return true;
}
async function authenticate(context: SetupContext, expected: Owner, server: { publicKey: string; fingerprint: string }, refreshAllowed = true): Promise<void> {
  if (await owner(context, expected)) {
    await context.secrets.writeSetupSession(null);
    return;
  }
  let session = await context.secrets.readSetupSession();
  if (session && (session.fingerprint !== expected.fingerprint || session.serverFingerprint !== server.fingerprint)) fail();
  if (!session) {
    const nonce = `gpgauthv1.3.0|36|${randomUUID()}|gpgauthv1.3.0`;
    const encrypted = await context.crypto.encryptSign({ text: nonce, recipientPublicKey: server.publicKey, recipientFingerprint: server.fingerprint });
    session = { fingerprint: expected.fingerprint, serverFingerprint: server.fingerprint, nonce,
      encrypted: Buffer.from(encrypted, "utf8").toString("base64") };
    await context.secrets.writeSetupSession(session);
  }
  if (session.serverVerified !== "true") {
    const response = await context.http.request({ method: "POST", path: "/auth/verify.json", requireHttps: true,
      headers: await headers(context), body: JSON.stringify({ gpg_auth: { keyid: expected.fingerprint, server_verify_token: Buffer.from(session.encrypted!, "base64").toString("utf8") } }),
      approval: { action: "passbolt-verify-server-key", progress: "Verify possession of the pinned Passbolt server OpenPGP private key" } });
    if (response.headers.get("X-GPGAuth-Verify-Response") !== session.nonce) fail();
    await saveCookies(context, response);
    session.serverVerified = "true";
    await context.secrets.writeSetupSession(session);
  }
  if (!session.userToken) {
    const response = await context.http.request({ method: "POST", path: "/auth/login.json", requireHttps: true,
      headers: await headers(context), body: JSON.stringify({ gpg_auth: { keyid: expected.fingerprint } }),
      approval: { action: "passbolt-gpgauth-challenge", progress: "Request a server-signed encrypted challenge for the saved Passbolt client key" } });
    const encoded = response.headers.get("X-GPGAuth-User-Auth-Token");
    if (!encoded || encoded.length > 65536 || response.headers.get("X-GPGAuth-Progress") !== "stage1") fail();
    let armored: string;
    try { armored = decodeURIComponent(encoded.replace(/\+/g, " ")).replace(/\\ /g, " "); } catch { fail(); }
    const token = await context.crypto.decryptVerify({ armored, signerPublicKey: server.publicKey, signerFingerprint: server.fingerprint });
    const parts = token.split("|");
    if (parts.length !== 4 || parts[0] !== "gpgauthv1.3.0" || parts[1] !== "36" || !UUID.test(parts[2]!) || parts[3] !== parts[0]) fail();
    session.userToken = token;
    await saveCookies(context, response);
    await context.secrets.writeSetupSession(session);
  }
  let response: SetupHttpResponse;
  try {
    response = await context.http.request({ method: "POST", path: "/auth/login.json", requireHttps: true,
      headers: await headers(context), body: JSON.stringify({ gpg_auth: { keyid: expected.fingerprint, user_token_result: session.userToken } }),
      approval: { action: "passbolt-gpgauth-authenticate", progress: "Authenticate possession of the saved Passbolt client OpenPGP key" } });
  } catch (error) {
    // A lost response may already have authenticated the owner. Reconcile before
    // changing private attempt material; a still-unknown outcome keeps it intact.
    if (await owner(context, expected)) {
      await context.secrets.writeSetupSession(null);
      return;
    }
    throw error;
  }
  if (response.status === 400 && response.headers.get("X-GPGAuth-Progress") === "stage2"
    && response.headers.get("X-GPGAuth-Authenticated") === "false") {
    // Pinned AuthLoginController returns this only after stage2 token rejection.
    // Never reset enrollment/key custody or replay activation to renew a login.
    const reconciled = await owner(context, expected);
    await context.secrets.writeSetupSession(null);
    if (reconciled) return;
    if (!refreshAllowed) fail();
    return authenticate(context, expected, server, false);
  }
  if (response.headers.get("X-GPGAuth-Authenticated") !== "true" || response.headers.get("X-GPGAuth-Progress") !== "complete") fail();
  await saveCookies(context, response);
  if (!await owner(context, expected)) fail();
  await context.secrets.writeSetupSession(null);
}
const adapter: SetupAdapter = {
  appId: "passbolt", sharedOwner: true, credentialCommand: "app handoff", apiKey: "not-created", homarrIntegration: null,
  healthSource: "Native HTTPS GPGAuth and exact administrator/key readback; not encrypted-vault or SMTP acceptance",
  inputDefinitions: [{ key: "email", label: "First owner's real email" }, { key: "first-name", label: "First owner's given name" },
    { key: "last-name", label: "First owner's family name" }],
  ready(record) { return record.appId === "passbolt" && record.stage === READY && record.loginVerified === true && record.clientPrivateKeyCustodyVerified === true; },
  async firstRun(context) {
    const status = appliedStatus(context, await context.status());
    if (context.appId !== "passbolt" || status.ownerKind !== "shared") fail();
    const configuration = setupRecord(setupRecord(status.derivedRecipe, "Passbolt derived recipe").configuration, "Passbolt configuration");
    const canonicalOrigin = configuration.canonicalOrigin;
    if (typeof canonicalOrigin !== "string" || typeof status.setupUrl !== "string") fail();
    let setupUrl: URL;
    try { setupUrl = new URL(status.setupUrl); } catch { fail(); }
    if (setupUrl.origin !== canonicalOrigin || setupUrl.username || setupUrl.password
      || setupUrl.pathname !== "/" || setupUrl.search || setupUrl.hash) fail();
    let checkpoint = await context.checkpoint.read();
    const email = context.inputs.email ?? checkpoint?.data.email, firstName = context.inputs["first-name"] ?? checkpoint?.data.firstName;
    const lastName = context.inputs["last-name"] ?? checkpoint?.data.lastName;
    if (![email, firstName, lastName].every((value) => typeof value === "string")
      || (checkpoint && (typeof checkpoint.data.serverFingerprint !== "string"
        || !/^[0-9A-F]{40}$/.test(checkpoint.data.serverFingerprint)))) fail();
    const identity = { email: email as string, firstName: firstName as string, lastName: lastName as string };
    compilePassboltRegistration(identity, canonicalOrigin);
    const verify = await context.http.request({ method: "GET", path: "/auth/verify.json", requireHttps: true, headers: await headers(context) });
    if (verify.status !== 200) fail();
    const serverBody = body(await verify.json());
    if (typeof serverBody.fingerprint !== "string" || !/^[0-9A-Fa-f]{40}$/.test(serverBody.fingerprint)
      || typeof serverBody.keydata !== "string") fail();
    const serverFingerprint = serverBody.fingerprint.toUpperCase();
    if (checkpoint && checkpoint.data.serverFingerprint !== serverFingerprint) fail();
    // First-use trust comes from the exact saved owner HTTPS route/CA, never a
    // caller URL or loopback fallback. Validate key bytes, then persist the pin
    // before key generation/registration. Any subsequent drift stops enrollment.
    await context.crypto.inspectPublicKey({ publicKey: serverBody.keydata, expectedFingerprint: serverFingerprint });
    const choices = { ...identity, serverFingerprint, canonicalOrigin };
    if (checkpoint && Object.entries(choices).some(([name, value]) => checkpoint!.data[name] !== value)) fail();
    await saveCookies(context, verify);
    if (!checkpoint) checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: null, stage: "gpg-enrollment-selected", data: choices });
    // Durable encrypted key/passphrase/recovery custody MUST precede activation.
    const key = await context.crypto.ensureClientKey({ name: `${identity.firstName} ${identity.lastName}`, email: identity.email });
    let invitation = await context.passbolt.readInvitation();
    if (!invitation) {
      if (checkpoint.stage !== "gpg-enrollment-selected") fail();
      invitation = await context.passbolt.registerFirstAdmin({ ...identity, canonicalOrigin,
        beforeSendCheckpoint: { expectedRevision: checkpoint.revision, stage: "registration-attempted", data: choices } });
    }
    if (!UUID.test(invitation.userId) || !UUID.test(invitation.token)) fail();
    const expected = { id: invitation.userId, email: identity.email, fingerprint: key.fingerprint };
    checkpoint = await context.checkpoint.read();
    if (!checkpoint) fail();
    if (checkpoint.data.userId && (checkpoint.data.userId !== invitation.userId || checkpoint.data.clientFingerprint !== key.fingerprint)) fail();
    if (!["activation-attempted", READY].includes(checkpoint.stage)) {
      const start = await context.http.request({ method: "GET", requireHttps: true, path: `/setup/start/${invitation.userId}/${invitation.token}.json`, headers: await headers(context) });
      if (start.status !== 200) fail();
      const invited = setupRecord(body(await start.json()).user, "Passbolt invitation identity");
      if (invited.id !== invitation.userId || invited.username !== identity.email || invited.active !== false) fail();
      await saveCookies(context, start);
      const activation = await context.http.request({ method: "POST", requireHttps: true, path: `/setup/complete/${invitation.userId}.json`, headers: await headers(context),
        body: JSON.stringify({ authentication_token: { token: invitation.token }, gpgkey: { armored_key: key.publicKey } }),
        approval: { action: "passbolt-activate-first-admin", progress: "Activate the exact invitation using the already-custodied client public key", once: true },
        beforeSendCheckpoint: { expectedRevision: checkpoint.revision, stage: "activation-attempted", data: { ...choices, userId: invitation.userId, clientFingerprint: key.fingerprint } } });
      if (activation.status !== 200) fail();
      if (setupRecord(setupRecord(await activation.json(), "Passbolt activation").header, "Passbolt activation header").status !== "success") fail();
    }
    // Never replay attempted activation; authenticate the SAME saved key instead.
    await authenticate(context, expected, { publicKey: serverBody.keydata, fingerprint: serverFingerprint as string });
    checkpoint = await context.checkpoint.read();
    if (!checkpoint) fail();
    if (checkpoint.stage !== READY) await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision, stage: READY,
      data: { ...choices, userId: invitation.userId, clientFingerprint: key.fingerprint } });
    return { appId: "passbolt", projectRoot: context.projectRoot, stage: READY, email: identity.email, userId: invitation.userId,
      clientFingerprint: key.fingerprint, clientKeyCustodyPath: key.custodyPath, accountCreated: true, loginVerified: true,
      clientPrivateKeyCustodyVerified: true, serverKeyPossessionVerified: true, encryptedRoundTripVerified: false,
      smtpDeliveryVerified: false, timeSynchronizationVerified: false, browserExtensionImportVerified: false, restartPersistenceVerified: false,
      gaps: ["Privately import the saved native key into the intended client", "Verify SMTP delivery, client TLS, encrypted-vault save/decrypt, restart and isolated recovery"] };
  },
};
export default adapter;
