import { randomBytes } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { appliedStatus, type SetupAdapter, type SetupContext, type SetupRecord } from "../../types/setup";

const APP_ID = "freshrss";
const USER = "admin";
const ROOT = "/var/www/FreshRSS";
const API_STAGES = ["api-password-prepared", "api-enable-attempted", "api-enabled", "api-password-attempted", "api-password-verified"];
const API_INVENTORY = `
$s=include '${ROOT}/data/config.php'; $u=include '${ROOT}/data/users/${USER}/config.php';
$p=stream_get_contents(STDIN); $h=$u['apiPasswordHash']??''; $f=$u['feverKey']??'';
$expected=md5('${USER}:'.$p); $file='${ROOT}/data/fever/.key-'.sha1($s['salt']).'-'.$expected.'.txt';
echo json_encode(['enabled'=>($s['api_enabled']??false)===true,
 'empty'=>$h==='' && $f==='', 'match'=>is_string($h) && $h!=='' && password_verify($p,$h)
 && hash_equals($expected,$f) && is_file($file) && file_get_contents($file)==='${USER}']);
`.replace(/\s*\n\s*/g, " ").trim();
const SET_API_PASSWORD = `require '${ROOT}/cli/_cli.php'; cliInitUser('${USER}');
if (FreshRSS_api_Controller::updatePassword(stream_get_contents(STDIN)) !== false) exit(1);`;

// FreshRSS 1.30.0: cli/do-install.php, cli/create-user.php, cli/reconfigure-user.php,
// app/Utils/passwordUtil.php, app/Controllers/authController.php.
// The first-user CLI has no password-stdin option. Its empty password leaves
// passwordHash empty; reconfigure-user accepts a bcrypt hash on private stdin.
const INVENTORY = `
$d='${ROOT}/data'; $u=$d.'/users/${USER}';
$m=is_file($d.'/applied_migrations.txt'); $c=is_file($d.'/config.php');
$h=is_dir($u); $uc=is_file($u.'/config.php');
$others=[]; foreach (is_dir($d.'/users') ? (scandir($d.'/users') ?: []) : [] as $n) {
  if ($n!=='.' && $n!=='..' && $n!=='_' && is_dir($d.'/users/'.$n)) $others[]=$n;
}
$system=$c ? include $d.'/config.php' : [];
$user=$uc ? include $u.'/config.php' : [];
$hash=is_array($user) ? ($user['passwordHash']??'') : null;
$password=stream_get_contents(STDIN);
echo json_encode(['marker'=>$m,'config'=>$c,'home'=>$h,'userConfig'=>$uc,
  'users'=>$others,'defaultUser'=>is_array($system)?($system['default_user']??null):null,
  'authType'=>is_array($system)?($system['auth_type']??null):null,
  'hashState'=>!is_string($hash)?'invalid':($hash===''?'empty':(password_verify($password,$hash)?'match':'mismatch'))]);
`.replace(/\s*\n\s*/g, " ").trim();

// Read the plaintext only from the private container stdin. The hash crosses
// only an in-container pipe, and neither the hash nor password reaches argv.
const SET_HASH = `h=$(php -r 'echo password_hash(stream_get_contents(STDIN), PASSWORD_BCRYPT, ["cost"=>9]);') && [ \${#h} -eq 60 ] && printf %s "$h" | php ${ROOT}/cli/reconfigure-user.php --user ${USER} --key passwordHash --set --value-stdin`;

type Inventory = {
  marker: boolean; config: boolean; home: boolean; userConfig: boolean;
  users: string[]; defaultUser: string | null; authType: string | null;
  hashState: "empty" | "match" | "mismatch" | "invalid";
};

async function inventory(context: SetupContext, password: string): Promise<Inventory> {
  const result = await context.container.exec({
    effect: "read", argv: ["php", "-r", INVENTORY], stdin: password,
    approval: { action: "freshrss-inspect-install", progress: "Inspect the exact FreshRSS install and verify any saved administrator hash without revealing it" },
  });
  if (result.exitCode !== 0) throw new Error("FreshRSS private install inventory failed");
  let value: unknown;
  try { value = JSON.parse(result.stdout); } catch { throw new Error("FreshRSS install inventory was invalid"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("FreshRSS install inventory was invalid");
  const row = value as Record<string, unknown>;
  if (!["marker", "config", "home", "userConfig"].every((key) => typeof row[key] === "boolean")
    || !Array.isArray(row.users) || row.users.some((user) => typeof user !== "string")
    || !["empty", "match", "mismatch", "invalid"].includes(String(row.hashState))) {
    throw new Error("FreshRSS install inventory was invalid");
  }
  return row as Inventory;
}

async function userDatabase(context: SetupContext): Promise<void> {
  const result = await context.container.exec({
    effect: "read", argv: ["php", `${ROOT}/cli/user-info.php`, "--user", USER, "--json"],
    approval: { action: "freshrss-inspect-user", progress: "Verify the FreshRSS administrator configuration and initialized user database" },
  });
  if (result.exitCode !== 0) throw new Error("FreshRSS administrator database is incomplete");
  let value: unknown;
  try { value = JSON.parse(result.stdout); } catch { throw new Error("FreshRSS administrator database readback was invalid"); }
  if (!Array.isArray(value) || value.length !== 1 || !value[0] || typeof value[0] !== "object") {
    throw new Error("FreshRSS administrator database readback was invalid");
  }
  const row = value[0] as Record<string, unknown>;
  if (row.user !== USER || row.default !== true || row.enabled !== true) {
    throw new Error("FreshRSS administrator database readback did not match the default enabled user");
  }
}

async function apiInventory(context: SetupContext, password: string) {
  const result = await context.container.exec({ effect: "read", argv: ["php", "-r", API_INVENTORY], stdin: password,
    approval: { action: "freshrss-inspect-api-password", progress: "Privately verify the independent API password hash and derived Fever key" } });
  if (result.exitCode !== 0) throw new Error("FreshRSS API credential inventory failed");
  const value = JSON.parse(result.stdout) as Record<string, unknown>;
  if (!value || ["enabled", "empty", "match"].some((key) => typeof value[key] !== "boolean")) {
    throw new Error("FreshRSS API credential inventory was invalid");
  }
  return value as { enabled: boolean; empty: boolean; match: boolean };
}

async function apiCredential(context: SetupContext, passwordFile: string, privateFiles: string): Promise<SetupRecord> {
  const expectedPath = join(privateFiles, "freshrss-api-key");
  let saved = await context.checkpoint.read();
  let key = await context.secrets.readApiKey();
  let path = await context.secrets.apiKeyPath();
  if (saved?.stage === "admin-password-hash-verified") {
    if (key !== null || path !== null) throw new Error("FreshRSS has an API credential without owned provenance");
    if (!(await apiInventory(context, "")).empty) throw new Error("FreshRSS has a foreign API password; no credential was changed");
    saved = await context.checkpoint.compareAndSet({ expectedRevision: saved.revision, stage: "api-password-prepared",
      data: { passwordFile, apiKeyFile: expectedPath, apiCredentialKind: "api-password", adminUsername: USER } });
    // Persist the generated durable password before any later await or remote write.
    key = randomBytes(32).toString("hex");
    path = await context.secrets.writeApiKey(key);
  }
  if (!saved || !API_STAGES.includes(saved.stage) || saved.data.passwordFile !== passwordFile
    || saved.data.apiKeyFile !== expectedPath || saved.data.apiCredentialKind !== "api-password"
    || saved.data.adminUsername !== USER || path !== expectedPath || typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key)) {
    throw new Error("FreshRSS owned API password is missing or inconsistent; never generate a replacement automatically");
  }
  let state = await apiInventory(context, key);
  if (!state.empty && !state.match) throw new Error("FreshRSS has a foreign or partial API password; no credential was changed");
  if (state.match && (!["api-password-attempted", "api-password-verified"].includes(saved.stage)
    || !saved.attemptedActions.includes("freshrss-set-api-password"))) {
    throw new Error("FreshRSS API password has no owned write provenance");
  }
  if (!state.enabled) {
    if (saved.stage !== "api-password-prepared") throw new Error("FreshRSS API enablement is incomplete; do not replay an uncertain write");
    const enabled = await context.container.exec({ effect: "write",
      argv: ["php", `${ROOT}/cli/reconfigure.php`, "--api-enabled", "true"],
      approval: { action: "freshrss-enable-api", progress: "Enable private FreshRSS mobile API access once", once: true },
      beforeSendCheckpoint: { expectedRevision: saved.revision, stage: "api-enable-attempted", data: saved.data } });
    if (enabled.exitCode !== 0) throw new Error("FreshRSS API enablement is uncertain; inspect before recovery");
    saved = await context.checkpoint.read();
    state = await apiInventory(context, key);
    if (!saved || !state.enabled) throw new Error("FreshRSS API enablement did not persist");
  }
  if (["api-password-prepared", "api-enable-attempted"].includes(saved.stage)) {
    saved = await context.checkpoint.compareAndSet({ expectedRevision: saved.revision, stage: "api-enabled", data: saved.data });
  }
  if (state.empty) {
    if (saved.stage !== "api-enabled") throw new Error("FreshRSS API password write is incomplete; do not replay it");
    const configured = await context.container.exec({ effect: "write", argv: ["php", "-r", SET_API_PASSWORD], stdin: key,
      approval: { action: "freshrss-set-api-password", progress: "Set one independent durable FreshRSS API password and Fever key through private stdin", once: true },
      beforeSendCheckpoint: { expectedRevision: saved.revision, stage: "api-password-attempted", data: saved.data } });
    if (configured.exitCode !== 0) throw new Error("FreshRSS API password write is uncertain; inspect before recovery");
    saved = await context.checkpoint.read();
    state = await apiInventory(context, key);
  }
  if (!saved || !state.match || !state.enabled) throw new Error("FreshRSS independent API password did not verify");
  const login = await context.http.request({ method: "POST", path: "/api/greader.php/accounts/ClientLogin",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ Email: USER, Passwd: key }).toString(),
    approval: { action: "freshrss-api-login", progress: "Authenticate the saved independent FreshRSS API password" } });
  if (login.status !== 200) throw new Error("FreshRSS API password login failed");
  const auth = /^Auth=(admin\/[a-f0-9]{40})\r?$/m.exec(await login.text())?.[1];
  if (!auth) throw new Error("FreshRSS temporary API authentication response was invalid");
  // Use GReader Auth only for this verification; export the API password, never Auth.
  const info = await context.http.request({ method: "GET", path: "/api/greader.php/reader/api/0/user-info",
    headers: { Authorization: `GoogleLogin auth=${auth}` } });
  if (info.status !== 200) throw new Error("FreshRSS API identity readback failed");
  const user = await info.json() as Record<string, unknown>;
  if (!user || user.userId !== USER || user.userName !== USER || user.userProfileId !== USER) {
    throw new Error("FreshRSS API identity did not match the owned administrator");
  }
  if (saved.stage !== "api-password-verified") await context.checkpoint.compareAndSet({ expectedRevision: saved.revision,
    stage: "api-password-verified", data: saved.data });
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: "api-password-verified",
    adminUsername: USER, credentialRef: passwordFile, apiKeyFile: expectedPath, apiKeyRef: expectedPath,
    apiCredentialKind: "api-password", apiKeyScope: "saved-administrator-mobile-api", apiKeyExpires: null,
    apiKeyVerified: true };
}

const adapter: SetupAdapter = {
  appId: APP_ID, sharedOwner: true, credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding", healthSource: null, homarrIntegration: null,
  ready(value) {
    return value.appId === APP_ID && value.stage === "api-password-verified" && value.apiCredentialKind === "api-password"
      && value.apiKeyVerified === true && typeof value.apiKeyFile === "string" && isAbsolute(value.apiKeyFile)
      && value.adminUsername === USER && typeof value.credentialRef === "string"
      && isAbsolute(value.credentialRef);
  },
  async firstRun(context) {
    if (context.appId !== APP_ID) throw new Error("FreshRSS setup received a different app ID");
    const status = appliedStatus(context, await context.status());
    if (status.ownerKind !== "shared" || status.username !== USER
      || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)
      || typeof status.privateFiles !== "string" || !isAbsolute(status.privateFiles)
      || status.passwordFile !== join(status.privateFiles, "admin-password")) {
      throw new Error("FreshRSS has no exact saved private administrator credential");
    }
    const password = await context.secrets.readAdminPassword();
    if (!/^[A-Za-z0-9]{7,72}$/.test(password)) throw new Error("FreshRSS saved administrator password is invalid");
    let checkpoint = await context.checkpoint.read();
    if (checkpoint && (checkpoint.schemaVersion !== 1 || checkpoint.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot
      || !Number.isSafeInteger(checkpoint.revision) || checkpoint.revision < 1
      || !Array.isArray(checkpoint.attemptedActions)
      || !["install-attempted", "user-attempted", "hash-attempted", "admin-password-hash-verified", ...API_STAGES].includes(checkpoint.stage))) {
      throw new Error("FreshRSS has an unrecognized first-run checkpoint");
    }
    let state = await inventory(context, password);
    if (state.users.some((user) => user !== USER) || state.home !== state.userConfig
      || (state.home && !state.users.includes(USER))) {
      throw new Error("FreshRSS has an ambiguous or foreign user directory; first-run is blocked");
    }
    if (!state.marker || !state.config) {
      if (state.marker || state.config || state.home || state.users.length > 0 || checkpoint !== null) {
        throw new Error("FreshRSS installation is partial or previously attempted; do not replay installation");
      }
      const installed = await context.container.exec({
        effect: "write", argv: ["php", `${ROOT}/cli/do-install.php`, "--default-user", USER,
          "--auth-type", "form", "--db-type", "sqlite"],
        approval: { action: "freshrss-install", progress: "Install one private SQLite FreshRSS instance with form authentication", once: true },
        beforeSendCheckpoint: { expectedRevision: null, stage: "install-attempted" },
      });
      if (installed.exitCode !== 0) throw new Error("FreshRSS installation did not complete; inspect before recovery");
      checkpoint = await context.checkpoint.read();
      state = await inventory(context, password);
    }
    if (!state.marker || !state.config || state.defaultUser !== USER || state.authType !== "form") {
      throw new Error("FreshRSS installed authentication configuration does not match the reviewed private administrator");
    }
    if (!state.home) {
      if (checkpoint?.stage !== "install-attempted") {
        throw new Error("FreshRSS has no provably owned first-user creation route");
      }
      const created = await context.container.exec({
        effect: "write", argv: ["php", `${ROOT}/cli/create-user.php`, "--user", USER, "--no-default-feeds"],
        approval: { action: "freshrss-create-admin", progress: "Create the first FreshRSS administrator without placing a password in argv", once: true },
        beforeSendCheckpoint: { expectedRevision: checkpoint.revision, stage: "user-attempted" },
      });
      if (created.exitCode !== 0) throw new Error("FreshRSS first-user creation did not complete; inspect before recovery");
      checkpoint = await context.checkpoint.read();
      state = await inventory(context, password);
    }
    if (!state.home || !state.userConfig || !checkpoint
      || !["user-attempted", "hash-attempted", "admin-password-hash-verified", ...API_STAGES].includes(checkpoint.stage)) {
      throw new Error("FreshRSS administrator creation is partial or not owned by this first run");
    }
    await userDatabase(context);
    if (state.hashState === "empty") {
      if (checkpoint.stage !== "user-attempted") {
        throw new Error("FreshRSS password setup was attempted but did not persist; do not replay it");
      }
      const configured = await context.container.exec({
        effect: "write", argv: ["sh", "-c", SET_HASH], stdin: password,
        approval: { action: "freshrss-set-admin-hash", progress: "Set the first FreshRSS password hash through private stdin once", once: true },
        beforeSendCheckpoint: { expectedRevision: checkpoint.revision, stage: "hash-attempted" },
      });
      if (configured.exitCode !== 0) throw new Error("FreshRSS password setup did not complete; inspect before recovery");
      checkpoint = await context.checkpoint.read();
      state = await inventory(context, password);
    }
    if (state.hashState !== "match") {
      throw new Error("FreshRSS saved administrator password did not match the installed hash; no password was changed");
    }
    if (checkpoint?.stage !== "admin-password-hash-verified" && !API_STAGES.includes(checkpoint?.stage ?? "")) {
      await context.checkpoint.compareAndSet({ expectedRevision: checkpoint?.revision ?? null,
        stage: "admin-password-hash-verified" });
    }
    return apiCredential(context, status.passwordFile, status.privateFiles);
  },
};

export default adapter;
