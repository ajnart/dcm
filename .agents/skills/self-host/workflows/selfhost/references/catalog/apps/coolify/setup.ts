import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { appliedStatus, setupRecord, type SetupAdapter, type SetupContext,
  type SetupHttpResponse, type SetupCheckpoint, type SetupRecord } from "../../types/setup.ts";

const EMAIL = "admin@example.test";
const NAME = "Auto-Stack Root";
const TOKEN_NAME = "Auto-Stack private read";
const STAGES = ["register-attempted", "root-verified", "boarding-attempted", "api-enable-attempted", "token-attempted", "credentials-verified"];

// Pinned publisher bootstrap and model reads only. No user/token creation,
// seeding, host SSH or Docker commands are performed by this inspection.
const INVENTORY = "chdir('/var/www/html');require 'vendor/autoload.php';"
  + "$app=require 'bootstrap/app.php';$app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap();"
  + "$u=App\\Models\\User::find(0);$s=App\\Models\\InstanceSettings::find(0);"
  + "$p=stream_get_contents(STDIN);echo json_encode(['count'=>App\\Models\\User::count(),"
  + "'root'=>!!$u,'email'=>$u?->email,'name'=>$u?->name,'password'=>!!$u&&Illuminate\\Support\\Facades\\Hash::check($p,$u->password),"
  + "'owner'=>!!$u&&$u->teams()->where('teams.id',0)->wherePivot('role','owner')->exists(),"
  + "'tokenCount'=>$u?->tokens()->count(),"
  + "'registration'=>$s?->is_registration_enabled,'api'=>$s?->is_api_enabled,"
  + "'privateKeys'=>App\\Models\\PrivateKey::count(),'servers'=>App\\Models\\Server::count(),"
  + "'boarding'=>App\\Models\\Team::find(0)?->show_boarding,"
  + "'horizon'=>config('constants.horizon.is_horizon_enabled'),'scheduler'=>config('constants.horizon.is_scheduler_enabled'),"
  + "'version'=>config('constants.coolify.version')]);";

function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function decode(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
function csrf(html: string): string {
  const value = html.match(/name="(?:_token|csrf-token)"[^>]*(?:value|content)="([A-Za-z0-9]{20,256})"/)?.[1];
  if (!value) throw new Error("Coolify did not supply its pinned CSRF form");
  return value;
}
function component(html: string, name: string): string {
  for (const match of html.matchAll(/wire:snapshot="([^"]+)"/g)) {
    const value = decode(match[1]);
    const snapshot = setupRecord(JSON.parse(value), "Coolify Livewire snapshot");
    if (setupRecord(snapshot.memo, "Coolify Livewire memo").name === name) return value;
  }
  throw new Error("Coolify did not provide the pinned Livewire component");
}
function data(snapshot: string): SetupRecord {
  return setupRecord(setupRecord(JSON.parse(snapshot), "Coolify snapshot").data, "Coolify component data");
}
function cookieHeader(saved: Record<string, string>): string {
  const cookies = Object.entries(saved).filter(([name]) => name.startsWith("cookie_"));
  if (!cookies.length) throw new Error("Coolify has no saved private session");
  return cookies.map(([name, value]) => `${name.slice(7)}=${value}`).join("; ");
}
function addCookies(saved: Record<string, string>, response: SetupHttpResponse): void {
  for (const cookie of response.headers.getSetCookie?.() ?? []) {
    const pair = cookie.split(";", 1)[0];
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (separator < 1 || !/^[A-Za-z0-9_-]{1,64}$/.test(name)
      || value.length > 4096 || /[^\x21-\x7e]|[;,\\"]/.test(value)) {
      throw new Error("Coolify supplied an invalid private session cookie");
    }
    saved[`cookie_${name}`] = value;
  }
}
async function inventory(context: SetupContext, password: string): Promise<SetupRecord> {
  const result = await context.container.exec({ effect: "read", argv: ["php", "-r", INVENTORY], stdin: password,
    approval: { action: "coolify-inspect-root", progress: "Inspect only the owned Coolify root, worker policy and absence of host SSH keys" } });
  if (result.exitCode !== 0) throw new Error("Coolify root inventory is unavailable");
  const value = setupRecord(JSON.parse(result.stdout), "Coolify root inventory");
  if (value.version !== "4.3.23" || value.horizon !== false || value.scheduler !== false
    || value.privateKeys !== 0 || value.servers !== 1) {
    throw new Error("Coolify differs from disconnected administration-only preparation; inspect host authority");
  }
  return value;
}
function requireRoot(value: SetupRecord): void {
  if (value.count !== 1 || value.root !== true || value.email !== EMAIL || value.name !== NAME
    || value.password !== true || value.owner !== true || value.registration !== false) {
    throw new Error("Coolify does not have the exact saved sole root owner and closed registration");
  }
}
async function page(context: SetupContext, saved: Record<string, string>, path: string): Promise<string> {
  const response = await context.http.request({ method: "GET", path, headers: { Cookie: cookieHeader(saved), Accept: "text/html" } });
  if (response.status === 419 || (response.status === 302 && response.headers.get("location") === "/login")) {
    await context.secrets.writeSessionCookies({});
    throw new Error("Coolify private session expired; review a fresh login on the next run");
  }
  if (response.status !== 200) throw new Error("Coolify authenticated page is unavailable; preserve the private session");
  // Do not rotate saved cookies during a deferred write: its snapshot/CSRF and
  // cookie bytes must remain identical until exact approval has been applied.
  return response.text();
}
async function form(context: SetupContext, password: string, path: "/login" | "/register"): Promise<Record<string, string>> {
  const saved = await context.secrets.readSessionCookies();
  if (Object.keys(saved).length) {
    if (saved.password_digest !== digest(password) || !saved.csrf_token) throw new Error("Coolify private session differs from its owner password");
    return saved;
  }
  const response = await context.http.request({ method: "GET", path, headers: { Accept: "text/html" } });
  if (response.status !== 200) throw new Error("Coolify private account form is unavailable");
  const html = await response.text();
  if (path === "/register" && !html.includes("This first account becomes the root user.")) {
    throw new Error("Coolify registration is not its first-root form");
  }
  const next = { password_digest: digest(password), csrf_token: csrf(html), form_path: path };
  addCookies(next, response);
  cookieHeader(next);
  await context.secrets.writeSessionCookies(next);
  return next;
}
async function login(context: SetupContext, password: string): Promise<Record<string, string>> {
  let saved = await context.secrets.readSessionCookies();
  if (saved.authenticated === "yes") {
    if (saved.password_digest !== digest(password)) throw new Error("Coolify session password differs");
    return saved;
  }
  if (saved.form_path !== "/login") {
    await context.secrets.writeSessionCookies({});
    saved = await form(context, password, "/login");
  }
  const response = await context.http.request({ method: "POST", path: "/login",
    headers: { Cookie: cookieHeader(saved), Accept: "text/html", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _token: saved.csrf_token, email: EMAIL, password }).toString(),
    approval: { action: "coolify-verify-root-login", progress: "Authenticate the saved Coolify root without connecting a host" } });
  if (response.status === 419) {
    await context.secrets.writeSessionCookies({});
    throw new Error("Coolify login CSRF expired; review a new login");
  }
  if (response.status !== 302 || response.headers.get("location")?.endsWith("/login")) throw new Error("Coolify saved root login failed");
  addCookies(saved, response);
  delete saved.form_path;
  saved.authenticated = "yes";
  await context.secrets.writeSessionCookies(saved);
  return saved;
}
async function livewire(context: SetupContext, saved: Record<string, string>, path: string,
  name: string, method: string, updates: SetupRecord, action: string, stage: string,
  checkpoint: SetupCheckpoint): Promise<string> {
  if (saved.pending_action && saved.pending_action !== action) throw new Error("Coolify has another pending private Livewire intent");
  if (!saved.pending_snapshot) {
    const html = await page(context, saved, path);
    saved.pending_snapshot = Buffer.from(component(html, name)).toString("base64url");
    saved.pending_csrf = csrf(html);
    saved.pending_action = action;
    await context.secrets.writeSessionCookies(saved);
  }
  const snapshot = Buffer.from(saved.pending_snapshot, "base64url").toString();
  if (setupRecord(setupRecord(JSON.parse(snapshot), "Coolify pending snapshot").memo, "Coolify pending memo").name !== name) {
    throw new Error("Coolify pending component identity differs");
  }
  const response = await context.http.request({ method: "POST", path: "/livewire/update",
    headers: { Cookie: cookieHeader(saved), "Content-Type": "application/json", "X-Livewire": "" },
    body: JSON.stringify({ _token: saved.pending_csrf, components: [{ snapshot, updates, calls: [{ path: "", method, params: [] }] }] }),
    approval: { action, once: true, progress: "Apply one pinned Coolify account/API action without host provisioning" },
    beforeSendCheckpoint: { expectedRevision: checkpoint.revision, stage } });
  if (response.status !== 200) throw new Error("Coolify Livewire action outcome is uncertain; inspect without replaying");
  const result = setupRecord(await response.json(), "Coolify Livewire response");
  if (!Array.isArray(result.components) || result.components.length !== 1) throw new Error("Coolify Livewire action has an invalid response");
  const effect = setupRecord(setupRecord(result.components[0], "Coolify updated component").effects, "Coolify component effects");
  if (typeof effect.html !== "string") throw new Error("Coolify action did not return its pinned HTML readback");
  // Caller captures a once-returned API token before any subsequent I/O.
  return effect.html;
}
async function clearPending(context: SetupContext, saved: Record<string, string>): Promise<void> {
  delete saved.pending_action; delete saved.pending_snapshot; delete saved.pending_csrf;
  await context.secrets.writeSessionCookies(saved);
}
async function verifyApi(context: SetupContext, key: string): Promise<void> {
  if (!/^[0-9]+\|[A-Za-z0-9]{40,128}$/.test(key)) throw new Error("Coolify saved API key format differs");
  const headers = { Authorization: `Bearer ${key}` };
  const teamResponse = await context.http.request({ method: "GET", path: "/api/v1/team", headers,
    approval: { action: "coolify-verify-token-team", progress: "Verify the saved token's root team; Sanctum records its last-used metadata" } });
  if (teamResponse.status !== 200) throw new Error("Coolify saved API key cannot read its root team");
  const team = setupRecord(await teamResponse.json(), "Coolify API token team");
  const membersResponse = await context.http.request({ method: "GET", path: "/api/v1/team/members", headers,
    approval: { action: "coolify-verify-token-root", progress: "Verify the saved token's sole root member; Sanctum records its last-used metadata" } });
  if (membersResponse.status !== 200) throw new Error("Coolify root member readback failed");
  const members = await membersResponse.json();
  if (team.id !== 0 || !Array.isArray(members) || members.length !== 1
    || setupRecord(members[0], "Coolify root member").id !== 0
    || setupRecord(members[0], "Coolify root member").email !== EMAIL) throw new Error("Coolify API key belongs to a different team/owner");
}

const adapter: SetupAdapter = {
  appId: "coolify", sharedOwner: true, credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding", healthSource: null, homarrIntegration: null,
  ready() { return false; },
  async inspect(context) {
    const status = appliedStatus(context, await context.status());
    const checkpoint = await context.checkpoint.read();
    const key = await context.secrets.readApiKey();
    const file = await context.secrets.apiKeyPath();
    if (status.ownerKind !== "shared" || status.username !== EMAIL
      || typeof status.privateFiles !== "string" || !isAbsolute(status.privateFiles)
      || status.passwordFile !== join(status.privateFiles, "admin-password")
      || !checkpoint || checkpoint.appId !== "coolify" || checkpoint.projectRoot !== context.projectRoot
      || checkpoint.stage !== "credentials-verified" || checkpoint.data.email !== EMAIL
      || key === null || file !== join(status.privateFiles, "coolify-api-key")
      || checkpoint.data.apiKeyFile !== file || checkpoint.data.apiKeyDigest !== digest(key)) {
      throw new Error("Coolify has no exact verified shared-owner key");
    }
    // Sanctum authentication updates last_used_at. Read-only inspection cannot
    // exercise a token; retain saved evidence without presenting it as fresh.
    return { appId: "coolify", projectRoot: context.projectRoot, stage: "host-authority-required",
      credentialPreparationSaved: true, apiKeyFile: file, apiKeyVerified: false,
      adminLoginVerified: false, hostAuthorityVerified: false, functionalAcceptance: false };
  },
  async firstRun(context) {
    const status = appliedStatus(context, await context.status());
    if (context.appId !== "coolify" || status.ownerKind !== "shared" || status.username !== EMAIL
      || typeof status.privateFiles !== "string" || !isAbsolute(status.privateFiles)
      || status.passwordFile !== join(status.privateFiles, "admin-password")) throw new Error("Coolify requires the exact shared owner credential");
    const password = await context.secrets.readAdminPassword();
    if (!/^base64:[A-Za-z0-9+/]{64}$/.test(password) || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      throw new Error("Coolify saved password does not satisfy production character classes; never regenerate a saved owner on resume");
    }
    let checkpoint = await context.checkpoint.read();
    if (checkpoint && (checkpoint.appId !== context.appId || checkpoint.projectRoot !== context.projectRoot
      || !STAGES.includes(checkpoint.stage))) throw new Error("Coolify checkpoint differs");
    let observed = await inventory(context, password);
    if (!checkpoint) {
      if (observed.count !== 0 || observed.root !== false || observed.registration !== true) throw new Error("Coolify is not an empty first-owner instance");
      const saved = await form(context, password, "/register");
      const response = await context.http.request({ method: "POST", path: "/register",
        headers: { Cookie: cookieHeader(saved), "Content-Type": "application/x-www-form-urlencoded", Accept: "text/html" },
        body: new URLSearchParams({ _token: saved.csrf_token, name: NAME, email: EMAIL, password, password_confirmation: password }).toString(),
        approval: { action: "coolify-create-first-root", once: true, progress: "Create the actual first Coolify root and close registration" },
        beforeSendCheckpoint: { expectedRevision: null, stage: "register-attempted" } });
      if (response.status !== 302 || !response.headers.get("location")?.endsWith("/settings")) throw new Error("Coolify root registration outcome is uncertain; do not replay");
      observed = await inventory(context, password);
      checkpoint = await context.checkpoint.read();
    }
    requireRoot(observed);
    if (!checkpoint) throw new Error("Coolify root attempt has no checkpoint");
    if (checkpoint.stage === "register-attempted") checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision, stage: "root-verified" });
    const saved = await login(context, password);
    if (observed.boarding === true) {
      if (checkpoint.stage === "boarding-attempted") throw new Error("Coolify onboarding skip is uncertain; do not replay");
      await livewire(context, saved, "/onboarding", "boarding.index", "skipBoarding", {}, "coolify-skip-host-onboarding", "boarding-attempted", checkpoint);
      await clearPending(context, saved);
      observed = await inventory(context, password);
      if (observed.boarding !== false) throw new Error("Coolify host onboarding was not skipped");
      checkpoint = await context.checkpoint.read();
    } else if (saved.pending_action === "coolify-skip-host-onboarding") await clearPending(context, saved);
    if (!checkpoint) throw new Error("Coolify has no root checkpoint");
    const profile = data(component(await page(context, saved, "/profile"), "profile.index"));
    if (profile.userId !== 0 || profile.email !== EMAIL || profile.name !== NAME) throw new Error("Coolify HTTP login identified a different root");
    if (observed.api !== true) {
      if (checkpoint.stage === "api-enable-attempted") throw new Error("Coolify API enablement is uncertain; do not replay");
      await livewire(context, saved, "/settings/advanced", "settings.advanced", "instantSave", { is_api_enabled: true }, "coolify-enable-private-api", "api-enable-attempted", checkpoint);
      await clearPending(context, saved);
      observed = await inventory(context, password);
      if (observed.api !== true) throw new Error("Coolify API enablement did not persist");
      checkpoint = await context.checkpoint.read();
    } else if (saved.pending_action === "coolify-enable-private-api") await clearPending(context, saved);
    if (!checkpoint) throw new Error("Coolify has no API checkpoint");
    let key = await context.secrets.readApiKey();
    if (key === null) {
      if (checkpoint.stage === "token-attempted" || checkpoint.stage === "credentials-verified") throw new Error("Coolify once-returned token is missing; inspect without recreating it");
      observed = await inventory(context, password);
      if (observed.tokenCount !== 0) throw new Error("Coolify already has token state outside this saved one-time setup; no token was created");
      const html = await livewire(context, saved, "/security/api-tokens", "security.api-tokens", "addNewToken",
        { description: TOKEN_NAME, expiresInDays: null, permissions: ["read"] }, "coolify-create-read-token", "token-attempted", checkpoint);
      const matches = [...html.matchAll(/<input\b[^>]*value="([0-9]+\|[A-Za-z0-9]{40,128})"/g)];
      if (matches.length !== 1) throw new Error("Coolify did not return exactly one once-visible token; inspect without replaying");
      key = decode(matches[0][1]);
      await context.secrets.writeApiKey(key);
      await clearPending(context, saved);
      checkpoint = await context.checkpoint.read();
    }
    await verifyApi(context, key);
    const file = await context.secrets.apiKeyPath();
    if (file !== join(status.privateFiles, "coolify-api-key") || !checkpoint) throw new Error("Coolify API key has no exact private file/checkpoint");
    if (checkpoint.stage === "credentials-verified" && (checkpoint.data.apiKeyDigest !== digest(key) || checkpoint.data.apiKeyFile !== file)) throw new Error("Coolify saved key differs from its verified checkpoint");
    if (checkpoint.stage !== "credentials-verified") await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision, stage: "credentials-verified", data: { email: EMAIL, apiKeyFile: file, apiKeyDigest: digest(key) } });
    return { appId: "coolify", projectRoot: context.projectRoot, stage: "host-authority-required", adminEmail: EMAIL,
      credentialRef: status.passwordFile, apiKeyFile: file, adminLoginVerified: true, apiKeyVerified: true,
      credentialPreparationSaved: true, registrationClosed: true, workersEnabled: false,
      hostAuthorityVerified: false, functionalAcceptance: false };
  }
};
export default adapter;
