import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { installedCliRoot } from "./installed-cli-root.ts";

const inputLimit = 96 * 1024;
const outputLimit = 128 * 1024;
const digestPattern = /^\$argon2id\$v=19\$m=65536,t=3,p=1\$(?:[A-Za-z0-9+/]{22}|[A-Za-z0-9+/]{43})\$[A-Za-z0-9+/]{43}$/;

function fail(): never {
  throw new Error("Private identity operation failed; child output was suppressed. Bun 1.4+ must be available on PATH.");
}

function invoke(request: Record<string, string>): unknown {
  let runtime = new URL("./private-identity-bun.ts", import.meta.url);
  if (!new URL(import.meta.url).pathname.endsWith(".ts")) {
    runtime = new URL("workflows/selfhost/references/mutable-config-runtime/private-identity-bun.ts", installedCliRoot(import.meta.url));
  }
  const input = JSON.stringify(request);
  if (Buffer.byteLength(input) > inputLimit) fail();
  // No inherited application credentials and no private argv, files or logs.
  const result = spawnSync("bun", [fileURLToPath(runtime)], {
    input, encoding: "utf8", timeout: 15_000, maxBuffer: outputLimit,
    env: { PATH: process.env.PATH }, stdio: ["pipe", "pipe", "pipe"], shell: false,
  });
  if (result.error || result.status !== 0 || result.stderr !== ""
    || Buffer.byteLength(result.stdout ?? "") > outputLimit) fail();
  try {
    const response = JSON.parse(result.stdout);
    if (!response || typeof response !== "object" || Array.isArray(response)
      || Object.keys(response).sort().join(",") !== "value") fail();
    return response.value;
  } catch {
    fail();
  }
}

function checkPassword(password: string): void {
  if (typeof password !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(password)) fail();
}

/** All results remain private to the mutable identity apply boundary. */
export const privateIdentityHasher = {
  async hash(password: string): Promise<string> {
    checkPassword(password);
    const digest = invoke({ operation: "argon2id-hash", password });
    if (typeof digest !== "string" || !digestPattern.test(digest)) fail();
    return digest;
  },
  async verify(password: string, digest: string): Promise<boolean> {
    checkPassword(password);
    if (typeof digest !== "string" || !digestPattern.test(digest)) fail();
    const matched = invoke({ operation: "argon2id-verify", password, digest });
    if (typeof matched !== "boolean") fail();
    return matched;
  },
};

export async function parsePrivateIdentityYaml(content: string): Promise<unknown> {
  if (typeof content !== "string" || !content.length || Buffer.byteLength(content) > 64 * 1024) fail();
  return invoke({ operation: "identity-yaml", content });
}
