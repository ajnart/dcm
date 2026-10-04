import { existsSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

if (!Bun.isStandaloneExecutable) {
  console.error("This entry is for a Bun-compiled self-host artifact only.");
  process.exitCode = 1;
} else {
  const root = await mkdtemp(join(tmpdir(), "selfhost-native-"));
  process.once("exit", () => {
    try { rmSync(root, { recursive: true, force: true }); }
    catch { /* Do not replace a command result with temporary-cleanup failure. */ }
  });
  try {
    const names = new Set<string>();
    for (const file of Bun.embeddedFiles) {
      const name = file.name;
      const parts = name.split("/");
      const packageManifest = name === "package.json";
      if ((!packageManifest && (parts.length < 2 || !["bin", "dist"].includes(parts[0])))
        || parts.some((part) => !part || part === "." || part === "..") || names.has(name)) {
        throw new Error("The embedded CLI contains an unsafe file path.");
      }
      names.add(name);
      const target = join(root, ...parts);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      let mode = 0o600;
      if (name.endsWith(".sh")) mode = 0o700;
      await writeFile(target, Buffer.from(await file.arrayBuffer()), { mode });
    }
    const entry = join(root, "bin", "selfhost.mjs");
    if (!names.has("bin/selfhost.mjs") || !names.has("dist/command.js") || !existsSync(entry)) {
      throw new Error("The embedded self-host command is incomplete.");
    }
    process.argv[1] = entry;
    process.env.BUN_BE_BUN = "1";
    await import(pathToFileURL(entry).href);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "The native self-host CLI could not start.");
    process.exitCode = 1;
  }
}
