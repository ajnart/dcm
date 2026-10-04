import type { SetupHttpRequest, SetupHttpResponse } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { links as sonarrLinks } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/sonarr/links.ts";
import { links as radarrLinks } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/radarr/links.ts";
import { links as prowlarrLinks } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/prowlarr/links.ts";
import { links as seerrLinks } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/seerr/links.ts";

export type ServiceLink = {
  source: string;
  target: string;
  kind: "download-client" | "application" | "request-manager";
  name: string;
  targetPort: number;
  categoryField?: string;
  category?: string;
  root?: string;
};
export type ServiceLinkOwner = { projectRoot: string; projectId: string; manifestHash: string; revision: number };
export type ServiceLinkPeer = {
  appId: string;
  owner: ServiceLinkOwner;
  verified: true;
  apiKey?: string;
  username?: string;
  password?: string;
  /** Selected loopback/user access URL, not the internal connection endpoint. */
  externalUrl: string;
  /** Exact app service DNS alias and target port from the verified shared manifest. */
  server: { host: string; port: number };
};
export type ServiceLinkCheckpoint = {
  owner: ServiceLinkOwner;
  linkId: string;
  phase: "attempted" | "verified";
};
export type ServiceLinkContext = {
  owner: ServiceLinkOwner;
  /** Recheck API credentials (and account credentials where required) in the exact running shared unit before releasing registered/redacted secrets. */
  verifiedPeer(appId: string): Promise<ServiceLinkPeer>;
  /** Exact-owner private transport; every POST/PUT requires the normal exact approval. Never logs raw payloads. */
  request(appId: string, request: SetupHttpRequest): Promise<SetupHttpResponse>;
  checkpoint: {
    read(linkId: string): Promise<ServiceLinkCheckpoint | null>;
    /** Atomic owner-only persistence, separate from account checkpoints, before any save request. */
    save(checkpoint: ServiceLinkCheckpoint): Promise<void>;
  };
};

export const serviceLinks: readonly ServiceLink[] = [...sonarrLinks, ...radarrLinks, ...prowlarrLinks, ...seerrLinks];
type Entry = Record<string, any>;
function object(value: unknown): Entry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Service link API resource is invalid");
  return value;
}
function array(value: unknown): Entry[] {
  if (!Array.isArray(value)) throw new Error("Service link API list is invalid");
  return value.map(object);
}
function one(rows: Entry[], predicate: (entry: Entry) => boolean, label: string): Entry {
  const matches = rows.filter(predicate);
  if (matches.length !== 1) throw new Error(`Service link ${label} is missing or ambiguous`);
  return matches[0]!;
}
function sameOwner(left: ServiceLinkOwner, right: ServiceLinkOwner): boolean {
  return left.projectRoot === right.projectRoot && left.projectId === right.projectId
    && left.manifestHash === right.manifestHash && left.revision === right.revision;
}
function positiveId(value: unknown): boolean { return Number.isSafeInteger(value) && Number(value) > 0; }
function successfulProviderTest(result: unknown): void {
  // Pinned Servarr ProviderControllerBase.Test returns the string "{}";
  // default string formatting sends {}, while JSON formatting may quote it.
  if (result === "{}") return;
  if (result !== null && typeof result === "object" && !Array.isArray(result)
    && Object.keys(result).length === 0) return;
  throw new Error("Service link connection test returned no exact success resource");
}
function implementation(entry: Entry, name: string): boolean {
  return [entry.implementation, entry.implementationName].some((value) => typeof value === "string"
    && value.toLowerCase().replace(/[^a-z0-9]+/g, "") === name.toLowerCase().replace(/[^a-z0-9]+/g, ""));
}
function fields(entry: Entry): Entry[] {
  const result = array(entry.fields).map((field) => ({ name: field.name, value: field.value }));
  if (result.some((field) => typeof field.name !== "string")
    || new Set(result.map((field) => field.name)).size !== result.length) {
    throw new Error("Service link schema fields are invalid or duplicated");
  }
  return result;
}
function value(entry: Entry, name: string): unknown { return one(fields(entry), (field) => field.name === name, name).value; }
function set(entries: Entry[], name: string, next: unknown): void {
  one(entries, (field) => field.name === name, name).value = next;
}
async function json(context: ServiceLinkContext, source: ServiceLinkPeer, path: string,
  method: "GET" | "POST" | "PUT" = "GET", payload?: Entry): Promise<unknown> {
  const request: SetupHttpRequest = { method, path, headers: { "X-Api-Key": source.apiKey! } };
  if (method !== "GET") {
    request.headers!["Content-Type"] = "application/json";
    request.body = JSON.stringify(payload);
    request.approval = { action: `link-${source.appId}-${path.split("/").filter(Boolean).join("-")}`,
      progress: `Verify or save the approved ${source.appId} service link privately` };
  }
  let response: SetupHttpResponse;
  try { response = await context.request(source.appId, request); }
  catch { throw new Error("Service link request was not confirmed; inspect before continuing"); }
  if (path.endsWith("/test") && response.status !== 200) {
    throw new Error("Service link connection test returned an unexpected status");
  }
  if (![200, 201, 202].includes(response.status)) throw new Error("Service link API request returned an unexpected status");
  if (response.status === 202) return null;
  try { return await response.json(); }
  catch { throw new Error("Service link API returned invalid JSON"); }
}
function arrPayload(link: ServiceLink, schema: Entry, source: ServiceLinkPeer, target: ServiceLinkPeer): Entry {
  const writable = fields(schema);
  const payload: Entry = { enable: true, name: link.name, fields: writable,
    implementation: schema.implementation, implementationName: schema.implementationName,
    configContract: schema.configContract, tags: [] };
  for (const key of ["implementation", "implementationName", "configContract"]) {
    if (typeof payload[key] !== "string" || !payload[key]) throw new Error("Service link implementation schema is invalid");
  }
  if (link.kind === "application") {
    set(writable, "prowlarrUrl", `http://${source.server.host}:${source.server.port}`);
    set(writable, "baseUrl", `http://${target.server.host}:${target.server.port}`);
    set(writable, "apiKey", target.apiKey);
    payload.syncLevel = "fullSync";
  } else {
    set(writable, "host", target.server.host);
    set(writable, "port", target.server.port);
    set(writable, "username", target.username);
    set(writable, "password", target.password);
    set(writable, link.categoryField!, link.category);
    for (const field of writable) {
      if (field.name === "useSsl") field.value = false;
      if (field.name === "urlBase") field.value = "";
      // qBittorrent's provider test creates missing imported categories.
      // This route only owns the pre-existing selected download category.
      if (["tvImportedCategory", "movieImportedCategory"].includes(field.name)) field.value = "";
    }
    Object.assign(payload, { priority: 1, protocol: "torrent", removeCompletedDownloads: true,
      removeFailedDownloads: true });
  }
  return payload;
}
function matches(link: ServiceLink, saved: Entry, expected: Entry): boolean {
  if (link.kind === "request-manager") {
    // Seerr assigns its first saved server ID 0, unlike Servarr resources.
    if (!Number.isSafeInteger(saved.id) || saved.id < 0) return false;
    return ["hostname", "port", "useSsl", "is4k", "apiKey", "baseUrl", "activeProfileId",
      "activeDirectory", "isDefault", "preventSearch"].every((key) => saved[key] === expected[key]);
  }
  if (!positiveId(saved.id)) return false;
  if (saved.enable !== true || !implementation(saved, link.name)) return false;
  let names = ["prowlarrUrl", "baseUrl"];
  if (link.kind === "download-client") {
    names = ["host", "port", "username", "useSsl", "urlBase", link.categoryField!];
    names.push(...fields(expected).filter((field) =>
      ["tvImportedCategory", "movieImportedCategory"].includes(field.name)).map((field) => field.name));
  }
  if (!names.every((name) => value(saved, name) === value(expected, name))) return false;
  if (link.kind === "application"
    && (saved.syncLevel !== "fullSync" || value(saved, "apiKey") !== "********")) return false;
  // Stored credential ownership is checked by testing the read-back masked secret.
  return true;
}

/** Account-only setup is independent. This separate operation never adds indexers, media, or downloads. */
export async function runServiceLink(context: ServiceLinkContext, sourceId: string, targetId: string): Promise<Entry> {
  const link = one([...serviceLinks], (item) => item.source === sourceId && item.target === targetId, "descriptor") as ServiceLink;
  if (!context.owner.projectRoot.startsWith("/") || !/^[a-z0-9][a-z0-9_-]*$/.test(context.owner.projectId)
    || !/^[0-9a-f]{64}$/.test(context.owner.manifestHash) || !positiveId(context.owner.revision)) {
    throw new Error("Service link owner identity is invalid");
  }
  const source = await context.verifiedPeer(sourceId);
  const target = await context.verifiedPeer(targetId);
  for (const peer of [source, target]) {
    if (peer.verified !== true || !sameOwner(context.owner, peer.owner)) throw new Error("Service links require verified accounts in the exact same shared Compose owner");
    if (peer.server?.host !== peer.appId || !positiveId(peer.server.port) || peer.server.port > 65535) {
      throw new Error("Service link peer has no exact saved internal endpoint");
    }
  }
  let displayUrl: URL;
  try { displayUrl = new URL(target.externalUrl); }
  catch { throw new Error("Service link display URL is invalid"); }
  if (!["http:", "https:"].includes(displayUrl.protocol) || displayUrl.username || displayUrl.password
    || displayUrl.search || displayUrl.hash) throw new Error("Service link display URL must be credential-free");
  if (source.appId !== sourceId || target.appId !== targetId || !source.apiKey
    || (link.kind !== "download-client" && !target.apiKey)
    || (link.kind === "download-client" && (target.username !== "admin" || !target.password))) {
    throw new Error("Service link verified credential references are unavailable");
  }
  const linkId = `${sourceId}-to-${targetId}`;
  const savedCheckpoint = await context.checkpoint.read(linkId);
  if (savedCheckpoint && (savedCheckpoint.linkId !== linkId || !sameOwner(context.owner, savedCheckpoint.owner)
    || !["attempted", "verified"].includes(savedCheckpoint.phase))) throw new Error("Service link checkpoint owner differs");
  if (link.kind === "application"
    && array(await json(context, source, "/api/v1/indexer")).length !== 0) {
    // Prowlarr synchronizes existing indexers when an enabled application is
    // saved. This operation does not authorize configuring remote indexers.
    throw new Error("Service link requires an empty Prowlarr indexer inventory; existing indexer synchronization needs separate approval");
  }
  let path = "/api/v3/downloadclient";
  if (link.kind === "application") path = "/api/v1/applications";
  if (link.kind === "request-manager") path = `/api/v1/settings/${targetId}`;
  const inventory = array(await json(context, source, path));
  let candidates: Entry[];
  if (link.kind === "request-manager") candidates = inventory;
  else candidates = inventory.filter((item) => implementation(item, link.name));
  if (candidates.length > 1) throw new Error("Service link destination is ambiguous; inspect before continuing");
  let payload: Entry;
  if (link.kind === "request-manager") {
    const details = object(await json(context, source, `${path}/test`, "POST",
      { hostname: target.server.host, port: target.server.port, apiKey: target.apiKey, useSsl: false, baseUrl: "" }));
    const profile = one(array(details.profiles), (item) => typeof item.name === "string"
      && item.name.toLowerCase() === "any" && positiveId(item.id), "Any profile");
    one(array(details.rootFolders), (item) => item.path === link.root && positiveId(item.id), "root folder");
    if (details.urlBase !== "") throw new Error("Service link Arr URL base differs");
    payload = { name: link.name, hostname: target.server.host, port: target.server.port, apiKey: target.apiKey,
      useSsl: false, baseUrl: "", activeProfileId: profile.id, activeProfileName: profile.name,
      activeDirectory: link.root, tags: [], is4k: false, isDefault: true, externalUrl: target.externalUrl,
      syncEnabled: true, preventSearch: false, tagRequests: false };
    if (targetId === "radarr") payload.minimumAvailability = "released";
    else Object.assign(payload, { seriesType: "standard", animeSeriesType: "anime", activeAnimeProfileId: profile.id,
      activeAnimeProfileName: profile.name, activeAnimeDirectory: link.root, animeTags: [], enableSeasonFolders: true,
      monitorNewItems: "all" });
  } else {
    const schema = one(array(await json(context, source, `${path}/schema`)),
      (item) => implementation(item, link.name), "implementation schema");
    payload = arrPayload(link, schema, source, target);
  }
  const existing = candidates[0];
  if (existing && !matches(link, existing, payload)) throw new Error("Service link existing configuration differs; no overwrite was attempted");
  if (!existing) {
    if (savedCheckpoint) throw new Error("Service link prior save is not reconciled; automatic replay is refused");
    if (link.kind !== "request-manager") {
      const tested = await json(context, source, `${path}/test`, "POST", payload);
      successfulProviderTest(tested);
    }
    await context.checkpoint.save({ owner: context.owner, linkId, phase: "attempted" });
    await json(context, source, path, "POST", payload);
  }
  const readback = array(await json(context, source, path));
  let retained: Entry;
  if (link.kind === "request-manager") retained = one(readback, () => true, "saved server");
  else retained = one(readback, (item) => implementation(item, link.name), "saved implementation");
  if (!matches(link, retained, payload)) throw new Error("Service link saved configuration did not pass exact readback");
  if (link.kind !== "request-manager") {
    const test = { ...retained, fields: fields(retained) };
    if (link.kind === "download-client") {
      // Positive retained ID + exact mask resolves the stored password server-side:
      // https://github.com/Sonarr/Sonarr/blob/v4.0.19.2979/src/Sonarr.Api.V3/ProviderControllerBase.cs#L200-L209
      // https://github.com/Sonarr/Sonarr/blob/v4.0.19.2979/src/Sonarr.Http/ClientSchema/SchemaBuilder.cs#L61-L68
      // https://github.com/Radarr/Radarr/blob/v6.4.4.10685/src/Radarr.Http/ClientSchema/SchemaBuilder.cs#L61-L68
      // Never substitute a proposed password: that would not test saved credentials.
      if (value(retained, "password") !== "********") {
        throw new Error("Service link saved password readback has no exact publisher mask");
      }
    }
    // Prowlarr application API keys use the same ID + mask resolution. Preserve
    // the read-back mask; matches() requires it only for this reviewed contract:
    // https://github.com/Prowlarr/Prowlarr/blob/v2.6.5.5623/src/Prowlarr.Api.V1/ProviderControllerBase.cs#L139-L148
    // https://github.com/Prowlarr/Prowlarr/blob/v2.6.5.5623/src/Prowlarr.Http/ClientSchema/SchemaBuilder.cs#L61-L68
    const result = await json(context, source, `${path}/test`, "POST", test);
    successfulProviderTest(result);
  } else {
    // Test the read-back connection, not only the proposed pre-save endpoint.
    // Seerr's test route only reads profiles/roots/tags from that exact Arr peer.
    const details = object(await json(context, source, `${path}/test`, "POST",
      { hostname: retained.hostname, port: retained.port, apiKey: target.apiKey,
        useSsl: retained.useSsl, baseUrl: retained.baseUrl }));
    one(array(details.profiles), (profile) => profile.id === retained.activeProfileId
      && profile.name === payload.activeProfileName, "saved profile connection test");
    one(array(details.rootFolders), (folder) => folder.path === retained.activeDirectory
      && positiveId(folder.id), "saved root-folder connection test");
    if (details.urlBase !== retained.baseUrl) throw new Error("Service link saved URL base connection test differs");
  }
  await context.checkpoint.save({ owner: context.owner, linkId, phase: "verified" });
  return { linkId, source: sourceId, target: targetId, status: "api-link-verified",
    owner: context.owner, resourceId: retained.id, acceptance: "media-indexers-downloads-and-restart-not-verified" };
}
