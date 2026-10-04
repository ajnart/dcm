import { requireSharedPrestart } from "../../../../../../packages/cli/src/lib/shared-prestart.ts";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";

/** Input manifests are non-secret JSON. Keep ordinary 0644 manifests compatible;
 * private owner records and credentials retain their separate strict readers. */
function readManifest(path: string): unknown {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size < 1 || before.size > 16 * 1024 * 1024) throw new Error("Invalid manifest source");
    const bytes = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    if (offset !== before.size) throw new Error("Changed manifest source");
    for (const current of [fstatSync(fd), lstatSync(path)]) {
      if (!current.isFile() || before.dev !== current.dev || before.ino !== current.ino || before.size !== current.size
        || before.mtimeMs !== current.mtimeMs || before.ctimeMs !== current.ctimeMs) throw new Error("Changed manifest source");
    }
    return JSON.parse(bytes.subarray(0, offset).toString("utf8"));
  } finally { closeSync(fd); }
}

/** Canonical lifecycle caller, not an attestation or caller-provided pass flag. */
async function main() {
  const options = new Map<string, string>();
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name || !["--manifest", "--operation", "--services"].includes(name) || options.has(name)
      || !value || value.startsWith("--")) throw new Error("Invalid pre-start owner invocation");
    options.set(name, value);
  }
  const path = options.get("--manifest");
  const operation = options.get("--operation");
  if (!path || !operation || !["apply", "add", "start", "recreate", "probe"].includes(operation)) {
    throw new Error("Exact pre-start owner operation is required");
  }
  let services: string[] | undefined;
  if (options.has("--services")) {
    services = options.get("--services")!.split(",");
    if (services.length > 512 || new Set(services).size !== services.length
      || services.some((id) => !/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(id))) throw new Error("Invalid pre-start service selection");
  }
  const manifest = readManifest(path);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Invalid manifest source");
  await requireSharedPrestart(manifest as Record<string, any>, operation, services);
}
if (import.meta.main) {
  try { await main(); }
  catch {
    console.error("Shared app pre-start prerequisite failed; inspect its exact prepared owner and authority; payload withheld");
    process.exitCode = 1;
  }
}
