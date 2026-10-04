#!/usr/bin/env bun

import { strict as assert } from "node:assert";
import { householdAdoptedAllInterfaceKey, householdAppPortSet, householdBeginArgs, householdCatalogSupported, householdFullReviewArgs, householdMediaWebHandoff, householdParallelAdapterReview, householdParallelPlan, householdParallelPorts, householdPortCandidates, householdPortSet, householdReviewRunArgs, reviewedExistingMedia, reviewedHouseholdPlan, reviewedMediaWebHostReport, unavailableHouseholdPorts, type HouseholdChoices } from "../src/interactive-household.ts";

const choices: HouseholdChoices = {
  root: "/tmp/selfhost-household-test",
  id: "home",
  username: "admin",
  email: "admin@home.invalid",
  name: "Home Admin",
  vaultwardenOrigin: "https://vaultwarden.localhost:28443",
  routeOwner: "caddy-local-pending",
  tlsOwner: "caddy-local-pending",
};
const args = householdBeginArgs(choices);
assert.deepEqual(args.slice(0, 4), ["bundle", "begin", "--project-root", choices.root]);
assert.ok(args.includes("--resolve-images"));
assert.deepEqual(args.slice(-3), ["--resolve-images", "--media-bind-mode", "host-only"]);
assert.throws(() => householdBeginArgs({ ...choices, vaultwardenOrigin: "http://vaultwarden.localhost" }), /HTTPS origin/);
assert.throws(() => householdBeginArgs({ ...choices, ports: { immich: 2283, docmost: 2283, vaultwarden: 8080 } }), /distinct ports/);
const isolated = householdPortCandidates(32383);
const selected = householdPortSet(isolated);
assert.deepEqual(selected, [32383, 32384, 32385, 32393, 32394, 32395, 32396, 32397, 32398, 32399]);
assert.deepEqual(householdAppPortSet(isolated), [32383, 32384, 32385]);
const inspected = { network: { selectedTcpPorts: { state: "observed", complete: true,
  items: selected.map((port) => ({ port, inUse: port === 32385 })) } } };
assert.deepEqual(unavailableHouseholdPorts(inspected, selected), [32385]);
assert.throws(() => unavailableHouseholdPorts({ network: { selectedTcpPorts: { ...inspected.network.selectedTcpPorts,
  complete: false } } }, selected), /incomplete/);
assert.throws(() => unavailableHouseholdPorts({ network: { selectedTcpPorts: { ...inspected.network.selectedTcpPorts,
  items: selected.slice(0, 9).map((port) => ({ port, inUse: false })) } } }, selected), /incomplete/);
assert.throws(() => householdPortCandidates(44984), /start from/);

const stageApps = [
  ["homarr", "jellyfin", "seerr", "sonarr", "radarr", "prowlarr", "qbittorrent"],
  ["immich"], ["docmost"], ["vaultwarden"], ["immich", "docmost", "vaultwarden"],
];
const catalog = {
  catalogSource: { kind: "bundled", executionAuthority: "packaged" },
  setupStages: ["media", "app-immich", "app-docmost", "app-vaultwarden", "homarr-attachments"]
    .map((id, index) => ({ id, apps: stageApps[index], owner: index === 0 ? "selfhost-media" : "selfhost-compose" })),
  selectedApps: [...stageApps[0], "immich", "docmost", "vaultwarden", "postgresql", "valkey"]
    .map((id) => {
      if (["immich", "docmost", "vaultwarden"].includes(id)) return { id, cliSetup: { command: id } };
      return { id };
    }),
};
assert.equal(householdCatalogSupported(catalog), true);
assert.equal(householdCatalogSupported({ ...catalog,
  catalogSource: { kind: "external", executionAuthority: "read-only-declarative" } }), false);
assert.equal(householdCatalogSupported({ ...catalog, selectedApps: [...catalog.selectedApps, { id: "nextcloud" }] }), false);
assert.equal(householdCatalogSupported({ ...catalog, selectedApps: catalog.selectedApps.map((app) => {
  if (app.id === "immich") return { id: app.id };
  return app;
}) }), false);
assert.equal(householdCatalogSupported({ ...catalog, setupStages: catalog.setupStages.slice(0, 4) }), false);

const plan = {
  schemaVersion: 1,
  kind: "household-bundle-plan",
  status: "ready-for-staged-planning",
  mutation: false,
  bundle: choices.id,
  projectRoot: choices.root,
  input: `${choices.root}/.selfhost/bundles/${choices.id}/household-bundle.json`,
  approval: `BUNDLE:${choices.id}:${"a".repeat(64)}`,
  mediaExposure: "All seven media ports bind to 127.0.0.1",
  mediaPorts: "automatic",
  mediaSelection: { mode: "create", runId: "home-media", bind: "127.0.0.1", source: "bundle-selection", approvalDigest: null },
  stages: ["media", "immich", "docmost", "vaultwarden"]
    .map((service) => ({ service, purpose: "Example", acceptance: "Separate checks" })),
};
assert.equal(reviewedHouseholdPlan(plan, choices).approval, plan.approval);
assert.throws(() => reviewedHouseholdPlan({ ...plan, mutation: true }, choices), /different project/);
assert.throws(() => reviewedHouseholdPlan({ ...plan, mediaExposure: "0.0.0.0" }, choices), /new host-only media plan/);
assert.throws(() => reviewedHouseholdPlan({ ...plan, input: "/other/bundle.json" }, choices), /different project/);
const mediaConfig = { schemaVersion: 1, profile: "media", runId: "existing-media", username: "admin", credentialHandoff: true };
const mediaPortKeys = ["PROWLARR_PORT", "RADARR_PORT", "SONARR_PORT", "QBITTORRENT_PORT", "JELLYFIN_PORT", "SEERR_PORT", "HOMARR_PORT"];
const mediaInfo = { schemaVersion: 1, projectRoot: choices.root, runId: "existing-media",
  composeProject: "autostack-existing-media", adminUsername: "admin", approved: true,
  bind: "127.0.0.1", approvalDigest: "b".repeat(64),
  ports: Object.fromEntries(mediaPortKeys.map((key, index) => [key, String(21000 + index)])) };
const mediaStatus = { schemaVersion: 1, kind: "selfhost-media-status", provenance: "cli-managed",
  runId: "existing-media", composeProject: "autostack-existing-media",
  services: ["prowlarr", "radarr", "sonarr", "qbittorrent", "jellyfin", "seerr", "homarr"]
    .map((service) => ({ service, present: true, running: true, state: "running" })),
  summary: { expected: 7, present: 7, running: 7 } };
const adoptedMedia = reviewedExistingMedia(mediaConfig, mediaInfo, mediaStatus, choices.root);
assert.deepEqual(adoptedMedia.ports, [21000, 21001, 21002, 21003, 21004, 21005, 21006]);
assert.throws(() => reviewedExistingMedia(mediaConfig, { ...mediaInfo, bind: "0.0.0.0", approved: false }, mediaStatus, choices.root), /ready for adoption/);
assert.throws(() => reviewedExistingMedia(mediaConfig, mediaInfo, { ...mediaStatus,
  services: mediaStatus.services.slice(0, 6) }, choices.root), /all seven running services/);
const adoptedChoices: HouseholdChoices = { ...choices, adoptedMedia,
  ports: { immich: 32383, docmost: 32384, vaultwarden: 32385 } };
const adoptedArgs = householdBeginArgs(adoptedChoices);
assert.ok(adoptedArgs.includes("--media-run-id") && adoptedArgs.includes("existing-media")
  && !adoptedArgs.includes("--media-bind-mode") && !adoptedArgs.includes("--media-port-start"));
assert.throws(() => householdBeginArgs({ ...adoptedChoices,
  ports: { ...adoptedChoices.ports!, mediaStart: 32393 } }), /keeps its existing ports/);
const adoptedPlan = { ...plan, mediaExposure: "Adopted CLI media plan recorded all seven ports on 127.0.0.1",
  mediaPorts: adoptedMedia.ports,
  mediaSelection: { mode: "adopt", runId: "existing-media", bind: "127.0.0.1", source: "cli-managed-media-info",
    approvalDigest: adoptedMedia.approvalDigest } };
assert.equal(reviewedHouseholdPlan(adoptedPlan, adoptedChoices).approval, plan.approval);
assert.throws(() => reviewedHouseholdPlan({ ...adoptedPlan, mediaPorts: [1, 2, 3] }, adoptedChoices), /existing media run/);
const inbox = {
  kind: "household-bundle-approvals", status: "review-required", mutation: false, executionPerformed: false,
  projectRoot: choices.root, bundle: choices.id, bundleReview: { mediaExposure: plan.mediaExposure,
    mediaPorts: plan.mediaPorts, mediaSelection: plan.mediaSelection },
  bundleApproval: plan.approval, current: { checkpoint: "review-bundle-plan" },
};
const baseRun = ["bundle", "run", "--project-root", choices.root, "--input", plan.input, "--approve", plan.approval];
assert.deepEqual(householdReviewRunArgs(inbox, choices.root), baseRun);
assert.deepEqual(householdFullReviewArgs(inbox, choices.root), ["bundle", "plan", "--project-root", choices.root, "--input", plan.input]);
const freshInbox = { ...inbox, current: { checkpoint: "prepare-media-plan", service: "media",
  command: ["self-host", "bundle", "stage", "--project-root", choices.root, "--input", plan.input,
    "--service", "media", "--phase", "prepare", "--approve", plan.approval] } };
assert.deepEqual(householdReviewRunArgs(freshInbox, choices.root), baseRun);
assert.deepEqual(householdFullReviewArgs(freshInbox, choices.root), ["bundle", "plan", "--project-root", choices.root, "--input", plan.input]);
assert.equal(householdReviewRunArgs({ ...freshInbox, current: { ...freshInbox.current,
  command: [...freshInbox.current.command, "--unexpected"] } }, choices.root), null);
const adapterToken = `sha256:${"b".repeat(64)}`;
const approved = { ...inbox, current: { checkpoint: "review-media-plan", service: "media", review: { bind: "127.0.0.1" },
  reviewCommand: ["self-host", "bundle", "stage", "--project-root", choices.root, "--input", plan.input,
    "--service", "media", "--phase", "plan"],
  adapterApproval: adapterToken, runAfterReview: ["self-host", ...baseRun, "--stage-approve", adapterToken] } };
assert.deepEqual(householdReviewRunArgs(approved, choices.root), [...baseRun, "--stage-approve", adapterToken]);
assert.deepEqual(householdFullReviewArgs(approved, choices.root), approved.current.reviewCommand.slice(1));
assert.equal(householdReviewRunArgs({ ...approved, current: { ...approved.current, review: null } }, choices.root), null);
assert.equal(householdReviewRunArgs({ ...approved, current: { ...approved.current,
  runAfterReview: ["self-host", ...baseRun, "--stage-approve", "wrong"] } }, choices.root), null);
assert.equal(householdReviewRunArgs({ ...approved, projectRoot: "/other" }, choices.root), null);
assert.equal(householdReviewRunArgs({ ...approved, bundleReview: { mediaExposure: "all interfaces" } }, choices.root), null);
const adoptedInbox = { ...inbox, bundleReview: { mediaExposure: adoptedPlan.mediaExposure,
  mediaPorts: adoptedPlan.mediaPorts, mediaSelection: adoptedPlan.mediaSelection } };
assert.deepEqual(householdReviewRunArgs(adoptedInbox, choices.root), baseRun);
const allInterfaceInbox = { ...adoptedInbox, bundleReview: { ...adoptedInbox.bundleReview,
  mediaExposure: "Adopted CLI media plan recorded all seven ports on every host interface; verify the existing private firewall scope.",
  mediaSelection: { ...adoptedPlan.mediaSelection, bind: "0.0.0.0" } } };
assert.equal(householdReviewRunArgs(allInterfaceInbox, choices.root), null);
assert.equal(householdAdoptedAllInterfaceKey(allInterfaceInbox, choices.root),
  `${plan.approval}:existing-media:${adoptedMedia.approvalDigest}:${JSON.stringify(adoptedMedia.ports)}`);
assert.notEqual(householdAdoptedAllInterfaceKey({ ...allInterfaceInbox, bundleReview: { ...allInterfaceInbox.bundleReview,
  mediaPorts: [21010, ...adoptedMedia.ports.slice(1)] } }, choices.root),
  householdAdoptedAllInterfaceKey(allInterfaceInbox, choices.root));
assert.deepEqual(householdReviewRunArgs(allInterfaceInbox, choices.root, true), baseRun);
assert.deepEqual(householdFullReviewArgs(allInterfaceInbox, choices.root, true),
  ["bundle", "plan", "--project-root", choices.root, "--input", plan.input]);
assert.equal(householdReviewRunArgs({ ...allInterfaceInbox, bundleReview: { ...allInterfaceInbox.bundleReview,
  mediaExposure: "unknown host exposure" } }, choices.root, true), null);
assert.equal(householdFullReviewArgs({ ...approved, current: { ...approved.current,
  reviewCommand: [...approved.current.reviewCommand, "--approve", adapterToken] } }, choices.root), null);

const mediaWebInbox = { ...inbox, current: { checkpoint: "bind-media-web" } };
const network = "autostack-home-media_web";
const reportPath = `${choices.root}/.selfhost/bundles/home/host-media-web-12345678-1234-4234-8234-123456789abc.json`;
const mediaWebInspect = ["self-host", "host", "inspect", "--output", reportPath, "--limit", "50",
  "--check-tcp-port", "2283", "--check-tcp-port", "3000"];
const mediaWebRoute = ["self-host", "bundle", "route-network", "--service", "media-web",
  "--project-root", choices.root, "--input", plan.input, "--host-inspection", reportPath,
  "--network", network, "--approve", plan.approval];
const mediaWebNext = {
  schemaVersion: 1, kind: "household-bundle-next", status: "action-required", mutation: false,
  executionPerformed: false, bundle: choices.id, projectRoot: choices.root,
  next: { checkpoint: "bind-media-web", service: "bundle", command: mediaWebInspect,
    inspection: { mutation: "new-owner-only-report", output: reportPath,
      overwritesExisting: false, checkedTcpPorts: [2283, 3000] },
    afterInspection: { command: mediaWebRoute, mutation: "owner-only-bundle-and-app-inputs",
      requiresUnchangedBundleApproval: true,
      planCommand: ["self-host", "bundle", "plan", "--project-root", choices.root, "--input", plan.input] } },
};
const handoff = householdMediaWebHandoff(mediaWebInbox, mediaWebNext, choices.root, plan.input);
assert.ok(handoff);
assert.deepEqual(handoff.ports, [2283, 3000]);
assert.deepEqual(handoff.inspectionArgs, mediaWebInspect.slice(1));
assert.deepEqual(handoff.routeArgs, mediaWebRoute.slice(1));
assert.equal(householdMediaWebHandoff(mediaWebInbox, { ...mediaWebNext, next: { ...mediaWebNext.next,
  afterInspection: { ...mediaWebNext.next.afterInspection,
    command: [...mediaWebRoute.slice(0, -1), `BUNDLE:home:${"b".repeat(64)}`] } } }, choices.root, plan.input), null);
assert.equal(householdMediaWebHandoff(mediaWebInbox, { ...mediaWebNext, next: { ...mediaWebNext.next,
  inspection: { ...mediaWebNext.next.inspection, checkedTcpPorts: [2283, 2283] } } }, choices.root, plan.input), null);
assert.equal(householdMediaWebHandoff({ ...mediaWebInbox, bundleReview: adoptedInbox.bundleReview },
  mediaWebNext, choices.root, plan.input), null);
const mediaWebHost = {
  schemaVersion: 1, mode: "read-only",
  runtime: { docker: { state: "running", rootless: { state: "observed", value: false } }, dockerContext: { state: "observed", current: "default" } },
  workloads: { dockerNetworks: { state: "observed", truncated: false, items: [{ name: network }] } },
  network: { listeningPorts: { state: "observed", items: [] }, selectedTcpPorts: {
    state: "observed", complete: true,
    items: [{ port: 2283, inUse: false }, { port: 3000, inUse: false }] } },
};
assert.equal(reviewedMediaWebHostReport(mediaWebHost, network, [2283, 3000]), "default");
assert.throws(() => reviewedMediaWebHostReport({ ...mediaWebHost, workloads: {
  dockerNetworks: { state: "observed", truncated: false, items: [] } } }, network, [2283, 3000]), /network/);
assert.throws(() => reviewedMediaWebHostReport({ ...mediaWebHost, network: { ...mediaWebHost.network,
  selectedTcpPorts: { ...mediaWebHost.network.selectedTcpPorts,
    items: [{ port: 2283, inUse: true }, { port: 3000, inUse: false }] } } }, network, [2283, 3000]), /in use/);

const parallelInbox = { ...inbox, current: { checkpoint: "review-immich-apply" } };
const parallelInfo = { schemaVersion: 1, kind: "household-bundle-info", bundle: choices.id,
  services: [{ name: "Immich", url: "http://127.0.0.1:2283" },
    { name: "Docmost", url: "http://127.0.0.1:3000" }] };
assert.deepEqual(householdParallelPorts(parallelInfo, choices.id), [2283, 3000]);
assert.throws(() => householdParallelPorts({ ...parallelInfo, services: [parallelInfo.services[0],
  { name: "Docmost", url: "http://8.8.8.8:3000" }] }, choices.id), /private HTTP/);
assert.throws(() => householdParallelPorts({ ...parallelInfo, services: [parallelInfo.services[0],
  { name: "Docmost", url: "http://127.0.0.1:2283" }] }, choices.id), /share a host port/);
const immichApply = `APPLY:home-immich:${"b".repeat(64)}`;
const docmostApply = `APPLY:home-docmost:${"c".repeat(64)}`;
const parallelPlan = { schemaVersion: 1, kind: "household-bundle-parallel-plan", status: "ready-for-review",
  mutation: false, bundle: choices.id, approval: plan.approval, services: ["immich", "docmost"],
  network, adapterApprovals: { immich: immichApply, docmost: docmostApply }, hostInspection: reportPath };
assert.deepEqual(householdParallelPlan(parallelPlan, parallelInbox, choices.root, plan.input, reportPath),
  { immich: immichApply, docmost: docmostApply, network });
assert.equal(householdParallelPlan({ ...parallelPlan, adapterApprovals: { ...parallelPlan.adapterApprovals,
  docmost: immichApply } }, parallelInbox, choices.root, plan.input, reportPath), null);
assert.equal(householdParallelPlan(parallelPlan, { ...parallelInbox, current: { checkpoint: "review-immich-bootstrap" } },
  choices.root, plan.input, reportPath), null);
const compose = (service: "immich" | "docmost", port: number) => ({
  kind: "selfhost-compose-plan", status: "pass", project: { id: `home-${service}`, ownership: "new", dockerContext: "default" },
  claims: { services: [{ id: service, image: `docker.io/example/${service}:1@sha256:${"d".repeat(64)}` }],
    privatePorts: [{ service, hostIp: "127.0.0.1", published: port, target: port, protocol: "tcp" }], publicPorts: [] },
});
const immichPlan = { schemaVersion: 1, kind: "immich-v3.2.2-cli-plan", status: "pass", mutation: false,
  runId: "home-immich", compose: compose("immich", 2283), approvals: { apply: immichApply } };
const docmostPlan = { schemaVersion: 1, kind: "docmost-v0.96.0-cli-plan", status: "pass", mutation: false,
  runId: "home-docmost", compose: compose("docmost", 3000), approval: docmostApply };
assert.match(householdParallelAdapterReview(immichPlan, choices.id, "immich", 2283, immichApply), /home-immich/);
assert.match(householdParallelAdapterReview(docmostPlan, choices.id, "docmost", 3000, docmostApply), /home-docmost/);
assert.throws(() => householdParallelAdapterReview({ ...docmostPlan, compose: { ...docmostPlan.compose,
  claims: { ...docmostPlan.compose.claims, publicPorts: [{ published: 3000 }] } } },
  choices.id, "docmost", 3000, docmostApply), /untouched, private/);
assert.throws(() => householdParallelAdapterReview({ ...docmostPlan, compose: { ...docmostPlan.compose,
  claims: { ...docmostPlan.compose.claims, privatePorts: [...docmostPlan.compose.claims.privatePorts,
    { service: "docmost", hostIp: "127.0.0.1", published: 3001, target: 3001, protocol: "tcp" }] } } },
  choices.id, "docmost", 3000, docmostApply), /untouched, private/);
assert.throws(() => householdParallelAdapterReview(immichPlan, choices.id, "immich", 2283, docmostApply), /reviewed token/);
console.log("PASS household TUI validates exact catalog, arguments and prepared plan");
