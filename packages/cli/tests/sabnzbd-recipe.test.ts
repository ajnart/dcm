import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { sharedProjectCandidate } from "../src/lib/shared-compose-project.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";

const catalog = join(import.meta.dir, "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps");
const sabnzbd = JSON.parse(await readFile(join(catalog, "sabnzbd/recipe.json"), "utf8"));
const sonarr = JSON.parse(await readFile(join(catalog, "sonarr/recipe.json"), "utf8"));
const projectId = "shared-usenet-test";
const mediaPath = "/tmp/selfhost-usenet-media";
const candidate = sharedProjectCandidate({ projectRoot: "/tmp/selfhost-usenet-project",
  projectId, dockerContext: "default", uid: 1000, gid: 1000, timezone: "Etc/UTC",
  apps: [
    { appId: "sabnzbd", recipe: sabnzbd, port: 18080,
      images: { sabnzbd: `${sabnzbd.services[0].imageTag}@sha256:${"a".repeat(64)}` },
      hostPaths: { "media-data": mediaPath } },
    { appId: "sonarr", recipe: sonarr, port: 18989,
      images: { sonarr: `${sonarr.services[0].imageTag}@sha256:${"b".repeat(64)}` },
      hostPaths: { "media-data": mediaPath } },
  ],
  observed: { checkedAt: "2026-09-29T12:00:00Z", ports: [], networks: [], volumes: [],
    paths: [{ path: mediaPath, owner: projectId }] } });

assert.equal(sabnzbd.onboarding.kind, "manual-first-admin");
assert.equal(sabnzbd.services[0].healthcheck, undefined);
assert.equal(sabnzbd.services[0].mounts[1].target, "/data");
assert.equal(candidate.manifest.services.find((service: { id: string }) => service.id === "sabnzbd")
  .mounts.find((mount: { target: string }) => mount.target === "/data").readOnly, false);
assert.equal((await createSelfhostComposeOwner(candidate.manifest).plan()).status, "pass");

process.stdout.write("SABnzbd recipe checks passed\n");
