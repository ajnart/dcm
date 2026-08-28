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
  [validation.counts.apps, validation.counts.stacks, validation.counts.skills, validation.counts.adapters, validation.counts.homarrStandardCovered, validation.counts.homarrSpecialCovered],
  [107, 13, 12, 2, 54, 2]
);
const registeredSkillIds = catalog.skills.skills.map((record) => record.id);
assert.deepEqual(registeredSkillIds, [...registeredSkillIds].sort());
assert.deepEqual(catalog.skills.skills.filter((record) => record.adapter).map((record) => record.id), ["selfhost-homarr", "selfhost-media"]);

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

const ambiguousCompositeCases = new Map([
  ["photos and VPN", ["photos"]],
  ["VPN and backups", ["backups"]]
]);
for (const [query, expectedComponents] of ambiguousCompositeCases) {
  const result = resolveStack(catalog, query);
  assert.equal(result.kind, "composite");
  assert.equal(result.needsComposition, true);
  assert.equal(result.needsClarification, true);
  assert.equal(result.requiredAction, "choose-unresolved-intents-before-planning");
  assert.deepEqual(result.components.map((component) => component.id), expectedComponents);
  assert.deepEqual(result.unresolvedIntents.map((intent) => intent.intent), ["vpn"]);
  assert.deepEqual(result.unresolvedIntents[0].candidates.map((candidate) => candidate.id), ["download-privacy", "remote-access"]);
}

const vpn = resolveStack(catalog, "vpn");
assert.equal(vpn.kind, "ambiguous");
assert.equal(vpn.needsComposition, false);
assert.deepEqual(vpn.candidates.slice(0, 2).map((candidate) => candidate.id), ["download-privacy", "remote-access"]);
assert.equal(resolveStack(catalog, "route qBittorrent through VPN").stack.id, "download-privacy");

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

const malformedSkillRegistry = structuredClone(catalog);
malformedSkillRegistry.skills.extra = true;
assert.equal(validateCatalog(malformedSkillRegistry).errors.some((error) => error.includes("skills: registry contains missing or unsupported fields")), true);

const duplicateSkillRegistry = structuredClone(catalog);
duplicateSkillRegistry.skills.skills.push(structuredClone(duplicateSkillRegistry.skills.skills[0]));
assert.equal(validateCatalog(duplicateSkillRegistry).errors.some((error) => error.includes("skills: duplicate id selfhost")), true);

const unsortedSkillRegistry = structuredClone(catalog);
unsortedSkillRegistry.skills.skills.reverse();
assert.equal(validateCatalog(unsortedSkillRegistry).errors.some((error) => error.includes("skills: records must be sorted by id")), true);

const retiredChoice = structuredClone(catalog);
retiredChoice.stacks.find((stack) => stack.id === "photos").roles[0].choices.push("readarr");
assert.equal(validateCatalog(retiredChoice).errors.some((error) => error.includes("choice readarr is retired")), true);

process.stdout.write("selfhost router checks passed\n");
