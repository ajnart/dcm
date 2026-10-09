#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let sourceSkill = join(sourceRoot, ".agents", "skills", "self-host");
if (!existsSync(join(sourceSkill, "SKILL.md"))) {
  sourceSkill = join(sourceRoot, "skills", "self-host");
}
const agents = new Set(["codex", "pi", "opencode"]);
const managedMarker = "<!-- Managed by selfhost-skills. -->";

function usage() {
  return "Usage: bun scripts/install.ts --agent codex|pi|opencode [--agent ...] --scope project|global [--project-root PATH] [--codex-prompt]";
}

function parse(args: string[]) {
  const selected: string[] = [];
  let scope = "";
  let projectRoot = process.cwd();
  let codexPrompt = false;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--agent") {
      const agent = args[++index];
      if (!agents.has(agent)) {
        throw new Error(`Unsupported agent: ${agent || "missing"}`);
      }
      selected.push(agent);
      continue;
    }
    if (value === "--scope") {
      scope = args[++index] || "";
      continue;
    }
    if (value === "--project-root") {
      projectRoot = args[++index] || "";
      continue;
    }
    if (value === "--codex-prompt") {
      codexPrompt = true;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }
  if (selected.length === 0 || !["project", "global"].includes(scope)) {
    throw new Error(usage());
  }
  if (codexPrompt && (scope !== "global" || !selected.includes("codex"))) {
    throw new Error("--codex-prompt requires --agent codex --scope global");
  }
  return { selected: [...new Set(selected)], scope, projectRoot, codexPrompt };
}

function skillRoots(agent: string, scope: string, projectRoot: string) {
  if (scope === "project") {
    const shared = join(projectRoot, ".agents", "skills", "self-host");
    return agent === "pi" ? [join(projectRoot, ".pi", "skills", "self-host"), shared] : [shared];
  }
  const shared = join(homedir(), ".agents", "skills", "self-host");
  if (agent === "pi") {
    return [join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "skills", "self-host"), shared];
  }
  if (agent === "opencode") {
    return [shared];
  }
  return [shared, join(process.env.CODEX_HOME || join(homedir(), ".codex"), "skills", "self-host")];
}

function commandPath(agent: string, scope: string, projectRoot: string) {
  if (scope === "project") {
    if (agent === "pi") {
      return join(projectRoot, ".pi", "prompts", "self-host.md");
    }
    return join(projectRoot, ".opencode", "commands", "self-host.md");
  }
  if (agent === "pi") {
    return join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "prompts", "self-host.md");
  }
  if (agent === "opencode") {
    return join(homedir(), ".config", "opencode", "commands", "self-host.md");
  }
  return join(process.env.CODEX_HOME || join(homedir(), ".codex"), "prompts", "self-host.md");
}

async function preflightCommand(path: string) {
  try {
    const details = await lstat(path);
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new Error(`Command path is not a regular file: ${path}`);
    }
    const current = await readFile(path, "utf8");
    if (!current.includes(managedMarker)) {
      throw new Error(`Refusing to replace an unmanaged command: ${path}`);
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function run(command: string, args: string[], cwd: string) {
  await new Promise<void>((fulfill, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        fulfill();
        return;
      }
      reject(new Error(`${command} exited with status ${code}`));
    });
  });
}

async function ensurePiExplicitPolicy(root: string) {
  const path = join(root, "SKILL.md");
  const current = await readFile(path, "utf8");
  if (/^disable-model-invocation: true$/m.test(current)) {
    return;
  }
  if (!/^---\nname: self-host\n/m.test(current) || /^disable-model-invocation:/m.test(current)) {
    throw new Error("Installed Pi skill has unexpected invocation metadata");
  }
  const projected = current.replace(/^name: self-host\n/m, "name: self-host\ndisable-model-invocation: true\n");
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, projected, { flag: "wx", mode: 0o644 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function main() {
  const options = parse(process.argv.slice(2));
  const projectRoot = await realpath(options.projectRoot);
  if (!existsSync(join(sourceSkill, "SKILL.md"))) {
    throw new Error("self-host skill is missing from the source package");
  }

  for (const agent of options.selected) {
    if (agent === "codex" && !options.codexPrompt) {
      continue;
    }
    await preflightCommand(commandPath(agent, options.scope, projectRoot));
  }

  const cliArgs = ["--bun", "skills@latest", "add", sourceRoot, "--skill", "self-host"];
  for (const agent of options.selected) {
    cliArgs.push("--agent", agent);
  }
  if (options.scope === "global") {
    cliArgs.push("--global");
  }
  cliArgs.push("--copy", "--yes");
  await run("bunx", cliArgs, projectRoot);

  for (const agent of options.selected) {
    const candidates = skillRoots(agent, options.scope, projectRoot);
    const installed = candidates.find((root) => existsSync(join(root, "SKILL.md")));
    if (!installed) {
      throw new Error(`The installer did not create the ${agent} self-host skill in ${candidates.join(" or ")}`);
    }
    if (agent === "pi") {
      await ensurePiExplicitPolicy(installed);
    }
    if (agent === "codex" && !options.codexPrompt) {
      console.log("Codex: invoke $self-host or select /skills");
      continue;
    }
    await run("bun", [
      join(installed, "scripts", "install-command.ts"),
      "--agent", agent,
      "--scope", options.scope,
      "--project-root", projectRoot,
    ], projectRoot);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
