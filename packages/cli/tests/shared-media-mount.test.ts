import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { sharedProjectCandidate } from "../src/lib/shared-compose-project.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";

const catalog = join(import.meta.dir, "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps");
const jellyfin = JSON.parse(await readFile(join(catalog, "jellyfin/recipe.json"), "utf8"));
const sonarr = JSON.parse(await readFile(join(catalog, "sonarr/recipe.json"), "utf8"));
const projectId = "shared-media-test";
const mediaPath = "/tmp/selfhost-shared-media-test";
const observed = {
  checkedAt: "2026-09-29T12:00:00Z",
  ports: [], networks: [], volumes: [],
  paths: [{ path: mediaPath, owner: projectId }],
};
const selections = [
  { appId: "jellyfin", recipe: jellyfin, port: 18096,
    images: { jellyfin: `${jellyfin.services[0].imageTag}@sha256:${"a".repeat(64)}` },
    hostPaths: { "media-library": mediaPath } },
  { appId: "sonarr", recipe: sonarr, port: 18989,
    images: { sonarr: `${sonarr.services[0].imageTag}@sha256:${"b".repeat(64)}` },
    hostPaths: { "media-data": mediaPath } },
];

function candidate(apps = selections, host = observed) {
  return sharedProjectCandidate({ projectRoot: "/tmp/selfhost-media-project", projectId,
    dockerContext: "default", uid: 1000, gid: 1000, timezone: "Etc/UTC",
    apps, observed: host });
}

const matching = candidate();
const jellyfinMount = matching.manifest.services.find((service: { id: string }) => service.id === "jellyfin")
  .mounts.find((mount: { target: string }) => mount.target === "/data");
const sonarrMount = matching.manifest.services.find((service: { id: string }) => service.id === "sonarr")
  .mounts.find((mount: { target: string }) => mount.target === "/data");
assert.equal(jellyfinMount.readOnly, true);
assert.equal(sonarrMount.readOnly, false);
assert.equal(jellyfinMount.shareGroup, "media-data");
assert.equal(sonarrMount.shareGroup, "media-data");
assert.equal(jellyfinMount.source, sonarrMount.source);
assert.equal((await createSelfhostComposeOwner(matching.manifest).plan()).status, "pass");

const mismatched = structuredClone(selections);
mismatched[0].recipe.services[0].mounts[2].shareGroup = "another-group";
await assert.rejects(createSelfhostComposeOwner(candidate(mismatched).manifest).plan(), /desired-path-overlap/);

const externallyOwned = structuredClone(observed);
externallyOwned.paths[0].owner = "external-owner";
assert.throws(() => candidate(selections, externallyOwned), /cannot write an externally owned/);
assert.equal((await createSelfhostComposeOwner(candidate([selections[0]], externallyOwned).manifest).plan()).status, "pass");

const nested = structuredClone(selections);
nested[0].hostPaths["media-library"] = `${mediaPath}/movies`;
const nestedObserved = structuredClone(observed);
nestedObserved.paths.push({ path: `${mediaPath}/movies`, owner: projectId });
await assert.rejects(createSelfhostComposeOwner(candidate(nested, nestedObserved).manifest).plan(), /desired-path-overlap/);

process.stdout.write("shared media mount checks passed\n");
