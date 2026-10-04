import { isAbsolute, join, parse, resolve } from "node:path";
import { isIP } from "node:net";
import { bundledCatalogPlan } from "./interactive-catalog.ts";
import { exactHouseholdParallelGraph } from "./lib/household-graph.ts";

export type HouseholdChoices = {
  root: string;
  id: string;
  username: string;
  email: string;
  name: string;
  vaultwardenOrigin: string;
  routeOwner: string;
  tlsOwner: string;
  ports?: { immich: number; docmost: number; vaultwarden: number; mediaStart?: number };
  adoptedMedia?: AdoptedMediaSelection;
};

export type HouseholdPorts = { immich: number; docmost: number; vaultwarden: number; mediaStart: number };
export type AdoptedMediaSelection = { runId: string; username: string; bind: "127.0.0.1" | "0.0.0.0"; ports: number[]; approvalDigest: string };
export type MediaWebHandoff = {
  bundle: string;
  approval: string;
  network: string;
  ports: [number, number];
  reportPath: string;
  inspectionArgs: string[];
  routeArgs: string[];
};

type HouseholdPlan = {
  kind: "household-bundle-plan";
  bundle: string;
  projectRoot: string;
  input: string;
  approval: string;
  mediaExposure: string;
  mediaPorts: number[] | "automatic";
  stages: Array<{ service: string; purpose: string; acceptance: string }>;
};

type HouseholdInbox = {
  kind?: unknown;
  status?: unknown;
  mutation?: unknown;
  executionPerformed?: unknown;
  bundle?: unknown;
  projectRoot?: unknown;
  bundleApproval?: unknown;
  bundleReview?: { mediaExposure?: unknown; mediaPorts?: unknown; mediaSelection?: {
    mode?: unknown; runId?: unknown; bind?: unknown; source?: unknown; approvalDigest?: unknown;
  } };
  current?: {
    checkpoint?: unknown;
    service?: unknown;
    command?: unknown;
    review?: unknown;
    reviewCommand?: unknown;
    adapterApproval?: unknown;
    runAfterReview?: unknown;
  };
};

const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const USERNAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$/;
const OWNER = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const EMAIL = /^[^@\s]+@[^@.\s]+(?:\.[^@.\s]+)+$/;

function object(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, any>;
}

function bundleIdentity(inboxValue: unknown, root: string, input: string): { bundle: string; approval: string; runId: string } | null {
  const inbox = object(inboxValue);
  const review = object(inbox?.bundleReview);
  const selection = object(review?.mediaSelection);
  if (inbox?.kind !== "household-bundle-approvals" || inbox.status !== "review-required"
    || inbox.mutation !== false || inbox.executionPerformed !== false || inbox.projectRoot !== root
    || !ID.test(String(inbox.bundle)) || input !== join(root, ".selfhost", "bundles", inbox.bundle, "household-bundle.json")
    || typeof inbox.bundleApproval !== "string"
    || !new RegExp(`^BUNDLE:${inbox.bundle}:[0-9a-f]{64}$`).test(inbox.bundleApproval)
    || selection?.mode !== "create" || selection.bind !== "127.0.0.1"
    || selection.source !== "bundle-selection" || selection.approvalDigest !== null
    || typeof selection.runId !== "string" || !ID.test(selection.runId)
    || !reviewedHouseholdExposure(review, false)) return null;
  return { bundle: inbox.bundle, approval: inbox.bundleApproval, runId: selection.runId };
}

export function householdMediaWebHandoff(inboxValue: unknown, nextValue: unknown,
  root: string, input: string): MediaWebHandoff | null {
  const identity = bundleIdentity(inboxValue, root, input);
  const inbox = object(inboxValue);
  const next = object(nextValue);
  const action = object(next?.next);
  const inspection = object(action?.inspection);
  const after = object(action?.afterInspection);
  if (!identity || inbox?.current?.checkpoint !== "bind-media-web"
    || next?.schemaVersion !== 1 || next.kind !== "household-bundle-next"
    || next.status !== "action-required" || next.mutation !== false || next.executionPerformed !== false
    || next.bundle !== identity.bundle || next.projectRoot !== root
    || action?.checkpoint !== "bind-media-web" || action.service !== "bundle"
    || inspection?.mutation !== "new-owner-only-report" || inspection.overwritesExisting !== false
    || after?.mutation !== "owner-only-bundle-and-app-inputs"
    || after.requiresUnchangedBundleApproval !== true) return null;
  const ports = inspection.checkedTcpPorts;
  if (!Array.isArray(ports) || ports.length !== 2 || ports.some((port) => !Number.isInteger(port)
    || port < 1024 || port > 65535) || ports[0] === ports[1]) return null;
  const reportPath = inspection.output;
  const reportPrefix = join(root, ".selfhost", "bundles", identity.bundle, "host-media-web-");
  if (typeof reportPath !== "string" || !reportPath.startsWith(reportPrefix)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/.test(reportPath.slice(reportPrefix.length))) return null;
  const network = `autostack-${identity.runId}_web`;
  const inspectCommand = ["self-host", "host", "inspect", "--output", reportPath, "--limit", "50",
    "--check-tcp-port", String(ports[0]), "--check-tcp-port", String(ports[1])];
  const routeCommand = ["self-host", "bundle", "route-network", "--service", "media-web",
    "--project-root", root, "--input", input, "--host-inspection", reportPath,
    "--network", network, "--approve", identity.approval];
  if (JSON.stringify(action.command) !== JSON.stringify(inspectCommand)
    || JSON.stringify(after.command) !== JSON.stringify(routeCommand)
    || JSON.stringify(after.planCommand) !== JSON.stringify(["self-host", "bundle", "plan",
      "--project-root", root, "--input", input])) return null;
  return { bundle: identity.bundle, approval: identity.approval, network,
    ports: [ports[0], ports[1]], reportPath, inspectionArgs: inspectCommand.slice(1),
    routeArgs: routeCommand.slice(1) };
}

export function reviewedMediaWebHostReport(value: unknown, network: string, ports: number[]): string {
  const report = object(value);
  const docker = object(report?.runtime?.docker);
  const context = object(report?.runtime?.dockerContext);
  const networks = object(report?.workloads?.dockerNetworks);
  const listeners = object(report?.network?.listeningPorts);
  if (report?.schemaVersion !== 1 || report.mode !== "read-only" || docker?.state !== "running"
    || context?.state !== "observed" || !["default", "rootless"].includes(context.current)
    || networks?.state !== "observed" || networks.truncated !== false || !Array.isArray(networks.items)
    || !networks.items.some((entry: unknown) => object(entry)?.name === network)
    || listeners?.state !== "observed" || !Array.isArray(listeners.items)) {
    throw new Error("The fresh host report did not observe the exact Docker context, media web network, and listeners.");
  }
  if (unavailableHouseholdPorts(report, ports).length !== 0) {
    throw new Error("One of the selected app ports is now in use. Inspect the host before continuing.");
  }
  return context.current;
}

export function householdParallelPorts(value: unknown, bundle: string): [number, number] {
  const info = object(value);
  if (info?.schemaVersion !== 1 || info.kind !== "household-bundle-info" || info.bundle !== bundle
    || !Array.isArray(info.services)) throw new Error("The household links did not match this bundle.");
  const ports: number[] = [];
  for (const name of ["Immich", "Docmost"]) {
    const matches = info.services.filter((entry: unknown) => object(entry)?.name === name);
    if (matches.length !== 1 || typeof matches[0].url !== "string") {
      throw new Error("The household links did not identify both exact app ports.");
    }
    let url: URL;
    try { url = new URL(matches[0].url); }
    catch { throw new Error("An app link is not a valid private HTTP origin."); }
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const octets = host.split(".").map(Number);
    const privateV4 = isIP(host) === 4 && (octets[0] === 10
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168));
    const privateV6 = isIP(host) === 6 && /^(fc|fd)/i.test(host);
    const port = Number(url.port);
    if (url.protocol !== "http:" || url.origin !== matches[0].url || url.username || url.password
      || url.pathname !== "/" || url.search || url.hash
      || !(host === "127.0.0.1" || host === "::1" || privateV4 || privateV6)
      || !Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error("An app link is not one exact selected private HTTP port.");
    }
    ports.push(port);
  }
  if (ports[0] === ports[1]) throw new Error("Immich and Docmost cannot share a host port.");
  return [ports[0], ports[1]];
}

export function householdParallelPlan(value: unknown, inboxValue: unknown,
  root: string, input: string, reportPath: string): { immich: string; docmost: string; network: string } | null {
  const identity = bundleIdentity(inboxValue, root, input);
  const inbox = object(inboxValue);
  const plan = object(value);
  const approvals = object(plan?.adapterApprovals);
  if (!identity || inbox?.current?.checkpoint !== "review-immich-apply"
    || plan?.schemaVersion !== 1 || plan.kind !== "household-bundle-parallel-plan"
    || plan.status !== "ready-for-review" || plan.mutation !== false
    || plan.bundle !== identity.bundle || plan.approval !== identity.approval
    || plan.network !== `autostack-${identity.runId}_web` || plan.hostInspection !== reportPath
    || JSON.stringify(plan.services) !== JSON.stringify(["immich", "docmost"])
    || typeof approvals?.immich !== "string" || typeof approvals.docmost !== "string"
    || !new RegExp(`^APPLY:${identity.bundle}-immich:[0-9a-f]{64}$`).test(approvals.immich)
    || !new RegExp(`^APPLY:${identity.bundle}-docmost:[0-9a-f]{64}$`).test(approvals.docmost)) return null;
  return { immich: approvals.immich, docmost: approvals.docmost, network: plan.network };
}

export function householdParallelAdapterReview(value: unknown, bundle: string,
  service: "immich" | "docmost", port: number, approval: string): string {
  const plan = object(value);
  const compose = object(plan?.compose);
  const project = object(compose?.project);
  const claims = object(compose?.claims);
  const expectedKind = service === "immich" ? "immich-v3.2.2-cli-plan" : "docmost-v0.96.0-cli-plan";
  const actualApproval = service === "immich" ? plan?.approvals?.apply : plan?.approval;
  if (plan?.schemaVersion !== 1 || plan.kind !== expectedKind || plan.status !== "pass"
    || plan.mutation !== false || plan.runId !== `${bundle}-${service}` || actualApproval !== approval
    || compose?.kind !== "selfhost-compose-plan" || compose.status !== "pass"
    || project?.id !== `${bundle}-${service}` || project.ownership !== "new"
    || !["default", "rootless"].includes(project.dockerContext)
    || !Array.isArray(claims?.services) || !Array.isArray(claims.privatePorts)
    || claims.privatePorts.length !== 1 || !Array.isArray(claims.publicPorts)
    || claims.publicPorts.length !== 0) {
    throw new Error(`The ${service} adapter plan did not match the untouched, private project and reviewed token.`);
  }
  const binding = object(claims.privatePorts[0]);
  if (!binding || binding.published !== port || typeof binding.hostIp !== "string"
    || binding.protocol !== "tcp" || !Number.isInteger(binding.target)
    || binding.target < 1 || binding.target > 65535) {
    throw new Error(`The ${service} adapter plan did not contain one exact private TCP binding.`);
  }
  const images: string[] = [];
  for (const entry of claims.services) {
    const serviceClaim = object(entry);
    if (!serviceClaim || typeof serviceClaim.id !== "string" || typeof serviceClaim.image !== "string"
      || !/^[a-zA-Z0-9][a-zA-Z0-9._/:+-]{1,200}@sha256:[0-9a-f]{64}$/.test(serviceClaim.image)) {
      throw new Error(`The ${service} plan did not contain bounded immutable service images.`);
    }
    images.push(`${serviceClaim.id}: ${serviceClaim.image}`);
  }
  return `${service}: ${project.id} (${project.dockerContext}, new)\nPrivate TCP binding: ${binding.hostIp}:${port} → ${binding.target}\nImages:\n${images.join("\n")}\nApply token: ${approval}`;
}

export function householdPortCandidates(start: number): HouseholdPorts {
  if (!Number.isInteger(start) || start < 20000 || start > 44983) {
    throw new Error("The isolated household port range must start from 20000 through 44983.");
  }
  return { immich: start, docmost: start + 1, vaultwarden: start + 2, mediaStart: start + 10 };
}

export function householdPortSet(ports: HouseholdPorts): number[] {
  return [ports.immich, ports.docmost, ports.vaultwarden,
    ...Array.from({ length: 7 }, (_, offset) => ports.mediaStart + offset)];
}

export function householdAppPortSet(ports: HouseholdPorts): number[] {
  return [ports.immich, ports.docmost, ports.vaultwarden];
}

export function reviewedExistingMedia(configValue: unknown, infoValue: unknown, statusValue: unknown,
  root: string): AdoptedMediaSelection {
  if (!configValue || typeof configValue !== "object" || Array.isArray(configValue)
    || !infoValue || typeof infoValue !== "object" || Array.isArray(infoValue)
    || !statusValue || typeof statusValue !== "object" || Array.isArray(statusValue)) {
    throw new Error("The existing media review needs valid CLI config, info, and status.");
  }
  const config = configValue as Record<string, any>;
  const info = infoValue as Record<string, any>;
  const status = statusValue as Record<string, any>;
  if (config.schemaVersion !== 1 || config.profile !== "media" || !ID.test(config.runId)
    || !USERNAME.test(config.username) || typeof config.credentialHandoff !== "boolean"
    || info.schemaVersion !== 1 || info.projectRoot !== root || info.runId !== config.runId
    || info.composeProject !== `autostack-${config.runId}` || info.adminUsername !== config.username
    || info.approved !== true || !["127.0.0.1", "0.0.0.0"].includes(info.bind)
    || typeof info.approvalDigest !== "string" || !/^[0-9a-f]{64}$/.test(info.approvalDigest)
    || status.schemaVersion !== 1 || status.kind !== "selfhost-media-status"
    || status.provenance !== "cli-managed" || status.runId !== config.runId
    || status.composeProject !== `autostack-${config.runId}`
    || status.summary?.expected !== 7 || status.summary?.present !== 7 || status.summary?.running !== 7) {
    throw new Error("This project does not have one approved, seven-service CLI media run ready for adoption.");
  }
  const names = ["prowlarr", "radarr", "sonarr", "qbittorrent", "jellyfin", "seerr", "homarr"];
  if (!Array.isArray(status.services) || status.services.length !== names.length
    || JSON.stringify(status.services.map((service: Record<string, unknown>) => service?.service).sort())
      !== JSON.stringify([...names].sort())
    || status.services.some((service: Record<string, unknown>) => service?.present !== true
      || service?.running !== true || service?.state !== "running")) {
    throw new Error("The existing media status did not verify all seven running services.");
  }
  const keys = ["PROWLARR_PORT", "RADARR_PORT", "SONARR_PORT", "QBITTORRENT_PORT", "JELLYFIN_PORT", "SEERR_PORT", "HOMARR_PORT"];
  if (!info.ports || typeof info.ports !== "object" || Array.isArray(info.ports)
    || JSON.stringify(Object.keys(info.ports).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error("The existing media run did not report all seven exact ports.");
  }
  const ports: number[] = [];
  for (const key of keys) {
    const raw = info.ports[key];
    if (typeof raw !== "string" || !/^[1-9][0-9]{0,4}$/.test(raw)) {
      throw new Error("The existing media run returned an invalid port.");
    }
    ports.push(Number(raw));
  }
  if (ports.some((port) => port > 65535) || new Set(ports).size !== 7) {
    throw new Error("The existing media run returned duplicate or invalid ports.");
  }
  return { runId: config.runId, username: config.username, bind: info.bind, ports,
    approvalDigest: info.approvalDigest };
}

export function unavailableHouseholdPorts(value: unknown, requested: number[]): number[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The exact port inspection did not return a host report.");
  }
  const report = value as Record<string, any>;
  const selected = report.network?.selectedTcpPorts;
  if (selected?.state !== "observed" || selected.complete !== true || !Array.isArray(selected.items)
    || selected.items.length !== requested.length || new Set(requested).size !== requested.length) {
    throw new Error("The exact port inspection was incomplete; choose ports only after a complete host check.");
  }
  const observations = new Map<number, boolean>();
  for (const item of selected.items) {
    if (!item || typeof item !== "object" || !Number.isInteger(item.port)
      || typeof item.inUse !== "boolean" || observations.has(item.port)) {
      throw new Error("The exact port inspection returned invalid or duplicate entries.");
    }
    observations.set(item.port, item.inUse);
  }
  if (requested.some((port) => !observations.has(port))) {
    throw new Error("The exact port inspection did not cover every proposed port.");
  }
  return requested.filter((port) => observations.get(port));
}

export function householdCatalogSupported(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  if (!bundledCatalogPlan(plan)) return false;
  if (!Array.isArray(plan.setupStages)) return false;
  const stages = plan.setupStages as Array<Record<string, unknown>>;
  const expected = ["media", "app-immich", "app-docmost", "app-vaultwarden", "homarr-attachments"];
  const expectedApps = [
    ["homarr", "jellyfin", "seerr", "sonarr", "radarr", "prowlarr", "qbittorrent"],
    ["immich"], ["docmost"], ["vaultwarden"], ["immich", "docmost", "vaultwarden"],
  ];
  if (stages.length !== expected.length
    || JSON.stringify(stages.map((stage) => stage.id)) !== JSON.stringify(expected)) return false;
  if (stages.some((stage, index) => JSON.stringify(stage.apps) !== JSON.stringify(expectedApps[index]))) return false;
  const selectedApps = plan.selectedApps;
  if (!Array.isArray(selectedApps) || selectedApps.some((app) => !app || typeof app !== "object" || Array.isArray(app)
    || typeof app.id !== "string")) return false;
  if (JSON.stringify(selectedApps.map((app) => app.id)) !== JSON.stringify([
    ...expectedApps[0], "immich", "docmost", "vaultwarden", "postgresql", "valkey",
  ])) return false;
  for (const id of ["immich", "docmost", "vaultwarden"]) {
    const app = selectedApps.find((candidate) => candidate.id === id);
    if (!app || !app.cliSetup || typeof app.cliSetup !== "object" || app.cliSetup.command !== id) return false;
  }
  return stages[0].owner === "selfhost-media";
}

export function householdParallelGraphSupported(value: unknown): boolean {
  return householdCatalogSupported(value) && exactHouseholdParallelGraph(value);
}

export function householdBeginArgs(choices: HouseholdChoices): string[] {
  const root = resolve(choices.root);
  if (!isAbsolute(choices.root) || root !== choices.root || root === parse(root).root) {
    throw new Error("Choose one canonical absolute project directory.");
  }
  if (!ID.test(choices.id) || !USERNAME.test(choices.username)) {
    throw new Error("The bundle ID or administrator username is invalid.");
  }
  if (choices.email.length > 254 || !EMAIL.test(choices.email)
    || !choices.name || choices.name.trim() !== choices.name || choices.name.length > 128
    || /[\u0000-\u001f\u007f]/.test(choices.name)) {
    throw new Error("The account email or display name is invalid.");
  }
  let origin: URL;
  try { origin = new URL(choices.vaultwardenOrigin); }
  catch { throw new Error("Vaultwarden needs one exact HTTPS origin."); }
  if (origin.protocol !== "https:" || origin.origin !== choices.vaultwardenOrigin
    || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("Vaultwarden needs one exact HTTPS origin without a path or credentials.");
  }
  if (!OWNER.test(choices.routeOwner) || !OWNER.test(choices.tlsOwner)) {
    throw new Error("Private route and TLS owners need bounded IDs.");
  }
  const args = ["bundle", "begin", "--project-root", root, "--id", choices.id,
    "--username", choices.username, "--email", choices.email, "--name", choices.name,
    "--vaultwarden-origin", choices.vaultwardenOrigin,
    "--https-route-owner", choices.routeOwner, "--https-tls-owner", choices.tlsOwner,
    "--resolve-images"];
  if (choices.adoptedMedia) {
    if (!ID.test(choices.adoptedMedia.runId) || choices.adoptedMedia.username !== choices.username) {
      throw new Error("The adopted media run does not match the selected administrator.");
    }
    args.push("--media-run-id", choices.adoptedMedia.runId);
  } else {
    args.push("--media-bind-mode", "host-only");
  }
  if (choices.ports) {
    const ports = choices.ports;
    const selected = [ports.immich, ports.docmost, ports.vaultwarden];
    if (selected.some((port) => !Number.isInteger(port) || port < 1024 || port > 65535)
      || new Set(selected).size !== selected.length) {
      throw new Error("Immich, Docmost, and Vaultwarden need distinct ports from 1024 through 65535.");
    }
    args.push("--immich-port", String(ports.immich), "--docmost-port", String(ports.docmost),
      "--vaultwarden-port", String(ports.vaultwarden));
    if (ports.mediaStart !== undefined) {
      if (choices.adoptedMedia) throw new Error("An adopted media run keeps its existing ports.");
      if (!Number.isInteger(ports.mediaStart) || ports.mediaStart < 20000 || ports.mediaStart > 44993) {
        throw new Error("The seven media ports need a first port from 20000 through 44993.");
      }
      for (let offset = 0; offset < 7; offset += 1) {
        if (selected.includes(ports.mediaStart + offset)) {
          throw new Error("The media port range overlaps an app port.");
        }
      }
      args.push("--media-port-start", String(ports.mediaStart));
    }
  }
  return args;
}

export function reviewedHouseholdPlan(value: unknown, choices: HouseholdChoices): HouseholdPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Household preparation did not return a plan.");
  }
  const plan = value as Record<string, any>;
  const expectedInput = join(choices.root, ".selfhost", "bundles", choices.id, "household-bundle.json");
  const expectedStages = ["media", "immich", "docmost", "vaultwarden"];
  if (plan.schemaVersion !== 1 || plan.kind !== "household-bundle-plan"
    || plan.status !== "ready-for-staged-planning" || plan.mutation !== false
    || plan.bundle !== choices.id || plan.projectRoot !== choices.root || plan.input !== expectedInput
    || typeof plan.approval !== "string"
    || !new RegExp(`^BUNDLE:${choices.id}:[0-9a-f]{64}$`).test(plan.approval)
    || typeof plan.mediaExposure !== "string"
    || !Array.isArray(plan.stages)
    || plan.stages.some((stage: unknown) => !stage || typeof stage !== "object" || Array.isArray(stage))
    || JSON.stringify(plan.stages.map((stage: Record<string, unknown>) => stage.service)) !== JSON.stringify(expectedStages)) {
    throw new Error("Household preparation returned a plan for a different project, exposure, or service set.");
  }
  const selectedMedia = plan.mediaSelection;
  if (choices.adoptedMedia) {
    const adopted = choices.adoptedMedia;
    if (selectedMedia?.mode !== "adopt" || selectedMedia.runId !== adopted.runId
      || selectedMedia.bind !== adopted.bind
      || selectedMedia.source !== "cli-managed-media-info" || selectedMedia.approvalDigest !== adopted.approvalDigest
      || !plan.mediaExposure.includes(adopted.bind)
      || JSON.stringify(plan.mediaPorts) !== JSON.stringify(adopted.ports)) {
      throw new Error("Household preparation did not preserve the reviewed existing media run and exposure.");
    }
  } else if (selectedMedia?.mode !== "create" || selectedMedia.runId !== `${choices.id}-media`
    || selectedMedia.bind !== "127.0.0.1"
    || !plan.mediaExposure.includes("127.0.0.1")) {
    throw new Error("Household preparation did not preserve the new host-only media plan.");
  }
  for (const stage of plan.stages) {
    if (typeof stage.purpose !== "string" || typeof stage.acceptance !== "string") {
      throw new Error("Household preparation returned an incomplete service description.");
    }
  }
  return plan as HouseholdPlan;
}

function reviewedHouseholdExposure(review: HouseholdInbox["bundleReview"], allowAdoptedAllInterfaces: boolean): boolean {
  const selection = review?.mediaSelection;
  if (typeof review?.mediaExposure !== "string" || !selection || typeof selection.runId !== "string"
    || !ID.test(selection.runId)) return false;
  if (selection.mode === "create") {
    return selection.bind === "127.0.0.1" && selection.source === "bundle-selection"
      && selection.approvalDigest === null && review.mediaExposure.includes("127.0.0.1");
  }
  if (selection.mode !== "adopt" || selection.source !== "cli-managed-media-info"
    || typeof selection.approvalDigest !== "string" || !/^[0-9a-f]{64}$/.test(selection.approvalDigest)
    || !Array.isArray(review.mediaPorts) || review.mediaPorts.length !== 7
    || review.mediaPorts.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)
    || new Set(review.mediaPorts).size !== 7) return false;
  if (selection.bind === "127.0.0.1") return review.mediaExposure.includes("127.0.0.1");
  return selection.bind === "0.0.0.0" && allowAdoptedAllInterfaces
    && review.mediaExposure.includes("every host interface") && !review.mediaExposure.includes("127.0.0.1");
}

export function householdAdoptedAllInterfaceKey(value: unknown, root: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const inbox = value as HouseholdInbox;
  const selection = inbox.bundleReview?.mediaSelection;
  if (inbox.projectRoot !== root || selection?.mode !== "adopt" || selection.bind !== "0.0.0.0"
    || typeof inbox.bundle !== "string" || !ID.test(inbox.bundle)
    || typeof inbox.bundleApproval !== "string"
    || !new RegExp(`^BUNDLE:${inbox.bundle}:[0-9a-f]{64}$`).test(inbox.bundleApproval)
    || !reviewedHouseholdExposure(inbox.bundleReview, true)) return null;
  return `${inbox.bundleApproval}:${selection.runId}:${selection.approvalDigest}:${JSON.stringify(inbox.bundleReview?.mediaPorts)}`;
}

export function householdReviewRunArgs(value: unknown, root: string, allowAdoptedAllInterfaces = false): string[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const inbox = value as HouseholdInbox;
  if (inbox.kind !== "household-bundle-approvals" || inbox.status !== "review-required"
    || inbox.mutation !== false || inbox.executionPerformed !== false
    || inbox.projectRoot !== root || !reviewedHouseholdExposure(inbox.bundleReview, allowAdoptedAllInterfaces)
    || typeof inbox.bundle !== "string" || !ID.test(inbox.bundle)
    || typeof inbox.bundleApproval !== "string"
    || !new RegExp(`^BUNDLE:${inbox.bundle}:[0-9a-f]{64}$`).test(inbox.bundleApproval)) return null;
  const input = join(root, ".selfhost", "bundles", inbox.bundle, "household-bundle.json");
  const base = ["self-host", "bundle", "run", "--project-root", root, "--input", input,
    "--approve", inbox.bundleApproval];
  if (inbox.current?.checkpoint === "review-bundle-plan") return base.slice(1);
  if (inbox.current?.checkpoint === "prepare-media-plan") {
    const expected = ["self-host", "bundle", "stage", "--project-root", root, "--input", input,
      "--service", "media", "--phase", "prepare", "--approve", inbox.bundleApproval];
    if (inbox.current.service !== "media" || JSON.stringify(inbox.current.command) !== JSON.stringify(expected)) return null;
    return base.slice(1);
  }
  const command = inbox.current?.runAfterReview;
  const review = inbox.current?.review;
  const token = inbox.current?.adapterApproval;
  if (!review || typeof review !== "object" || Array.isArray(review)
    || typeof token !== "string" || token.length < 8 || token.length > 256
    || !Array.isArray(command) || command.length !== base.length + 2
    || JSON.stringify(command.slice(0, base.length)) !== JSON.stringify(base)
    || command[base.length] !== "--stage-approve" || command[base.length + 1] !== token) return null;
  return command.slice(1) as string[];
}

export function householdFullReviewArgs(value: unknown, root: string, allowAdoptedAllInterfaces = false): string[] | null {
  const runArgs = householdReviewRunArgs(value, root, allowAdoptedAllInterfaces);
  if (!runArgs) return null;
  const inbox = value as HouseholdInbox;
  const input = join(root, ".selfhost", "bundles", inbox.bundle as string, "household-bundle.json");
  if (inbox.current?.checkpoint === "review-bundle-plan" || inbox.current?.checkpoint === "prepare-media-plan") {
    return ["bundle", "plan", "--project-root", root, "--input", input];
  }
  const command = inbox.current?.reviewCommand;
  const service = inbox.current?.service;
  if (!Array.isArray(command) || !["media", "immich", "docmost", "vaultwarden"].includes(String(service))) return null;
  const prefix = ["self-host", "bundle", "stage", "--project-root", root, "--input", input,
    "--service", service, "--phase"];
  if (command.length !== prefix.length + 1
    || JSON.stringify(command.slice(0, prefix.length)) !== JSON.stringify(prefix)
    || !["plan", "owner-plan", "accept-plan", "status"].includes(command[prefix.length])) return null;
  return command.slice(1) as string[];
}
