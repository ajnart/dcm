import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAppRecipe } from "../../../.agents/skills/self-host/workflows/selfhost/scripts/catalog.ts";
import { isRecipeImageReference } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/recipe-image-reference.ts";

const catalogDirectory = new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/", import.meta.url);
const app = JSON.parse(await readFile(new URL("apps/archive-team-warrior/manifest.json", catalogDirectory), "utf8"));
assert.equal(app.image.reference, "atdr.meo.ws/archiveteam/warrior-dockerfile@sha256:19337aa9157e04f6cdb8f7c6f8c98e27d14efb0d9525334995fbdb036b95e1ca");
assert.equal(isRecipeImageReference(app.image.reference), true);
assert.equal(app.image.status, "known");
assert.equal(app.support.automation, "discovery");
assert.equal(app.cliSetup, undefined);
assert.match(app.lifecycle.note, /installed runner provenance are verified/);
assert.match(app.lifecycle.note, /writable private config\/resume inspection/);
const provenance = JSON.parse(await readFile(new URL("apps/archive-team-warrior/runtime-provenance.json", catalogDirectory), "utf8"));
assert.equal(provenance.runnerRevision, "bb6673d27a8717e13efe5d7deb3628349cd08585");
assert.equal(provenance.runnerVersion, "0.10.3");
assert.equal(provenance.imageDigest, app.image.reference.split("@")[1]);
assert.equal(Object.keys(provenance.byteMatchedSources).length, 6);
assert.ok(provenance.startupEffects.some((value: string) => value.includes("every ten minutes")));
const missingInterface = app.pitfalls.find((value: string) => value.startsWith("Missing install interfaces:"));
for (const boundary of ["before start", "selected_project=none", "resource/bandwidth budget", "owner-private config", "Basic login", "SockJS", "not zero external work", "No socket, Watchtower"]) {
  assert.ok(missingInterface.includes(boundary), `Missing exact install boundary: ${boundary}`);
}
assert.equal(await loadAppRecipe({ apps: [app] }, app.id, resolve(fileURLToPath(catalogDirectory))), null,
  "Missing private mutable config/startup guard must not create a startable recipe");
console.log("Warrior immutable image/provenance and exact private-config/startup blocker: pass (source-only).");
