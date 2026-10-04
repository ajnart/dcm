import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { isAbsolute } from "node:path";

import {
  type SetupAdapter,
  type SetupContext,
  type SetupInspectionContext,
  type SetupRecord,
} from "../../types/setup";

const APP_ID = "nextcloud";
const SERVER_VERSION = "35.0.1";
const PROBE_PREFIX = ".selfhost-webdav-";
type ReadContext = Pick<SetupInspectionContext, "appId" | "projectRoot" | "status" | "http" | "secrets" | "checkpoint">;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

async function readJson(context: ReadContext, path: string,
  headers?: Record<string, string>): Promise<Record<string, unknown>> {
  let response;
  try {
    response = await context.http.request({ method: "GET", path, headers });
  } catch {
    throw new Error(`Nextcloud ${path} could not be read from its saved private origin`);
  }
  if (response.status !== 200) {
    throw new Error(`Nextcloud ${path} did not return HTTP 200`);
  }
  try {
    return object(await response.json(), `Nextcloud ${path} response`);
  } catch {
    throw new Error(`Nextcloud ${path} returned invalid JSON`);
  }
}

async function verifyAdmin(context: ReadContext): Promise<{ status: Record<string, unknown>; authorization: string }> {
  if (context.appId !== APP_ID) throw new Error("Nextcloud setup received a different app ID");
  const status = object(await context.status(), "Nextcloud app status");
  const runtime = object(status.runtime, "Nextcloud runtime");
  if (status.command !== "app status" || status.appId !== APP_ID
    || status.projectRoot !== context.projectRoot || status.status !== "applied"
    || status.mutation !== false || runtime.state !== "running"
    || status.username !== "admin" || typeof status.passwordFile !== "string"
    || !isAbsolute(status.passwordFile) || typeof status.url !== "string") {
    throw new Error("Nextcloud has no running, exact saved administrator project");
  }
  const server = await readJson(context, "/status.php");
  if (server.installed !== true || server.maintenance !== false
    || server.needsDbUpgrade !== false || server.versionstring !== SERVER_VERSION) {
    throw new Error("Nextcloud is not an installed, current, ready server at the pinned version");
  }
  const password = await context.secrets.readAdminPassword();
  if (password.length < 1 || password.length > 1024 || /[\r\n\u0000]/.test(password)) {
    throw new Error("Nextcloud has no valid saved administrator credential");
  }
  const authorization = `Basic ${Buffer.from(`admin:${password}`, "utf8").toString("base64")}`;
  const capabilities = await readJson(context, "/ocs/v1.php/cloud/capabilities", {
    Authorization: authorization,
    "OCS-APIRequest": "true",
    Accept: "application/json",
  });
  const ocs = object(capabilities.ocs, "Nextcloud OCS envelope");
  const meta = object(ocs.meta, "Nextcloud OCS metadata");
  const data = object(ocs.data, "Nextcloud OCS data");
  const version = object(data.version, "Nextcloud OCS version");
  if (meta.statuscode !== 100 || version.string !== SERVER_VERSION) {
    throw new Error("Nextcloud OCS version verification failed");
  }
  const listing = await readJson(context, "/ocs/v1.php/cloud/users", {
    Authorization: authorization,
    "OCS-APIRequest": "true",
    Accept: "application/json",
  });
  const usersOcs = object(listing.ocs, "Nextcloud user-list envelope");
  const usersMeta = object(usersOcs.meta, "Nextcloud user-list metadata");
  const usersData = object(usersOcs.data, "Nextcloud user-list data");
  if (usersMeta.statuscode !== 100 || !Array.isArray(usersData.users)
    || !usersData.users.includes("admin")) {
    throw new Error("Nextcloud saved administrator credential did not pass the protected OCS user-list check");
  }
  return { status, authorization };
}

function probeName(checkpoint: Awaited<ReturnType<ReadContext["checkpoint"]["read"]>>): string {
  const name = checkpoint?.data.probeName;
  if (typeof name !== "string" || !/^\.selfhost-webdav-[0-9a-f]{32}\.txt$/.test(name)) {
    throw new Error("Nextcloud has no exact saved WebDAV probe name");
  }
  return name;
}

async function readProbe(context: ReadContext, authorization: string, name: string): Promise<void> {
  let response;
  try {
    response = await context.http.request({ method: "GET",
      path: `/remote.php/dav/files/admin/${name}`, headers: { Authorization: authorization } });
  } catch {
    throw new Error("Nextcloud WebDAV probe read failed; inspect the exact saved file before retrying");
  }
  if (response.status !== 200 || await response.text() !== `selfhost-nextcloud-webdav:${name}\n`) {
    throw new Error("Nextcloud WebDAV probe did not match the saved file; no write was retried");
  }
}

function record(context: ReadContext, status: Record<string, unknown>, name: string): SetupRecord {
  return { appId: APP_ID, projectRoot: context.projectRoot,
    stage: "webdav-probe-verified", credentialRef: status.passwordFile,
    url: status.url, version: SERVER_VERSION, probePath: `/remote.php/dav/files/admin/${name}` };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  credentialCommand: "app handoff",
  apiKey: "not-created",
  healthSource: "https://github.com/nextcloud/server/blob/v35.0.1/status.php",
  homarrIntegration: "nextcloud",
  ready(record) {
    return record.appId === APP_ID && record.stage === "webdav-probe-verified"
      && typeof record.credentialRef === "string" && isAbsolute(record.credentialRef)
      && record.version === SERVER_VERSION
      && typeof record.probePath === "string"
      && /^\/remote\.php\/dav\/files\/admin\/\.selfhost-webdav-[0-9a-f]{32}\.txt$/.test(record.probePath);
  },
  async firstRun(context: SetupContext) {
    const { status, authorization } = await verifyAdmin(context);
    let checkpoint = await context.checkpoint.read();
    if (checkpoint === null) {
      const name = `${PROBE_PREFIX}${randomBytes(16).toString("hex")}.txt`;
      checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: null,
        stage: "webdav-probe-planned", data: { probeName: name } });
    }
    if (checkpoint.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot) {
      throw new Error("Nextcloud WebDAV probe checkpoint belongs to another project");
    }
    const name = probeName(checkpoint);
    if (checkpoint.stage === "webdav-probe-planned") {
      const response = await context.http.request({ method: "PUT",
        path: `/remote.php/dav/files/admin/${name}`,
        headers: { Authorization: authorization, "Content-Type": "text/plain", "If-None-Match": "*" },
        body: `selfhost-nextcloud-webdav:${name}\n`,
        approval: { action: "nextcloud-webdav-probe", once: true,
          progress: "Create one hidden Nextcloud WebDAV probe file; keep it for a separate restart check" },
        beforeSendCheckpoint: { expectedRevision: checkpoint.revision,
          stage: "webdav-put-attempted", data: { probeName: name } } });
      if (response.status !== 201) {
        throw new Error("Nextcloud did not confirm creation of the WebDAV probe; inspect before retrying");
      }
      checkpoint = await context.checkpoint.read();
    }
    if (checkpoint?.stage !== "webdav-put-attempted" && checkpoint?.stage !== "webdav-probe-verified") {
      throw new Error("Nextcloud has an unrecognized WebDAV probe checkpoint");
    }
    await readProbe(context, authorization, name);
    if (checkpoint.stage === "webdav-put-attempted") {
      checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision,
        stage: "webdav-probe-verified", data: { probeName: name } });
    }
    return record(context, status, name);
  },
  async inspect(context: SetupInspectionContext) {
    const { status, authorization } = await verifyAdmin(context);
    const checkpoint = await context.checkpoint.read();
    if (checkpoint?.stage !== "webdav-probe-verified"
      || checkpoint.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot) {
      throw new Error("Nextcloud has no verified WebDAV probe checkpoint");
    }
    const name = probeName(checkpoint);
    await readProbe(context, authorization, name);
    return record(context, status, name);
  },
};

export default adapter;
