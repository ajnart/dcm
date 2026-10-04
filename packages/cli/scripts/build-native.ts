#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { link, lstat, mkdtemp, readdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const targets = new Set([
  "bun-linux-x64", "bun-linux-arm64",
  "bun-darwin-x64", "bun-darwin-arm64",
  "bun-windows-x64", "bun-windows-arm64",
]);

function fail(message: string): never { throw new Error(message); }

function options(args: string[]) {
  const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!["--target", "--outfile"].includes(flag) || !value || value.startsWith("--") || flags[flag]) {
      fail(`Invalid or repeated native build option: ${flag ?? "(missing)"}`);
    }
    flags[flag] = value;
  }
  const target = flags["--target"];
  const requestedOutput = flags["--outfile"];
  if (!targets.has(target)) fail("Choose one supported Bun x64 or ARM64 Linux, macOS, or Windows target");
  if (!requestedOutput || !isAbsolute(requestedOutput)
    || requestedOutput.split(/[\\/]/).some((part) => part === "." || part === "..")) {
    fail("--outfile must be one absolute path without dot segments");
  }
  const outfile = resolve(requestedOutput);
  if (target.startsWith("bun-windows-") !== outfile.endsWith(".exe")) {
    fail("Windows output needs .exe; non-Windows output must not use .exe");
  }
  return { target, outfile };
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function main() {
  const { target, outfile } = options(process.argv.slice(2));
  const version = Bun.version.split(".").map(Number);
  if (version[0] < 1 || (version[0] === 1 && version[1] < 4)) {
    fail("Native asset compilation requires Bun 1.4.0 or newer");
  }
  if (existsSync(outfile)) fail("Native output already exists; choose a new exact artifact path");
  const parent = dirname(outfile);
  const parentStat = await lstat(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) fail("Native output parent must be one real directory");
  const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const repositoryRoot = resolve(packageRoot, "../..");
  const bin = join(packageRoot, "bin");
  const dist = join(packageRoot, "dist");
  const marker = join(dist, ".selfhost-cli-generated");
  for (const path of [join(bin, "selfhost.mjs"), join(packageRoot, "package.json"), marker,
    join(dist, "command.js"), join(dist, "homarr-mcp.js"),
    join(dist, "workflows", "selfhost", "scripts", "selfhost.js")]) {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) fail(`Built CLI input is missing or unsafe: ${path}`);
  }
  if ((await readdir(dist)).length < 10) fail("Built CLI asset directory is incomplete");
  const staging = await mkdtemp(join(parent, ".selfhost-native-build-"));
  try {
    const temporary = join(staging, target.startsWith("bun-windows-") ? "self-host.exe" : "self-host");
    const result = Bun.spawnSync({
      cmd: [process.execPath, "build", "--compile", `--target=${target}`,
        `--asset=${bin}`, `--asset=${dist}`, `--asset=${join(packageRoot, "package.json")}`,
        `--outfile=${temporary}`, join(packageRoot, "src", "native.ts")],
      cwd: repositoryRoot, stdout: "pipe", stderr: "pipe",
    });
    if (result.exitCode !== 0) fail(`Native compile failed: ${result.stderr.toString().trim().slice(0, 1000)}`);
    const metadata = await lstat(temporary);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1_000_000) {
      fail("Native compiler did not create one bounded executable");
    }
    const digest = await sha256(temporary);
    await link(temporary, outfile);
    console.log(JSON.stringify({ schemaVersion: 1, kind: "selfhost-native-build", target,
      outfile, bytes: metadata.size, sha256: digest, runOnTargetOs: "required-before-support-claim" }, null, 2));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

await main();
