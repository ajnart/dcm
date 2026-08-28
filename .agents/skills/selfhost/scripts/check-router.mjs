#!/usr/bin/env node

import assert from "node:assert/strict";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlan, loadCatalog, resolveStack, validateCatalog } from "./catalog.mjs";
import { preferencesPathForProjectRoot, resolvePreferencesPath } from "./preferences.mjs";

const catalog = await loadCatalog();
const validation = validateCatalog(catalog);
assert.equal(validation.valid, true);
assert.deepEqual(
  [validation.counts.apps, validation.counts.stacks, validation.counts.homarrStandardCovered, validation.counts.homarrSpecialCovered],
  [107, 13, 54, 2]
);

const skillDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
assert.throws(() => resolvePreferencesPath(), /explicit absolute path/);
assert.throws(() => resolvePreferencesPath("relative/preferences.json"), /explicit absolute path/);
assert.throws(() => resolvePreferencesPath(join(skillDirectory, "..data", "preferences.json")), /installed skill directory/);
await assert.rejects(() => preferencesPathForProjectRoot(skillDirectory), /installed skill directory/);
await assert.rejects(() => preferencesPathForProjectRoot(parse(process.cwd()).root), /filesystem root/);
assert.equal(await preferencesPathForProjectRoot(process.cwd()), join(process.cwd(), ".selfhost", "preferences.json"));

const compositeCases = new Map([
  ["photos and backups", ["photos", "backups"]],
  ["replace google photos and dropbox", ["photos", "files"]],
  ["photos and remote access", ["photos", "remote-access"]],
  ["make Immich private on my phone", ["photos", "remote-access"]]
]);
for (const [query, expected] of compositeCases) {
  const result = resolveStack(catalog, query);
  assert.equal(result.kind, "composite");
  assert.equal(result.needsComposition, true);
  assert.deepEqual(result.components.map((component) => component.id), expected);
}
assert.equal(resolveStack(catalog, "profiles").kind, "none");
assert.equal(resolveStack(catalog, "profiles and backups").stack.id, "backups");

const vpn = resolveStack(catalog, "vpn");
assert.equal(vpn.kind, "ambiguous");
assert.deepEqual(vpn.candidates.slice(0, 2).map((candidate) => candidate.id), ["download-privacy", "remote-access"]);

const personalMedia = catalog.stacks.find((stack) => stack.id === "personal-media");
const managedPlan = buildPlan(catalog, personalMedia);
assert.equal(managedPlan.effectiveAutomation, "managed");
assert.deepEqual(managedPlan.requiredSkills, [...managedPlan.requiredSkills].sort());
assert.deepEqual(managedPlan.requiredSkills.filter((skill) => ["selfhost-homarr", "selfhost-media"].includes(skill)), ["selfhost-homarr", "selfhost-media"]);
assert.equal(buildPlan(catalog, personalMedia, { playback: "plex" }).effectiveAutomation, "guided");
assert.equal(buildPlan(catalog, personalMedia, { playback: "emby" }).effectiveAutomation, "discovery");
assert.throws(() => buildPlan(catalog, personalMedia, { unknown: "jellyfin" }), /Unknown selection role/);

const photos = catalog.stacks.find((stack) => stack.id === "photos");
const homarrPlan = buildPlan(catalog, photos, { dashboard: "homarr" });
assert.equal(homarrPlan.requiredSkills.includes("selfhost-homarr"), true);

const impliedCatalog = structuredClone(catalog);
impliedCatalog.apps.find((app) => app.id === "immich").dependencies.push("homarr");
const impliedPlan = buildPlan(impliedCatalog, photos);
assert.equal(impliedPlan.requiredSkills.includes("selfhost-homarr"), true);

assert.throws(() => buildPlan(catalog, personalMedia, { playback: "readarr" }), /retired/);

for (const malformedTaxonomy of [null, {}, { ambiguousAliases: {} }, { categories: {} }]) {
  const malformed = structuredClone(catalog);
  malformed.taxonomy = malformedTaxonomy;
  const result = validateCatalog(malformed);
  assert.equal(result.valid, false);
  assert.equal(result.errors.length > 0, true);
}

const unknownAdapter = structuredClone(catalog);
unknownAdapter.apps.find((app) => app.id === "homarr").support.adapterSkill = "selfhost-missing";
assert.equal(validateCatalog(unknownAdapter).errors.some((error) => error.includes("not available as an adapter in this skill pack")), true);

const unknownRequiredSkill = structuredClone(catalog);
unknownRequiredSkill.stacks[0].requiredSkills.push("selfhost-missing");
assert.equal(validateCatalog(unknownRequiredSkill).errors.some((error) => error.includes("required skill selfhost-missing is not available")), true);

const retiredChoice = structuredClone(catalog);
retiredChoice.stacks.find((stack) => stack.id === "photos").roles[0].choices.push("readarr");
assert.equal(validateCatalog(retiredChoice).errors.some((error) => error.includes("choice readarr is retired")), true);

process.stdout.write("selfhost router checks passed\n");
