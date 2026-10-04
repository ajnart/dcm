import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { homarrIntegrationCredentials, homarrStackMapping, homarrStackWidgets } from "../src/lib/homarr-stack-mapping.ts";
import { sharedHomarrPreparedJob } from "../src/shared-homarr.ts";

// Independent source snapshot: official release/v2 beffe794022c22c43dd458999ee2a016bb1df2e6.
// Synthetic descriptor contract only; not live authentication or rendered acceptance.
const native = [
  ["adguard-home","adGuardHome",[["username","password"]]],
  ["archive-team-warrior","archiveTeamWarrior",[[],["username","password"]]],
  ["aria2","aria2",[[],["apiKey"]]],
  ["audiobookshelf","audiobookshelf",[["apiKey"]]],
  ["bazarr","bazarr",[["apiKey"]]],
  ["beszel","beszel",[["username","password"]]],
  ["caddy","caddy",[[]]],
  ["coolify","coolify",[["apiKey"]]],
  ["dashdot","dashDot",[[]]],
  ["deluge","deluge",[["password"]]],
  ["emby","emby",[["apiKey"]]],
  ["frigate","frigate",[[]]],
  ["gatus","gatus",[[]]],
  ["glances","glances",[[]]],
  ["gluetun","gluetun",[["username","password"],["apiKey"],[]]],
  ["gotify","gotify",[["username","password"]]],
  ["home-assistant","homeAssistant",[["apiKey"]]],
  ["immich","immich",[["apiKey"]]],
  ["jellyfin","jellyfin",[["username","password"],["apiKey"]]],
  ["lidarr","lidarr",[["apiKey"]]],
  ["linkwarden","linkwarden",[["apiKey"]]],
  ["navidrome","navidrome",[["username","password"]]],
  ["netdata","netdata",[[]]],
  ["nextcloud","nextcloud",[["username","password"]]],
  ["ntfy","ntfy",[["topic"],["topic","apiKey"]]],
  ["nzbget","nzbGet",[["username","password"]]],
  ["paperless-ngx","paperlessNgx",[["apiKey"]]],
  ["patchmon","patchmon",[["patchmonApiKey","patchmonApiSecret"]]],
  ["peanut","peaNut",[["username","password"],[]]],
  ["pihole","piHole",[["apiKey"],[]]],
  ["plex","plex",[["apiKey"]]],
  ["prometheus","prometheus",[[],["username","password"]]],
  ["prowlarr","prowlarr",[["apiKey"]]],
  ["qbittorrent","qBittorrent",[["apiKey"],["username","password"]]],
  ["radarr","radarr",[["apiKey"]]],
  ["sabnzbd","sabNzbd",[["apiKey"]]],
  ["seerr","seerr",[["apiKey"]]],
  ["slskd","slskd",[["apiKey"]]],
  ["sonarr","sonarr",[["apiKey"]]],
  ["speedtest-tracker","speedtestTracker",[["apiKey"]]],
  ["tdarr","tdarr",[[],["apiKey"]]],
  ["technitium-dns","technitiumDns",[["apiKey"],["username","password"]]],
  ["tracearr","tracearr",[["apiKey"]]],
  ["traefik","traefik",[[],["username","password"],["apiKey"]]],
  ["transmission","transmission",[["username","password"]]],
  ["umami","umami",[["username","password"],["apiKey"]]],
  ["uptime-kuma","uptimeKuma",[[],["slug"],["slug","apiKey"],["apiKey"]]],
  ["wud","wud",[[],["username","password"]]],
] as const;
const appsRoot = new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/", import.meta.url);
for (const id of ["restic", "borgmatic", "renovate"]) {
  const manifest = JSON.parse(readFileSync(new URL(`${id}/manifest.json`, appsRoot), "utf8"));
  const recipe = JSON.parse(readFileSync(new URL(`${id}/recipe.json`, appsRoot), "utf8"));
  const job = sharedHomarrPreparedJob(id, manifest, recipe)!;
  assert.equal(job.state, "prepared");
  assert.equal(job.executed, false);
  assert.equal(job.browserUrl, null);
  assert.equal(job.integrationKind, null);
  assert.equal(job.notebookStatus, "not-published");
  assert.throws(() => sharedHomarrPreparedJob(id, { ...manifest, id: "different" }, recipe), /differs/);
}
assert.equal(sharedHomarrPreparedJob("homarr", {}, { appId: "homarr" }), null);
assert.deepEqual(homarrIntegrationCredentials(homarrStackMapping("uptime-kuma")!, {}, { slug: "default" }),
  { credentials: { slug: "default" }, missing: [] });
assert.deepEqual(homarrIntegrationCredentials(homarrStackMapping("prometheus")!, { username: "admin", password: "fixture-only" }),
  { credentials: { username: "admin", password: "fixture-only" }, missing: [] });
assert.deepEqual(homarrIntegrationCredentials(homarrStackMapping("jellyfin")!, {
  username: "admin", password: "fixture-only", apiKey: "fixture-key" }),
  { credentials: { apiKey: "fixture-key" }, missing: [] });
const patchmon = homarrStackMapping("patchmon")!;
assert.deepEqual(homarrIntegrationCredentials(patchmon, { apiKey: JSON.stringify({ apiKey: "fixture-key", apiSecret: "fixture-secret" }) }),
  { credentials: { patchmonApiKey: "fixture-key", patchmonApiSecret: "fixture-secret" }, missing: [] });
assert.deepEqual(homarrIntegrationCredentials(patchmon, {}, { patchmonApiKey: "not-accepted", patchmonApiSecret: "not-accepted" }),
  { credentials: {}, missing: ["patchmonApiKey", "patchmonApiSecret"] });
assert.throws(() => homarrIntegrationCredentials(patchmon, { apiKey: "fixture-jwt-not-a-bundle" }), /malformed/);
assert.throws(() => homarrIntegrationCredentials(patchmon, { apiKey: JSON.stringify({ apiKey: "fixture-key", apiSecret: "fixture-secret", extra: "rejected" }) }), /malformed/);
const ids = readdirSync(appsRoot).filter((id) => /^[a-z0-9-]+$/.test(id));
const nativeIds = new Set(native.map(([id]) => id));
// Upstream supports anonymous modes, but these recipes mandate authenticated
// control APIs. Descriptor policy must not silently fall back before setup.
const authenticatedRecipes = new Set(["aria2", "tdarr", "pihole"]);
const sets = (value: readonly (readonly string[])[]) => value.map((set) => [...set].sort().join(",")).sort();
for (const id of ids) {
  const mapping = homarrStackMapping(id);
  assert.ok(mapping, `Missing descriptor: ${id}`);
  const descriptor = JSON.parse(readFileSync(new URL(`${id}/homarr.json`, appsRoot), "utf8"));
  assert.equal(descriptor.source, "https://github.com/homarr-labs/homarr/tree/beffe794022c22c43dd458999ee2a016bb1df2e6/packages");
  if (!nativeIds.has(id as any)) {
    assert.equal(mapping.integrationKind, null, `Unexpected native integration: ${id}`);
    assert.equal(mapping.tileOnly, true);
    assert.deepEqual(mapping.widgets, []);
    assert.deepEqual(mapping.requiredSecrets, []);
  }
}
for (const [id, kind, secrets] of native) {
  const mapping = homarrStackMapping(id)!;
  assert.equal(mapping.integrationKind, kind);
  const actual = sets([mapping.requiredSecrets, ...(mapping.alternativeSecrets ?? [])]);
  if (authenticatedRecipes.has(id)) {
    assert.ok(sets(secrets).includes("apiKey"), "Authenticated policy must be supported by pinned upstream");
    assert.deepEqual(actual, ["apiKey"]);
    assert.deepEqual(homarrIntegrationCredentials(mapping, {}), { credentials: {}, missing: ["apiKey"] });
    assert.deepEqual(homarrIntegrationCredentials(mapping, { apiKey: "fixture-saved-control-secret" }),
      { credentials: { apiKey: "fixture-saved-control-secret" }, missing: [] });
    assert.deepEqual(homarrIntegrationCredentials(mapping, { username: "admin", password: "fixture-password" }),
      { credentials: {}, missing: ["apiKey"] }, "A password placeholder is not a saved integration credential");
  } else {
    assert.deepEqual(actual, sets(secrets));
  }
}
assert.deepEqual(homarrStackMapping("patchmon")!.requiredSecrets, ["patchmonApiKey", "patchmonApiSecret"]);
assert.deepEqual(homarrStackWidgets("caddy"), []);
assert.deepEqual(homarrStackWidgets("frigate"), []);
assert.deepEqual(homarrStackWidgets("gatus"), []);
assert.deepEqual(homarrStackWidgets("linkwarden"), []);
assert.deepEqual(homarrStackWidgets("netdata"), []);
assert.deepEqual(homarrStackWidgets("prometheus"), []);
assert.deepEqual(homarrStackWidgets("umami"), []);
assert.deepEqual(homarrStackWidgets("umami", { umamiWebsiteId: "selected-website" })[0].options, { websiteId: "selected-website" });
assert.deepEqual(homarrStackWidgets("home-assistant").map((widget) => widget.kind), ["calendar"]);
assert.deepEqual(homarrStackWidgets("home-assistant", {
  homeAssistantEntityId: "sensor.selected",
  homeAssistantAutomationId: "automation.selected",
}).map((widget) => widget.options), [{}, { entityId: "sensor.selected" }, { automationId: "automation.selected" }]);
assert.equal(homarrStackWidgets("immich").some((widget) => widget.kind === "immich-albumCarousel"), false);
assert.equal(homarrStackWidgets("beszel").some((widget) => widget.kind === "beszelSystemStats"), false);
assert.deepEqual(homarrStackWidgets("immich", { immichAlbumId: "selected-album" })[1].options, { albumId: "selected-album" });
assert.deepEqual(homarrStackWidgets("beszel", { beszelSystemId: "selected-system" })[3].options, { systemId: "selected-system" });
assert.equal(homarrStackMapping("../invalid"), null);
console.log(`PASS ${ids.length} catalog Homarr descriptors (${native.length} native); synthetic, not live acceptance`);
