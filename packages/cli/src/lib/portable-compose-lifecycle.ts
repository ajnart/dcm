import { dirname } from "node:path";

type Request = {
  action: string;
  manifest: string;
  context: string;
  project: string;
  file: string;
  services?: string[];
  approval?: string;
  requireExistingVolumes?: boolean;
};
type Run = (command: string, args: string[], label: string) => string;

// Keep Docker execution shell-free; all policy decisions remain canonical commands.
export function portableComposeLifecycle(request: Request, canonical: (args: string[]) => string, run: Run, prestart: (operation: string, services?: string[]) => void): void {
  const { action, manifest, context, project, file } = request;
  if (!["preflight", "apply", "stop", "selected-start", "selected-stop", "selected-add", "selected-recreate", "selected-probe", "selected-remove"].includes(action)) throw new Error("Unsupported portable Compose action");
  const selected = action.startsWith("selected-");
  const operation = action.replace(/^selected-/, "");
  const identity = ["--input", manifest, "--context", context, "--project", project, "--file", file];
  const docker = (args: string[]) => run("docker", ["--context", context, ...args], "selfhost-compose Docker lifecycle");
  const compose = (args: string[]) => docker(["compose", "--project-name", project, "--file", file, ...args]);
  const ids = request.services ?? [];
  const selection = ["--services", ids.join(","), "--operation", operation, "--approval", request.approval ?? ""];
  if (action === "apply" && canonical(["apply-approval", "--input", manifest]).trim() !== request.approval) throw new Error("Compose apply approval does not match canonical policy");
  if (action === "stop" && request.approval !== `STOP:${project}`) throw new Error("Compose stop requires exact approval");
  if (selected) canonical(["selected-check", ...identity, ...selection]);
  else canonical(["lifecycle-check", ...identity]);
  if (["preflight", "apply", "selected-start", "selected-add", "selected-recreate", "selected-probe"].includes(action)) canonical(["runtime-preflight", ...identity]);
  if (context === "rootless") {
    const options = JSON.parse(docker(["info", "--format", "{{json .SecurityOptions}}"]));
    if (!Array.isArray(options) || !options.some((value) => typeof value === "string" && value.includes("rootless"))) throw new Error("Selected Docker context does not report rootless mode");
  } else docker(["info", "--format", "{{.ServerVersion}}"]);
  const volumeArgs: string[] = [];
  if (action === "selected-add") volumeArgs.push("--allow-new-volumes", "true");
  else if (request.requireExistingVolumes || action === "selected-start" || action === "selected-recreate") volumeArgs.push("--require-existing-volumes", "true");
  canonical(["volume-preflight", ...identity, ...volumeArgs]);
  compose(["config", "--quiet"]);
  if (action === "preflight") return;
  const containers = (id: string) => docker(["ps", "--all", "--no-trunc", "--filter", `label=com.docker.compose.project=${project}`, "--filter", `label=com.docker.compose.service=${id}`, "--format", "{{.ID}}"] ).trim();
  if (action === "selected-remove") {
    const check = () => {
      for (const id of ids) {
        const output = containers(id);
        if (!output) continue;
        for (const container of output.split(/\r?\n/)) {
          if (!/^[0-9a-f]{64}$/.test(container)) throw new Error("Invalid selected container identity");
          const labels = docker(["container", "inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}|{{index .Config.Labels "com.docker.compose.project.working_dir"}}|{{index .Config.Labels "com.docker.compose.oneoff"}}', container]).trim();
          if (labels !== `${project}|${id}|${file}|${dirname(file)}|False`) throw new Error("Selected container differs from exact original Compose owner");
        }
      }
    };
    check();
    compose(["stop", ...ids]);
    check();
    compose(["rm", "--force", ...ids]);
    if (ids.some((id) => containers(id) !== "")) throw new Error("Selected removal outcome requires inspection");
    return;
  }
  if (action === "stop") { compose(["stop"]); return; }
  if (action === "selected-stop") { compose(["stop", ...ids]); return; }
  if (action === "selected-probe") { prestart("probe", ids); canonical(["probe-run", ...identity, ...selection]); return; }
  const automatic = canonical(["automatic-services", "--input", manifest]).trim().split(/\r?\n/).filter(Boolean);
  let startup = automatic;
  if (selected) startup = ids;
  if (action === "selected-add") {
    for (const id of ids) if (containers(id)) throw new Error("Selected new service already exists; inspect before adding");
    startup = ids.filter((id) => automatic.includes(id));
  }
  if (!startup.length) return;
  if (selected) prestart(operation, ids);
  else prestart("apply");
  const args = ["up", "--detach"];
  if (selected) args.push("--no-deps");
  if (action === "selected-recreate") args.push("--force-recreate");
  compose([...args, ...startup]);
}
