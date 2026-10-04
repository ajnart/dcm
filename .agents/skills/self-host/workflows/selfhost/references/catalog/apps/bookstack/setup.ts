import { createHash } from "node:crypto";
import { dirname, isAbsolute } from "node:path";

import { appliedStatus, type SetupAdapter, type SetupContext, type SetupHttpResponse,
  type SetupRecord, type SetupCheckpoint } from "../../types/setup";

const APP_ID = "bookstack";
const EMAIL = "admin@example.test";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function addCookies(jar: Map<string, string>, response: SetupHttpResponse): void {
  for (const header of response.headers.getSetCookie?.() ?? []) {
    const pair = header.split(";", 1)[0] ?? "";
    const separator = pair.indexOf("=");
    if (separator < 1) throw new Error("BookStack returned an invalid session cookie");
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name) || /[\r\n;]/.test(value) || value.length > 4096
      || (jar.size >= 16 && !jar.has(name))) {
      throw new Error("BookStack returned an unsafe session cookie");
    }
    jar.set(name, value);
  }
}

function cookies(jar: Map<string, string>): string {
  if (jar.size === 0) throw new Error("BookStack supplied no private login session");
  if (jar.size > 16 || [...jar.values()].some((value) => value.length > 4096 || /[\r\n;]/.test(value))) {
    throw new Error("BookStack saved login cookies exceed the private session bounds");
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

function csrf(page: string): string {
  const token = page.match(/<input\s+[^>]*name="_token"[^>]*value="([A-Za-z0-9]+)"/i)?.[1];
  if (!token || token.length < 20 || token.length > 256) {
    throw new Error("BookStack's pinned login form did not supply a CSRF token");
  }
  return token;
}

async function login(context: SetupContext, email: string, password: string,
  action: string, retainSession = false): Promise<boolean> {
  const jar = new Map<string, string>();
  const passwordDigest = digest(`${email}\0${password}`);
  const saved = await context.secrets.readSessionCookies();
  let token = saved.csrf_token;
  if (Object.keys(saved).length > 0) {
    if (saved.password_digest !== passwordDigest || !token || !/^[A-Za-z0-9]{20,256}$/.test(token)
      || Object.keys(saved).some((key) => !["password_digest", "csrf_token"].includes(key)
        && !/^cookie_[A-Za-z0-9_-]{1,64}$/.test(key))) {
      throw new Error("BookStack saved login form differs from the private owner credential");
    }
    for (const [key, value] of Object.entries(saved)) {
      if (key.startsWith("cookie_")) jar.set(key.slice(7), value);
    }
    cookies(jar);
  } else {
    const page = await context.http.request({ method: "GET", path: "/login",
      headers: { Accept: "text/html" } });
    addCookies(jar, page);
    if (page.status !== 200) throw new Error("BookStack login form is unavailable");
    const html = await page.text();
    if (!/<form\b[^>]*method="post"/i.test(html) || !/name="email"/.test(html)
      || !/name="password"/.test(html)) {
      throw new Error("BookStack did not show its standard email login form");
    }
    token = csrf(html);
    cookies(jar);
    await context.secrets.writeSessionCookies({ password_digest: passwordDigest, csrf_token: token,
      ...Object.fromEntries([...jar].map(([name, value]) => [`cookie_${name}`, value])) });
  }
  // Preserve the exact CSRF/session across separate deferred-approval invocations.
  const body = new URLSearchParams({ _token: token, email, password }).toString();
  const response = await context.http.request({ method: "POST", path: "/login",
    headers: { Accept: "text/html", "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookies(jar) }, body,
    approval: { action, progress: "Verify BookStack email login on the exact private origin" } });
  addCookies(jar, response);
  if (response.status === 419) {
    await context.secrets.writeSessionCookies({});
    throw new Error("BookStack saved login form expired; review a new form on the next setup run");
  }
  if (response.status !== 302) throw new Error("BookStack login returned an unexpected response");
  const users = await context.http.request({ method: "GET", path: "/settings/users",
    headers: { Accept: "text/html", Cookie: cookies(jar) } });
  if (users.status === 302 || users.status === 401 || users.status === 419) {
    await context.secrets.writeSessionCookies({});
    return false;
  }
  if (users.status !== 200) throw new Error("BookStack login did not prove administrator access");
  if (retainSession) {
    await context.secrets.writeSessionCookies({ password_digest: passwordDigest, csrf_token: token,
      ...Object.fromEntries([...jar].map(([name, value]) => [`cookie_${name}`, value])) });
  } else {
    await context.secrets.writeSessionCookies({});
  }
  return true;
}

const TOKEN_NAME = "selfhost-private-admin";
const TOKEN_EXPIRY = "2099-01-01";
const TOKEN_STAGES = ["token-reviewed", "token-create-attempted", "token-created",
  "token-secret-attempted", "admin-and-api-token-verified"];

// v26.05.3 UserApiTokenController, token edit view and ApiTokenGuard at
// https://github.com/BookStackApp/BookStack/tree/e1cd3229966d939a75a74a2224ff0643d8af337b
// Tokens inherit the owner's API permissions; they have no independent scope.
function inputValue(html: string, name: string): string {
  const inputs = [...html.matchAll(/<input\b[^>]*>/gi)].map((match) => match[0]);
  const found = inputs.filter((input) => input.includes(`name="${name}"`));
  if (found.length !== 1) throw new Error("BookStack's pinned token input is ambiguous");
  const value = found[0]!.match(/\bvalue="([^"]*)"/)?.[1];
  if (value === undefined) throw new Error("BookStack's pinned token input is missing");
  return value;
}

async function tokenSession(context: SetupContext): Promise<Map<string, string>> {
  const saved = await context.secrets.readSessionCookies();
  const password = await context.secrets.readAdminPassword();
  if (saved.password_digest !== digest(`${EMAIL}\0${password}`)
    || !/^[A-Za-z0-9]{20,256}$/.test(saved.csrf_token ?? "")
    || Object.keys(saved).some((name) => !["password_digest", "csrf_token"].includes(name)
      && !/^cookie_[A-Za-z0-9_-]{1,64}$/.test(name))) {
    throw new Error("BookStack saved token session differs from its private administrator");
  }
  const jar = new Map<string, string>();
  for (const [name, value] of Object.entries(saved)) {
    if (name.startsWith("cookie_")) jar.set(name.slice(7), value);
  }
  cookies(jar);
  return jar;
}

async function saveTokenSession(context: SetupContext, jar: Map<string, string>, token: string): Promise<void> {
  const saved = await context.secrets.readSessionCookies();
  await context.secrets.writeSessionCookies({ password_digest: saved.password_digest!, csrf_token: token,
    ...Object.fromEntries([...jar].map(([name, value]) => [`cookie_${name}`, value])) });
}

async function apiToken(context: SetupContext, checkpoint: SetupCheckpoint): Promise<SetupRecord> {
  let current = checkpoint;
  if (TOKEN_STAGES.includes(current.stage) && current.stage !== "token-reviewed"
    && !current.attemptedActions.includes("bookstack-create-private-api-token")) {
    throw new Error("BookStack token lacks one-time creation provenance");
  }
  let key = await context.secrets.readApiKey();
  if (current.stage === "admin-login-verified") {
    if (key !== null) throw new Error("BookStack has an API key without creation provenance");
    const jar = await tokenSession(context);
    const headers = { Accept: "text/html", Cookie: cookies(jar) };
    const profile = await context.http.request({ method: "GET", path: "/my-account/profile", headers });
    if (profile.status !== 200 || inputValue(await profile.text(), "email") !== EMAIL) {
      throw new Error("BookStack token owner is not the saved administrator");
    }
    addCookies(jar, profile);
    const auth = await context.http.request({ method: "GET", path: "/my-account/auth",
      headers: { ...headers, Cookie: cookies(jar) } });
    if (auth.status !== 200) throw new Error("BookStack own-account token controls are unavailable");
    const page = await auth.text();
    const ids = [...page.matchAll(/href="[^"\s]*\/api-tokens\/([1-9][0-9]*)\/create\?context=my-account"/g)];
    if (ids.length !== 1 || /\/api-tokens\/[1-9][0-9]*\/[1-9][0-9]*/.test(page)) {
      throw new Error("BookStack token owner is ambiguous or already has tokens; inspect before creation");
    }
    addCookies(jar, auth);
    const userId = ids[0]![1]!;
    const form = await context.http.request({ method: "GET", path: `/api-tokens/${userId}/create`,
      headers: { ...headers, Cookie: cookies(jar) } });
    if (form.status !== 200) throw new Error("BookStack token creation form is unavailable");
    const html = await form.text();
    if (!html.includes(`/api-tokens/${userId}/create`) || !/name="name"/.test(html)
      || !/name="expires_at"/.test(html)) throw new Error("BookStack token form differs from its pinned source");
    addCookies(jar, form);
    await saveTokenSession(context, jar, csrf(html));
    current = await context.checkpoint.compareAndSet({ expectedRevision: current.revision,
      stage: "token-reviewed", data: { ...current.data, userId, label: TOKEN_NAME,
        expiresAt: TOKEN_EXPIRY } });
  }
  if (current.stage === "token-reviewed") {
    if (key !== null) throw new Error("BookStack has an unexpected saved token before creation");
    const jar = await tokenSession(context);
    const saved = await context.secrets.readSessionCookies();
    if (!/^[A-Za-z0-9]{20,256}$/.test(saved.csrf_token ?? "")) throw new Error("BookStack token CSRF is missing");
    const created = await context.http.request({ method: "POST",
      path: `/api-tokens/${current.data.userId}/create`,
      headers: { Accept: "text/html", Cookie: cookies(jar), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _token: saved.csrf_token!, name: TOKEN_NAME, expires_at: TOKEN_EXPIRY }).toString(),
      approval: { action: "bookstack-create-private-api-token", once: true,
        progress: "Create one API token inheriting the saved BookStack administrator's permissions" },
      beforeSendCheckpoint: { expectedRevision: current.revision, stage: "token-create-attempted", data: current.data } });
    const location = created.headers.get("location") ?? "";
    const match = location.match(/^\/api-tokens\/([1-9][0-9]*)\/([1-9][0-9]*)\/$/);
    if (created.status !== 302 || !match || match[1] !== current.data.userId) {
      throw new Error("BookStack token creation output is uncertain; do not create another token");
    }
    addCookies(jar, created);
    await saveTokenSession(context, jar, saved.csrf_token!);
    current = (await context.checkpoint.read())!;
    current = await context.checkpoint.compareAndSet({ expectedRevision: current.revision,
      stage: "token-created", data: { ...current.data, recordId: match[2]! } });
  }
  if (current.stage === "token-created") {
    if (key !== null) throw new Error("BookStack has a saved token before secret-read provenance");
    const jar = await tokenSession(context);
    const response = await context.http.request({ method: "GET",
      path: `/api-tokens/${current.data.userId}/${current.data.recordId}/`,
      headers: { Accept: "text/html", Cookie: cookies(jar) },
      approval: { action: "bookstack-capture-private-api-token", once: true,
        progress: "Consume BookStack's once-returned API secret into its private handoff" },
      beforeSendCheckpoint: { expectedRevision: current.revision,
        stage: "token-secret-attempted", data: current.data } });
    if (response.status !== 200) throw new Error("BookStack token secret output was lost; do not recreate it");
    const html = await response.text();
    const publicId = inputValue(html, "token_id");
    const secrets = [...html.matchAll(/<input\s+type="text"\s+readonly="readonly"\s+value="([A-Za-z0-9]{32})">/g)];
    if (!/^[A-Za-z0-9]{32}$/.test(publicId) || secrets.length !== 1
      || inputValue(html, "name") !== TOKEN_NAME || inputValue(html, "expires_at") !== TOKEN_EXPIRY) {
      throw new Error("BookStack once-returned token does not match its pinned contract; do not recreate it");
    }
    key = `${publicId}:${secrets[0]![1]}`;
    // No further awaited operation before privately capturing the once-returned pair.
    await context.secrets.writeApiKey(key);
    current = (await context.checkpoint.read())!;
  }
  if (!["token-secret-attempted", "admin-and-api-token-verified"].includes(current.stage)
    || key === null || !/^[A-Za-z0-9]{32}:[A-Za-z0-9]{32}$/.test(key)) {
    throw new Error("BookStack token output is missing or creation is uncertain; do not replay it");
  }
  if (!current.attemptedActions.includes("bookstack-create-private-api-token")
    || !current.attemptedActions.includes("bookstack-capture-private-api-token")) {
    throw new Error("BookStack token lacks one-time mutation provenance");
  }
  const file = await context.secrets.apiKeyPath();
  if (!file || !isAbsolute(file) || (current.stage === "admin-and-api-token-verified"
    && (current.data.apiKeyFile !== file || current.data.keyDigest !== digest(key)))) {
    throw new Error("BookStack saved API key identity changed");
  }
  const owner = await context.http.request({ method: "GET", path: `/api/users/${current.data.userId}`,
    headers: { Accept: "application/json", Authorization: `Token ${key}` } });
  if (owner.status !== 200) throw new Error("BookStack saved token failed administrator API readback");
  const identity = await owner.json() as Record<string, unknown>;
  if (String(identity.id) !== current.data.userId || identity.email !== EMAIL) {
    throw new Error("BookStack token API readback differs from the saved administrator");
  }
  if (current.stage !== "admin-and-api-token-verified") {
    await context.checkpoint.compareAndSet({ expectedRevision: current.revision,
      stage: "admin-and-api-token-verified", data: { ...current.data, apiKeyFile: file, keyDigest: digest(key) } });
  }
  await context.secrets.writeSessionCookies({});
  return { ...verified(context, String(current.data.passwordFile)), stage: "admin-and-api-token-verified",
    apiKeyFile: file, apiKeyVerified: true, apiKeyOwnerId: current.data.userId,
    apiKeyScope: "inherits-saved-administrator-permissions", apiKeyExpiry: TOKEN_EXPIRY };
}

function verified(context: SetupContext, passwordFile: string): SetupRecord {
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: "admin-login-verified",
    email: EMAIL, credentialRef: passwordFile };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  healthSource: null,
  homarrIntegration: null,
  ready(status) {
    return status.appId === APP_ID && status.stage === "admin-and-api-token-verified"
      && status.email === EMAIL && typeof status.credentialRef === "string"
      && isAbsolute(status.credentialRef) && status.apiKeyVerified === true
      && typeof status.apiKeyFile === "string" && isAbsolute(status.apiKeyFile);
  },
  async firstRun(context) {
    if (context.appId !== APP_ID) throw new Error("BookStack setup received a different app ID");
    const status = appliedStatus(context, await context.status());
    if (status.ownerKind !== "shared" || status.username !== EMAIL
      || typeof status.privateFiles !== "string" || !isAbsolute(status.privateFiles)
      || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)
      || dirname(status.passwordFile) !== status.privateFiles) {
      throw new Error("BookStack has no exact saved email administrator handoff file");
    }
    let checkpoint = await context.checkpoint.read();
    if (checkpoint !== null && (checkpoint.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot
      || !["admin-attempted", "admin-login-verified", ...TOKEN_STAGES].includes(checkpoint.stage)
      || typeof checkpoint.data.placeholderDigest !== "string"
      || !/^[0-9a-f]{64}$/.test(checkpoint.data.placeholderDigest)
      || checkpoint.data.passwordFile !== status.passwordFile)) {
      throw new Error("BookStack has an unrecognized first-admin checkpoint");
    }
    if (checkpoint === null) {
      const placeholder = await context.secrets.readAdminPassword();
      if (placeholder.length < 32 || placeholder.length > 128 || !/^[A-Za-z0-9]+$/.test(placeholder)) {
        throw new Error("BookStack has no valid owner-only password placeholder");
      }
      const result = await context.container.exec({ effect: "write",
        argv: ["php", "/app/www/artisan", "bookstack:create-admin", "--initial",
          `--email=${EMAIL}`, "--name=Administrator", "--generate-password"],
        approval: { action: "bookstack-create-first-admin", once: true,
          progress: "Replace BookStack's seeded account with one private email administrator" },
        beforeSendCheckpoint: { expectedRevision: null, stage: "admin-attempted",
          data: { placeholderDigest: digest(placeholder), passwordFile: status.passwordFile } },
        captureAdminPassword: { format: "whole-stdout" } });
      if (result.exitCode !== 0) {
        throw new Error("BookStack did not create the first administrator; inspect the saved checkpoint before recovery");
      }
      checkpoint = await context.checkpoint.read();
    }
    if (!checkpoint || typeof checkpoint.data.placeholderDigest !== "string") {
      throw new Error("BookStack first-admin checkpoint is missing");
    }
    const password = await context.secrets.readAdminPassword();
    if (digest(password) === checkpoint.data.placeholderDigest) {
      throw new Error("BookStack's administrator password was not captured; do not replay the initial command");
    }
    if (password.length < 4 || password.length > 8192 || /[\r\n\u0000-\u001f\u007f]/.test(password)) {
      throw new Error("BookStack has no valid captured administrator password");
    }
    if (TOKEN_STAGES.includes(checkpoint.stage)) {
      if (!/^[1-9][0-9]*$/.test(String(checkpoint.data.userId))
        || checkpoint.data.label !== TOKEN_NAME || checkpoint.data.expiresAt !== TOKEN_EXPIRY
        || (["token-created", "token-secret-attempted", "admin-and-api-token-verified"].includes(checkpoint.stage)
          && !/^[1-9][0-9]*$/.test(String(checkpoint.data.recordId)))) {
        throw new Error("BookStack token checkpoint identity changed");
      }
      if (checkpoint.stage === "admin-and-api-token-verified"
        && !await login(context, EMAIL, password, "bookstack-verify-generated-admin")) {
        throw new Error("BookStack rejected its captured administrator password");
      }
      return apiToken(context, checkpoint);
    }
    if (!await login(context, EMAIL, password, "bookstack-verify-generated-admin", true)) {
      throw new Error("BookStack rejected its captured administrator password");
    }
    if (checkpoint.stage === "admin-attempted") {
      checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision,
        stage: "admin-login-verified", data: { placeholderDigest: checkpoint.data.placeholderDigest,
          passwordFile: status.passwordFile } });
    }
    return apiToken(context, checkpoint);
  },
};

export default adapter;
