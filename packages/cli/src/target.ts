import { spawnSync } from "node:child_process";

type TargetKind = "wsl" | "lima";
type Target = { kind: TargetKind; name: string; state: "running" };

const maximumOutput = 64 * 1024;
const namePattern = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,79}$/u;

function fail(message: string): never {
  throw new Error(message);
}

function commandForPlatform(): { binary: string; args: string[]; kind: TargetKind } | null {
  if (process.platform === "win32") {
    return { binary: "wsl.exe", args: ["--list", "--running", "--quiet"], kind: "wsl" };
  }
  if (process.platform === "darwin") {
    return { binary: "limactl", args: ["list", "--quiet", "--filter", '.status == "Running"'], kind: "lima" };
  }
  return null;
}

function decodeOutput(output: Buffer, kind: TargetKind): string {
  if (kind !== "wsl") return output.toString("utf8");
  const sample = output.subarray(0, Math.min(output.length, 128));
  let oddZeroes = 0;
  for (let index = 1; index < sample.length; index += 2) {
    if (sample[index] === 0) oddZeroes += 1;
  }
  if (sample.length >= 4 && oddZeroes >= Math.floor(sample.length / 8)) {
    return new TextDecoder("utf-16le").decode(output);
  }
  return output.toString("utf8");
}

export function parseRunningTargetNames(output: Buffer, kind: TargetKind): string[] {
  const names = decodeOutput(output, kind).replaceAll("\ufeff", "").split(/\r?\n/u)
    .map((line) => line.trim()).filter(Boolean);
  if (names.length > 50 || names.some((name) => !namePattern.test(name))) {
    fail("Target inventory contained an invalid or oversized name; inspect the guest manager directly");
  }
  const safe = kind === "wsl" ? names.filter((name) => !["docker-desktop", "docker-desktop-data"].includes(name.toLowerCase())) : names;
  return [...new Set(safe)].sort((left, right) => left.localeCompare(right));
}

function runningTargets(): { kind: TargetKind | null; targets: Target[]; status: "available" | "none" | "unavailable" | "unsupported" } {
  const command = commandForPlatform();
  if (!command) return { kind: null, targets: [], status: "unsupported" };
  const result = spawnSync(command.binary, command.args, {
    timeout: 8000, maxBuffer: maximumOutput, windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    return { kind: command.kind, targets: [], status: "unavailable" };
  }
  const targets = parseRunningTargetNames(result.stdout, command.kind)
    .map((name) => ({ kind: command.kind, name, state: "running" as const }));
  return { kind: command.kind, targets, status: targets.length > 0 ? "available" : "none" };
}

export function targetCommand(args: string[]): void {
  if (args.length === 0 || (args.length === 1 && ["help", "--help"].includes(args[0]))) {
    console.log("self-host target list [--json]\nself-host target launch --name RUNNING_GUEST\nA guest must already have the standalone CLI and Docker installed. This command does not provision, install, or verify host-visible ports and TLS trust.");
    return;
  }
  if (args[0] === "list" && (args.length === 1 || (args.length === 2 && args[1] === "--json"))) {
    const inventory = runningTargets();
    const result = { schemaVersion: 1, command: "target list", mutation: false, platform: process.platform,
      ...inventory, limitation: "Running guests are candidates only; architecture, Docker, published ports and client trust are not verified." };
    if (args[1] === "--json") {
      console.log(JSON.stringify(result, null, 2));
    } else if (inventory.status === "available") {
      console.log(`Running ${inventory.kind} guests: ${inventory.targets.map((target) => target.name).join(", ")}`);
      console.log("Choose one with self-host target launch --name NAME. Its CLI must already be installed inside the guest.");
    } else {
      console.log(`No running Linux target is available (${inventory.status}). Use self-host --interactive for local planning.`);
    }
    return;
  }
  if (args[0] !== "launch" || args.length !== 3 || args[1] !== "--name" || !namePattern.test(args[2])) {
    fail("Use target list [--json] or target launch --name EXACT_RUNNING_GUEST");
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) fail("target launch requires a terminal; use the headless CLI inside the guest for automation");
  const inventory = runningTargets();
  const selected = inventory.targets.find((target) => target.name === args[2]);
  if (!selected) fail("The selected guest is not running or no longer appears in the exact target inventory");
  const binary = selected.kind === "wsl" ? "wsl.exe" : "limactl";
  const launchArgs = selected.kind === "wsl"
    ? ["--distribution", selected.name, "--exec", "sh", "-c", "cd && exec self-host --interactive"]
    : ["shell", selected.name, "--", "sh", "-c", "cd && exec self-host --interactive"];
  console.log(`Opening the self-host terminal menu in ${selected.kind} guest ${selected.name}. Keep project data on that guest's Linux filesystem.`);
  const result = spawnSync(binary, launchArgs, { stdio: "inherit", windowsHide: false });
  if (result.error || result.status !== 0) {
    fail("The selected guest CLI could not complete. Check that self-host is installed inside the running guest; no target was provisioned by this command");
  }
}
