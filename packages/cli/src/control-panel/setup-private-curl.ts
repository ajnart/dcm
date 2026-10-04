import { spawn } from "node:child_process";
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readSharedHttpsTargetCa, type SharedHttpsTarget } from "../lib/shared-https-target.ts";
import type { SetupHttpMethod } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

export type PrivateCurlResponse = {
  status: number;
  bytes: Buffer;
  headers: Record<string, string | string[] | undefined>;
};

function fail(): never { throw new Error("Private HTTPS setup request failed; payload withheld; inspect its saved checkpoint before retrying"); }
function quote(value: string): string {
  if (/[\r\n\0]/.test(value)) fail();
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** Caller owns approval/checkpoint/redaction. Wire payloads stay in owner-only temporary files. */
export async function privateCurlResponse(target: SharedHttpsTarget, method: SetupHttpMethod,
  path: string, headers: Record<string, string>, body: Buffer | undefined,
  privateFiles: string, timeoutMs: number, revalidate: () => Promise<void>): Promise<PrivateCurlResponse> {
  if (!/^(GET|HEAD|POST|PUT|PATCH|DELETE)$/.test(method)
    || !path.startsWith("/") || path.startsWith("//") || /[\r\n\0\\#]/.test(path)
    || path.length > 2048 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 180000
    || (body && body.length > 256 * 1024)) fail();
  const url = new URL(path, target.origin);
  if (url.origin !== target.origin || url.username || url.password || url.hash) fail();
  const metadata = await lstat(privateFiles);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.()
    || (metadata.mode & 0o7777) !== 0o700 || await realpath(privateFiles) !== privateFiles) fail();
  await revalidate();
  const ca = await readSharedHttpsTargetCa(target);
  const directory = await mkdtemp(join(privateFiles, ".https-request-"));
  const responsePath = join(directory, "response.body");
  const headersPath = join(directory, "response.headers");
  const configPath = join(directory, "request.conf");
  const caPath = join(directory, "root.crt");
  try {
    const config = [`url = ${quote(url.toString())}`, `request = ${quote(method)}`];
    if (Object.keys(headers).length > 17) fail();
    for (const [name, value] of Object.entries(headers)) {
      const lower = name.toLowerCase();
      if (!/^[A-Za-z0-9-]+$/.test(name) || typeof value !== "string" || value.length > 8192
        || ["host", "connection", "transfer-encoding", "content-length", "upgrade", "proxy-authorization",
          "proxy-connection", "expect", "te", "trailer", "keep-alive", "x-http-method-override",
          "x-method-override", "x-original-method", "x-original-url", "x-rewrite-url"].includes(lower)
        || lower.startsWith("x-forwarded-")) fail();
      config.push(`header = ${quote(`${name}: ${value}`)}`);
    }
    if (body) {
      const bodyPath = join(directory, "request.body");
      await writeFile(bodyPath, body, { flag: "wx", mode: 0o600 });
      config.push(`data-binary = ${quote(`@${bodyPath}`)}`);
    }
    await writeFile(configPath, config.join("\n") + "\n", { flag: "wx", mode: 0o600 });
    // Snapshot the hash-checked public root so replacement during curl cannot change request trust.
    await writeFile(caPath, ca, { flag: "wx", mode: 0o600 });
    for (const file of [responsePath, headersPath]) await writeFile(file, "", { flag: "wx", mode: 0o600 });
    const args = ["--disable", "--silent", "--show-error", "--cacert", caPath, "--capath", directory,
      "--resolve", `${target.hostname}:${target.port}:${target.resolveAddress}`, "--noproxy", "*",
      "--proto", "=https", "--proto-redir", "=https", "--max-redirs", "0",
      "--max-time", String(Math.ceil(timeoutMs / 1000)), "--connect-timeout", "5",
      "--max-filesize", String(1024 * 1024), "--output", responsePath,
      "--dump-header", headersPath, "--write-out", "%{http_code}", "--config", configPath];
    if (method === "HEAD") args.push("--head");
    await revalidate();
    const status = await new Promise<number>((resolve, reject) => {
      const child = spawn("curl", args, { stdio: ["ignore", "pipe", "ignore"] });
      let output = "";
      const deadline = setTimeout(() => child.kill("SIGKILL"), timeoutMs + 1000);
      child.stdout.on("data", (bytes) => {
        output += bytes.toString();
        if (output.length > 16) child.kill("SIGKILL");
      });
      child.on("error", () => { clearTimeout(deadline); reject(new Error("Private HTTPS setup request failed; payload withheld")); });
      child.on("close", (code) => {
        clearTimeout(deadline);
        if (code !== 0 || !/^[1-5][0-9]{2}$/.test(output.trim())) {
          reject(new Error("Private HTTPS setup request failed; payload withheld; inspect its saved checkpoint before retrying"));
          return;
        }
        resolve(Number(output.trim()));
      });
    });
    if ((await lstat(responsePath)).size > 1024 * 1024 || (await lstat(headersPath)).size > 64 * 1024) fail();
    const bytes = await readFile(responsePath);
    const rawHeaders = await readFile(headersPath, "utf8");
    const blocks = rawHeaders.split(/\r?\n\r?\n/).filter((block) => /^HTTP\//.test(block));
    const responseHeaders: PrivateCurlResponse["headers"] = Object.create(null);
    for (const line of (blocks.at(-1) ?? "").split(/\r?\n/).slice(1)) {
      const colon = line.indexOf(":");
      if (colon <= 0) continue;
      const name = line.slice(0, colon).toLowerCase();
      const value = line.slice(colon + 1).trim();
      if (name === "set-cookie") {
        if (!responseHeaders[name]) responseHeaders[name] = [];
        (responseHeaders[name] as string[]).push(value);
      } else if (responseHeaders[name] === undefined) responseHeaders[name] = value;
    }
    return { status, bytes, headers: responseHeaders };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
