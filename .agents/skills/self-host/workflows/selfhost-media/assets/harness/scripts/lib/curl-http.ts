import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

let cookieRoot = "";

function privateDirectory(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o7777) !== 0o700) {
    throw new Error("curl private directory is unsafe");
  }
}

function privateFile(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o7777) !== 0o600) {
    throw new Error("curl private file is unsafe");
  }
}

function configValue(value) {
  if (typeof value !== "string" || /[\r\n\0]/.test(value)) {
    throw new Error("curl option contains an unsafe value");
  }
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function requestUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || !url.port || url.username || url.password || url.hash) {
    throw new Error("curl transport accepts only explicit loopback HTTP ports");
  }
  for (const key of url.searchParams.keys()) {
    if (/(?:token|key|secret|auth|cookie|pass|code)/i.test(key)) {
      throw new Error("curl transport refuses credentials in URL query");
    }
  }
  return url;
}

function cookieJar(url) {
  const identity = createHash("sha256").update(url.origin).digest("hex").slice(0, 24);
  const path = join(cookieRoot, `${identity}.cookies`);
  try {
    privateFile(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    closeSync(descriptor);
    privateFile(path);
  }
  return path;
}

function responseHeaders(raw) {
  const blocks = raw.split(/\r?\n\r?\n/).filter((block) => /^HTTP\//i.test(block));
  const finalBlock = blocks.at(-1) ?? "";
  const values = new Map();
  for (const line of finalBlock.split(/\r?\n/).slice(1)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!values.has(name)) values.set(name, line.slice(colon + 1).trim());
  }
  return { get(name) { return values.get(String(name).toLowerCase()) ?? null; } };
}

export function enableCurlHttp(session) {
  privateDirectory(session.sessionDir);
  const artifacts = join(session.sessionDir, "artifacts");
  privateDirectory(artifacts);
  const root = join(artifacts, "http-cookies");
  try {
    mkdirSync(root, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  privateDirectory(root);
  process.umask(0o077);
  cookieRoot = root;
  return root;
}

export async function curlFetch(rawUrl, options = {}) {
  if (!cookieRoot) throw new Error("curl transport is not initialized");
  const url = requestUrl(rawUrl);
  const jar = cookieJar(url);
  const requestDirectory = mkdtempSync(join(cookieRoot, "request-"));
  privateDirectory(requestDirectory);
  const configPath = join(requestDirectory, "curl.conf");
  const requestPath = join(requestDirectory, "request.body");
  const responsePath = join(requestDirectory, "response.body");
  const headersPath = join(requestDirectory, "response.headers");
  try {
    const method = String(options.method ?? "GET").toUpperCase();
    if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD)$/.test(method)) throw new Error("unsupported curl method");
    const timeoutMs = options.timeoutMs ?? 5_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 180_000) {
      throw new Error("unsupported curl timeout");
    }
    const config = [`url = ${configValue(url.toString())}`, `request = ${configValue(method)}`];
    let explicitCookie = false;
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      if (!/^[A-Za-z0-9-]+$/.test(name)) throw new Error("unsafe curl header name");
      if (name.toLowerCase() === "cookie") explicitCookie = true;
      config.push(`header = ${configValue(`${name}: ${String(value)}`)}`);
    }
    if (options.body !== undefined && options.body !== null) {
      let body = options.body;
      if (body instanceof URLSearchParams) body = body.toString();
      if (typeof body !== "string" && !Buffer.isBuffer(body)) throw new Error("unsupported curl request body");
      writeFileSync(requestPath, body, { flag: "wx", mode: 0o600 });
      config.push(`data-binary = ${configValue(`@${requestPath}`)}`);
    }
    writeFileSync(configPath, `${config.join("\n")}\n`, { flag: "wx", mode: 0o600 });
    privateFile(configPath);
    const args = [
      "--disable",
      "--silent", "--show-error", "--max-time", String(Math.ceil(timeoutMs / 1000)), "--connect-timeout", "5",
      "--max-redirs", "0", "--proto", "=http", "--noproxy", "*",
      "--output", responsePath, "--dump-header", headersPath,
      "--write-out", "%{http_code}", "--cookie-jar", jar,
    ];
    if (!explicitCookie) args.push("--cookie", jar);
    args.push("--config", configPath);
    const result = spawnSync("curl", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs + 1_000,
      maxBuffer: 1024 * 1024,
    });
    privateFile(jar);
    if (result.error || result.status !== 0) throw new Error("curl request failed");
    const status = Number(result.stdout.trim());
    if (!Number.isInteger(status) || status < 100 || status > 599) throw new Error("curl returned an invalid HTTP status");
    privateFile(headersPath);
    privateFile(responsePath);
    if (statSync(responsePath).size > 16 * 1024 * 1024) throw new Error("curl response exceeds limit");
    const rawHeaders = readFileSync(headersPath, "utf8");
    const body = readFileSync(responsePath);
    const responseText = body.toString("utf8");
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: responseHeaders(rawHeaders),
      async json() { return JSON.parse(responseText); },
      async text() { return responseText; },
    };
  } finally {
    for (const path of [configPath, requestPath, responsePath, headersPath]) {
      try { unlinkSync(path); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    rmdirSync(requestDirectory);
  }
}
