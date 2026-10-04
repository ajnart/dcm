/** Fixed private protocol. Never accepts a command, parser path or executable code. */
import { readSync } from "node:fs";
const inputLimit = 96 * 1024;
const outputLimit = 128 * 1024;
const digestPattern = /^\$argon2id\$v=19\$m=65536,t=3,p=1\$(?:[A-Za-z0-9+/]{22}|[A-Za-z0-9+/]{43})\$[A-Za-z0-9+/]{43}$/;

function reject(): never { throw new Error("Private identity request rejected"); }

function boundedValue(value: unknown, depth = 0, seen = new Set<object>(), count = { nodes: 0 }): void {
  count.nodes += 1;
  if (depth > 32 || count.nodes > 4096) reject();
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (!value || typeof value !== "object" || seen.has(value)) reject();
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) reject();
    boundedValue(child, depth + 1, seen, count);
  }
}

async function main(): Promise<void> {
  const version = /^(\d+)\.(\d+)\.(\d+)$/.exec(Bun.version);
  if (!version || Number(version[1]) < 1 || (Number(version[1]) === 1 && Number(version[2]) < 4)
    || process.argv.length !== 2 || process.stdin.isTTY) reject();
  const chunks: Buffer[] = [];
  let bytes = 0;
  for (;;) {
    const buffer = Buffer.alloc(4096);
    const read = readSync(0, buffer, 0, buffer.length, null);
    if (read === 0) break;
    bytes += read;
    if (bytes > inputLimit) reject();
    chunks.push(buffer.subarray(0, read));
  }
  const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!request || typeof request !== "object" || Array.isArray(request)) reject();
  const keys = Object.keys(request).sort().join(",");
  let value: unknown;
  if (request.operation === "identity-yaml" && keys === "content,operation") {
    if (typeof request.content !== "string" || !request.content.length
      || Buffer.byteLength(request.content) > 64 * 1024) reject();
    // Identity files need no aliases/anchors/custom tags. Refuse these before
    // parsing to prevent alias expansion; JSON stays accepted as a YAML subset.
    try { value = JSON.parse(request.content); }
    catch {
      if (/(?:^|[\s:[{,])[&*!][^\s]/m.test(request.content)) reject();
      value = Bun.YAML.parse(request.content);
    }
    boundedValue(value);
  } else {
    if (typeof request.password !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(request.password)) reject();
    if (request.operation === "argon2id-hash" && keys === "operation,password") {
      value = await Bun.password.hash(request.password, { algorithm: "argon2id", memoryCost: 65536, timeCost: 3 });
      if (typeof value !== "string" || !digestPattern.test(value)) reject();
    } else if (request.operation === "argon2id-verify" && keys === "digest,operation,password") {
      if (typeof request.digest !== "string" || !digestPattern.test(request.digest)) reject();
      value = await Bun.password.verify(request.password, request.digest);
    } else reject();
  }
  const output = JSON.stringify({ value });
  if (Buffer.byteLength(output) > outputLimit) reject();
  process.stdout.write(output);
}

try { await main(); }
catch {
  // Parser and runtime errors can contain private input. Suppress every detail.
  process.stderr.write("Private identity operation failed\n");
  process.exitCode = 1;
}
