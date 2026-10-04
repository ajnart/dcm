import { createHash } from "node:crypto";
import { isAbsolute, join, posix } from "node:path";
import type { AcceptanceContext } from "../../types/acceptance";
import { createReadOnlyAcceptance } from "../../types/acceptance-lifecycle";
import { appliedStatus, setupRecord } from "../../types/setup";

const SOURCE = "https://github.com/jellyfin/jellyfin/blob/v12.1/Jellyfin.Api/Controllers/LibraryController.cs";
const MAX_BYTES = 1024 * 1024;
const UUID = /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;

function id(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value) || /^0+$/.test(value.replaceAll("-", ""))) {
    throw new Error("Jellyfin acceptance requires a non-empty UUID-like item or source identity");
  }
  return value.replaceAll("-", "").toLowerCase();
}

function path(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/data/") || value.length > 1024
    || value.endsWith("/") || posix.normalize(value) !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Jellyfin selected media must be a local, normalized file under /data");
  }
  return value;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function headers(context: AcceptanceContext): Promise<Record<string, string>> {
  const status = appliedStatus(context, await context.status());
  const key = await context.secrets.readApiKey();
  if (typeof status.privateFiles !== "string" || !isAbsolute(status.privateFiles)
    || await context.secrets.apiKeyPath() !== join(status.privateFiles, "jellyfin-api-key")
    || typeof key !== "string" || key.length < 16 || key.length > 8192
    || key.trim() !== key || /[\r\n\u0000,\"]/.test(key)) {
    throw new Error("Jellyfin acceptance needs the exact saved private API key; no new key or login is created");
  }
  return { Authorization: `MediaBrowser Token="${key}"`, "Cache-Control": "no-cache" };
}

async function json(context: AcceptanceContext, requestPath: string,
  auth: Record<string, string>, query?: Record<string, string>): Promise<unknown> {
  try {
    const response = await context.http.request({ method: "GET", path: requestPath, headers: auth, query });
    if (!response.ok || response.status !== 200) throw new Error("denied");
    return await response.json();
  } catch { throw new Error("Jellyfin selected authorized media read was denied or unavailable"); }
}

async function ready(context: AcceptanceContext, auth: Record<string, string>): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    let response;
    try {
      response = await context.http.request({ method: "GET", path: "/System/Info",
        headers: auth, timeoutMs: 1_000 });
    } catch { /* Only bounded restart readiness reads retry a connection failure. */ }
    if (response) {
      if (response.status === 200 && response.ok) return;
      if (![502, 503, 504].includes(response.status)) {
        throw new Error("Jellyfin restart API readiness was denied or unexpected");
      }
    }
    if (attempt < 29) await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Jellyfin authenticated API did not become ready within bounded restart reads");
}

export default createReadOnlyAcceptance({
  appId: "jellyfin", source: SOURCE, stage: "jellyfin-original-read-acceptance",
  serviceIds: ["jellyfin"], cleanup: "not-required-existing-media-read-only",
  inputDefinitions: [{ key: "item-id", label: "Existing authorized Movie or Episode UUID (original file at most 1 MiB)" }],
  async observe(context, afterRestart) {
    const itemId = id(context.inputs?.["item-id"]);
    const auth = await headers(context);
    if (afterRestart) await ready(context, auth);
    const publicInfo = setupRecord(await json(context, "/System/Info/Public", {}), "Jellyfin public info");
    const info = setupRecord(await json(context, "/System/Info", auth), "Jellyfin authenticated info");
    const serverId = id(info.Id);
    if (publicInfo.StartupWizardCompleted !== true || id(publicInfo.Id) !== serverId
      || typeof info.Version !== "string" || !/^12\.1(?:\.|$)/.test(info.Version)
      || publicInfo.Version !== info.Version) {
      throw new Error("Jellyfin acceptance requires the same initialized pinned v12.1 server");
    }
    const result = setupRecord(await json(context, "/Items", auth, { ids: itemId,
      fields: "Path,MediaSources", locationTypes: "File", includeItemTypes: "Movie,Episode",
      limit: "1", recursive: "true", enableImages: "false", enableUserData: "false" }), "Jellyfin selected item");
    if (!Array.isArray(result.Items) || result.Items.length !== 1 || result.TotalRecordCount !== 1) {
      throw new Error("Jellyfin selected media is missing or ambiguous; an empty library cannot pass");
    }
    const item = setupRecord(result.Items[0], "Jellyfin media item");
    if (id(item.Id) !== itemId || !["Movie", "Episode"].includes(String(item.Type))
      || item.IsFolder !== false || item.IsPlaceHolder === true || item.MediaType !== "Video"
      || item.LocationType !== "File" || item.VideoType !== "VideoFile"
      || !Array.isArray(item.MediaSources) || item.MediaSources.length !== 1) {
      throw new Error("Jellyfin selected item is not one local Movie or Episode original media source");
    }
    const itemPath = path(item.Path);
    const media = setupRecord(item.MediaSources[0], "Jellyfin original source");
    const mediaSourceId = id(media.Id);
    if (media.Protocol !== "File" || media.IsRemote !== false || media.Type !== "Default"
      || media.RequiresOpening === true || media.RequiresClosing === true || media.IsInfiniteStream === true
      || path(media.Path) !== itemPath || !Number.isSafeInteger(media.Size)
      || Number(media.Size) < 1 || Number(media.Size) > MAX_BYTES) {
      throw new Error("Jellyfin requires one existing non-empty local original of at most 1 MiB; no streams are opened");
    }
    const inventory = await json(context, "/Library/VirtualFolders", auth);
    const ancestors = await json(context, `/Items/${itemId}/Ancestors`, auth);
    if (!Array.isArray(inventory) || inventory.length > 128 || !Array.isArray(ancestors) || ancestors.length > 128) {
      throw new Error("Jellyfin selected library membership could not be verified");
    }
    let libraryName = "Movies";
    let collectionType = "movies";
    if (item.Type === "Episode") { libraryName = "Shows"; collectionType = "tvshows"; }
    const libraries = inventory.map((entry) => setupRecord(entry, "Jellyfin library"))
      .filter((entry) => entry.Name === libraryName);
    if (libraries.length !== 1) throw new Error("Jellyfin selected media library is missing or ambiguous");
    const library = libraries[0]!;
    const libraryId = id(library.ItemId);
    if (library.CollectionType !== collectionType || !Array.isArray(library.Locations)
      || library.Locations.length !== 1 || !itemPath.startsWith(`${path(library.Locations[0])}/`)
      || !ancestors.some((entry) => id(setupRecord(entry, "Jellyfin ancestor").Id) === libraryId)) {
      throw new Error("Jellyfin selected item does not belong to the expected local media library");
    }
    // The shared HTTP transport aborts above 1 MiB of actual received bytes,
    // independent of Content-Length. Do not replace this with unbounded fetch.
    const download = await context.http.request({ method: "GET", path: `/Items/${itemId}/Download`,
      headers: { ...auth, Accept: "video/*" } });
    if (!download.ok || download.status !== 200
      || !/^video\/[a-z0-9.+-]+(?:;|$)/i.test(download.headers.get("content-type") ?? "")) {
      throw new Error("Jellyfin selected original download was denied or did not return video bytes");
    }
    const bytes = new Uint8Array(await download.arrayBuffer());
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES || bytes.byteLength !== media.Size) {
      throw new Error("Jellyfin selected original is empty, oversized, truncated or differs from its metadata size");
    }
    const metadataSha256 = sha256(JSON.stringify({ serverId, version: info.Version, itemId,
      type: item.Type, itemPath, libraryId, collectionType, locations: library.Locations,
      mediaSourceId, container: media.Container ?? null, runTimeTicks: media.RunTimeTicks ?? null,
      size: media.Size, name: item.Name ?? null, parentId: item.ParentId ?? null }));
    return { baseline: { serverId, itemId, libraryId, mediaSourceId,
      metadataSha256, originalSha256: sha256(bytes), originalSize: bytes.byteLength },
      result: { appHealthObserved: true, authenticatedApiVerified: true,
        originalMediaReadVerified: true, libraryMembershipVerified: true,
        workloadScope: "selected-existing-local-original-media-download",
        renderedPlayerVerified: false, transcodingVerified: false, externalClientNetworkVerified: false } };
  },
});
