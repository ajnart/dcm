import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, type Stats } from "node:fs";
import { fileURLToPath } from "node:url";

type ArgumentRule = "any" | "positive-id" | "positive-id-hours-24"
  | "username-password" | "username-password-object" | "none";
export type SocketIoIntentProfile = {
  version: 1;
  appId: string;
  source: string;
  events: readonly { event: string; action: string; arguments: ArgumentRule }[];
};

function invalid(): never { throw new Error("Catalog Socket.IO intent profile is invalid"); }

export function decodeSocketIoIntentProfile(value: unknown, appId: string): SocketIoIntentProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const data = value as Record<string, unknown>;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appId) || appId.length > 47
    || data.version !== 1 || data.appId !== appId
    || Object.keys(data).some((key) => !["version", "appId", "source", "events"].includes(key))
    || typeof data.source !== "string" || data.source.length > 512
    || !/^https:\/\/(?:github\.com\/[^/]+\/[^/]+\/blob\/|raw\.githubusercontent\.com\/[^/]+\/[^/]+\/)(?:[a-f0-9]{40}|(?:v|release-)?\d+\.\d+\.\d+)\/[a-zA-Z0-9._/-]+$/.test(data.source)
    || !Array.isArray(data.events) || data.events.length < 1 || data.events.length > 16) invalid();
  const seen = new Set<string>();
  const events = data.events.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
    const entry = value as Record<string, unknown>;
    if (Object.keys(entry).length !== 3
      || Object.keys(entry).some((key) => !["event", "action", "arguments"].includes(key))
      || typeof entry.event !== "string" || !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(entry.event)
      || seen.has(entry.event) || typeof entry.action !== "string" || entry.action.length > 96
      || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(entry.action)
      || !["any", "positive-id", "positive-id-hours-24", "username-password",
        "username-password-object", "none"].includes(entry.arguments as string)) invalid();
    seen.add(entry.event);
    return Object.freeze({ event: entry.event, action: entry.action, arguments: entry.arguments as ArgumentRule });
  });
  return Object.freeze({ version: 1, appId, source: data.source, events: Object.freeze(events) });
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mode === right.mode && left.nlink === right.nlink
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

const loaded = new Map<string, string | null>();

/** App-owned data only, from the same source/package catalog roots as bootstrap profiles. */
function readProfile(appId: string): { profile: SocketIoIntentProfile; sha256: string } | null {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appId) || appId.length > 47) return null;
  let root = new URL("./workflows/selfhost/references/catalog/apps/", import.meta.url);
  if (new URL(import.meta.url).pathname.endsWith(".ts")) {
    root = new URL("../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/", import.meta.url);
  }
  const path = fileURLToPath(new URL(`${appId}/socketio-intents.json`, root));
  let result: { profile: SocketIoIntentProfile; sha256: string } | null = null;
  let exists = true;
  try { lstatSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") invalid();
    exists = false;
  }
  if (exists) {
    try {
      if (realpathSync(path) !== path) invalid();
      const flags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
      const descriptor = openSync(path, flags);
      try {
        const before = fstatSync(descriptor);
        if (!before.isFile() || before.nlink !== 1 || before.size < 1
          || before.size > 4096 || (before.mode & 0o002) !== 0) invalid();
        const buffer = Buffer.alloc(4097);
        let length = 0;
        while (length < buffer.length) {
          const count = readSync(descriptor, buffer, length, buffer.length - length, null);
          if (count === 0) break;
          length += count;
        }
        if (length !== before.size) invalid();
        const bytes = buffer.subarray(0, length);
        const profile = decodeSocketIoIntentProfile(JSON.parse(bytes.toString("utf8")), appId);
        const after = fstatSync(descriptor);
        if (!sameFile(before, after) || realpathSync(path) !== path) invalid();
        const current = openSync(path, flags);
        try { if (!sameFile(after, fstatSync(current))) invalid(); }
        finally { closeSync(current); }
        result = { profile, sha256: createHash("sha256").update(bytes).digest("hex") };
      } finally { closeSync(descriptor); }
    } catch { throw new Error("Catalog Socket.IO intent profile could not be read"); }
  }
  const hash = result?.sha256 ?? null;
  if (loaded.has(appId) && loaded.get(appId) !== hash) {
    throw new Error("Socket.IO intent profile changed while the CLI was running; restart it and review again");
  }
  loaded.set(appId, hash);
  return result;
}

export function socketIoIntentProfile(appId: string): SocketIoIntentProfile | null {
  return readProfile(appId)?.profile ?? null;
}

export function socketIoIntentProfileSha256(appId: string): string | null {
  return readProfile(appId)?.sha256 ?? null;
}

function validCredentials(username: unknown, password: unknown): boolean {
  return typeof username === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(username)
    && typeof password === "string" && Buffer.byteLength(password, "utf8") >= 8
    && Buffer.byteLength(password, "utf8") <= 72 && !/[\r\n\u0000]/.test(password);
}

/** Returns the complete application intent only for the exact reviewed event and argument rule. */
export function socketIoApprovalEvent(profile: SocketIoIntentProfile, frame: string, action: string | undefined): unknown[] | null {
  const match = /^42\d+(\[.*\])$/s.exec(frame);
  if (!match) return null;
  let event: unknown;
  try { event = JSON.parse(match[1]!); } catch { return null; }
  if (!Array.isArray(event)) return null;
  const entry = profile.events.find((entry) => entry.event === event[0] && entry.action === action);
  if (!entry) return null;
  if (entry.arguments === "none" && event.length !== 1) return null;
  if (entry.arguments === "username-password"
    && (event.length !== 3 || !validCredentials(event[1], event[2]))) return null;
  if (entry.arguments === "username-password-object") {
    const credentials = event[1];
    if (event.length !== 2 || !credentials || typeof credentials !== "object" || Array.isArray(credentials)
      || Object.keys(credentials).sort().join(",") !== "password,username"
      || !validCredentials(credentials.username, credentials.password)) return null;
  }
  if (entry.arguments === "positive-id" || entry.arguments === "positive-id-hours-24") {
    if (!Number.isSafeInteger(event[1]) || event[1] < 1) return null;
    if (entry.arguments === "positive-id" && event.length !== 2) return null;
    if (entry.arguments === "positive-id-hours-24" && (event.length !== 3 || event[2] !== 24)) return null;
  }
  return event;
}
