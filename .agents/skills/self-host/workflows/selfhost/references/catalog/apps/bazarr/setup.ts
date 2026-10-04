import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import {
  appliedStatus,
  setupRecord,
  type SetupAdapter,
  type SetupCheckpoint,
  type SetupContext,
  type SetupInspectionContext,
} from "../../types/setup";

const APP_ID = "bazarr";
const ACTION = "bazarr-enable-basic-auth";
// v1.6.0 app/config.py owns /config/config/config.yaml. The publisher's
// v1.6.0-ls363 service starts Python with /app/bazarr/bin and --config /config.
// Read only auth, not provider/Arr credentials or a guessed frontend injection.
const READ_AUTH = [
  "import os,sys,json,stat",
  "sys.path.insert(0,'/app/bazarr/bin/libs')",
  "import yaml",
  "p='/config/config/config.yaml'",
  "assert not os.path.islink('/config/config')",
  "f=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)",
  "s=os.fstat(f)",
  "assert stat.S_ISREG(s.st_mode) and s.st_nlink==1 and 0<s.st_size<=1048576",
  "raw=os.read(f,1048577)",
  "os.close(f)",
  "node=yaml.compose(raw)",
  "assert isinstance(node,yaml.MappingNode)",
  "pairs=[v for k,v in node.value if k.value.lower()=='auth']",
  "assert len(pairs)==1 and isinstance(pairs[0],yaml.MappingNode)",
  "names=[k.value for k,v in pairs[0].value]",
  "assert len(names)==len(set(names)) and set(names)=={'apikey','type','username','password'}",
  "auth=yaml.safe_load(raw)['auth']",
  "print(json.dumps(auth))",
].join(";");
type ReadContext = Pick<SetupInspectionContext, "projectRoot" | "http" | "secrets" | "checkpoint">;

function validKey(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
}

function checkedCheckpoint(context: ReadContext, value: SetupCheckpoint | null,
  key: string, password: string): SetupCheckpoint | null {
  if (value === null) return null;
  const data = setupRecord(value.data, "Bazarr checkpoint data");
  if (value.schemaVersion !== 1 || value.appId !== APP_ID
    || value.projectRoot !== context.projectRoot || value.stage !== "basic-auth-attempted"
    || !Number.isSafeInteger(value.revision) || value.revision < 1
    || value.attemptedActions.length !== 1 || value.attemptedActions[0] !== ACTION
    || data.keyHash !== createHash("sha256").update(key).digest("hex")
    || (data.loginDigest !== undefined
      && data.loginDigest !== createHash("sha256").update(password).digest("hex"))) {
    throw new Error("Bazarr setup checkpoint does not match this app and saved API key");
  }
  return value;
}

async function settings(context: ReadContext, key: string) {
  const response = await context.http.request({ method: "GET", path: "/api/system/settings",
    headers: { "X-API-KEY": key } });
  if (response.status !== 200 || !response.ok) throw new Error("Bazarr settings readback failed");
  const result = setupRecord(await response.json(), "Bazarr settings");
  const auth = setupRecord(result.auth, "Bazarr authentication settings");
  if (auth.apikey !== key) throw new Error("Bazarr settings API key differs from the owned saved key");
  return auth;
}

async function verify(context: ReadContext, key: string, password: string) {
  const auth = await settings(context, key);
  const hash = createHash("md5").update(password).digest("hex");
  if (auth.type !== "basic" || auth.username !== "admin" || auth.password !== hash
    || auth.apikey !== key) {
    throw new Error("Bazarr Basic authentication does not match saved credentials");
  }
  const anonymous = await context.http.request({ method: "GET", path: "/" });
  if (anonymous.status !== 401) throw new Error("Bazarr still permits anonymous UI access");
  const authorization = `Basic ${Buffer.from(`admin:${password}`, "utf8").toString("base64")}`;
  const login = await context.http.request({ method: "GET", path: "/",
    headers: { Authorization: authorization } });
  if (login.status !== 200 || !login.ok) throw new Error("Bazarr saved Basic login failed");
  const apiKeyFile = await context.secrets.apiKeyPath();
  if (!apiKeyFile) throw new Error("Bazarr API key handoff path is missing");
  return { appId: APP_ID, projectRoot: context.projectRoot,
    stage: "basic-auth-and-api-key-verified", adminUsername: "admin", apiKeyFile };
}

async function savedKey(context: ReadContext): Promise<string | null> {
  const key = await context.secrets.readApiKey();
  if (key === null) return null;
  if (!validKey(key)) throw new Error("Bazarr saved API key is invalid");
  return key;
}

async function ownedAuth(context: SetupContext) {
  const result = await context.container.exec({ effect: "read",
    argv: ["python3", "-I", "-c", READ_AUTH],
    approval: { action: "bazarr-read-owned-auth", progress: "Privately read Bazarr authentication from its exact owned configuration." } });
  if (result.exitCode !== 0 || result.stdout.length > 2048) {
    throw new Error("Bazarr owned authentication extraction failed");
  }
  let value: unknown;
  try { value = JSON.parse(result.stdout); }
  catch { throw new Error("Bazarr owned authentication extraction returned invalid JSON"); }
  const auth = setupRecord(value, "Bazarr owned authentication");
  if (Object.keys(auth).sort().join(",") !== "apikey,password,type,username"
    || !validKey(auth.apikey) || typeof auth.username !== "string" || typeof auth.password !== "string"
    || (auth.type !== null && auth.type !== "basic" && auth.type !== "form")) {
    throw new Error("Bazarr owned authentication is ambiguous");
  }
  return auth;
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  sharedOwner: true,
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  healthSource: "Basic-authenticated GET / and API-key GET /api/system/settings",
  homarrIntegration: "Bazarr",
  ready(record) {
    return record.appId === APP_ID && record.stage === "basic-auth-and-api-key-verified"
      && record.adminUsername === "admin" && typeof record.apiKeyFile === "string";
  },
  async inspect(context) {
    if (context.appId !== APP_ID) throw new Error("Bazarr inspection received a different app ID");
    const status = setupRecord(await context.status(), "Bazarr app status");
    const runtime = setupRecord(status.runtime, "Bazarr runtime status");
    if (status.command !== "app status" || status.appId !== APP_ID
      || status.projectRoot !== context.projectRoot || status.status !== "applied"
      || status.mutation !== false || runtime.state !== "running") {
      throw new Error("Bazarr is not a running, exact saved app project");
    }
    const key = await savedKey(context);
    const password = await context.secrets.readAdminPassword();
    if (!key || !checkedCheckpoint(context, await context.checkpoint.read(), key, password)) {
      throw new Error("Bazarr has no saved first-run ownership proof");
    }
    return verify(context, key, password);
  },
  async firstRun(context: SetupContext) {
    if (context.appId !== APP_ID) throw new Error("Bazarr setup received a different app ID");
    appliedStatus(context, await context.status());
    const password = await context.secrets.readAdminPassword();
    if (!password || password.length > 1024 || /[\r\n\u0000]/.test(password)) {
      throw new Error("Bazarr saved administrator password is invalid");
    }
    let key = await savedKey(context);
    const checkpoint = await context.checkpoint.read();
    const owned = await ownedAuth(context);
    if (key !== null && owned.apikey !== key) {
      throw new Error("Bazarr owned API key differs from its saved key; refuse implicit adoption or rotation");
    }
    if (checkpoint !== null) {
      if (!key) throw new Error("Bazarr attempted setup has no saved API key; inspect before retrying");
      checkedCheckpoint(context, checkpoint, key, password);
      if (owned.type !== "basic" || owned.username !== "admin"
        || owned.password !== createHash("md5").update(password).digest("hex")) {
        throw new Error("Bazarr attempted authentication is not confirmed in owned config; inspect before retrying");
      }
      return verify(context, key, password);
    }
    if (owned.type !== null || owned.username !== "" || owned.password !== "") {
      throw new Error("Bazarr is already configured outside this project");
    }
    if (!key) {
      key = owned.apikey as string;
      const path = await context.secrets.writeApiKey(key);
      if (!path || await savedKey(context) !== key) {
        throw new Error("Bazarr generated API key was not saved privately");
      }
    }
    const auth = await settings(context, key);
    if (auth.type !== null || auth.username !== "" || auth.password !== "") {
      throw new Error("Bazarr has configured authentication without a setup checkpoint");
    }
    const response = await context.http.request({ method: "POST", path: "/api/system/settings",
      headers: { "X-API-KEY": key, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ "settings-auth-type": "basic",
        "settings-auth-username": "admin", "settings-auth-password": password }).toString(),
      approval: { action: ACTION, progress: "Enable Bazarr Basic authentication", once: true },
      beforeSendCheckpoint: { expectedRevision: null, stage: "basic-auth-attempted",
        data: { keyHash: createHash("sha256").update(key).digest("hex"),
          loginDigest: createHash("sha256").update(password).digest("hex") } },
    });
    if (response.status !== 204) throw new Error("Bazarr authentication update was not confirmed; inspect before retrying");
    return verify(context, key, password);
  },
};

export default adapter;
