import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { MAX_SHARED_APPS } from "../lib/shared-project-limits.ts";
import { savedAppIds } from "../lib/app-state-discovery.ts";

// The caller owns bounded subprocess execution and JSON parsing. This module never
// opens app state, Compose, or credential files itself.
export type JsonCliRunner = (args: string[]) => Promise<unknown>;

export type SavedImage = string | Record<string, string> | null;
type Runtime = { state: string; health: string; checkedAt: string; source: "docker-compose" };

export type AppProjectSnapshot = {
  id: string;
  stage: string;
  url: string | null;
  image: SavedImage;
  projectId: string | null;
  approvals: Record<string, string>;
  runtime: Runtime | null;
  update: { status: "current" | "available" | "unknown"; registryImage: SavedImage };
  limitations: string[];
};

export type ProjectSnapshot = {
  root: string;
  owners: { project: boolean; cli: boolean; stack: boolean; appBatch: boolean; bundles: string[]; shared: string[] };
  apps: AppProjectSnapshot[];
  shared: Array<{ id: string; stage: string; apps: Array<{ id: string; url: string | null;
    publishedPort?: number | null;
    runtime: Runtime | null; manualJob?: boolean; image: SavedImage; recipeSha256: string | null;
    update: AppProjectSnapshot["update"]; limitations: string[] }> }>;
};

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

function boundedString(value: unknown, limit = 2048): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > limit) return null;
  return value;
}

function savedImage(value: unknown): SavedImage {
  if (typeof value === "string") return boundedString(value, 512);
  const record = object(value);
  if (!record || Object.keys(record).length === 0 || Object.keys(record).length > 32) return null;
  const images: Record<string, string> = {};
  for (const [service, image] of Object.entries(record)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(service)) return null;
    const bounded = boundedString(image, 512);
    if (!bounded) return null;
    images[service] = bounded;
  }
  return images;
}

function approvals(value: unknown): Record<string, string> {
  const record = object(value);
  if (!record || Object.keys(record).length > 32) return {};
  const tokens: Record<string, string> = {};
  for (const [name, token] of Object.entries(record)) {
    if (!/^[a-z][a-zA-Z]{0,31}$/.test(name)) continue;
    const bounded = boundedString(token, 512);
    if (bounded) tokens[name] = bounded;
  }
  return tokens;
}

function validStatus(value: unknown, id: string, root: string): JsonObject | null {
  const report = object(value);
  if (!report || report.schemaVersion !== 1 || report.command !== "app status"
    || report.appId !== id || report.projectRoot !== root || report.mutation !== false) return null;
  return report;
}

function savedUrl(value: unknown): string | null {
  const text = boundedString(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol === "http:" && url.hostname === "127.0.0.1"
      && !url.username && !url.password && url.port && url.pathname === "/"
      && !url.search && !url.hash) return text;
  } catch { /* Invalid saved URLs remain unknown. */ }
  return null;
}

async function privateDirectory(path: string): Promise<boolean> {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()
    || await realpath(path) !== path || (metadata.mode & 0o077) !== 0
    || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
    throw new Error("Saved project owner directory is unsafe");
  }
  return true;
}

async function privateMarker(path: string): Promise<boolean> {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || (metadata.mode & 0o077) !== 0
    || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
    throw new Error("Saved project owner marker is unsafe");
  }
  return true;
}

async function ownerMarkers(root: string): Promise<ProjectSnapshot["owners"]> {
  const owners = { project: false, cli: false, stack: false, appBatch: false,
    bundles: [] as string[], shared: [] as string[] };
  const local = join(root, ".selfhost");
  if (!await privateDirectory(local)) return owners;
  owners.project = await privateMarker(join(local, "project.json"));
  owners.cli = await privateMarker(join(local, "cli.json"));
  owners.stack = await privateMarker(join(local, "stack.json"));
  owners.appBatch = await privateMarker(join(local, "app-batch.json"));
  const sharedDirectory = join(local, "shared");
  if (await privateDirectory(sharedDirectory)) {
    const entries = await readdir(sharedDirectory, { withFileTypes: true });
    if (entries.length > 64) throw new Error("Too many saved shared projects to review");
    for (const entry of entries) {
      if (!/^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/.test(entry.name)) continue;
      if (!entry.isDirectory() || !await privateDirectory(join(sharedDirectory, entry.name))) {
        throw new Error("Saved shared project directory is unsafe");
      }
      owners.shared.push(entry.name);
    }
  }
  const bundleDirectory = join(local, "bundles");
  if (!await privateDirectory(bundleDirectory)) return owners;
  const entries = await readdir(bundleDirectory, { withFileTypes: true });
  if (entries.length > 64) throw new Error("Too many saved bundle owners to review");
  for (const entry of entries) {
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(entry.name)) continue;
    if (!entry.isDirectory() || !await privateDirectory(join(bundleDirectory, entry.name))) {
      throw new Error("Saved bundle owner directory is unsafe");
    }
    if (await privateMarker(join(bundleDirectory, entry.name, "household-bundle.json"))) {
      owners.bundles.push(entry.name);
    }
  }
  return owners;
}

function emptyApp(id: string): AppProjectSnapshot {
  return { id, stage: "unknown", url: null, image: null, projectId: null,
    approvals: {}, runtime: null, update: { status: "unknown", registryImage: null },
    limitations: [] };
}

export async function loadProjectSnapshot(root: string, runJson: JsonCliRunner): Promise<ProjectSnapshot> {
  if (!isAbsolute(root)) throw new Error("Project root must be absolute");
  const [ids, owners] = await Promise.all([savedAppIds(root), ownerMarkers(root)]);
  const apps: AppProjectSnapshot[] = [];
  for (let index = 0; index < ids.length; index += 3) {
    const batch = ids.slice(index, index + 3);
    apps.push(...await Promise.all(batch.map(async (id) => {
      const app = emptyApp(id);
      try {
        const report = validStatus(await runJson(["app", "status", "--id", id,
          "--project-root", root, "--json"]), id, root);
        if (!report) throw new Error("invalid status");
        app.stage = boundedString(report.status, 64) ?? "unknown";
        app.url = savedUrl(report.url);
        app.image = savedImage(report.image ?? report.images);
        app.projectId = boundedString(report.projectId, 128);
        app.approvals = approvals(report.approvals);
      } catch {
        app.limitations.push("Saved app status unavailable or invalid");
      }
      return app;
    })));
  }
  const shared = await Promise.all(owners.shared.map(async (id) => {
    try {
      const result = object(await runJson(["app", "shared", "status", "--project-root", root,
        "--project-id", id, "--json"]));
      if (!result || result.command !== "app shared status" || result.mutation !== false
        || result.projectRoot !== root || result.projectId !== id || !Array.isArray(result.apps)
        || result.apps.length > MAX_SHARED_APPS) throw new Error("invalid shared status");
      const urls = object(result.urls);
      const ports = object(result.ports);
      const images = object(result.images);
      const recipeHashes = object(result.recipeSha256);
      const manualJobs = result.manualJobs ?? [];
      if (!Array.isArray(manualJobs) || manualJobs.some((appId) => !result.apps.includes(appId))) {
        throw new Error("invalid shared manual job inventory");
      }
      const selected = result.apps.map((appId) => {
        if (typeof appId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appId)) {
          throw new Error("invalid shared app ID");
        }
        const recipeSha256 = recipeHashes?.[appId];
        let guardedHash: string | null = null;
        if (typeof recipeSha256 === "string" && /^[0-9a-f]{64}$/.test(recipeSha256)) guardedHash = recipeSha256;
        let publishedPort: number | null = null;
        if (Number.isSafeInteger(ports?.[appId]) && Number(ports?.[appId]) >= 1024
          && Number(ports?.[appId]) <= 65535) publishedPort = Number(ports?.[appId]);
        return { id: appId, url: savedUrl(urls?.[appId]), publishedPort, runtime: null, manualJob: manualJobs.includes(appId),
          image: savedImage(images?.[appId]), recipeSha256: guardedHash,
          update: { status: "unknown" as const, registryImage: null }, limitations: [] };
      });
      return { id, stage: boundedString(result.status, 64) ?? "unknown", apps: selected };
    } catch {
      return { id, stage: "unknown", apps: [] };
    }
  }));
  return { root, owners, apps, shared };
}

function pinnedParts(image: string): { source: string; digest: string } | null {
  const match = /^([a-zA-Z0-9][a-zA-Z0-9._/:+-]{0,447})@sha256:([0-9a-f]{64})$/.exec(image);
  if (!match) return null;
  return { source: match[1], digest: match[2] };
}

function registryImage(value: JsonObject): SavedImage {
  if (typeof value.image === "string") return savedImage(value.image);
  if (!Array.isArray(value.images) || value.images.length === 0 || value.images.length > 32) return null;
  const images: Record<string, string> = {};
  for (const entry of value.images) {
    const record = object(entry);
    if (!record || typeof record.service !== "string" || typeof record.image !== "string"
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.service)
      || Object.hasOwn(images, record.service)) return null;
    images[record.service] = record.image;
  }
  return savedImage(images);
}

function comparePins(saved: SavedImage, current: SavedImage): "current" | "available" | "unknown" {
  if (!saved || !current || typeof saved !== typeof current) return "unknown";
  if (typeof saved === "string" && typeof current === "string") {
    const left = pinnedParts(saved);
    const right = pinnedParts(current);
    if (!left || !right || left.source !== right.source) return "unknown";
    return left.digest === right.digest ? "current" : "available";
  }
  if (typeof saved === "string" || typeof current === "string") return "unknown";
  const savedServices = Object.keys(saved).sort();
  const currentServices = Object.keys(current).sort();
  if (JSON.stringify(savedServices) !== JSON.stringify(currentServices)) return "unknown";
  let changed = false;
  for (const service of savedServices) {
    const left = pinnedParts(saved[service]);
    const right = pinnedParts(current[service]);
    if (!left || !right || left.source !== right.source) return "unknown";
    if (left.digest !== right.digest) changed = true;
  }
  return changed ? "available" : "current";
}

async function enrichApp(saved: AppProjectSnapshot, root: string,
  runJson: JsonCliRunner): Promise<AppProjectSnapshot> {
  const app: AppProjectSnapshot = { ...saved, approvals: { ...saved.approvals },
    limitations: [...saved.limitations], runtime: null,
    update: { status: "unknown", registryImage: null } };
  const inspectRuntime = async (): Promise<string | null> => {
    if (app.stage === "applied") {
      try {
        const report = validStatus(await runJson(["app", "status", "--id", app.id,
          "--project-root", root, "--live", "--json"]), app.id, root);
        const runtime = object(report?.runtime);
        const state = boundedString(runtime?.state, 32);
        const health = boundedString(runtime?.health, 32);
        const checkedAt = boundedString(runtime?.checkedAt, 64);
        if (!report || report.status !== app.stage || report.projectId !== app.projectId
          || !state || !health || !checkedAt || Number.isNaN(Date.parse(checkedAt))) {
          throw new Error("invalid runtime");
        }
        const documentedHealth = ["healthy", "unhealthy", "starting"].includes(health)
          ? health : "unknown";
        app.runtime = { state, health: documentedHealth, checkedAt, source: "docker-compose" };
      } catch {
        return "Current Docker runtime unavailable or unverified";
      }
    }
    return null;
  };
  const resolveRegistry = async (): Promise<string | null> => {
    if (app.image) {
      try {
        const report = object(await runJson(["app", "image", "--id", app.id, "--json"]));
        if (!report || report.schemaVersion !== 1 || report.command !== "app image"
          || report.appId !== app.id || report.mutation !== false
          || !["resolved", "resolved-read-only"].includes(String(report.status))) {
          throw new Error("invalid image resolution");
        }
        app.update.registryImage = registryImage(report);
        app.update.status = comparePins(app.image, app.update.registryImage);
        if (app.update.status === "unknown") {
          return "Saved and registry image pins are not comparable";
        }
      } catch {
        return "Current registry image resolution unavailable";
      }
    }
    return null;
  };
  const limitations = await Promise.all([inspectRuntime(), resolveRegistry()]);
  for (const limitation of limitations) {
    if (limitation) app.limitations.push(limitation);
  }
  return app;
}

export async function enrichProjectSnapshot(snapshot: ProjectSnapshot,
  runJson: JsonCliRunner): Promise<ProjectSnapshot> {
  const apps: AppProjectSnapshot[] = [];
  const batchSize = 3;
  for (let index = 0; index < snapshot.apps.length; index += batchSize) {
    const batch = snapshot.apps.slice(index, index + batchSize);
    apps.push(...await Promise.all(batch.map((app) => enrichApp(app, snapshot.root, runJson))));
  }
  const shared: ProjectSnapshot["shared"] = [];
  for (const saved of snapshot.shared) {
    if (saved.stage !== "completed") {
      shared.push(saved);
      continue;
    }
    let project: ProjectSnapshot["shared"][number] = { ...saved, apps: saved.apps.map((app) => ({ ...app, runtime: null,
      update: { status: "unknown" as AppProjectSnapshot["update"]["status"], registryImage: null as SavedImage },
      limitations: [...app.limitations] })) };
    try {
      const result = object(await runJson(["app", "shared", "status", "--project-root", snapshot.root,
        "--project-id", project.id, "--live", "--json"]));
      if (!result || result.command !== "app shared status" || result.mutation !== false
        || result.projectRoot !== snapshot.root || result.projectId !== project.id
        || result.status !== project.stage) throw new Error("invalid shared runtime");
      const runtimes = object(result.runtime);
      const currentImages = object(result.images);
      const currentHashes = object(result.recipeSha256);
      project = { ...project, apps: project.apps.map((app) => {
        if (currentHashes?.[app.id] !== app.recipeSha256
          || comparePins(app.image, savedImage(currentImages?.[app.id])) !== "current") {
          app = { ...app, recipeSha256: null,
            limitations: [...app.limitations, "Saved owner or recipe changed during image review"] };
        }
        const observed = object(runtimes?.[app.id]);
        const state = boundedString(observed?.state, 32);
        const health = boundedString(observed?.health, 32);
        const checkedAt = boundedString(observed?.checkedAt, 64);
        if (!state || !health || !checkedAt || Number.isNaN(Date.parse(checkedAt))) {
          return { ...app, limitations: [...app.limitations, "Current Docker runtime unavailable or unverified"] };
        }
        const documentedHealth = ["healthy", "unhealthy", "starting"].includes(health)
          ? health : "unknown";
        return { ...app, runtime: { state, health: documentedHealth, checkedAt,
          source: "docker-compose" as const } };
      }) };
    } catch {
      project.apps = project.apps.map((app) => ({ ...app,
        limitations: [...app.limitations, "Current Docker runtime unavailable or unverified"] }));
    }
    for (let index = 0; index < project.apps.length; index += batchSize) {
      await Promise.all(project.apps.slice(index, index + batchSize).map(async (app) => {
        if (!app.image || !app.recipeSha256) {
          app.limitations.push("Saved recipe identity or pinned images unavailable; image update unknown");
          return;
        }
        try {
          const report = object(await runJson(["app", "image", "--id", app.id, "--json"]));
          if (!report || report.schemaVersion !== 1 || report.command !== "app image"
            || report.appId !== app.id || report.mutation !== false
            || report.recipeSha256 !== app.recipeSha256
            || !["resolved", "resolved-read-only"].includes(String(report.status))) {
            throw new Error("invalid image resolution or changed recipe");
          }
          app.update.registryImage = registryImage(report);
          app.update.status = comparePins(app.image, app.update.registryImage);
          if (app.update.status === "unknown") app.limitations.push("Saved and registry image pins are not comparable");
        } catch {
          app.limitations.push("Current registry resolution unavailable or recipe changed; image update unknown");
        }
      }));
    }
    shared.push(project);
  }
  return { ...snapshot, apps, shared };
}
