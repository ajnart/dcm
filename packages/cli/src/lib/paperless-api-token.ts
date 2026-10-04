import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { link, lstat, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { verifyPaperlessAdmin } from "./paperless-admin-api.ts";

type Input = {
  action: "paperless-token-plan" | "paperless-token-create" | "paperless-token-status";
  approval: string | null;
  origin: string;
  username: string;
  passwordFile: string;
  tokenFile: string;
  projectId: string;
  recipeSha256: string;
};

const tokenPattern = /^[0-9a-f]{40}$/;

function fail(message: string): never { throw new Error(message); }

async function privateFile(path: string): Promise<string | null> {
  let metadata;
  try { metadata = await lstat(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || metadata.uid !== process.getuid?.() || (metadata.mode & 0o777) !== 0o600
    || metadata.size < 1 || metadata.size > 4096 || await realpath(path) !== path) {
    fail("Paperless credential file must be an owner-only regular mode-0600 file");
  }
  return await readFile(path, "utf8");
}

async function storedToken(path: string): Promise<string | null> {
  const token = await privateFile(path);
  if (token !== null && !tokenPattern.test(token)) fail("Saved Paperless API token is invalid; inspect privately");
  return token;
}

async function responseJson(url: string, method: "GET" | "POST", headers: Record<string, string>,
  body?: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method, headers, body, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
  } catch {
    fail("Paperless API did not respond; no credential or response body was printed");
  }
  if (response.status !== 200) fail(`Paperless API returned HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length > 128 * 1024) fail("Paperless API response is too large");
  const text = await response.text();
  if (text.length > 128 * 1024) fail("Paperless API response is too large");
  try { return JSON.parse(text); }
  catch { fail("Paperless API returned invalid JSON"); }
}

async function verifyToken(origin: string, token: string,
  account: { userId: number; username: string }): Promise<void> {
  // v3.2.1 /api/profile/ omits identity; /api/ui_settings/ derives user from request.user.
  const identity = await responseJson(`${origin}/api/ui_settings/`, "GET",
    { Authorization: `Token ${token}`, Accept: "application/json" });
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
    fail("Paperless token identity response is invalid");
  }
  const user = (identity as Record<string, unknown>).user;
  if (!user || typeof user !== "object" || Array.isArray(user)) {
    fail("Paperless token identity response is invalid");
  }
  const authenticated = user as Record<string, unknown>;
  if (authenticated.id !== account.userId || authenticated.username !== account.username
    || authenticated.is_superuser !== true) {
    fail("Paperless API token does not belong to the exact managed administrator");
  }
  const value = await responseJson(`${origin}/api/statistics/`, "GET",
    { Authorization: `Token ${token}`, Accept: "application/json" });
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Paperless statistics response is invalid");
  const stats = value as Record<string, unknown>;
  if (!Number.isSafeInteger(stats.documents_total) || Number(stats.documents_total) < 0
    || (stats.documents_inbox !== null
      && (!Number.isSafeInteger(stats.documents_inbox) || Number(stats.documents_inbox) < 0))) {
    fail("Paperless statistics response is invalid");
  }
}

async function saveToken(path: string, token: string): Promise<boolean> {
  const parent = dirname(path);
  const metadata = await lstat(parent);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.()
    || (metadata.mode & 0o077) !== 0 || await realpath(parent) !== parent) {
    fail("Paperless secrets directory is not owner-only");
  }
  const temporary = join(parent, `.paperless-api-token-${randomUUID()}`);
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    try {
      await handle.writeFile(token);
      await handle.sync();
    } finally { await handle.close(); }
    try {
      await link(temporary, path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await storedToken(path) !== token) fail("An existing Paperless token file differs; inspect privately");
      return false;
    }
  } finally {
    await unlink(temporary);
  }
}

function approval(input: Input, userId: number, password: string, existingToken: string | null): string {
  const digest = createHash("sha256").update(JSON.stringify({
    action: "paperless-token-create", projectId: input.projectId, recipeSha256: input.recipeSha256,
    origin: input.origin, username: input.username, userId, passwordFile: input.passwordFile,
    tokenFile: input.tokenFile,
    passwordFingerprint: createHash("sha256").update("paperless-admin-password\0").update(password).digest("hex"),
    tokenFingerprint: existingToken === null ? null
      : createHash("sha256").update("paperless-api-token\0").update(existingToken).digest("hex"),
  })).digest("hex");
  return `PAPERLESS-TOKEN:paperless-ngx:${digest}`;
}

export async function paperlessApiTokenCommand(input: Input): Promise<Record<string, unknown>> {
  const password = await privateFile(input.passwordFile);
  if (password === null) fail("Managed Paperless admin password file is unavailable");
  let account: { userId: number; username: string };
  try { account = await verifyPaperlessAdmin(input.origin, input.username, password); }
  catch { fail("Managed Paperless administrator could not be verified"); }
  const existingToken = await storedToken(input.tokenFile);
  if (input.action === "paperless-token-status") {
    if (existingToken === null) return { status: "token-not-created", mutation: false,
      apiKeyFile: null, adminVerified: true, apiVerified: false };
    await verifyToken(input.origin, existingToken, account);
    return { status: "token-verified", mutation: false, apiKeyFile: input.tokenFile,
      adminVerified: true, apiVerified: true };
  }
  const exactApproval = approval(input, account.userId, password, existingToken);
  if (input.action === "paperless-token-plan") {
    if (existingToken !== null) await verifyToken(input.origin, existingToken, account);
    return { status: "pass", mutation: false, alreadyPresent: existingToken !== null,
      apiKeyFile: existingToken === null ? null : input.tokenFile, adminVerified: true,
      apiVerified: existingToken !== null, approval: exactApproval,
      approvals: { paperlessTokenCreate: exactApproval },
      effect: "Acquire the existing or first Paperless API token for the exact managed administrator; never rotate it." };
  }
  if (input.approval !== exactApproval) fail("Paperless token approval no longer matches the exact project, account, and private files; re-plan");
  if (existingToken !== null) {
    await verifyToken(input.origin, existingToken, account);
    return { status: "token-already-current", mutation: false, apiKeyFile: input.tokenFile,
      adminVerified: true, apiVerified: true, tokenPrinted: false, homarrAttached: false };
  }
  const payload = await responseJson(`${input.origin}/api/token/`, "POST",
    { Accept: "application/json", "Content-Type": "application/json" },
    JSON.stringify({ username: input.username, password }));
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || !tokenPattern.test((payload as Record<string, unknown>).token as string)) {
    fail("Paperless token endpoint returned an invalid token; no file was changed");
  }
  const token = (payload as { token: string }).token;
  await verifyToken(input.origin, token, account);
  const created = await saveToken(input.tokenFile, token);
  if (await storedToken(input.tokenFile) !== token) fail("Paperless token file read-back differs; inspect privately");
  return { status: created ? "token-created-and-verified" : "token-already-current",
    mutation: created, apiKeyFile: input.tokenFile, adminVerified: true, apiVerified: true,
    tokenPrinted: false, homarrAttached: false };
}
