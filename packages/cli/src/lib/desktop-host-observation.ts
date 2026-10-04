import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, lstatSync, realpathSync, statfsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, parse, resolve, win32 } from "node:path";
import type { SharedHostRequest } from "./shared-host-observation.ts";
import { MAX_SHARED_SERVICES } from "./shared-project-limits.ts";

function fail(): never {
  throw new Error("Shared-project host inspection: local Docker Desktop metadata could not be safely observed; child output suppressed");
}

function command(executable: string, args: string[], maxBuffer = 1024 * 1024): string {
  const environment = { ...process.env };
  if (executable === process.execPath) environment.BUN_BE_BUN = "1";
  const result = spawnSync(executable, args, { encoding: "utf8", timeout: 30_000,
    maxBuffer, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || result.status !== 0) fail();
  return result.stdout.trim();
}

export function localDesktopEndpoint(context: string, endpoint: unknown): boolean {
  if (process.platform === "darwin") {
    if (context === "default") return endpoint === "unix:///var/run/docker.sock";
    if (context !== "desktop-linux") return false;
    return endpoint === `unix://${resolve(homedir(), ".docker/run/docker.sock")}`
      || endpoint === `unix://${resolve(homedir(), ".docker/desktop/docker.sock")}`;
  }
  if (process.platform === "win32" && (context === "default" || context === "desktop-linux")) {
    return endpoint === "npipe:////./pipe/docker_engine"
      || endpoint === "npipe:////./pipe/dockerDesktopLinuxEngine";
  }
  return false;
}

/** Only known Desktop VM translations of the complete inspected host path. Never suffix-match. */
export function localDockerBindSourceMatches(context: string, actual: unknown, source: unknown): boolean {
  if (typeof actual !== "string" || typeof source !== "string") return false;
  if (actual === source) return true;
  if (!["default", "desktop-linux"].includes(context)) return false;
  if (process.platform === "darwin") return actual === `/host_mnt${source}`;
  if (process.platform !== "win32" || !win32.isAbsolute(source)
    || source.startsWith("\\\\") || win32.normalize(source) !== source) return false;
  const normalized = source.replaceAll("\\", "/");
  if (actual.replaceAll("\\", "/").toLowerCase() === normalized.toLowerCase()) return true;
  const drive = normalized[0]!.toLowerCase();
  const remainder = normalized.slice(2);
  return actual.toLowerCase() === `/run/desktop/mnt/host/${drive}${remainder}`.toLowerCase()
    || actual.toLowerCase() === `/host_mnt/${drive}${remainder}`.toLowerCase();
}

function pathFacts(path: string): Record<string, unknown> {
  if (path === parse(path).root || path.startsWith("\\\\")) fail();
  let ancestor = path;
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) fail();
    ancestor = parent;
  }
  // Check every component, including parents of an absent media directory.
  let component = ancestor;
  while (component !== parse(component).root) {
    if (lstatSync(component).isSymbolicLink()) fail();
    component = dirname(component);
  }
  if (resolve(realpathSync(ancestor)) !== resolve(ancestor)) fail();
  accessSync(ancestor, constants.W_OK);
  const capacity = statfsSync(ancestor);
  if (process.platform === "darwin") {
    // df resolves APFS firmlinks: /Users lives on Data, not the sealed read-only root.
    const rows = command("/bin/df", ["-P", ancestor], 16384).split("\n");
    const mountedOn = rows.at(-1)?.trim().split(/\s+/).slice(5).join(" ");
    const mounts = command("/sbin/mount", [], 128 * 1024).split("\n")
      .map((line) => / on (.+) \(([^)]+)\)$/.exec(line)).filter((match) => match !== null)
      .filter((match) => match![1] === mountedOn);
    const flags = mounts[0]?.[2]?.split(", ");
    if (!flags || !["apfs", "hfs"].includes(flags[0]!) || flags.includes("read-only")) fail();
  } else {
    const drive = parse(ancestor).root.slice(0, 2);
    if (!/^[A-Za-z]:$/.test(drive)) fail();
    const kind = command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `$v = Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='${drive}'\"; if ($null -eq $v -or $v.DriveType -ne 3) { exit 1 }; Write-Output $v.DriveType`], 4096);
    if (kind !== "3") fail();
  }
  const present = existsSync(path);
  let directory = false;
  if (present) directory = lstatSync(path).isDirectory();
  return { path, exists: present, directory, symlink: false, writableByInspector: true,
    networkFilesystem: false, readOnlyMount: false,
    availableBytes: capacity.bavail * capacity.bsize,
    availableInodes: capacity.ffree, inodeAccounting: "desktop-host" };
}

/** Bounded host metadata only; no Bash dependency, mounts, configuration or environment dumps. */
export function inspectDesktopHost(request: SharedHostRequest,
  verifyContext: (context: string) => void): unknown {
  const context = command("docker", ["context", "show"], 4096);
  verifyContext(context);
  const dockerArgs = ["--context", context];
  const info = JSON.parse(command("docker", [...dockerArgs, "info", "--format",
    '{"os":{{json .OSType}},"architecture":{{json .Architecture}},"security":{{json .SecurityOptions}}}']));
  if (info.os !== "linux" || !["x86_64", "amd64", "aarch64", "arm64"].includes(info.architecture)
    || !Array.isArray(info.security) || info.security.some((item: unknown) =>
      typeof item !== "string" || item.includes("rootless"))) fail();
  const containers = command("docker", [...dockerArgs, "container", "ls", "--all", "--format",
    '{"name":{{json .Names}},"publishedPorts":{{json .Ports}},"composeProject":{{json (.Label "com.docker.compose.project")}}}']).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const networks = command("docker", [...dockerArgs, "network", "ls", "--format",
    '{"name":{{json .Name}}}']).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  if (containers.length > MAX_SHARED_SERVICES || networks.length > MAX_SHARED_SERVICES) fail();
  const probe = `const net=require('node:net'); const ports=JSON.parse(process.argv[1]);
    async function check(port,host){return await new Promise((resolve,reject)=>{const s=net.createServer();
      s.once('error',e=>{if(e.code==='EADDRINUSE'||e.code==='EACCES')resolve(true);else reject(e)});
      s.listen({port,host,exclusive:true,ipv6Only:true},()=>s.close(()=>resolve(false)));});}
    (async()=>{const items=[];for(const port of ports){const ipv4=await check(port,'0.0.0.0');
      const ipv6=await check(port,'::');items.push({port,inUse:ipv4||ipv6});}
      process.stdout.write(JSON.stringify(items));})().catch(()=>process.exit(1));`;
  const selected = JSON.parse(command(process.execPath, ["-e", probe, JSON.stringify(request.tcpPorts)]));
  const paths = [pathFacts(request.projectRoot)];
  if (request.mediaPath !== null) paths.push(pathFacts(request.mediaPath));
  let uid = 1000;
  let gid = 1000;
  if (typeof process.getuid === "function") uid = process.getuid();
  if (typeof process.getgid === "function") gid = process.getgid();
  let selectedState = "observed";
  if (request.tcpPorts.length === 0) selectedState = "not_requested";
  return { schemaVersion: 1, mode: "read-only", desktopHost: process.platform,
    runtime: { docker: { state: "running", os: info.os, architecture: info.architecture,
      rootless: { state: "observed", value: false } }, dockerContext: { state: "observed", current: context } },
    identity: { state: "observed", uid, gid,
      timezone: { state: "observed", value: Intl.DateTimeFormat().resolvedOptions().timeZone } },
    workloads: { containers: { state: "observed", truncated: false, items: containers },
      dockerNetworks: { state: "observed", truncated: false, items: networks } },
    network: { listeningPorts: { state: "observed", truncated: true, items: [] },
      selectedTcpPorts: { state: selectedState, complete: request.tcpPorts.length > 0, items: selected } },
    storage: { paths } };
}
