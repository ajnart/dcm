import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { multiServiceManifest, pinnedMultiServiceImages, prepareMultiServiceFiles,
  privateDirectory, checkedConnectorRecipe, checkedPrivateDaemonRecipe } from "./multi-service-recipe.ts";
import { createSelfhostComposeOwner } from "./selfhost-compose.ts";
import { MAX_SHARED_APPS, MAX_SHARED_SERVICES } from "./shared-project-limits.ts";
import { checkedManualJobRecipe, isManualJobService } from "./manual-job.ts";
import { verifyMutableConfigs } from "./mutable-config.ts";
import { sharedHttpsProxyProfileServices } from "./shared-https-proxy-profile.ts";

type Entry = Record<string, any>;

export type SharedAppSelection = {
  appId: string;
  recipe: Entry;
  images: Record<string, string>;
  port: number | null;
  publishedPorts?: Record<string, number>;
  hostPaths?: Record<string, string>;
  derivationSha256?: string;
};

export type SharedProjectInput = {
  projectRoot: string;
  projectId: string;
  dockerContext: string;
  uid: number;
  gid: number;
  timezone: string;
  apps: SharedAppSelection[];
  observed: {
    checkedAt: string;
    ports: Entry[];
    paths: Entry[];
    networks: Entry[];
    volumes?: Entry[];
  };
};

export type SharedProjectCandidate = {
  manifest: Entry;
  units: Record<string, string[]>;
  selectionFingerprints: Record<string, string>;
  projectDirectory: string;
  settings: { uid: number; gid: number; timezone: string };
};

export type SharedProjectObservation = SharedProjectInput["observed"] & {
  project: { id: string; directory: string; owner: string };
};

const appIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const projectIdPattern = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;

function fingerprint(selection: SharedAppSelection): string {
  return createHash("sha256").update(JSON.stringify(selection)).digest("hex");
}

function comparableService(service: Entry): string {
  const copy = structuredClone(service);
  delete copy.ownership;
  for (const mount of copy.mounts) delete mount.ownership;
  return JSON.stringify(copy);
}

function checkedTimezone(value: string): string {
  if (typeof value !== "string" || value.length < 3 || value.length > 128
    || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)*$/.test(value)) {
    throw new Error("Select one observed IANA timezone for the shared project");
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
  } catch {
    throw new Error("The selected shared-project timezone is not recognized");
  }
  return value;
}

function checkedSelection(selection: SharedAppSelection): void {
  const manualJob = checkedManualJobRecipe(selection.recipe);
  const connector = checkedConnectorRecipe(selection.recipe);
  let validPort = selection.port === null;
  if (!manualJob && !connector && !checkedPrivateDaemonRecipe(selection.recipe)) {
    validPort = Number.isInteger(selection.port) && Number(selection.port) >= 1024 && Number(selection.port) <= 65535;
  }
  if (!appIdPattern.test(selection.appId) || selection.appId.length > 47
    || selection.recipe?.appId !== selection.appId
    || (selection.derivationSha256 !== undefined && !/^[0-9a-f]{64}$/.test(selection.derivationSha256))
    || (selection.recipe.mutableConfigs !== undefined && selection.derivationSha256 === undefined)
    || !validPort) {
    throw new Error("Shared-project app ID, recipe, or private port is invalid");
  }
  if (selection.recipe.schemaVersion !== 2 || selection.recipe.kind !== "multi-service-compose") {
    throw new Error(`${selection.appId} needs a validated multi-service recipe before shared-project planning`);
  }
  pinnedMultiServiceImages(selection.recipe,
    Object.entries(selection.images).map(([id, image]) => `${id}=${image}`));
}

function remapService(service: Entry, selection: SharedAppSelection,
  projectId: string, projectDirectory: string): Entry {
  const { appId } = selection;
  const originalId = service.id as string;
  const privateNetwork = `${appId}-private`;
  const id = originalId === appId ? appId : `${appId}-${originalId}`;
  const connector = checkedConnectorRecipe(selection.recipe);
  let front = originalId === appId && !isManualJobService(service);
  if (sharedHttpsProxyProfileServices(appId).includes(id)) front = true;
  if (connector) front = selection.recipe.execution.frontendSharing === "owner-front";
  if (checkedPrivateDaemonRecipe(selection.recipe)) front = false;
  const renamed: Entry = {
    ...service,
    id,
    networks: front ? ["front", privateNetwork] : [privateNetwork],
    mounts: service.mounts.map((mount: Entry) => {
      if (mount.kind !== "volume") return mount;
      const prefix = `${projectId}-`;
      if (typeof mount.name !== "string" || !mount.name.startsWith(prefix)) {
        throw new Error(`${appId} has an unrecognized project-owned volume`);
      }
      return { ...mount, name: `${projectId}-${appId}-${mount.name.slice(prefix.length)}` };
    }),
    secretRefs: service.secretRefs.map((secret: Entry) => ({
      ...secret, filePath: join(projectDirectory, "secrets", appId, secret.name),
      ref: `local/${projectId}/${appId}/${secret.name}`,
    })),
  };
  if (service.envFilePath !== undefined) {
    renamed.envFilePath = join(projectDirectory, "secrets", appId, `${originalId}.env`);
  }
  if (originalId !== appId) renamed.networkAliases = [{ network: privateNetwork, alias: originalId }];
  const routeAliases = selection.recipe.sharedPrivateHttpsRouteAliases;
  if (routeAliases !== undefined) {
    // Generated same-owner HTTPS recipes use only the existing shared-front alias primitive.
    // Keep this on the recipe so preparation and saved-selection replay compile identical bytes.
    const config = selection.recipe.configFiles?.find((file: Entry) => file.id === "caddyfile");
    const routes = Array.from(String(config?.content ?? "").matchAll(/^([a-z0-9.-]+):([0-9]+) \{\n\ttls internal\n/gm));
    if (appId !== "caddy" || originalId !== "caddy" || !front
      || selection.recipe.services.length !== 1 || selection.recipe.privateFiles.length !== 0
      || selection.recipe.onboarding?.kind !== "no-account"
      || !Array.isArray(routeAliases) || routeAliases.length < 1 || routeAliases.length > 100
      || new Set(routeAliases).size !== routeAliases.length
      || routeAliases.some((hostname: unknown) => typeof hostname !== "string"
        || hostname.length > 64 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname))
      || routes.length !== routeAliases.length || routes.some((route) => Number(route[2]) !== selection.port)
      || JSON.stringify(routes.map((route) => route[1]).sort()) !== JSON.stringify([...routeAliases].sort())) {
      throw new Error("Shared HTTPS aliases require one bounded generated Caddy frontend recipe");
    }
    renamed.networkAliases = routeAliases.map((alias: string) => ({ network: "front", alias }))
      .sort((left: Entry, right: Entry) => left.alias.localeCompare(right.alias));
  }
  if (Array.isArray(service.dependsOn)) {
    renamed.dependsOn = service.dependsOn.map((dependency: Entry) => ({
      ...dependency,
      service: dependency.service === appId ? appId : `${appId}-${dependency.service}`,
    }));
  }
  return renamed;
}

function claimSelectedHostPaths(service: Entry, selection: SharedAppSelection,
  observed: SharedProjectInput["observed"], projectId: string,
  projectDirectory: string): void {
  const selected = new Set(Object.values(selection.hostPaths ?? {}));
  for (const mount of service.mounts) {
    if (mount.kind === "volume" || !selected.has(mount.source)) continue;
    const matches = observed.paths.filter((path) => path.path === mount.source);
    const internalMedia = join(projectDirectory, "data", "shared");
    if (mount.source === internalMedia && mount.shareGroup === "media-data"
      && typeof mount.readOnly === "boolean"
      && matches.length === 0) {
      mount.owner = projectId;
      mount.ownership = "new";
      continue;
    }
    if (matches.length !== 1 || typeof matches[0].owner !== "string") {
      throw new Error(`${selection.appId} needs one exact observed owner for each selected host path`);
    }
    if (!mount.readOnly && matches[0].owner !== projectId) {
      throw new Error(`${selection.appId} cannot write an externally owned selected host path`);
    }
    mount.owner = matches[0].owner;
    mount.ownership = "verified-existing";
  }
}

/** Pure compiler. Retained providers are supplied only by the saved-project boundaries below. */
function compileSharedProjectCandidate(input: SharedProjectInput,
  retainedProviders: ReadonlySet<string>): SharedProjectCandidate {
  if (!projectIdPattern.test(input.projectId) || !isAbsolute(input.projectRoot)
    || resolve(input.projectRoot) !== input.projectRoot
    || input.projectRoot === parse(input.projectRoot).root || input.projectRoot === resolve(homedir())
    || !Number.isSafeInteger(input.uid) || input.uid <= 0
    || !Number.isSafeInteger(input.gid) || input.gid <= 0
    || !Array.isArray(input.apps) || input.apps.length === 0 || input.apps.length > MAX_SHARED_APPS) {
    throw new Error("Shared-project identity or app selection is invalid");
  }
  const timezone = checkedTimezone(input.timezone);
  const selectedAppIds = new Set(input.apps.map((selection) => selection.appId));
  for (const selection of input.apps) {
    const providerAppId = selection.recipe?.onboarding?.providerAppId;
    if (providerAppId === undefined) continue;
    if (typeof providerAppId !== "string" || !appIdPattern.test(providerAppId)
      || providerAppId === selection.appId
      || (!selectedAppIds.has(providerAppId) && !retainedProviders.has(providerAppId))) {
      throw new Error(`${selection.appId} first-admin setup requires its selected Compose provider`);
    }
  }
  const projectRoot = join(input.projectRoot, ".selfhost", "shared");
  const projectDirectory = join(projectRoot, input.projectId);
  const appIds = new Set<string>();
  const ports = new Set<string>();
  const services: Entry[] = [];
  const networks: Entry[] = [{ id: "front", name: `${input.projectId}-front`, driver: "bridge",
    internal: false, owner: input.projectId, ownership: "new" }];
  const units: Record<string, string[]> = {};
  const selectionFingerprints: Record<string, string> = {};
  for (const selection of [...input.apps].sort((left, right) => left.appId.localeCompare(right.appId))) {
    checkedSelection(selection);
    if (appIds.has(selection.appId)) {
      throw new Error("Shared-project app IDs must be unique");
    }
    appIds.add(selection.appId);
    const privateNetwork = `${selection.appId}-private`;
    networks.push({ id: privateNetwork, name: `${input.projectId}-${privateNetwork}`,
      driver: "bridge", internal: false, owner: input.projectId, ownership: "new" });
    const prototype = multiServiceManifest({ recipe: selection.recipe, images: selection.images,
      projectId: input.projectId, appsRoot: projectRoot, projectDirectory,
      dataDirectory: join(projectDirectory, "data", selection.appId),
      dockerContext: input.dockerContext, port: selection.port,
      publishedPorts: selection.publishedPorts, hostPaths: selection.hostPaths,
      uid: input.uid, gid: input.gid, timezone, observed: input.observed });
    const names: string[] = [];
    for (const service of prototype.services) {
      const mapped = remapService(service, selection, input.projectId, projectDirectory);
      claimSelectedHostPaths(mapped, selection, input.observed, input.projectId,
        projectDirectory);
      for (const port of mapped.ports) {
        const key = `${port.protocol}:${port.published}`;
        if (ports.has(key)) throw new Error("Shared-project published protocol/ports must be unique");
        ports.add(key);
      }
      services.push(mapped);
      names.push(mapped.id);
    }
    units[selection.appId] = names;
    selectionFingerprints[selection.appId] = fingerprint(selection);
  }
  if (services.length > MAX_SHARED_SERVICES) throw new Error("Shared-project service count exceeds the reviewed limit");
  const manifest: Entry = {
    schemaVersion: 1,
    project: { dockerContext: input.dockerContext, id: input.projectId, owner: input.projectId,
      root: projectRoot, directory: projectDirectory, ownership: "new" },
    services, networks,
    observed: { checkedAt: input.observed.checkedAt, project: null,
      ports: input.observed.ports, paths: input.observed.paths,
      networks: input.observed.networks,
      ...(services.some((service) => service.mounts.some((mount: Entry) => mount.kind === "volume"))
        ? { volumes: input.observed.volumes ?? [] } : {}) },
  };
  return { manifest, units, selectionFingerprints, projectDirectory,
    settings: { uid: input.uid, gid: input.gid, timezone } };
}

/** Pure compiler. It never reads project state, starts Docker, or prepares secrets. */
export function sharedProjectCandidate(input: SharedProjectInput): SharedProjectCandidate {
  return compileSharedProjectCandidate(input, new Set());
}

/** Prepares only exact selected app units of a validated shared Compose candidate. */
export async function prepareSharedProjectFiles(candidate: SharedProjectCandidate,
  selections: SharedAppSelection[], ownerSecrets: Record<string, Buffer> = {}, initializeMutable = true): Promise<void> {
  const { manifest, projectDirectory, units, selectionFingerprints, settings } = candidate;
  const project = manifest?.project;
  if (!Array.isArray(selections) || selections.length === 0
    || !projectIdPattern.test(project?.id)
    || project.owner !== project.id || project.directory !== projectDirectory
    || project.root !== dirname(projectDirectory)
    || !isAbsolute(projectDirectory) || resolve(projectDirectory) !== projectDirectory
    || !project.root.endsWith("/.selfhost/shared")
    || !units || !selectionFingerprints || !settings
    || !Array.isArray(manifest.services) || !Array.isArray(manifest.networks)) {
    throw new Error("Shared-project preparation needs one exact validated candidate");
  }
  const selectedIds = new Set<string>();
  for (const selection of selections) {
    checkedSelection(selection);
    if (selectedIds.has(selection.appId)
      || selectionFingerprints[selection.appId] !== fingerprint(selection)
      || !Array.isArray(units[selection.appId])) {
      throw new Error("Shared-project preparation selections differ from the candidate");
    }
    selectedIds.add(selection.appId);
  }
  if (project.ownership === "new" && selectedIds.size !== Object.keys(units).length) {
    throw new Error("A new shared project needs every selected app prepared together");
  }
  const retainedProviders = new Set<string>();
  if (project.ownership === "verified-existing") {
    for (const [appId, serviceIds] of Object.entries(units)) {
      if (selectedIds.has(appId)) continue;
      if (!appIdPattern.test(appId) || !Array.isArray(serviceIds) || !serviceIds.includes(appId)
        || typeof selectionFingerprints[appId] !== "string"
        || serviceIds.some((id) => !manifest.services.some((service: Entry) =>
          service.id === id && service.ownership === "verified-existing"))) {
        throw new Error("Shared-project retained provider differs from the saved services");
      }
      retainedProviders.add(appId);
    }
  }
  const expected = compileSharedProjectCandidate({ projectRoot: dirname(dirname(project.root)),
    projectId: project.id, dockerContext: project.dockerContext,
    uid: settings.uid, gid: settings.gid, timezone: settings.timezone,
    apps: selections, observed: manifest.observed }, retainedProviders);
  const actualServices = new Map<string, Entry>();
  for (const service of manifest.services) {
    if (actualServices.has(service.id)) throw new Error("Shared-project service IDs are not unique");
    actualServices.set(service.id, service);
  }
  for (const selection of selections) {
    const appId = selection.appId;
    const expectedIds = expected.units[appId];
    if (JSON.stringify(units[appId]) !== JSON.stringify(expectedIds)) {
      throw new Error("Shared-project unit map differs from its selected recipe");
    }
    for (const expectedService of expected.manifest.services.filter((service: Entry) => expectedIds.includes(service.id))) {
      const actual = actualServices.get(expectedService.id);
      if (!actual || comparableService(actual) !== comparableService(expectedService)) {
        throw new Error("Shared-project service differs from its selected recipe");
      }
    }
    for (const file of selection.recipe.privateFiles) {
      if (typeof file.id !== "string" || !appIdPattern.test(file.id)
        || (file.source === "owner"
          ? !Number.isInteger(file.maxBytes) || file.maxBytes < 1 || file.maxBytes > 16384
          : !Number.isInteger(file.bytes) || file.bytes < 32 || file.bytes > 128
            || ![undefined, "base64url", "alphanumeric", "hex", "base64-prefixed", "base64"].includes(file.format))) {
        throw new Error("Shared-project private-file descriptor is invalid");
      }
    }
  }
  await createSelfhostComposeOwner(manifest).plan();
  if (Object.keys(ownerSecrets).some((key) => !selections.some((selection) =>
    selection.recipe.privateFiles.some((file: Entry) => file.source === "owner"
      && key === `${selection.appId}:${file.id}`)))) {
    throw new Error("Owner secret input does not match a selected declared file");
  }
  for (const selection of [...selections].sort((left, right) => left.appId.localeCompare(right.appId))) {
    if (!initializeMutable) await verifyMutableConfigs(selection.recipe,
      join(projectDirectory, "data", selection.appId), join(projectDirectory, "secrets", selection.appId));
    const appSecrets = Object.fromEntries(Object.entries(ownerSecrets)
      .filter(([key]) => key.startsWith(`${selection.appId}:`))
      .map(([key, value]) => [key.slice(selection.appId.length + 1), value]));
    await prepareMultiServiceFiles(selection.recipe, projectDirectory,
      join(projectDirectory, "data", selection.appId), selection.hostPaths, selection.appId, appSecrets, initializeMutable, settings);
  }
  const sharedData = join(projectDirectory, "data", "shared");
  if (selections.some((selection) => Object.values(selection.hostPaths ?? {})
    .includes(sharedData))) {
    for (const relative of ["", "media", "media/movies", "media/tv", "torrents",
      "torrents/incomplete", "torrents/tv-sonarr", "torrents/movies-radarr",
      "usenet", "usenet/incomplete", "usenet/complete"]) {
      await privateDirectory(join(sharedData, relative));
    }
  }
}

/** Pure add planner. The caller must authenticate the saved candidate and re-observe its resources. */
export function extendSharedProject(current: SharedProjectCandidate,
  additions: SharedAppSelection[], host: Pick<SharedProjectInput,
    "projectRoot" | "projectId" | "dockerContext" | "uid" | "gid" | "timezone">,
  observed: SharedProjectObservation): SharedProjectCandidate {
  const { manifest, projectDirectory, units, selectionFingerprints, settings } = current;
  if (!Array.isArray(additions) || additions.length === 0
    || !settings || !selectionFingerprints || settings.uid !== host.uid || settings.gid !== host.gid
    || settings.timezone !== checkedTimezone(host.timezone)
    || manifest?.project?.id !== host.projectId
    || manifest.project.dockerContext !== host.dockerContext
    || manifest.project.directory !== projectDirectory
    || manifest.project.root !== join(host.projectRoot, ".selfhost", "shared")
    || projectDirectory !== join(host.projectRoot, ".selfhost", "shared", host.projectId)
    || observed.project?.id !== host.projectId
    || observed.project.owner !== host.projectId
    || observed.project.directory !== projectDirectory
    || !Array.isArray(manifest.services) || !Array.isArray(manifest.networks)
    || !manifest.networks.some((network: Entry) => network.id === "front"
      && network.name === `${host.projectId}-front` && network.owner === host.projectId)) {
    throw new Error("Shared-project extension needs one exact saved and observed project");
  }
  const known = new Set(manifest.services.map((service: Entry) => service.id));
  const recorded = new Set<string>();
  for (const [appId, serviceIds] of Object.entries(units)) {
    if (!appIdPattern.test(appId) || !Array.isArray(serviceIds) || !serviceIds.includes(appId)
      || typeof selectionFingerprints[appId] !== "string"
      || serviceIds.some((id) => !known.has(id) || recorded.has(id))) {
      throw new Error("Shared-project unit map differs from the saved services");
    }
    for (const id of serviceIds) recorded.add(id);
  }
  if (known.size !== manifest.services.length || recorded.size !== known.size
    || additions.some((selection) => Object.hasOwn(units, selection.appId))) {
    throw new Error("Shared-project additions must not replace existing units");
  }
  const fresh = compileSharedProjectCandidate({ ...host, apps: additions, observed },
    new Set(Object.keys(units)));
  if (fresh.projectDirectory !== projectDirectory
    || fresh.manifest.services.some((service: Entry) => known.has(service.id))) {
    throw new Error("Shared-project addition conflicts with an existing service ID");
  }
  const occupiedPorts = new Set(manifest.services.flatMap((service: Entry) =>
    service.ports.map((port: Entry) => `${port.protocol}:${port.published}`)));
  if (fresh.manifest.services.some((service: Entry) =>
    service.ports.some((port: Entry) => occupiedPorts.has(`${port.protocol}:${port.published}`)))) {
    throw new Error("Shared-project addition conflicts with an existing published port");
  }
  const retainedServices = structuredClone(manifest.services);
  for (const service of retainedServices) {
    service.ownership = "verified-existing";
    for (const mount of service.mounts) mount.ownership = "verified-existing";
  }
  const addedServices = fresh.manifest.services.map((service: Entry) => ({ ...service, ownership: "new" }));
  const retainedNetworks = structuredClone(manifest.networks);
  for (const network of retainedNetworks) {
    network.ownership = "verified-existing";
    const automaticClaim = retainedServices.some((service: Entry) =>
      !isManualJobService(service) && service.networks.includes(network.id));
    if (!automaticClaim && !observed.networks.some((item: Entry) => item.name === network.name)) {
      network.ownership = "new";
    }
  }
  const next = {
    schemaVersion: 1,
    project: { ...manifest.project, ownership: "verified-existing" },
    services: [...retainedServices, ...addedServices],
    networks: [...retainedNetworks, ...fresh.manifest.networks.filter((network: Entry) => network.id !== "front")],
    observed: { checkedAt: observed.checkedAt, project: observed.project,
      ports: observed.ports, paths: observed.paths, networks: observed.networks,
      ...(observed.volumes !== undefined ? { volumes: observed.volumes } : {}) },
  };
  if (next.services.length > MAX_SHARED_SERVICES || Object.keys(units).length + additions.length > MAX_SHARED_APPS) {
    throw new Error("Shared-project extension exceeds the reviewed app or service limit");
  }
  return { manifest: next, units: { ...units, ...fresh.units },
    selectionFingerprints: { ...selectionFingerprints, ...fresh.selectionFingerprints }, projectDirectory,
    settings: { ...settings } };
}
