#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = process.argv[1] || fileURLToPath(import.meta.url);
const skillRoot = resolve(dirname(scriptPath), "..");
const source = join(skillRoot, "commands", "self-host.md");
const marker = "<!-- Managed by selfhost-skills. -->";
const skillPathPlaceholder = "{{SELF_HOST_SKILL_PATH}}";
const supportedAgents = new Set(["codex", "pi", "opencode"]);

function usage() {
  return "Usage: bun install-command.ts --agent codex|pi|opencode [--agent ...] --scope project|global [--project-root PATH] [--remove]";
}

function parseArguments(args: string[]) {
  const agents: string[] = [];
  let scope = "";
  let projectRoot = process.cwd();
  let remove = false;

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--agent") {
      const agent = args[++index];
      if (!supportedAgents.has(agent)) {
        throw new Error(`Unsupported agent: ${agent || "missing"}`);
      }
      agents.push(agent);
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
    if (value === "--remove") {
      remove = true;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }

  if (agents.length === 0 || !["project", "global"].includes(scope)) {
    throw new Error(usage());
  }
  if (scope === "project" && agents.includes("codex")) {
    throw new Error("Codex custom prompts are global only; use --scope global for codex.");
  }
  return { agents: [...new Set(agents)], scope, projectRoot, remove };
}

async function destination(agent: string, scope: string, projectRoot: string) {
  if (scope === "project") {
    const root = await realpath(projectRoot);
    if (agent === "pi") {
      return join(root, ".pi", "prompts", "self-host.md");
    }
    return join(root, ".opencode", "commands", "self-host.md");
  }

  const home = homedir();
  if (agent === "codex") {
    return join(process.env.CODEX_HOME || join(home, ".codex"), "prompts", "self-host.md");
  }
  if (agent === "pi") {
    return join(process.env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent"), "prompts", "self-host.md");
  }
  return join(home, ".config", "opencode", "commands", "self-host.md");
}

async function existingContent(path: string) {
  try {
    const details = await lstat(path);
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new Error(`Refusing to replace non-regular command file: ${path}`);
    }
    return await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function main() {
  const { agents, scope, projectRoot, remove } = parseArguments(process.argv.slice(2));
  const template = await readFile(source, "utf8");
  if (!template.includes(marker) || !template.includes(skillPathPlaceholder)) {
    throw new Error("Bundled command marker is missing");
  }
  const skillPath = join(skillRoot, "SKILL.md");
  const skillDetails = await lstat(skillPath);
  if (!skillDetails.isFile()) {
    throw new Error("Installed self-host SKILL.md is missing");
  }
  const command = template.replaceAll(skillPathPlaceholder, JSON.stringify(skillPath));

  const targets = [];
  for (const agent of agents) {
    const path = await destination(agent, scope, projectRoot);
    const current = await existingContent(path);
    if (current !== null && !current.includes(marker)) {
      throw new Error(`Refusing to replace an unmanaged command: ${path}`);
    }
    targets.push({ agent, path, current });
  }

  for (const target of targets) {
    if (remove) {
      if (target.current !== null) {
        await rm(target.path);
        console.log(`Removed ${target.agent}: ${target.path}`);
      }
      continue;
    }
    if (target.current === command) {
      console.log(`Already current: ${target.path}`);
      continue;
    }
    await mkdir(dirname(target.path), { recursive: true });
    const temporary = `${target.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, command, { flag: "wx", mode: 0o644 });
      await rename(temporary, target.path);
    } finally {
      await rm(temporary, { force: true });
    }
    console.log(`Installed ${target.agent}: ${target.path}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
