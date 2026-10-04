import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, type Stats } from "node:fs";
import { fileURLToPath } from "node:url";

type BaseProfile = { version: 1; appId: string; source: string };
type SuffixProfile = BaseProfile & {
  format: "one-line-suffix";
  message: string;
  caseInsensitive: true;
  passwordFormat: "non-whitespace";
};
type BlockProfile = BaseProfile & {
  format: "exact-block";
  markerStart: string;
  freshMarker: string;
  beforePassword: readonly string[];
  afterPassword: readonly string[];
  passwordPrefix: string;
  passwordSuffix: string;
  resetContains: string;
  passwordFormat: "lowercase-hex-32";
};
type StalwartProfile = BaseProfile & { format: "stalwart-bootstrap"; passwordFormat: "alphanumeric-16" };
export type BootstrapPasswordProfile = SuffixProfile | BlockProfile | StalwartProfile;

function invalid(): never {
  throw new Error("Catalog bootstrap-password profile is invalid");
}

function marker(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 160
    && value.trim().length > 0 && !/[^\x20-\x7e]/.test(value);
}

function markers(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 8
    && value.every(marker);
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mode === right.mode && left.nlink === right.nlink
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

/** Strict data-only formats: profiles cannot supply a regular expression or executable code. */
export function decodeBootstrapPasswordProfile(value: unknown, appId: string): BootstrapPasswordProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const data = value as Record<string, unknown>;
  if (data.version !== 1 || data.appId !== appId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appId)
    || appId.length > 47 || typeof data.source !== "string" || data.source.length > 512
    || !/^https:\/\/(?:github\.com\/[^/]+\/[^/]+\/blob\/|raw\.githubusercontent\.com\/[^/]+\/[^/]+\/)(?:[a-f0-9]{40}|(?:v|release-)?\d+\.\d+\.\d+)\/[a-zA-Z0-9._/-]+$/.test(data.source)) invalid();
  const common = ["version", "appId", "source", "format", "passwordFormat"];
  if (data.format === "stalwart-bootstrap") {
    if (Object.keys(data).some((key) => !common.includes(key)) || appId !== "stalwart-mail"
      || data.passwordFormat !== "alphanumeric-16"
      || data.source !== "https://github.com/stalwartlabs/stalwart/blob/v0.16.24/crates/store/src/build/registry.rs") invalid();
    return Object.freeze({ version: 1, appId, source: data.source, format: data.format,
      passwordFormat: data.passwordFormat });
  }
  if (data.format === "one-line-suffix") {
    const allowed = [...common, "message", "caseInsensitive"];
    if (Object.keys(data).some((key) => !allowed.includes(key)) || !marker(data.message)
      || !data.message.endsWith(" ") || data.caseInsensitive !== true
      || data.passwordFormat !== "non-whitespace") invalid();
    return Object.freeze({ version: 1, appId, source: data.source, format: data.format,
      message: data.message, caseInsensitive: true, passwordFormat: data.passwordFormat });
  }
  if (data.format === "exact-block") {
    const allowed = [...common, "markerStart", "freshMarker", "beforePassword", "afterPassword", "passwordPrefix",
      "passwordSuffix", "resetContains"];
    if (Object.keys(data).some((key) => !allowed.includes(key)) || !marker(data.markerStart)
      || !markers(data.beforePassword) || !marker(data.freshMarker)
      || !markers(data.afterPassword) || !marker(data.passwordPrefix)
      || !marker(data.passwordSuffix) || !marker(data.resetContains)
      || data.passwordFormat !== "lowercase-hex-32"
      || !data.passwordPrefix.startsWith(data.markerStart)
      || [...data.beforePassword, ...data.afterPassword].some((line) => !line.startsWith(data.markerStart))
      || data.beforePassword.filter((line) => line === data.freshMarker).length !== 1) invalid();
    return Object.freeze({ version: 1, appId, source: data.source, format: data.format,
      markerStart: data.markerStart, freshMarker: data.freshMarker, beforePassword: Object.freeze([...data.beforePassword]),
      afterPassword: Object.freeze([...data.afterPassword]), passwordPrefix: data.passwordPrefix,
      passwordSuffix: data.passwordSuffix, resetContains: data.resetContains,
      passwordFormat: data.passwordFormat });
  }
  return invalid();
}

/** Only trusted catalog roots are searched; callers cannot provide a path or capture pattern. */
export function bootstrapPasswordProfile(appId: string): BootstrapPasswordProfile | null {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appId) || appId.length > 47) return null;
  let root = new URL("./workflows/selfhost/references/catalog/apps/", import.meta.url);
  if (new URL(import.meta.url).pathname.endsWith(".ts")) {
    root = new URL("../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/", import.meta.url);
  }
  const path = fileURLToPath(new URL(`${appId}/bootstrap-password.json`, root));
  try { lstatSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("Catalog bootstrap-password profile could not be read");
  }
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
      let data: unknown;
      try { data = JSON.parse(buffer.subarray(0, length).toString("utf8")); } catch { invalid(); }
      const profile = decodeBootstrapPasswordProfile(data, appId);
      const after = fstatSync(descriptor);
      if (!sameFile(before, after) || realpathSync(path) !== path) invalid();
      const current = openSync(path, flags);
      try { if (!sameFile(after, fstatSync(current))) invalid(); }
      finally { closeSync(current); }
      return profile;
    } finally { closeSync(descriptor); }
  }
  catch (error) {
    throw new Error("Catalog bootstrap-password profile could not be read");
  }
}

/** Input lines have already passed the transport's current-start timestamp and identity checks. */
export function parseBootstrapPassword(profile: BootstrapPasswordProfile, lines: readonly string[],
  registerSecret: (value: string) => void): string {
  if (profile.format === "stalwart-bootstrap") {
    const headers = lines.filter((line) => line === "🔑 Stalwart bootstrap mode - temporary administrator account");
    const usernames = lines.filter((line) => line === "   username: admin");
    const passwords = lines.filter((line) => line.startsWith("   password: "))
      .map((line) => line.slice("   password: ".length));
    for (const password of passwords) registerSecret(password);
    if (headers.length !== 1 || usernames.length !== 1 || passwords.length !== 1
      || !/^[A-Za-z0-9]{16}$/.test(passwords[0]!)) {
      throw new Error("A unique current-start Stalwart bootstrap administrator was not found");
    }
    const at = lines.indexOf(headers[0]!);
    if (lines[at + 2] !== usernames[0] || lines[at + 3] !== `   password: ${passwords[0]}`) {
      throw new Error("The Stalwart bootstrap administrator block is incomplete");
    }
    return passwords[0]!;
  }
  if (profile.format === "one-line-suffix") {
    const passwords: string[] = [];
    let invalidPassword = false;
    for (const line of lines) {
      const index = line.toLowerCase().lastIndexOf(profile.message.toLowerCase());
      if (index < 0) continue;
      const capture = /^(\S+)$/.exec(line.slice(index + profile.message.length));
      if (!capture) continue;
      const password = capture[1]!;
      // Register every captured candidate before reporting ambiguity or invalid format.
      registerSecret(password);
      if (password.length < 4 || password.length > 8192 || /[\r\n\0]/.test(password)) invalidPassword = true;
      passwords.push(password);
    }
    if (invalidPassword) throw new Error("Current-start temporary password has an invalid format");
    if (passwords.length !== 1) throw new Error("A unique current-start temporary password was not found");
    return passwords[0]!;
  }
  const captured: string[] = [];
  const passwordAt = (line: string): string | null => {
    if (!line.startsWith(profile.passwordPrefix) || !line.endsWith(profile.passwordSuffix)) return null;
    const password = line.slice(profile.passwordPrefix.length, -profile.passwordSuffix.length);
    if (!/^[a-f0-9]{32}$/.test(password)) return null;
    return password;
  };
  for (const line of lines) {
    // Preserve the original line-capture dot/end semantics, including a terminal CR.
    const tail = /.*$/.exec(line)?.[0] ?? "";
    const index = tail.indexOf(profile.markerStart);
    if (index < 0) continue;
    const text = tail.slice(index);
    const password = passwordAt(text);
    if (password) registerSecret(password);
    captured.push(text);
  }
  if (captured.some((line) => line.includes(profile.resetContains))) {
    throw new Error("Bootstrap logs report password reset, not a fresh owner");
  }
  const starts = captured.map((line, index) => ({ line, index })).filter((entry) => entry.line === profile.freshMarker);
  const passwords = captured.filter((line) => line.startsWith(profile.passwordPrefix.trimEnd()));
  const start = (starts[0]?.index ?? -1) - profile.beforePassword.indexOf(profile.freshMarker);
  const passwordIndex = start + profile.beforePassword.length;
  const password = passwordAt(captured[passwordIndex] ?? "");
  if (starts.length !== 1 || passwords.length !== 1 || !password
    || profile.beforePassword.some((line, offset) => captured[start + offset] !== line)
    || profile.afterPassword.some((line, offset) => captured[passwordIndex + 1 + offset] !== line)) {
    throw new Error("A unique complete current-start first-owner password block was not found");
  }
  return password;
}
