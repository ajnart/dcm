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
  [107, 14, 12, 2, 54, 2]
);
const registeredSkillIds = catalog.skills.skills.map((record) => record.id);
assert.deepEqual(registeredSkillIds, [...registeredSkillIds].sort());
assert.deepEqual(
  catalog.skills.skills.filter((record) => record.kind === "adapter").map((record) => [record.id, record.scope]),
  [["selfhost-homarr", "application"], ["selfhost-media", "stack"]]
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
assert.equal(genericMediaPlan.roles.find((role) => role.id === "dashboard").selected, null);
assert.equal(genericMediaPlan.roles.find((role) => role.id === "dashboard").recommended, true);
assert.deepEqual(genericMediaPlan.recommendations.map((recommendation) => [recommendation.kind, recommendation.status, recommendation.suggested]), [["optional-control-plane", "available", "homarr"]]);
assert.equal(genericMediaPlan.selectedApps.some((app) => app.id === "homarr"), false);
assert.equal(genericMediaPlan.requiredSkills.includes("selfhost-homarr"), false);
assert.equal(genericMediaPlan.requiredSkills.includes("selfhost-media"), false);
assert.equal(genericMediaPlan.acceptance.some((claim) => claim.includes("Homarr")), false);

const homarrMediaPlan = buildPlan(catalog, personalMedia, { dashboard: "homarr" });
assert.equal(homarrMediaPlan.planId === genericMediaPlan.planId, false);
assert.equal(homarrMediaPlan.selectedApps.some((app) => app.id === "homarr"), true);
assert.equal(homarrMediaPlan.requiredSkills.includes("selfhost-homarr"), true);
assert.equal(homarrMediaPlan.requiredSkills.includes("selfhost-media"), false);
assert.equal(homarrMediaPlan.gates.includes("exposure"), true);
assert.equal(homarrMediaPlan.gates.includes("secrets"), true);
assert.deepEqual(homarrMediaPlan.recommendations.map((recommendation) => [recommendation.status, recommendation.selected]), [["selected", "homarr"]]);
assert.equal(homarrMediaPlan.acceptance.filter((claim) => claim.includes("Homarr")).length, 4);
assert.equal(homarrMediaPlan.acceptance.some((claim) => claim.includes("app tile")), true);
assert.equal(homarrMediaPlan.acceptance.some((claim) => claim.includes("integration")), true);
assert.equal(homarrMediaPlan.acceptance.some((claim) => claim.includes("widget")), true);
assert.equal(homarrMediaPlan.acceptance.some((claim) => claim.includes("MCP bridge")), true);

assert.equal(buildPlan(catalog, personalMedia, { playback: "plex" }).effectiveAutomation, "guided");
assert.equal(buildPlan(catalog, personalMedia, { playback: "emby" }).effectiveAutomation, "discovery");
assert.throws(() => buildPlan(catalog, personalMedia, { unknown: "jellyfin" }), /Unknown selection role/);

const photos = catalog.stacks.find((stack) => stack.id === "photos");
const homarrPlan = buildPlan(catalog, photos, { dashboard: "homarr" });
assert.equal(homarrPlan.requiredSkills.includes("selfhost-homarr"), true);

const photoPrismPlan = buildPlan(catalog, photos, { "photo-library": "photoprism" });
assert.equal(photoPrismPlan.recommendations.length, 1);
assert.equal(photoPrismPlan.recommendations[0].status, "available");
assert.equal(photoPrismPlan.recommendations[0].coverageMode, "app-links-only");
assert.equal(photoPrismPlan.roles.find((role) => role.id === "dashboard").recommended, true);
assert.equal(photoPrismPlan.roles.find((role) => role.id === "dashboard").controlPlaneCoverage.supported.length, 0);

const changedCoverageCatalog = structuredClone(catalog);
const changedImmich = changedCoverageCatalog.apps.find((app) => app.id === "immich");
changedImmich.homarr = { support: "gap", integration: null };
const changedCoveragePlan = buildPlan(changedCoverageCatalog, photos);
assert.equal(changedCoveragePlan.recommendations.length, 1);
assert.equal(changedCoveragePlan.recommendations[0].coverageMode, "app-links-only");
assert.notEqual(changedCoveragePlan.planId, buildPlan(catalog, photos).planId);

const recommendedHomarrStacks = catalog.stacks
  .filter((stack) => stack.roles.some((role) => role.recommended === true))
  .map((stack) => stack.id)
  .sort();
assert.deepEqual(recommendedHomarrStacks, ["dns", "documents", "files", "home-automation", "monitoring", "personal-media", "photos"]);
for (const stackId of recommendedHomarrStacks) {
  const stack = catalog.stacks.find((candidate) => candidate.id === stackId);
  const role = stack.roles.find((candidate) => candidate.choices.includes("homarr"));
  assert.equal(role.recommended, true);
  assert.equal(role.required, false);
  assert.equal(role.default, null);
  const defaultPlan = buildPlan(catalog, stack);
  assert.equal(defaultPlan.selectedApps.some((app) => app.id === "homarr"), false);
  assert.equal(defaultPlan.requiredSkills.includes("selfhost-homarr"), false);
  assert.equal(defaultPlan.acceptance.some((claim) => claim.includes("Homarr")), false);
}

const impliedCatalog = structuredClone(catalog);
impliedCatalog.apps.find((app) => app.id === "immich").dependencies.push("homarr");
assert.equal(validateCatalog(impliedCatalog).errors.some((error) => error.includes("Homarr must be selected through an optional role")), true);

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

const invalidRecommendedType = structuredClone(catalog);
invalidRecommendedType.stacks.find((stack) => stack.id === "photos").roles.find((role) => role.id === "dashboard").recommended = "yes";
assert.equal(validateCatalog(invalidRecommendedType).errors.some((error) => error.includes("recommended must be boolean")), true);

const implicitRecommendation = structuredClone(catalog);
implicitRecommendation.stacks.find((stack) => stack.id === "photos").roles.find((role) => role.id === "dashboard").default = "homarr";
assert.equal(validateCatalog(implicitRecommendation).errors.some((error) => error.includes("recommended role must remain off by default")), true);

const requiredRecommendation = structuredClone(catalog);
requiredRecommendation.stacks.find((stack) => stack.id === "photos").roles.find((role) => role.id === "dashboard").required = true;
assert.equal(validateCatalog(requiredRecommendation).errors.some((error) => error.includes("recommended role must be optional")), true);

const unmarkedHomarrRole = structuredClone(catalog);
delete unmarkedHomarrRole.stacks.find((stack) => stack.id === "photos").roles.find((role) => role.id === "dashboard").recommended;
assert.equal(validateCatalog(unmarkedHomarrRole).errors.some((error) => error.includes("Homarr role must be recommended")), true);

const unconditionalHomarrAcceptance = structuredClone(catalog);
unconditionalHomarrAcceptance.stacks.find((stack) => stack.id === "photos").acceptance.push("Homarr must pass.");
assert.equal(validateCatalog(unconditionalHomarrAcceptance).errors.some((error) => error.includes("Homarr acceptance must be conditional")), true);

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
