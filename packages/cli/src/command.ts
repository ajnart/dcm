import { spawnSync } from "node:child_process";
import { constants, existsSync, readFileSync } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, realpath, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { immichAcceptCommand, immichHomarrKeyCommand } from "./immich-accept.ts";
import { appCommand } from "./app.ts";
import { bundleBackupCommand } from "./bundle-backup.ts";
import { bundleFinalizeCommand } from "./bundle-finalize.ts";
import { caddyPrivateCommand } from "./caddy-private.ts";
import { requireAppCliSetup, requireInstallPlan } from "./catalog-gate.ts";
import { assertPackagedCatalogProject } from "./lib/catalog-project.ts";
import { savedAppIds } from "./lib/app-state-discovery.ts";
import { parseMediaNetworkSubnets, type MediaNetworkSubnets } from "./media-network-subnets.ts";

type MediaCommand = (args: string[]) => Promise<void>;
type ImmichCommand = (args: string[]) => Promise<void>;
type VaultwardenCommand = (args: string[]) => Promise<void>;
type HomarrAttachCommand = (args: string[]) => Promise<void>;
type HomarrMcpCommand = (args: string[]) => Promise<void>;
type DocmostCommand = (args: string[]) => Promise<void>;
type BundleCommand = (args: string[], dependencies: {
  media: MediaCommand; immich: ImmichCommand; vaultwarden: VaultwardenCommand; docmost: DocmostCommand;
}) => Promise<void>;

type Config = {
  schemaVersion: 1;
  profile: "media";
  runId: string;
  username: string;
  credentialHandoff: boolean;
  mediaBindMode?: "host-only";
  mediaPortStart?: number;
  mediaNetworkSubnets?: MediaNetworkSubnets;
};

const runIdPattern = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const usernamePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$/;

function fail(message: string): never { throw new Error(message); }

function mediaPortStart(value: string): number {
  if (!/^[0-9]{5}$/.test(value)) fail("mediaPortStart must be from 20000 through 44993");
  const start = Number(value);
  if (start < 20000 || start > 44993) fail("mediaPortStart must be from 20000 through 44993");
  return start;
}

function parse(input: string[]) {
  const args: string[] = [];
  const flags: Record<string, string> = {};
  const valid = new Set(["--project-root", "--profile", "--run-id", "--username", "--credential-handoff", "--media-bind-mode", "--media-port-start", "--media-network-subnets", "--approve", "--from", "--firewall-scope", "--input", "--local-https-input", "--local-https-run-id", "--defer-indexer", "--scope", "--json", "--live"]);
  const switches = new Set(["--defer-indexer", "--json", "--live"]);
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (!value.startsWith("--")) {
      args.push(value);
      continue;
    }
    if (!valid.has(value) || flags[value]) fail(`Invalid or repeated option: ${value}`);
    if (switches.has(value)) {
      flags[value] = "true";
      continue;
    }
    if (!input[index + 1] || input[index + 1].startsWith("--")) fail(`Invalid or repeated option: ${value}`);
    flags[value] = input[++index];
  }
  return { args, flags };
}

function only(flags: Record<string, string>, names: string[]) {
  for (const name of Object.keys(flags)) if (!names.includes(name)) fail(`Option ${name} does not apply here`);
}

async function project(input: string | undefined, create = false) {
  const root = input ? resolve(input) : process.cwd();
  if (!isAbsolute(root) || root === "/" || root === await realpath(homedir())) fail("Choose a specific project directory, not your home or filesystem root");
  if (input && input !== root) fail("--project-root must be an exact absolute path");
  if (create && !existsSync(root)) await mkdir(root, { mode: 0o700 });
  if (await realpath(root) !== root) fail("Project path must be canonical");
  const metadata = await lstat(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o002) !== 0) fail("Project directory is unsafe");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail("Project directory has a different owner");
  return { root, local: join(root, ".selfhost"), file: join(root, ".selfhost", "cli.json") };
}

async function ensureLocal(paths: Awaited<ReturnType<typeof project>>, create: boolean) {
  if (!existsSync(paths.local) && create) await mkdir(paths.local, { mode: 0o700 });
  const metadata = await lstat(paths.local);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o700) fail(".selfhost must be an owner-only directory (0700)");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail(".selfhost has a different owner");
}

async function householdInputs(paths: Awaited<ReturnType<typeof project>>): Promise<string[]> {
  const directory = join(paths.local, "bundles");
  if (!existsSync(directory)) return [];
  await ensureLocal(paths, false);
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o700) {
    fail("Household bundle directory must be owner-only (0700)");
  }
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    fail("Household bundle directory has a different owner");
  }
  const inputs: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!runIdPattern.test(entry.name)) continue;
    if (!entry.isDirectory()) fail(`Unsafe household bundle entry: ${entry.name}`);
    const input = join(directory, entry.name, "household-bundle.json");
    let inputMetadata;
    try { inputMetadata = await lstat(input); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (!inputMetadata.isFile() || inputMetadata.isSymbolicLink()) fail(`Unsafe household bundle input: ${entry.name}`);
    inputs.push(input);
  }
  return inputs.sort();
}

function validate(config: unknown): asserts config is Config {
  if (!config || typeof config !== "object" || Array.isArray(config)) fail("Invalid CLI config");
  const value = config as Record<string, unknown>;
  const expected = ["credentialHandoff", "profile", "runId", "schemaVersion", "username"];
  if (Object.hasOwn(value, "mediaBindMode")) expected.push("mediaBindMode");
  if (Object.hasOwn(value, "mediaPortStart")) expected.push("mediaPortStart");
  if (Object.hasOwn(value, "mediaNetworkSubnets")) expected.push("mediaNetworkSubnets");
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected.sort())
    || value.schemaVersion !== 1 || value.profile !== "media"
    || typeof value.runId !== "string" || !runIdPattern.test(value.runId)
    || typeof value.username !== "string" || !usernamePattern.test(value.username)
    || typeof value.credentialHandoff !== "boolean"
    || (value.mediaBindMode !== undefined && value.mediaBindMode !== "host-only")
    || (value.mediaPortStart !== undefined && (!Number.isInteger(value.mediaPortStart) || value.mediaPortStart < 20000 || value.mediaPortStart > 44993))) fail("Invalid CLI config");
  if (value.mediaNetworkSubnets !== undefined) parseMediaNetworkSubnets(value.mediaNetworkSubnets);
}

async function readConfig(paths: Awaited<ReturnType<typeof project>>) {
  if (!existsSync(paths.local) || !existsSync(paths.file)) fail(`No CLI config at ${paths.file}. Run self-host config init first`);
  await ensureLocal(paths, false);
  const metadata = await lstat(paths.file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || (metadata.mode & 0o777) !== 0o600) fail("CLI config must be an owner-only regular file (0600)");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail("CLI config has a different owner");
  const value: unknown = JSON.parse(await readFile(paths.file, "utf8"));
  validate(value);
  return value;
}

async function createConfig(paths: Awaited<ReturnType<typeof project>>, value: Config) {
  validate(value);
  await ensureLocal(paths, true);
  const handle = await open(paths.file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); }
  finally { await handle.close(); }
}

async function updateConfig(paths: Awaited<ReturnType<typeof project>>, value: Config) {
  validate(value);
  await readConfig(paths);
  const temporary = join(paths.local, `.cli-${process.pid}-${Date.now()}.json`);
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, paths.file);
}

function check(command: string[], label: string, required: boolean) {
  const result = spawnSync(command[0], command.slice(1), { encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "pipe"] });
  const ok = result.status === 0;
  const version = ok ? result.stdout.trim().split("\n")[0].slice(0, 120) : "unavailable";
  return { tool: label, required, ok, version };
}

function doctor(json: boolean, scope: "plan" | "compose" | "media") {
  if (scope === "compose") {
    const embedded = Boolean(process.versions.bun);
    const tools = [
      { tool: "Linux, macOS, or Windows host", required: true,
        ok: ["linux", "darwin", "win32"].includes(process.platform), version: process.platform },
      { tool: "Embedded Bun runtime", required: embedded, ok: embedded, version: process.versions.bun ?? "not embedded" },
      check(["docker", "compose", "version", "--short"], "Docker Compose v2", true),
      check(["docker", "info", "--format", "{{.OSType}}"], "Docker daemon (Linux containers)", true),
    ];
    if (!embedded) tools.push(check(["bun", "--version"], "Bun 1.4+ setup runner", true));
    if (process.platform === "linux") tools.push(check(["bash", "--version"], "Linux host inspection", true));
    if (process.platform === "win32") tools.push(check(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.ToString()"], "Windows credential ACL support", true));
    const engine = tools.find((tool) => tool.tool === "Docker daemon (Linux containers)");
    if (engine) engine.ok = engine.ok && engine.version === "linux";
    const result = { scope, platform: process.platform,
      status: tools.every((tool) => !tool.required || tool.ok) ? "ready" : "needs-attention", tools,
      advisories: ["Uses the selected local Docker context. Docker Desktop must use Linux containers and share the selected project folder. Device/VPN and same-host Docker-manager recipes retain their specific platform gates."] };
    if (json) console.log(JSON.stringify(result, null, 2));
    else for (const tool of tools) console.log(`${tool.ok ? "OK" : "MISSING"} ${tool.tool}: ${tool.version}`);
    if (result.status !== "ready") process.exitCode = 1;
    return;
  }
  if (scope === "plan") {
    const native = typeof Bun !== "undefined" && Bun.isStandaloneExecutable;
    let tool = "Node.js 20.12+ for catalog, planner, and TUI";
    let version = process.version;
    let ok = Number(process.versions.node.split(".")[0]) > 20
      || (Number(process.versions.node.split(".")[0]) === 20 && Number(process.versions.node.split(".")[1]) >= 12);
    if (native) {
      tool = "Embedded Bun runtime for catalog, planner, and TUI";
      version = Bun.version;
      ok = true;
    }
    const tools = [{ tool, required: true, ok, version }];
    const result = { scope, platform: process.platform, status: tools[0].ok ? "ready" : "needs-attention", tools,
      advisories: ["This check covers planning only. Use doctor --scope compose for shared installation on Linux or Docker Desktop; legacy media and household adapters remain Linux-only."] };
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${tools[0].ok ? "OK" : "MISSING"} ${tools[0].tool}: ${tools[0].version}`);
      for (const advisory of result.advisories) console.log(`ADVISORY ${advisory}`);
    }
    if (result.status !== "ready") process.exitCode = 1;
    return;
  }
  let inotifyLimit: number | null = null;
  if (process.platform === "linux") {
    try {
      const value = Number(readFileSync("/proc/sys/fs/inotify/max_user_instances", "utf8").trim());
      if (Number.isSafeInteger(value) && value > 0) inotifyLimit = value;
    } catch {
      // A missing procfs entry is advisory, not a media prerequisite failure.
    }
  }
  const tools = [
    { tool: "Node.js 20.12+", required: true, ok: Number(process.versions.node.split(".")[0]) > 20 || (Number(process.versions.node.split(".")[0]) === 20 && Number(process.versions.node.split(".")[1]) >= 12), version: process.version },
    { tool: "Linux media host", required: true, ok: process.platform === "linux", version: process.platform },
    check(["bun", "--version"], "Bun 1.4+ media runner", true),
    check(["bash", "--version"], "GNU Bash 4+", true),
    check(["curl", "--version"], "curl API transport", true),
    check(["openssl", "version"], "OpenSSL credential generation", true),
    check(["flock", "--version"], "flock run locks", true),
    check(["realpath", "--version"], "GNU realpath", true),
    check(["stat", "--version"], "GNU stat", true),
    check(["find", "--version"], "GNU find", true),
    check(["mktemp", "--version"], "GNU mktemp", true),
    check(["awk", "BEGIN { print \"available\" }"], "awk", true),
    check(["docker", "compose", "version", "--short"], "Docker Compose", true),
    check(["docker", "info", "--format", "{{.ServerVersion}}"], "Docker daemon access", true),
    check(["docker", "buildx", "version"], "Docker Buildx for household image resolution", false),
    check(["agent-browser", "--version"], "agent-browser private HTTPS support", false),
  ];
  const browser = tools.find((entry) => entry.tool === "agent-browser private HTTPS support");
  if (browser?.ok) {
    const help = spawnSync("agent-browser", ["--help"], {
      encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "pipe"],
    });
    if (help.status !== 0 || !`${help.stdout}${help.stderr}`.includes("--ca-cert")) {
      browser.ok = false;
      browser.version += " (missing --ca-cert)";
    }
  }
  const certutil = spawnSync("certutil", ["-H"], {
    encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "pipe"],
  });
  const certutilAvailable = !certutil.error && /-A\s/.test(`${certutil.stdout}${certutil.stderr}`);
  tools.push({
    tool: "NSS certutil for private HTTPS browser trust", required: false,
    ok: certutilAvailable, version: certutilAvailable ? "available" : "unavailable",
  });
  const bash = tools.find((entry) => entry.tool === "GNU Bash 4+");
  if (bash && !/^GNU bash, version [4-9]\./.test(bash.version)) bash.ok = false;
  const bun = tools.find((entry) => entry.tool === "Bun 1.4+ media runner");
  if (bun) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(bun.version);
    if (!match || Number(match[1]) < 1 || (Number(match[1]) === 1 && Number(match[2]) < 4)) {
      bun.ok = false;
    }
  }
  const advisories: string[] = [];
  const buildx = tools.find((entry) => entry.tool === "Docker Buildx for household image resolution");
  if (!buildx?.ok) {
    advisories.push("Docker Buildx is needed for bundle init --resolve-images. Without it, supply four pre-reviewed immutable image references instead.");
  }
  if (!browser?.ok) {
    advisories.push("Vaultwarden private-HTTPS signup needs agent-browser with --ca-cert. Install or upgrade it before the browser step; an installed older version is insufficient.");
  }
  if (!certutilAvailable) {
    advisories.push("agent-browser --ca-cert needs NSS certutil (Debian/Ubuntu: libnss3-tools) to trust the private Caddy CA in its isolated browser session.");
  }
  if (inotifyLimit !== null && inotifyLimit <= 128) {
    advisories.push(`Inotify instances per user: ${inotifyLimit}. Jellyfin can fail to watch libraries or return 503 when this host limit is exhausted. Check its logs before changing the host; a host administrator can temporarily run sudo sysctl -w fs.inotify.max_user_instances=512, then retry. This affects every container and resets on reboot.`);
  }
  const result = { scope, platform: process.platform, status: tools.every((entry) => !entry.required || entry.ok) ? "ready" : "needs-attention", tools, advisories };
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const entry of tools) {
      let label = "OK";
      if (!entry.ok && entry.required) label = "MISSING";
      if (!entry.ok && !entry.required) label = "OPTIONAL";
      console.log(`${label} ${entry.tool}: ${entry.version}`);
    }
    if (result.status === "ready") console.log("Core setup tools are ready. Check optional browser/HTTPS advisories before Vaultwarden signup; this does not verify any app or deployment.");
    else console.log("Fix required items before full-stack setup. If Docker alone failed, check the daemon, selected context, socket permissions, and any sandbox restriction. Catalog planning needs Node.js only; media-only setup does not need Buildx.");
    for (const advisory of advisories) console.log(`ADVISORY ${advisory}`);
  }
  if (result.status !== "ready") process.exitCode = 1;
}

function help(topic?: string) {
  const usage = `self-host — your self-hosting control panel

  self-host                         Open the control panel in an interactive terminal
  interactive                       Open the control panel explicitly (requires a TTY)
  doctor --scope plan --json         Check planning prerequisites
  catalog recipes --json            Browse available recipes and setup requirements
  catalog compatibility --json      Show source coverage and verified compatibility separately
  app shared plan                   Review apps in one Compose project
  app shared apply                  Apply the unchanged plan with its exact approval
  app shared setup                  Review or resume deterministic account and API-key setup
  app shared status --live          Inspect saved apps and documented live checks
  app shared start|stop             Start or stop selected saved apps with reviewed approval
  app shared handoff                Locate private credentials; --show explicitly exports them
  app shared homarr-plan            Review integrations, widgets, app links and the stack recap
  app shared homarr-trust-plan      Review adding the exact owned HTTPS root CA to Homarr server trust
  app shared homarr-trust-apply     Apply exact CA trust approval; reconcile uncertain writes read-only
  app shared homarr-apply           Publish the approved Homarr plan
  app shared homarr-status --live   Read back the dashboard and check supported integrations
  target list                       Discover running WSL or Lima deployment hosts
  app --help                        Show full app/shared command arguments
  help legacy                       Show older per-app, media and bundle commands

Shared commands require --project-root ABSOLUTE --project-id ID.
Plan, apply and setup select apps with repeated --app APP flags. Mutations require
the exact reviewed --approve token; setup actions may need --approve-step tokens.
The control panel guides these choices, preserves data on removal, and offers
updates, app connections and optional Homarr/MCP setup.

Recipes and setup adapters are available across the catalog, with app-specific
inputs and coverage gaps. Source coverage is not live acceptance. The AI skill
wraps this same CLI for choices and exceptional repairs; it is not required.`;
  const legacyUsage = `self-host — older per-app, media and bundle commands

  --interactive|interactive                Guided terminal planner (requires a TTY)
  doctor [--scope plan|compose|media] [--json]  Check planning, shared Docker, or legacy Linux prerequisites
  host inspect|inspect-host --output ABSOLUTE [--limit COUNT] [--check-tcp-port PORT ...]
  app image --id ID [--json] (read-only pinned-image and architecture resolution)
  app plan --id ID --project-root ABSOLUTE --image IMAGE@sha256:DIGEST --port PORT [--connect-homarr] [--json] (read-only)
  app plan|apply --id immich ... [--email FIRST_ADMIN_EMAIL] [--name FIRST_ADMIN_NAME] (pass identical values to plan and apply)
  app apply --id ID --project-root ABSOLUTE --image IMAGE@sha256:DIGEST --port PORT [--connect-homarr] --approve EXACT_TOKEN
  app status|info|resume --id ID --project-root ABSOLUTE [--live for status/info] [--approve SAVED_TOKEN for resume]
  app batch status|info --project-root ABSOLUTE [--json] (saved mixed-app jobs; app acceptance is separate)
  app batch step-plan --project-root ABSOLUTE --job uptime-kuma [--json] (review the next credential-preparation step)
  app batch step --project-root ABSOLUTE --job uptime-kuma --approve EXACT_TOKEN [--json] (prepare credentials; login stays unverified)
  app up|down --id ID --project-root ABSOLUTE --approve EXACT_STATUS_TOKEN
  app onboard --id immich --project-root ABSOLUTE --approve EXACT_STATUS_TOKEN
  app close-plan --id immich --project-root ABSOLUTE [--json]
  app close-setup --id immich --project-root ABSOLUTE --approve EXACT_CLOSE_PLAN_TOKEN
  app account-plan|account-prepare --id ID --project-root ABSOLUTE [--username NAME] [--adopt-existing] [--approve EXACT_TOKEN for prepare]
  app handoff --id ID --project-root ABSOLUTE [--show] [--json]
  app shared homarr-plan|homarr-apply --project-root ABSOLUTE --project-id ID --app APP [--app APP ...] [--input ntfy.topic=TOPIC] [--approve TOKEN for apply] --json
  app shared homarr-trust-plan|homarr-trust-apply --project-root ABSOLUTE --project-id ID --app APP [--approve TOKEN for apply] --json
  app shared acceptance-begin|acceptance-finish --project-root ABSOLUTE --project-id ID --app ntfy [--approve TOKEN] [--approve-step TOKEN] --json
  app homarr-input --id APP --project-root ABSOLUTE --icon-url HTTPS_URL [--href HTTP_OR_HTTPS_URL] [--json]
  app homarr-immich-input --id immich --project-root ABSOLUTE [--json] (private integration input and accepted-service evidence; key and attachment separate)
  app homarr-paperless-input --id paperless-ngx --project-root ABSOLUTE [--json] (private native input from exact connected app and verified token)
  app homarr-immich-key-plan --id immich --project-root ABSOLUTE [--json] (review exact limited-key permission and approval)
  app homarr-immich-key-create --id immich --project-root ABSOLUTE --approve EXACT_TOKEN [--json] (one-time secret to private file; attachment separate)
  target list [--json]                   Discover running WSL or Lima guests without starting them
  target launch --name RUNNING_GUEST     Open the installed self-host TUI inside that exact guest
  config init --project-root ABSOLUTE --profile media --run-id ID --username NAME [--credential-handoff yes|no (default yes)] [--media-bind-mode host-only] [--media-port-start 20000..44993] [--media-network-subnets DEFAULT_CIDR,WEB_CIDR]
  config show --project-root ABSOLUTE
  config set runId|username|credentialHandoff|mediaBindMode|mediaPortStart|mediaNetworkSubnets VALUE --project-root ABSOLUTE
  config preferences init|show|set ... --project-root ABSOLUTE
  immich plan --project-root ABSOLUTE --input ABSOLUTE --run-id ID --account-file ABSOLUTE
  immich apply|bootstrap|close-setup --project-root ABSOLUTE --input ABSOLUTE --run-id ID --account-file ABSOLUTE --approve TOKEN
  immich accept --project-root ABSOLUTE --input ABSOLUTE --run-id ID --account-file ABSOLUTE --integration-url ORIGIN --acceptance-file ABSOLUTE
  immich homarr-key plan|create --project-root ABSOLUTE --input ABSOLUTE --run-id ID --account-file ABSOLUTE --acceptance-file ABSOLUTE --key-file ABSOLUTE [--approve TOKEN]
  immich status --project-root ABSOLUTE --input ABSOLUTE
  vaultwarden local-https init|plan|apply|status ... (run vaultwarden help for phase flags)
  vaultwarden prepare --project-root ABSOLUTE --run-id ID --account-file ABSOLUTE --input ABSOLUTE --https-plan ABSOLUTE
  vaultwarden apply|close-registration|status ... (run vaultwarden help for phase flags)
  vaultwarden signup plan|apply|status ... (one bounded first-account attempt; run vaultwarden help)
  homarr attach plan|apply|status --input ABSOLUTE --api-key-file ABSOLUTE [--repair-existing-link] [--approve TOKEN]
  homarr attach immich plan|apply|status|layout-plan|layout-apply --input ABSOLUTE --api-key-file ABSOLUTE --immich-api-key-file ABSOLUTE --acceptance-file ABSOLUTE [--approve TOKEN]
  homarr attach uptime-kuma plan|apply|status --input ABSOLUTE --api-key-file ABSOLUTE [--slug-file ABSOLUTE] [--uptime-api-key-file ABSOLUTE] [--approve TOKEN]
  homarr attach paperless plan|apply|status --input ABSOLUTE --api-key-file ABSOLUTE --paperless-api-key-file ABSOLUTE [--approve TOKEN]
  homarr mcp prepare|status|verify|fragment|serve ... (run homarr mcp help; client merge has a separate approval)
  docmost plan|recover-plan|apply|status --project-root ABSOLUTE --input ABSOLUTE --run-id ID ...
  docmost owner plan|apply|status --project-root ABSOLUTE --input ABSOLUTE --run-id ID ...
  docmost accept plan|apply|status|verify --project-root ABSOLUTE --input ABSOLUTE --run-id ID [--account-file ABSOLUTE (plan/apply/verify)] [--approve TOKEN (apply)]
  docmost db-export plan|apply|status --project-root ABSOLUTE --input ABSOLUTE --run-id ID --account-file ABSOLUTE --destination PRIVATE_DIR --output NEW_FILE.dump [--approve TOKEN (apply)]
  docmost recover-postgres-parent plan|apply ...; docmost repair-pgdata plan|apply ...
  docmost browser-password --project-root ABSOLUTE --run-id ID --ref @eN [--ref @eN] [--browser-bin ABSOLUTE]
  browser fill|capture-api-key|login --project-root ABSOLUTE --run-id ID --service APP --origin PRIVATE_ORIGIN ...
  bundle begin --project-root ABSOLUTE --id ID --email EMAIL --name NAME --vaultwarden-origin HTTPS_ORIGIN --https-route-owner OWNER --https-tls-owner OWNER --resolve-images [--media-run-id EXISTING_CLI_RUN] (inspect and plan only)
  bundle init --project-root ABSOLUTE --id ID ... --resolve-images [--media-port-start 20000..44993] [--media-network-subnets DEFAULT_CIDR,WEB_CIDR] [--immich-network-subnet CIDR] [--docmost-network-subnet CIDR] [--vaultwarden-network-subnet CIDR] (run bundle init alone for required choices)
  bundle approvals --project-root ABSOLUTE [--input ABSOLUTE] (read-only decision inbox)
  bundle plan|next|run|status|info --project-root ABSOLUTE [--input ABSOLUTE] ...
  bundle parallel-plan --project-root ABSOLUTE [--input ABSOLUTE] --host-inspection FRESH_REPORT
  bundle parallel-apply --project-root ABSOLUTE [--input ABSOLUTE] --host-inspection FRESH_REPORT --approve BUNDLE_TOKEN --immich-approve TOKEN --docmost-approve TOKEN
  bundle up|down|stage|handoff --project-root ABSOLUTE --input ABSOLUTE ...
  bundle stage --service media --phase resume --from STAGE --approve BUNDLE_TOKEN --stage-approve MEDIA_DIGEST ...
  bundle homarr-inputs plan|apply --project-root ABSOLUTE --input ABSOLUTE [--shared-caddy-input ABSOLUTE] [--approve TOKEN]
  bundle homarr-attach status --project-root ABSOLUTE --input ABSOLUTE
  bundle caddy-inputs plan|apply --project-root ABSOLUTE --input ABSOLUTE --host-inspection ABSOLUTE [--caddy-image DIGEST_REF] [--vaultwarden-network-subnet CIDR] [--ingress-network-subnet CIDR] [--approve TOKEN]
  bundle https-ready --project-root ABSOLUTE --input ABSOLUTE --approve BUNDLE_TOKEN --https-route-status configured --https-trust verified-for-intended-client
  bundle journey start|status --project-root ABSOLUTE --id ID
  bundle journey finish --project-root ABSOLUTE --id ID --input ABSOLUTE
  bundle benchmark --project-root ABSOLUTE --input ABSOLUTE
  bundle finalize scaffold --project-root ABSOLUTE --input ABSOLUTE
  bundle finalize record --project-root ABSOLUTE --input ABSOLUTE --subject SERVICE|homarr|bundle --check CHECK --observed-at ISO_UTC --observer ID --status pass --redacted true --reference OPAQUE [--reference OPAQUE ...] (bundle cleanup also needs four cleanup-state flags)
  bundle finalize --project-root ABSOLUTE --input ABSOLUTE --evidence ABSOLUTE
  bundle finalize status --project-root ABSOLUTE --input ABSOLUTE --evidence ABSOLUTE (read-only evidence assessment, not a live probe)
  bundle backup plan --project-root ABSOLUTE --input ABSOLUTE --backup-target ABSOLUTE --restore-target ABSOLUTE [--shared-caddy-input ABSOLUTE]
  bundle route-network --project-root ABSOLUTE --input ABSOLUTE --host-inspection ABSOLUTE --network NAME --approve TOKEN [--service vaultwarden|media-web]
  caddy-private plan --project-root ABSOLUTE --input ABSOLUTE
  caddy-private apply --project-root ABSOLUTE --input ABSOLUTE --approve TOKEN
  caddy-private status --project-root ABSOLUTE (--input ABSOLUTE | --checkpoint ID)
  caddy-private up|down --project-root ABSOLUTE (--input ABSOLUTE | --checkpoint ID) --approve TOKEN
  doctor
  info --project-root ABSOLUTE [--input EXACT_BUNDLE_INPUT | --profile media | --json/--live for one app] (also detects app-only batches)
  status --project-root ABSOLUTE [--input EXACT_BUNDLE_INPUT | --profile media | --json/--live for one app] (also detects app-only batches)
  up|down --project-root ABSOLUTE [--input EXACT_BUNDLE_INPUT --approve TOKEN [--local-https-input ABSOLUTE --local-https-run-id ID] | --profile media]
  up --project-root ABSOLUTE --approve DIGEST [--defer-indexer] --firewall-scope router-private|docker-aware-private (first all-interface apply)
  resume --project-root ABSOLUTE --approve DIGEST --from STAGE [--defer-indexer]
  install media access-proxy plan|apply --project-root ABSOLUTE --run-id ID --service NAME --origin HTTPS_ORIGIN [--private-dns-confirmed] [--approve sha256:DIGEST]
  install media reconcile-links|reconcile-notebook plan|apply --project-root ABSOLUTE --run-id ID --board NAME [--approve sha256:DIGEST]
  plan [goal...] --project-root ABSOLUTE [--compose] [--select role=app] [--json]
  catalog menu|list|search|show ...

These commands retain existing legacy owners. New projects use the shared
Compose workflow. First-account, application and Homarr acceptance remain
separate; inspect the selected app's current setup requirements.`;
  if (!topic) {
    console.log(usage);
    return;
  }
  if (topic === "legacy") {
    console.log(legacyUsage);
    return;
  }
  let commands = usage.split("\n").filter((line) => line.startsWith(`  ${topic} `) || line === `  ${topic}`);
  if (commands.length === 0) {
    commands = legacyUsage.split("\n").filter((line) => line.startsWith(`  ${topic} `) || line === `  ${topic}`);
  }
  if (commands.length === 0) {
    help();
    return;
  }
  console.log(`self-host ${topic}\n\n${commands.join("\n")}\n\nSee the installed package README for inputs and approval steps.`);
}

export async function command(input: string[], mediaCommand: MediaCommand, immichCommand: ImmichCommand,
  vaultwardenCommand: VaultwardenCommand, homarrAttachCommand: HomarrAttachCommand,
  docmostCommand: DocmostCommand, bundleCommand: BundleCommand, homarrMcpCommand?: HomarrMcpCommand) {
  if (input.length === 1 && (input[0] === "--version" || input[0] === "version")) {
    const metadata = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    console.log(metadata.version);
    return;
  }
  if ((input[0] === "help" && input[1] === "vaultwarden" && input.length === 2)
    || (input[0] === "vaultwarden" && input.length === 2 && ["help", "--help"].includes(input[1]))) {
    await vaultwardenCommand(["help"]);
    return;
  }
  if (input[0] === "help" && input.length === 2) { help(input[1]); return; }
  if (input.length === 0 || input[0] === "help" || input[0] === "--help") { help(); return; }
  if (input.length === 2 && (input[1] === "help" || input[1] === "--help")) {
    help(input[0]);
    return;
  }
  if (input.length === 2 && input[0] === "bundle" && input[1] === "init") {
    help("bundle");
    console.log("\nBundle init choices: --project-root, --id, --email, --name, --host-inspection; --resolve-images or four verified immutable image references; and --vaultwarden-origin, --https-route-owner, --https-tls-owner. Optional: --username, --host-ip, selected ports, --media-bind-mode host-only, --media-port-start FIRST_OF_SEVEN, --media-network-subnets DEFAULT_CIDR,WEB_CIDR, private network subnets for Immich/Docmost/Vaultwarden, existing media run, --homarr-network for Immich, --docmost-network for Docmost, and --vaultwarden-route-network.");
    return;
  }
  if (input[0] === "immich") {
    if (input[1] === "apply") requireAppCliSetup("immich");
    if (input[1] === "accept") {
      await immichAcceptCommand(input.slice(2));
      return;
    }
    if (input[1] === "homarr-key") {
      await immichHomarrKeyCommand(input.slice(2));
      return;
    }
    await immichCommand(input.slice(1));
    return;
  }
  if (input[0] === "vaultwarden") {
    if (input[1] === "apply") requireAppCliSetup("vaultwarden");
    await vaultwardenCommand(input.slice(1));
    return;
  }
  if (input[0] === "homarr") {
    if (input[1] === "mcp") {
      if (!homarrMcpCommand) fail("Homarr MCP command is not installed");
      await homarrMcpCommand(input.slice(2));
      return;
    }
    if (input[1] !== "attach") fail("Use homarr attach or homarr mcp");
    if (input.length === 2 || (input.length === 3 && ["help", "--help"].includes(input[2]))) {
      help("homarr");
      return;
    }
    await homarrAttachCommand(input.slice(2));
    return;
  }
  if (input[0] === "docmost") {
    if (input[1] === "apply") requireAppCliSetup("docmost");
    await docmostCommand(input.slice(1));
    return;
  }
  if (input[0] === "bundle") {
    if (["begin", "init"].includes(input[1])) {
      await requireInstallPlan("household");
    }
    if (input[1] === "backup") {
      await bundleBackupCommand(input.slice(2));
      return;
    }
    if (input[1] === "finalize") {
      await bundleFinalizeCommand(input.slice(1));
      return;
    }
    await bundleCommand(input.slice(1), { media: mediaCommand, immich: immichCommand, vaultwarden: vaultwardenCommand, docmost: docmostCommand });
    return;
  }
  if (input[0] === "caddy-private") {
    await caddyPrivateCommand(input.slice(1));
    return;
  }
  const json = input.includes("--json");
  const appLifecycle = ["info", "status", "up", "down", "resume"].includes(input[0]);
  if (json && input[0] !== "doctor" && !appLifecycle) {
    fail("--json is supported by doctor and one saved app; catalog and plan have their own JSON output");
  }
  if (json && input[0] === "doctor") input = input.filter((value) => value !== "--json");
  const { args, flags } = parse(input);
  const action = args[0];
  if (flags["--defer-indexer"] && action !== "up" && action !== "resume") {
    fail("--defer-indexer applies only to an exact approved media apply or resume");
  }
  if (action === "doctor") {
    only(flags, ["--scope"]);
    if (args.length !== 1) fail("doctor takes no positionals");
    const scope = flags["--scope"] ?? "compose";
    if (scope !== "plan" && scope !== "compose" && scope !== "media") fail("--scope must be plan, compose, or media");
    doctor(json, scope);
    return;
  }
  if (action === "config" && args[1] === "init") await requireInstallPlan("media");
  const paths = await project(flags["--project-root"], action === "config" && args[1] === "init");
  if (action === "config" && args[1] === "init") await assertPackagedCatalogProject(paths.root);
  if (action === "config") {
    const mode = args[1];
    if (mode === "init") {
      only(flags, ["--project-root", "--profile", "--run-id", "--username", "--credential-handoff", "--media-bind-mode", "--media-port-start", "--media-network-subnets"]);
      if (args.length !== 2 || flags["--profile"] !== "media") fail("Only --profile media can currently be installed");
      const choice = flags["--credential-handoff"] ?? "yes";
      if (choice !== "yes" && choice !== "no") fail("--credential-handoff must be yes or no");
      const bindChoice = flags["--media-bind-mode"];
      if (bindChoice && bindChoice !== "host-only" && bindChoice !== "all-interfaces") {
        fail("--media-bind-mode accepts host-only or all-interfaces");
      }
      const config: Record<string, unknown> = { schemaVersion: 1, profile: "media", runId: flags["--run-id"], username: flags["--username"], credentialHandoff: choice === "yes" };
      if (bindChoice === "host-only") config.mediaBindMode = "host-only";
      if (flags["--media-port-start"]) config.mediaPortStart = mediaPortStart(flags["--media-port-start"]);
      if (flags["--media-network-subnets"]) config.mediaNetworkSubnets = parseMediaNetworkSubnets(flags["--media-network-subnets"]);
      validate(config);
      await createConfig(paths, config);
      console.log(`Saved private CLI config at ${paths.file}. Next: self-host up --project-root ${paths.root}`);
      return;
    }
    if (mode === "show") {
      only(flags, ["--project-root"]);
      if (args.length !== 2) fail("config show takes no other arguments");
      console.log(JSON.stringify(await readConfig(paths), null, 2));
      return;
    }
    if (mode === "set") {
      only(flags, ["--project-root"]);
      if (args.length !== 4) fail("Use config set FIELD VALUE");
      const current = await readConfig(paths);
      if (existsSync(join(paths.local, "media-harness", ".sessions", current.runId))) fail("This run was prepared; change its config by choosing a new project instead");
      const next = { ...current };
      if (args[2] === "runId") next.runId = args[3];
      else if (args[2] === "username") next.username = args[3];
      else if (args[2] === "credentialHandoff" && ["yes", "no"].includes(args[3])) next.credentialHandoff = args[3] === "yes";
      else if (args[2] === "mediaBindMode" && args[3] === "host-only") next.mediaBindMode = "host-only";
      else if (args[2] === "mediaBindMode" && args[3] === "all-interfaces") delete next.mediaBindMode;
      else if (args[2] === "mediaPortStart" && args[3] === "auto") delete next.mediaPortStart;
      else if (args[2] === "mediaPortStart") next.mediaPortStart = mediaPortStart(args[3]);
      else if (args[2] === "mediaNetworkSubnets" && args[3] === "auto") delete next.mediaNetworkSubnets;
      else if (args[2] === "mediaNetworkSubnets") next.mediaNetworkSubnets = parseMediaNetworkSubnets(args[3]);
      else fail("Supported fields: runId, username, credentialHandoff, mediaBindMode (host-only or all-interfaces), mediaPortStart (20000 through 44993 or auto), mediaNetworkSubnets (two private CIDRs or auto)");
      await updateConfig(paths, next);
      console.log(`Updated ${args[2]} in ${paths.file}`);
      return;
    }
    fail("Use config init, show, or set");
  }
  if (["info", "status", "up", "down", "resume"].includes(action)) {
    if (args.length !== 1) fail(`self-host ${action} takes no positional arguments`);
    const mediaOnly = flags["--profile"] === "media";
    if (flags["--profile"] && !mediaOnly) fail("Lifecycle --profile accepts only media");
    if (mediaOnly && flags["--input"]) fail("Choose either --profile media or one exact household --input");
    const candidates = mediaOnly ? [] : await householdInputs(paths);
    let bundleInput = flags["--input"];
    if (!bundleInput && candidates.length > 1) {
      fail("This project has multiple household bundles. Select one exact --input path");
    }
    if (!bundleInput && candidates.length === 1) {
      if (action === "up" || action === "down") {
        fail(`This project has a household bundle. Use self-host ${action} --project-root ${paths.root} --input ${candidates[0]} --approve TOKEN; include the exact local-HTTPS input and run ID when Caddy should share this lifecycle. --profile media requires a separate media-only config.`);
      }
      if (action === "resume") {
        fail(`This project has a household bundle. Use self-host bundle next --project-root ${paths.root} --input ${candidates[0]} to resume its staged setup, or bundle stage --service media --phase resume for its exact media run.`);
      }
      bundleInput = candidates[0];
    }
    if (bundleInput) {
      if (!flags["--input"] && ((await savedAppIds(paths.root)).length > 0
        || existsSync(join(paths.local, "app-batch.json")))) {
        fail("This project has both household bundle and app checkpoints. Select --input EXACT_BUNDLE_INPUT, self-host app batch status, or self-host app status --id EXACT_APP_ID; no lifecycle was selected.");
      }
      if (action === "resume") fail("Household bundles resume with bundle next or bundle run, not media resume");
      only(flags, ["--project-root", "--input", "--approve", "--local-https-input", "--local-https-run-id"]);
      const bundleArgs = [action, "--project-root", paths.root, "--input", bundleInput];
      if (flags["--approve"]) bundleArgs.push("--approve", flags["--approve"]);
      if (flags["--local-https-input"]) bundleArgs.push("--local-https-input", flags["--local-https-input"]);
      if (flags["--local-https-run-id"]) bundleArgs.push("--local-https-run-id", flags["--local-https-run-id"]);
      await bundleCommand(bundleArgs, { media: mediaCommand, immich: immichCommand, vaultwarden: vaultwardenCommand, docmost: docmostCommand });
      return;
    }
    if (!mediaOnly && !bundleInput) {
      const appIds = await savedAppIds(paths.root);
      const batchLedger = existsSync(join(paths.local, "app-batch.json"));
      const hasAppOwner = appIds.length > 0 || batchLedger;
      if (hasAppOwner && existsSync(paths.file)) {
        fail("This project has both media and app checkpoints. Use --profile media or self-host app status --id EXACT_APP_ID; no lifecycle was selected.");
      }
      if (hasAppOwner && existsSync(join(paths.local, "stack.json"))) {
        fail("This project has both legacy stack and app checkpoints. Select the exact owner; no lifecycle was selected.");
      }
      if (batchLedger) {
        if (action === "info" || action === "status") {
          only(flags, ["--project-root", "--json"]);
          const batchArgs = ["batch", action, "--project-root", paths.root];
          if (flags["--json"]) batchArgs.push("--json");
          await appCommand(batchArgs);
          return;
        }
        fail(`This project has an app batch. Use self-host app batch status --project-root ${paths.root}, then choose an exact app lifecycle approval or app batch resume-plan for one pending job; no whole-batch lifecycle was selected.`);
      }
      if (appIds.length > 1) {
        fail(`This project has several saved apps (${appIds.join(", ")}). Use self-host app status --id EXACT_APP_ID --project-root ${paths.root}; no lifecycle was selected.`);
      }
      if (appIds.length === 1) {
        only(flags, ["--project-root", "--approve", "--json", "--live"]);
        const appArgs = [action, "--id", appIds[0], "--project-root", paths.root];
        if (flags["--approve"]) appArgs.push("--approve", flags["--approve"]);
        if (flags["--json"]) appArgs.push("--json");
        if (flags["--live"]) appArgs.push("--live");
        await appCommand(appArgs);
        return;
      }
    }
  }
  only(flags, ["--project-root", "--profile", "--approve", "--from", "--firewall-scope", "--defer-indexer"]);
  if (args.length !== 1 || !["info", "status", "up", "down", "resume"].includes(action)) fail("Unknown command. Run self-host help");
  if (action !== "up" && flags["--firewall-scope"]) fail("Only the first all-interface media apply accepts --firewall-scope");
  if (flags["--profile"] === "media" && !existsSync(paths.file)) {
    const bundles = await householdInputs(paths);
    if (bundles.length === 1) {
      let command = `self-host ${action} --project-root ${paths.root} --input ${bundles[0]}`;
      if (action === "resume") command = `self-host bundle next --project-root ${paths.root} --input ${bundles[0]}`;
      if (action === "up" || action === "down") command += " --approve TOKEN";
      fail(`No CLI config for media-only mode. This is a household project; use ${command}. --profile media is only for a separate media-only config.`);
    }
  }
  const config = await readConfig(paths);
  const runArgs = ["--project-root", paths.root, "--run-id", config.runId];
  const runPath = join(paths.local, "media-harness", ".sessions", config.runId);
  if (action === "info") {
    console.log(JSON.stringify({ config, projectRoot: paths.root, prepared: existsSync(runPath) }, null, 2));
    if (existsSync(runPath)) await mediaCommand(["info", ...runArgs]);
    return;
  }
  if (action === "status") {
    if (!existsSync(runPath)) { console.log("Not prepared. Run self-host up to create a private plan."); return; }
    await mediaCommand(["status", ...runArgs]);
    return;
  }
  if (action === "up") {
    if (flags["--from"]) fail("Use resume --from STAGE after a targeted repair");
    if (!existsSync(runPath)) {
      if (flags["--approve"] || flags["--firewall-scope"] || flags["--defer-indexer"]) fail("No private run exists yet. Run self-host up once to prepare and inspect its plan");
      const handoff = config.credentialHandoff ? "yes" : "no";
      const prepareArgs = ["prepare", ...runArgs, "--username", config.username, "--credential-handoff", handoff];
      if (config.mediaBindMode === "host-only") prepareArgs.push("--bind-mode", "host-only");
      if (config.mediaPortStart !== undefined) prepareArgs.push("--port-start", String(config.mediaPortStart));
      if (config.mediaNetworkSubnets !== undefined) prepareArgs.push("--network-subnets", `${config.mediaNetworkSubnets.default},${config.mediaNetworkSubnets.web}`);
      await mediaCommand(prepareArgs);
      return;
    }
    if (flags["--approve"]) {
      const applyArgs = ["apply", ...runArgs, "--approve", flags["--approve"]];
      if (flags["--firewall-scope"]) applyArgs.push("--firewall-scope", flags["--firewall-scope"]);
      if (flags["--defer-indexer"]) applyArgs.push("--defer-indexer");
      await mediaCommand(applyArgs);
      return;
    }
    if (flags["--firewall-scope"]) fail("--firewall-scope belongs with the exact first-apply --approve token");
    if (flags["--defer-indexer"]) fail("--defer-indexer belongs with an exact approved apply or resume");
    await mediaCommand(["up", ...runArgs]);
    return;
  }
  if (action === "resume") {
    if (!flags["--approve"] || !flags["--from"]) fail("resume needs --approve DIGEST and --from STAGE");
    const resumeArgs = ["resume", ...runArgs, "--approve", flags["--approve"], "--from", flags["--from"]];
    if (flags["--defer-indexer"]) resumeArgs.push("--defer-indexer");
    await mediaCommand(resumeArgs);
    return;
  }
  if (flags["--approve"] || flags["--from"] || flags["--defer-indexer"]) fail("down does not use approval, resume, or verification-defer flags");
  if (!existsSync(runPath)) { console.log("Nothing to stop; this project has no prepared media run."); return; }
  await mediaCommand(["down", ...runArgs]);
}
