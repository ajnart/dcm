#!/usr/bin/env bun

import assert from "node:assert/strict";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlan, loadCatalog, resolveStack, validateCatalog } from "./catalog.ts";
import { preferencesPathForProjectRoot, resolvePreferencesPath } from "./preferences.ts";

const catalog = await loadCatalog();
const validation = validateCatalog(catalog);
assert.equal(validation.valid, true);
assert.deepEqual(
  [validation.counts.apps, validation.counts.stacks, validation.counts.skills, validation.counts.adapters, validation.counts.homarrStandardCovered, validation.counts.homarrSpecialCovered],
  [107, 14, 14, 2, 54, 2]
);
const registeredSkillIds = catalog.skills.skills.map((record) => record.id);
assert.deepEqual(registeredSkillIds, [...registeredSkillIds].sort());
assert.deepEqual(
  catalog.skills.skills.filter((record) => record.kind === "adapter").map((record) => [record.id, record.scope]),
  [["selfhost-homarr", "application"], ["selfhost-media", "stack"]]
);
assert.deepEqual(
  catalog.skills.skills.filter((record) => record.kind === "workflow").map((record) => [record.id, record.activation]),
  [["selfhost-setup", "explicit"], ["selfhost-upkeep", "explicit"]]
);
assert.equal(catalog.apps.some((app) => app.support.adapterSkill === "selfhost-media"), false);

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

const explicitHomarr = resolveStack(catalog, "homarr");
assert.equal(explicitHomarr.kind, "single");
assert.equal(explicitHomarr.stack.id, "homarr-control-plane");
const explicitHomarrPlan = buildPlan(catalog, explicitHomarr.stack);
assert.equal(explicitHomarrPlan.selectedApps.some((app) => app.id === "homarr"), true);
assert.equal(explicitHomarrPlan.requiredSkills.includes("selfhost-homarr"), true);
assert.equal(explicitHomarrPlan.requiredSkills.includes("selfhost-media"), false);
assert.equal(explicitHomarrPlan.acceptance.filter((claim) => claim.includes("Homarr")).length, 4);

const personalMedia = catalog.stacks.find((stack) => stack.id === "personal-media");
const genericMediaPlan = buildPlan(catalog, personalMedia);
assert.equal(genericMediaPlan.effectiveAutomation, "guided");
assert.deepEqual(genericMediaPlan.requiredSkills, [...genericMediaPlan.requiredSkills].sort());
assert.equal(genericMediaPlan.roles.find((role) => role.id === "control-plane").selected, "homarr");
assert.equal(genericMediaPlan.roles.find((role) => role.id === "control-plane").required, true);
assert.equal(genericMediaPlan.selectedApps.some((app) => app.id === "homarr"), true);
assert.equal(genericMediaPlan.requiredSkills.includes("selfhost-homarr"), true);
assert.equal(genericMediaPlan.requiredSkills.includes("selfhost-media"), false);
assert.equal(genericMediaPlan.gates.includes("exposure"), true);
assert.equal(genericMediaPlan.gates.includes("secrets"), true);
assert.equal(genericMediaPlan.acceptance.filter((claim) => claim.includes("Homarr")).length, 4);
assert.equal(genericMediaPlan.acceptance.some((claim) => claim.includes("app tile")), true);
assert.equal(genericMediaPlan.acceptance.some((claim) => claim.includes("integration")), true);
assert.equal(genericMediaPlan.acceptance.some((claim) => claim.includes("widget")), true);
assert.equal(genericMediaPlan.acceptance.some((claim) => claim.includes("MCP bridge")), true);

assert.equal(buildPlan(catalog, personalMedia, { playback: "plex" }).effectiveAutomation, "guided");
assert.equal(buildPlan(catalog, personalMedia, { playback: "emby" }).effectiveAutomation, "discovery");
assert.throws(() => buildPlan(catalog, personalMedia, { unknown: "jellyfin" }), /Unknown selection role/);

const photos = catalog.stacks.find((stack) => stack.id === "photos");
const homarrPlan = buildPlan(catalog, photos);
assert.equal(homarrPlan.requiredSkills.includes("selfhost-homarr"), true);

const photoPrismPlan = buildPlan(catalog, photos, { "photo-library": "photoprism" });
assert.equal(photoPrismPlan.roles.find((role) => role.id === "control-plane").controlPlaneCoverage.supported.length, 0);

const changedCoverageCatalog = structuredClone(catalog);
const changedImmich = changedCoverageCatalog.apps.find((app) => app.id === "immich");
changedImmich.homarr = { support: "gap", integration: null };
const changedCoveragePlan = buildPlan(changedCoverageCatalog, photos);
assert.equal(changedCoveragePlan.roles.find((role) => role.id === "control-plane").controlPlaneCoverage.supported.length, 0);
assert.notEqual(changedCoveragePlan.planId, buildPlan(catalog, photos).planId);

for (const stack of catalog.stacks) {
  const defaultPlan = buildPlan(catalog, stack);
  const controlPlane = defaultPlan.roles.find((role) => role.id === "control-plane");
  assert.equal(controlPlane.required, true);
  assert.equal(controlPlane.selected, "homarr");
  assert.equal(defaultPlan.selectedApps.some((app) => app.id === "homarr"), true);
  assert.equal(defaultPlan.requiredSkills.includes("selfhost-homarr"), true);
  assert.equal(defaultPlan.acceptance.filter((claim) => claim.includes("Homarr")).length, 4);
}

const impliedCatalog = structuredClone(catalog);
impliedCatalog.apps.find((app) => app.id === "immich").dependencies.push("homarr");
assert.equal(validateCatalog(impliedCatalog).errors.some((error) => error.includes("Homarr is injected as the default control plane")), true);

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
assert.equal(validateCatalog(unknownAdapter).errors.some((error) => error.includes("not available as an application adapter in this skill pack")), true);

const optionalControlPlane = structuredClone(catalog);
optionalControlPlane.taxonomy.defaultControlPlane.required = false;
assert.equal(validateCatalog(optionalControlPlane).errors.some((error) => error.includes("defaultControlPlane: must be required")), true);

const wrongControlPlaneDefault = structuredClone(catalog);
wrongControlPlaneDefault.taxonomy.defaultControlPlane.default = null;
assert.equal(validateCatalog(wrongControlPlaneDefault).errors.some((error) => error.includes("defaultControlPlane: default must be homarr")), true);

const wrongControlPlaneChoices = structuredClone(catalog);
wrongControlPlaneChoices.taxonomy.defaultControlPlane.choices.push("homepage");
assert.equal(validateCatalog(wrongControlPlaneChoices).errors.some((error) => error.includes("defaultControlPlane: choices must contain only homarr")), true);

const invalidApplicationScope = structuredClone(catalog);
invalidApplicationScope.skills.skills.find((skill) => skill.id === "selfhost-homarr").scope = "stack";
assert.equal(validateCatalog(invalidApplicationScope).errors.some((error) => error.includes("not available as an application adapter")), true);

const invalidNonAdapterScope = structuredClone(catalog);
invalidNonAdapterScope.skills.skills.find((skill) => skill.id === "selfhost-compose").scope = "application";
assert.equal(validateCatalog(invalidNonAdapterScope).errors.some((error) => error.includes("non-adapter scope must be null")), true);

const implicitStackAdapter = structuredClone(catalog);
implicitStackAdapter.stacks.find((stack) => stack.id === "personal-media").requiredSkills.push("selfhost-media");
assert.equal(validateCatalog(implicitStackAdapter).errors.some((error) => error.includes("specialized adapter selfhost-media cannot be an implicit required skill")), true);

const implicitApplicationAdapter = structuredClone(catalog);
implicitApplicationAdapter.stacks.find((stack) => stack.id === "personal-media").requiredSkills.push("selfhost-homarr");
assert.equal(validateCatalog(implicitApplicationAdapter).errors.some((error) => error.includes("specialized adapter selfhost-homarr cannot be an implicit required skill")), true);

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
