#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { declaredSharedDerivedRecipe } from "../src/lib/shared-derived-recipe-loader.ts";
import { declaredSharedPrestart, sharedPrestartRuntimeNames } from "../src/lib/shared-prestart.ts";
import { checkedMutableConfigs, mutableConfigRuntimeNames } from "../src/lib/mutable-config.ts";
import { sharedHomarrCompatibilitySources } from "../src/lib/shared-homarr-compatibility.ts";
import { homarrStackMapping } from "../src/lib/homarr-stack-mapping.ts";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = resolve(packageRoot, "../..");
const sourceRoot = join(repositoryRoot, ".agents", "skills", "self-host", "workflows", "selfhost");
const entry = join(sourceRoot, "scripts", "selfhost.ts");
const catalog = join(sourceRoot, "references", "catalog");
const mediaBundle = join(repositoryRoot, ".agents", "skills", "self-host", "workflows", "selfhost-media", "assets", "harness");
const composeOwner = join(repositoryRoot, ".agents", "skills", "self-host", "workflows", "selfhost-compose", "scripts");
const hostInspector = join(repositoryRoot, ".agents", "skills", "self-host", "workflows", "selfhost-host", "scripts", "inspect-host.sh");
const docmostReference = join(repositoryRoot, ".agents", "skills", "self-host", "workflows", "selfhost-setup", "references", "docmost-cli.md");
const householdBrowser = join(repositoryRoot, ".agents", "skills", "self-host", "workflows", "selfhost-setup", "scripts", "household-browser-credentials.ts");
const destination = join(packageRoot, "dist");
const marker = ".selfhost-cli-generated";

async function copyMediaRuntime(staging: string) {
  const manifest = JSON.parse(await readFile(join(mediaBundle, "bundle-manifest.json"), "utf8"));
  const known = new Map(manifest.files.map((entry: { path: string; sha256: string }) => [entry.path, entry.sha256]));
  const mediaFiles = manifest.files.map((entry: { path: string }) => entry.path).filter((path: string) => {
    if (path === "docker-compose.yml" || path === "docs/browser-paths.json") return true;
    if (!path.startsWith("scripts/")) return false;
    const scriptName = path.split("/").at(-1);
    return !scriptName?.startsWith("check-") && scriptName !== "render-prompt.sh";
  });
  if (!mediaFiles.includes("scripts/session.sh") || !mediaFiles.includes("scripts/setup-media-run.ts")
    || !mediaFiles.includes("scripts/browser-api-key.ts")) throw new Error("Media runtime entry points are missing");
  const runtime = join(staging, "media-runtime");
  const modes = new Map<string, number>();
  for (const path of mediaFiles) {
    const expected = known.get(path);
    if (typeof expected !== "string") throw new Error(`Media runtime is missing ${path}`);
    const source = join(mediaBundle, path);
    const stat = await lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error(`Unsafe media runtime file: ${path}`);
    const content = await readFile(source);
    const actual = createHash("sha256").update(content).digest("hex");
    if (actual !== expected) throw new Error(`Media runtime bundle drift: ${path}`);
    const target = join(runtime, path);
    const normalizedMode = (stat.mode & 0o111) !== 0 ? 0o755 : 0o644;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, { mode: normalizedMode });
    modes.set(path, normalizedMode);
  }
  await writeFile(join(runtime, "runtime-manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    source: "verified selfhost-media bundle",
    files: mediaFiles.map((path) => ({ path, sha256: known.get(path), mode: modes.get(path) })),
  }, null, 2)}\n`);
}

async function compileAppAdapters(staging: string) {
  const appRoot = join(catalog, "apps");
  const entries = await readdir(appRoot, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name)) continue;
    try {
      if (!homarrStackMapping(entry.name)) throw new Error("descriptor missing");
    } catch {
      throw new Error(`Invalid Homarr descriptor for ${entry.name}; fix the app catalog before packaging`);
    }
    let derivedMutableHook = false;
    for (const kind of ["setup", "acceptance", "derived-recipe", "pre-start", "mutable-config"]) {
      if (kind === "derived-recipe" && !declaredSharedDerivedRecipe(
        pathToFileURL(`${join(appRoot, entry.name)}/`), entry.name)) continue;
      if (kind === "pre-start" && !declaredSharedPrestart(
        pathToFileURL(`${join(appRoot, entry.name)}/`), entry.name)) continue;
      if (kind === "mutable-config") {
        let declared = derivedMutableHook;
        try {
          const recipe = JSON.parse(await readFile(join(appRoot, entry.name, "recipe.json"), "utf8"));
          if (checkedMutableConfigs(recipe).size) declared = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (!declared) continue;
      }
      const source = join(appRoot, entry.name, `${kind}.ts`);
      let metadata;
      try { metadata = await lstat(source); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT"
          && kind !== "derived-recipe" && kind !== "pre-start" && kind !== "mutable-config") continue;
        throw error;
      }
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
        throw new Error(`Unsafe ${kind} adapter for ${entry.name}`);
      }
      const output = join(staging, "workflows", "selfhost", "references", "catalog", "apps", entry.name, `${kind}.js`);
      const result = Bun.spawnSync({
        cmd: [process.execPath, "build", source, "--target=node", `--outfile=${output}`],
        cwd: repositoryRoot, stdout: "pipe", stderr: "pipe",
      });
      if (result.exitCode !== 0) throw new Error(`Bun ${kind} adapter build failed for ${entry.name}: ${result.stderr.toString().trim()}`);
      const loaded = await import(pathToFileURL(output).href);
      if (kind === "mutable-config") {
        if (typeof loaded.mutableConfigHook?.initialize !== "function"
          || typeof loaded.mutableConfigHook?.validate !== "function") {
          throw new Error(`Compiled ${kind} hook contract is invalid for ${entry.name}`);
        }
        continue;
      }
      const adapter = loaded.default;
      if (!adapter || adapter.appId !== entry.name) {
        throw new Error(`Compiled ${kind} adapter identity is invalid for ${entry.name}`);
      }
      if (kind === "setup" && (typeof adapter.firstRun !== "function"
        || typeof adapter.ready !== "function" || adapter.credentialCommand !== "app handoff")) {
        throw new Error(`Compiled ${kind} adapter contract is invalid for ${entry.name}`);
      }
      if (kind === "acceptance" && (typeof adapter.begin !== "function"
        || typeof adapter.finish !== "function" || typeof adapter.source !== "string")) {
        throw new Error(`Compiled ${kind} adapter contract is invalid for ${entry.name}`);
      }
      if (kind === "derived-recipe" && (typeof adapter.derive !== "function"
        || !adapter.inputDefinitions || typeof adapter.inputDefinitions !== "object"
        || Array.isArray(adapter.inputDefinitions) || !Array.isArray(adapter.sourceFiles)
        || !adapter.sourceFiles.includes("derived-recipe.ts"))) {
        throw new Error(`Compiled ${kind} adapter contract is invalid for ${entry.name}`);
      }
      if (kind === "derived-recipe") derivedMutableHook = adapter.sourceFiles.includes("mutable-config.ts");
      if (kind === "pre-start" && (typeof adapter.verify !== "function"
        || (adapter.assertAuthority !== undefined && typeof adapter.assertAuthority !== "function"))) {
        throw new Error(`Compiled ${kind} adapter contract is invalid for ${entry.name}`);
      }
    }
  }
}

async function main() {
  const sourceStat = await lstat(entry);
  const catalogStat = await lstat(catalog);
  const inspectorStat = await lstat(hostInspector);
  const docmostReferenceStat = await lstat(docmostReference);
  const householdBrowserStat = await lstat(householdBrowser);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || !catalogStat.isDirectory() || catalogStat.isSymbolicLink()
    || !inspectorStat.isFile() || inspectorStat.isSymbolicLink() || inspectorStat.nlink !== 1
    || !docmostReferenceStat.isFile() || docmostReferenceStat.isSymbolicLink() || docmostReferenceStat.nlink !== 1
    || !householdBrowserStat.isFile() || householdBrowserStat.isSymbolicLink() || householdBrowserStat.nlink !== 1) {
    throw new Error("CLI source or catalog is unsafe");
  }
  const staging = await mkdtemp(join(packageRoot, ".build-"));
  try {
    const output = join(staging, "workflows", "selfhost", "scripts", "selfhost.js");
    await mkdir(resolve(output, ".."), { recursive: true });
    const result = Bun.spawnSync({
      cmd: [process.execPath, "build", entry, "--target=node", `--outfile=${output}`],
      cwd: repositoryRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) {
      throw new Error(`Bun CLI build failed: ${result.stderr.toString().trim()}`);
    }
    const mediaOutput = join(staging, "media.js");
    // Bundle the exact OpenPGP dependency into the executed private worker;
    // setup-contract hashes every shipped root executable, not node_modules.
    const cryptoBuild = Bun.spawnSync({
      cmd: [process.execPath, "build", join(packageRoot, "src/lib/private-openpgp-bun.ts"), "--target=bun",
        "--define", 'process.env.NODE_ENV="production"',
        `--outfile=${join(staging, "private-openpgp-bun.js")}`],
      cwd: repositoryRoot, stdout: "pipe", stderr: "pipe",
    });
    if (cryptoBuild.exitCode !== 0) throw new Error("Private OpenPGP worker build failed");
    const mediaResult = Bun.spawnSync({
      cmd: [process.execPath, "build", join(packageRoot, "src", "media.ts"), "--target=node", `--outfile=${mediaOutput}`],
      cwd: repositoryRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (mediaResult.exitCode !== 0) throw new Error(`Bun media CLI build failed: ${mediaResult.stderr.toString().trim()}`);
    const commandOutput = join(staging, "command.js");
    const commandResult = Bun.spawnSync({
      cmd: [process.execPath, "build", join(packageRoot, "src", "command.ts"), "--target=node", `--outfile=${commandOutput}`],
      cwd: repositoryRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (commandResult.exitCode !== 0) throw new Error(`Bun command CLI build failed: ${commandResult.stderr.toString().trim()}`);
    const appOutput = join(staging, "app.js");
    const appResult = Bun.spawnSync({
      cmd: [process.execPath, "build", join(packageRoot, "src", "app.ts"), "--target=node", `--outfile=${appOutput}`],
      cwd: repositoryRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (appResult.exitCode !== 0) throw new Error(`Bun app CLI build failed: ${appResult.stderr.toString().trim()}`);
    const targetOutput = join(staging, "target.js");
    const targetResult = Bun.spawnSync({
      cmd: [process.execPath, "build", join(packageRoot, "src", "target.ts"), "--target=node", `--outfile=${targetOutput}`],
      cwd: repositoryRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (targetResult.exitCode !== 0) throw new Error(`Bun target CLI build failed: ${targetResult.stderr.toString().trim()}`);
    for (const commandEntry of ["catalog-compatibility", "connect"]) {
      const builtCommand = Bun.spawnSync({
        cmd: [process.execPath, "build", join(packageRoot, "src", `${commandEntry}.ts`), "--target=node", `--outfile=${join(staging, `${commandEntry}.js`)}`],
        cwd: repositoryRoot, stdout: "pipe", stderr: "pipe",
      });
      if (builtCommand.exitCode !== 0) throw new Error(`Bun ${commandEntry} CLI build failed: ${builtCommand.stderr.toString().trim()}`);
    }
    // Imported separately so the catalog owner's path-relative registries remain canonical.
    const catalogRuntimeResult = Bun.spawnSync({
      cmd: [process.execPath, "build", join(sourceRoot, "scripts", "catalog.ts"), "--target=node",
        `--outfile=${join(staging, "workflows", "selfhost", "scripts", "catalog.js")}`],
      cwd: repositoryRoot, stdout: "pipe", stderr: "pipe",
    });
    if (catalogRuntimeResult.exitCode !== 0) throw new Error(`Bun catalog runtime build failed: ${catalogRuntimeResult.stderr.toString().trim()}`);
    const interactiveOutput = join(staging, "interactive.js");
    const interactiveResult = Bun.spawnSync({
      cmd: [process.execPath, "build", join(packageRoot, "src", "interactive.ts"), "--target=node", `--outfile=${interactiveOutput}`],
      cwd: repositoryRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (interactiveResult.exitCode !== 0) throw new Error(`Bun interactive CLI build failed: ${interactiveResult.stderr.toString().trim()}`);
    const immichOutput = join(staging, "immich.js");
    const immichResult = Bun.spawnSync({
      cmd: [process.execPath, "build", join(packageRoot, "src", "immich.ts"), "--target=node", `--outfile=${immichOutput}`],
      cwd: repositoryRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (immichResult.exitCode !== 0) throw new Error(`Bun Immich CLI build failed: ${immichResult.stderr.toString().trim()}`);
    const vaultwardenOutput = join(staging, "vaultwarden.js");
    const vaultwardenResult = Bun.spawnSync({
      cmd: [process.execPath, "build", join(packageRoot, "src", "vaultwarden.ts"), "--target=node", `--outfile=${vaultwardenOutput}`],
      cwd: repositoryRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (vaultwardenResult.exitCode !== 0) throw new Error(`Bun Vaultwarden CLI build failed: ${vaultwardenResult.stderr.toString().trim()}`);
    const homarrAttachOutput = join(staging, "homarr-attach.js");
    const homarrAttachResult = Bun.spawnSync({
      cmd: [process.execPath, "build", join(packageRoot, "src", "homarr-attach.ts"), "--target=node", `--outfile=${homarrAttachOutput}`],
      cwd: repositoryRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (homarrAttachResult.exitCode !== 0) throw new Error(`Bun Homarr attach CLI build failed: ${homarrAttachResult.stderr.toString().trim()}`);
    const homarrMcpOutput = join(staging, "homarr-mcp.js");
    const homarrMcpResult = Bun.spawnSync({
      cmd: [process.execPath, "build", join(packageRoot, "src", "homarr-mcp.ts"), "--target=node", `--outfile=${homarrMcpOutput}`],
      cwd: repositoryRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (homarrMcpResult.exitCode !== 0) throw new Error(`Bun Homarr MCP CLI build failed: ${homarrMcpResult.stderr.toString().trim()}`);
    const docmostOutput = join(staging, "docmost.js");
    const docmostResult = Bun.spawnSync({
      cmd: [process.execPath, "build", join(packageRoot, "src", "docmost.ts"), "--target=node", `--outfile=${docmostOutput}`],
      cwd: repositoryRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (docmostResult.exitCode !== 0) throw new Error(`Bun Docmost CLI build failed: ${docmostResult.stderr.toString().trim()}`);
    const bundleOutput = join(staging, "bundle.js");
    const bundleResult = Bun.spawnSync({
      cmd: [process.execPath, "build", join(packageRoot, "src", "bundle.ts"), "--target=node", `--outfile=${bundleOutput}`],
      cwd: repositoryRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (bundleResult.exitCode !== 0) throw new Error(`Bun bundle CLI build failed: ${bundleResult.stderr.toString().trim()}`);
    const householdBrowserOutput = join(staging, "household-browser-credentials.js");
    const householdBrowserResult = Bun.spawnSync({
      cmd: [process.execPath, "build", householdBrowser, "--target=bun", `--outfile=${householdBrowserOutput}`],
      cwd: repositoryRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (householdBrowserResult.exitCode !== 0) throw new Error(`Bun browser credential helper build failed: ${householdBrowserResult.stderr.toString().trim()}`);
    const composeScripts = join(staging, "workflows", "selfhost-compose", "scripts");
    await mkdir(composeScripts, { recursive: true });
    await cp(join(composeOwner, "compose-project.ts"), join(composeScripts, "compose-project.ts"), { force: false });
    await cp(join(composeOwner, "platform-private.ts"), join(composeScripts, "platform-private.ts"), { force: false });
    const composeBuild = Bun.spawnSync({
      cmd: [process.execPath, "build", join(composeOwner, "compose-project.ts"), "--target=bun",
        `--outfile=${join(composeScripts, "compose-project.js")}`],
      cwd: repositoryRoot, stdout: "pipe", stderr: "pipe",
    });
    if (composeBuild.exitCode !== 0) throw new Error("Canonical Compose runtime build failed");
    await cp(join(composeOwner, "compose-lifecycle.sh"), join(composeScripts, "compose-lifecycle.sh"), { force: false });
    const prestartCheck = Bun.spawnSync({
      cmd: [process.execPath, "build", join(composeOwner, "pre-start-check.ts"), "--target=node",
        `--outfile=${join(composeScripts, "pre-start-check.js")}`],
      cwd: repositoryRoot, stdout: "pipe", stderr: "pipe",
    });
    if (prestartCheck.exitCode !== 0) {
      throw new Error(`Bun pre-start owner check build failed: ${prestartCheck.stderr.toString().trim()}`);
    }
    const mutableCheck = Bun.spawnSync({
      cmd: [process.execPath, "build", join(composeOwner, "mutable-config.ts"), "--target=bun",
        `--outfile=${join(composeScripts, "mutable-config.js")}`],
      cwd: repositoryRoot, stdout: "pipe", stderr: "pipe",
    });
    if (mutableCheck.exitCode !== 0) {
      throw new Error(`Bun mutable configuration owner helper build failed: ${mutableCheck.stderr.toString().trim()}`);
    }
    const hostScripts = join(staging, "workflows", "selfhost-host", "scripts");
    await mkdir(hostScripts, { recursive: true });
    await writeFile(join(hostScripts, "inspect-host.sh"), await readFile(hostInspector), { mode: 0o755 });
    const documentation = join(staging, "docs");
    await mkdir(documentation, { recursive: true });
    await writeFile(join(documentation, "docmost-cli.md"), await readFile(docmostReference), { mode: 0o644 });
    await cp(catalog, join(staging, "workflows", "selfhost", "references", "catalog"), { recursive: true });
    // Acceptance fingerprints read canonical source bytes beside each bundled CLI entry.
    const acceptanceSources = new Set(["shared-acceptance-contract.ts", "shared-acceptance.ts", "shared-compose-compatibility.ts", "shared-setup-compatibility.ts", "setup-observation-journal.ts", "setup-contract.ts", "selfhost-compose.ts", "shared-project-state.ts", "shared-project.ts",
      ...sharedHomarrCompatibilitySources.map((name) => name.replace("../", ""))]);
    for (const name of acceptanceSources) {
      let source = join(packageRoot, "src", "lib", name);
      if (["shared-project.ts", "shared-homarr.ts", "homarr-attach.ts"].includes(name)) source = join(packageRoot, "src", name);
      const metadata = await lstat(source);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
        throw new Error(`Unsafe shared acceptance source: ${name}`);
      }
      await writeFile(join(staging, name), await readFile(source), { mode: 0o644 });
    }
    // Stable canonical source evidence across independently bundled CLI consumers.
    const derivedRuntime = join(staging, "workflows", "selfhost", "references", "derived-recipe-runtime");
    await mkdir(derivedRuntime, { recursive: true });
    for (const name of ["shared-derived-recipe.ts", "shared-derived-recipe-loader.ts", "shared-derived-recipe-state.ts", "shared-service-target.ts",
      "shared-compose-project.ts", "shared-saved-recipe.ts", "shared-https-proxy-profile.ts"]) {
      const source = join(packageRoot, "src", "lib", name);
      const metadata = await lstat(source);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
        throw new Error(`Unsafe derived recipe runtime source: ${name}`);
      }
      await writeFile(join(derivedRuntime, name), await readFile(source), { mode: 0o644 });
    }
    const prestartRuntime = join(staging, "workflows", "selfhost", "references", "prestart-runtime");
    await mkdir(prestartRuntime, { recursive: true });
    for (const name of sharedPrestartRuntimeNames) {
      let source = join(packageRoot, "src", "lib", name);
      if (name === "shared-project.ts") source = join(packageRoot, "src", name);
      if (name === "setup-cloudflare-provider.ts") source = join(packageRoot, "src", "control-panel", name);
      const metadata = await lstat(source);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
        throw new Error(`Unsafe pre-start runtime source: ${name}`);
      }
      await writeFile(join(prestartRuntime, name), await readFile(source), { mode: 0o644 });
    }
    const mutableRuntime = join(staging, "workflows", "selfhost", "references", "mutable-config-runtime");
    await mkdir(mutableRuntime, { recursive: true });
    for (const name of mutableConfigRuntimeNames) {
      const source = join(packageRoot, "src", "lib", name);
      const metadata = await lstat(source);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
        throw new Error(`Unsafe mutable configuration runtime source: ${name}`);
      }
      await writeFile(join(mutableRuntime, name), await readFile(source), { mode: 0o644 });
    }
    await compileAppAdapters(staging);
    await copyMediaRuntime(staging);
    await writeFile(join(staging, "LICENSE"), await readFile(join(repositoryRoot, "LICENSE")), { mode: 0o644 });
    await writeFile(join(staging, marker), "Generated from selfhost router and catalog.\n", { mode: 0o644 });
    try {
      const priorStat = await lstat(destination);
      if (!priorStat.isDirectory() || priorStat.isSymbolicLink()) throw new Error("CLI dist is not a generated directory");
      const priorMarker = await readFile(join(destination, marker), "utf8");
      if (!priorMarker.startsWith("Generated from selfhost router")) throw new Error("CLI dist is not a generated directory");
      await rm(destination, { recursive: true });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await rename(staging, destination);
    console.error("PASS standalone CLI built from canonical router and catalog");
  } finally {
    try {
      await rm(staging, { recursive: true });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

await main();
