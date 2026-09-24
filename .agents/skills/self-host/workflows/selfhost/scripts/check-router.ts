#!/usr/bin/env bun

import assert from "node:assert/strict";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlan, loadCatalog, resolvePlanTarget, resolveStack, stackForGoalId, validateCatalog } from "./catalog.ts";
import { preferencesPathForProjectRoot, resolvePreferencesPath, validatePreferencesDocument } from "./preferences.ts";

const catalog = await loadCatalog();
const validation = validateCatalog(catalog);
assert.equal(validation.valid, true);
assert.deepEqual(
  [validation.counts.apps, validation.counts.stacks, validation.counts.skills, validation.counts.adapters, validation.counts.homarrStandardCovered, validation.counts.homarrSpecialCovered],
  [111, 20, 15, 2, 54, 2]
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
const preferenceRecord = (value) => ({ value, source: "chosen", updatedAt: "2026-09-24T13:30:00Z" });
assert.equal(validatePreferencesDocument({
  schemaVersion: 1,
  updatedAt: "2026-09-24T13:30:00Z",
  choices: { "onboarding.experience": preferenceRecord("new") },
}).valid, true);
assert.equal(validatePreferencesDocument({
  schemaVersion: 1,
  updatedAt: "2026-09-24T13:30:00Z",
  choices: { "onboarding.experience": preferenceRecord("advanced") },
}).valid, true);
assert.equal(validatePreferencesDocument({
  schemaVersion: 1,
  updatedAt: "2026-09-24T13:30:00Z",
  choices: { "onboarding.experience": preferenceRecord("beginner") },
}).valid, false);

const compositeCases = new Map([
  ["photos and backups", ["photos", "backups"]],
  ["photos and remote access", ["photos", "remote-access"]],
  ["make Immich private on my phone", ["photos", "remote-access"]]
]);
for (const [query, expected] of compositeCases) {
  const result = resolveStack(catalog, query);
  assert.equal(result.kind, "composite");
  assert.equal(result.needsComposition, true);
  assert.deepEqual(result.components.map((component) => component.id), expected);
}
const photosAndFilesResolution = resolvePlanTarget(catalog, "replace google photos and google drive");
assert.equal(photosAndFilesResolution.kind, "single");
assert.equal(photosAndFilesResolution.stack.id, "photos-and-files");
assert.deepEqual(buildPlan(catalog, photosAndFilesResolution.stack).selectedApps.map((app) => app.id), ["homarr", "immich", "nextcloud", "postgresql", "valkey"]);
for (const query of ["Google Photos, OneDrive", "replace Dropbox and Google Photos", "Google Photos + Microsoft OneDrive"]) {
  const resolution = resolvePlanTarget(catalog, query);
  assert.equal(resolution.kind, "single");
  assert.equal(resolution.stack.id, "photos-and-files");
  const selectedIds = buildPlan(catalog, resolution.stack).selectedApps.map((app) => app.id);
  assert.equal(selectedIds.includes("immich"), true);
  assert.equal(selectedIds.filter((id) => id === "nextcloud").length, 1);
}

const cloudReplacement = resolvePlanTarget(catalog, "replace Google Drive Microsoft OneDrive Dropbox");
assert.equal(cloudReplacement.stack.id, "files");
const cloudReplacementPlan = buildPlan(catalog, cloudReplacement.stack);
assert.deepEqual(cloudReplacementPlan.selectedApps.map((app) => app.id), ["homarr", "nextcloud", "postgresql", "valkey"]);
assert.equal(cloudReplacementPlan.selectedApps.filter((app) => app.id === "nextcloud").length, 1);

const consumerPlans = new Map([
  ["replace netflix", ["homarr", "jellyfin"]],
  ["password manager", ["homarr", "vaultwarden"]],
  ["smart speaker", ["homarr", "home-assistant"]],
  ["audio books and music", ["homarr", "audiobookshelf", "navidrome"]],
  ["personal finance", ["homarr", "actual-budget"]],
  ["productivity", ["homarr", "anytype"]]
]);
for (const [query, expectedApps] of consumerPlans) {
  const resolution = resolvePlanTarget(catalog, query);
  assert.equal(resolution.kind, "single");
  const plan = buildPlan(catalog, resolution.stack);
  assert.deepEqual(plan.selectedApps.map((app) => app.id), expectedApps);
}
const punctuatedAudio = resolvePlanTarget(catalog, "audio books , music ,");
assert.equal(punctuatedAudio.stack.id, "audio-library");
assert.deepEqual(buildPlan(catalog, punctuatedAudio.stack).selectedApps.map((app) => app.id), ["homarr", "audiobookshelf", "navidrome"]);
assert.deepEqual(buildPlan(catalog, resolvePlanTarget(catalog, "music").stack).selectedApps.map((app) => app.id), ["homarr", "navidrome"]);
assert.deepEqual(buildPlan(catalog, resolvePlanTarget(catalog, "audiobooks").stack).selectedApps.map((app) => app.id), ["homarr", "audiobookshelf"]);
assert.equal(buildPlan(catalog, resolvePlanTarget(catalog, "personal finance").stack, { finance: "firefly-iii" }).selectedApps.some((app) => app.id === "firefly-iii"), true);
assert.equal(buildPlan(catalog, resolvePlanTarget(catalog, "smart home").stack, { cameras: "scrypted" }).selectedApps.some((app) => app.id === "scrypted"), true);
assert.equal(buildPlan(catalog, resolvePlanTarget(catalog, "productivity").stack, { notes: "obsidian" }).selectedApps.some((app) => app.id === "obsidian"), true);

const fullExpectedApps = [
  "homarr", "jellyfin", "seerr", "sonarr", "radarr", "prowlarr", "qbittorrent",
  "immich", "nextcloud", "navidrome", "audiobookshelf", "vaultwarden", "postgresql", "valkey"
];
for (const query of ["full", "full homelab", "everything for my homelab"]) {
  const resolution = resolvePlanTarget(catalog, query);
  assert.equal(resolution.kind, "single");
  assert.equal(resolution.stack.id, "full");
  const plan = buildPlan(catalog, resolution.stack);
  assert.deepEqual(plan.selectedApps.map((app) => app.id), fullExpectedApps);
  assert.equal(plan.selectedApps.filter((app) => app.id === "homarr").length, 1);
  assert.equal(plan.roles.find((role) => role.id === "home-automation").selected, null);
  assert.equal(plan.effectiveAutomation, "guided");
  assert.deepEqual(plan.setupStages.map((stage) => [stage.id, stage.owner, stage.mode]), [
    ["media", "selfhost-media", "hybrid"],
    ["household-apps", "selfhost-compose", "guided"],
    ["home-automation", "selfhost-compose", "optional"]
  ]);
}
const fullWithHomeAssistant = buildPlan(catalog, resolvePlanTarget(catalog, "full").stack, { "home-automation": "home-assistant" });
assert.equal(fullWithHomeAssistant.selectedApps.some((app) => app.id === "home-assistant"), true);
assert.deepEqual(fullWithHomeAssistant.setupStages.find((stage) => stage.id === "home-automation").apps, ["home-assistant"]);
assert.equal(resolveStack(catalog, "full sync").kind, "none");
assert.equal(resolvePlanTarget(catalog, "jellyfin").stack.id, "application-jellyfin");
assert.equal(resolveStack(catalog, "profiles").kind, "none");
assert.equal(resolveStack(catalog, "profiles and backups").stack.id, "backups");

for (const [query, expectedApps] of [
  ["sonarr", ["homarr", "sonarr", "prowlarr", "qbittorrent"]],
  ["jellyfin", ["homarr", "jellyfin"]]
]) {
  const resolution = resolvePlanTarget(catalog, query);
  assert.equal(resolution.kind, "application");
  assert.equal(resolution.stack.id, `application-${query}`);
  const plan = buildPlan(catalog, resolution.stack);
  assert.deepEqual(plan.selectedApps.map((app) => app.id), expectedApps);
  assert.equal(plan.roles.find((role) => role.id === "application").selected, query);
  assert.equal(plan.roles.some((role) => role.id === "requests"), false);
  assert.equal(plan.requiredSkills.includes("selfhost-homarr"), true);
  assert.equal(stackForGoalId(catalog, resolution.stack.id).id, resolution.stack.id);
}
assert.equal(resolvePlanTarget(catalog, "photos").stack.id, "photos");
assert.equal(resolvePlanTarget(catalog, "not-a-real-service").kind, "none");

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
assert.equal(genericMediaPlan.roles.find((role) => role.id === "control-plane").required, false);
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
  assert.equal(controlPlane.required, false);
  assert.equal(controlPlane.selected, "homarr");
  assert.equal(defaultPlan.selectedApps.some((app) => app.id === "homarr"), true);
  assert.equal(defaultPlan.requiredSkills.includes("selfhost-homarr"), true);
  assert.equal(defaultPlan.acceptance.filter((claim) => claim.includes("Homarr")).length >= 4, true);
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

const requiredControlPlane = structuredClone(catalog);
requiredControlPlane.taxonomy.defaultControlPlane.required = true;
assert.equal(validateCatalog(requiredControlPlane).errors.some((error) => error.includes("defaultControlPlane: must be optional")), true);

const appOnlyMedia = buildPlan(catalog, personalMedia, { "control-plane": "none" });
assert.equal(appOnlyMedia.selectedApps.some((app) => app.id === "homarr"), false);
assert.equal(appOnlyMedia.requiredSkills.includes("selfhost-homarr"), false);
assert.equal(appOnlyMedia.acceptance.some((claim) => /homarr/i.test(claim)), false);

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
assert.equal(validateCatalog(duplicateSkillRegistry).errors.some((error) => error.includes("skills: duplicate id self-host")), true);

const unsortedSkillRegistry = structuredClone(catalog);
unsortedSkillRegistry.skills.skills.reverse();
assert.equal(validateCatalog(unsortedSkillRegistry).errors.some((error) => error.includes("skills: records must be sorted by id")), true);

const retiredChoice = structuredClone(catalog);
retiredChoice.stacks.find((stack) => stack.id === "photos").roles[0].choices.push("readarr");
assert.equal(validateCatalog(retiredChoice).errors.some((error) => error.includes("choice readarr is retired")), true);

process.stdout.write("selfhost router checks passed\n");
