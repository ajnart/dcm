#!/usr/bin/env bun

import { strict as assert } from "node:assert";
import { localCaddySelection, reviewedCaddyInputs, reviewedHttpsReady, reviewedPrivateCaddyApply,
  reviewedPrivateCaddyPlan, reviewedPrivateCaddyPrepared, reviewedPrivateCaddyStatus,
  reviewedVaultwardenRoute } from "../src/interactive-caddy.ts";

const root = "/tmp/selfhost-caddy-menu-fixture";
const input = `${root}/.selfhost/bundles/home/household-bundle.json`;
const bundleApproval = `BUNDLE:home:${"a".repeat(64)}`;
const status = { schemaVersion: 1, kind: "household-bundle-status", status: "incomplete",
  mutation: false, bundle: "home", projectRoot: root,
  privateHttps: { ready: false, origin: "https://vaultwarden.localhost:28443",
    routeOwner: "home-edge", tlsOwner: "home-edge", recordedRouteStatus: "pending",
    recordedClientTrust: "pending", backendHostPort: 28080, backendPortMatchesApp: true,
    vaultwardenRouteNetwork: null } };
const inbox = { kind: "household-bundle-approvals", status: "review-required", mutation: false,
  executionPerformed: false, bundle: "home", projectRoot: root, bundleApproval,
  bundleReview: { mediaSelection: { mode: "create", bind: "127.0.0.1", source: "bundle-selection",
    runId: "home-media", approvalDigest: null } },
  current: { checkpoint: "verify-vaultwarden-private-https" } };
const selected = localCaddySelection(status, inbox, root, input);
assert.ok(selected);
assert.equal(selected.httpsPort, 28443);
assert.equal(selected.mediaWeb, "autostack-home-media_web");
assert.equal(selected.bridge, "home-edge-vaultwarden");
assert.equal(selected.routeNetwork, null);
assert.equal(localCaddySelection({ ...status, privateHttps: { ...status.privateHttps,
  origin: "https://vault.example.com:28443" } }, inbox, root, input), null);
assert.equal(localCaddySelection(status, { ...inbox, current: { checkpoint: "review-vaultwarden-plan" } }, root, input), null);
assert.equal(localCaddySelection({ ...status, privateHttps: { ...status.privateHttps,
  backendPortMatchesApp: false } }, inbox, root, input), null);
assert.equal(localCaddySelection({ ...status, privateHttps: { ...status.privateHttps,
  vaultwardenRouteNetwork: "unexpected" } }, inbox, root, input), null);

const ids = ["homarr", "jellyfin", "seerr", "immich", "docmost", "vaultwarden"];
const routes = ids.map((service) => ({ service, origin: `https://${service}.localhost:28443`,
  upstreamNetwork: service === "vaultwarden" ? "vaultwarden" : "media-web" }));
const caddyInputs = { schemaVersion: 1, kind: "household-caddy-inputs", status: "ready-for-review",
  mutation: false, bundle: "home", input: selected.sharedInput,
  approval: `CADDY-INPUTS:home:${"b".repeat(64)}`,
  caddyImage: `docker.io/library/caddy:2.11.4-alpine@sha256:${"c".repeat(64)}`,
  vaultwardenHostPort: 28080, routes,
  networks: { mediaWeb: selected.mediaWeb, vaultwarden: selected.bridge } };
assert.deepEqual(reviewedCaddyInputs(caddyInputs, selected, "ready-for-review"), {
  approval: caddyInputs.approval, image: caddyInputs.caddyImage,
  vaultwardenHostPort: 28080, origins: routes.map((route) => route.origin),
});
assert.throws(() => reviewedCaddyInputs({ ...caddyInputs, routes: [...routes.slice(0, 5),
  { ...routes[5], upstreamNetwork: "media-web" }] }, selected, "ready-for-review"), /route ownership/);
assert.deepEqual(reviewedCaddyInputs({ ...caddyInputs, status: "created",
  mutation: "owner-only-caddy-inputs" }, selected, "created").origins, routes.map((route) => route.origin));

const upstreams: Record<string, string> = { homarr: "homarr:7575", jellyfin: "jellyfin:8096",
  seerr: "seerr:5055", immich: "immich-server:2283", docmost: "docmost:3000",
  vaultwarden: "vaultwarden:8080" };
const caddyRoutes = routes.map((route) => ({ ...route, hostname: `${route.service}.localhost`,
  upstream: upstreams[route.service], network: route.upstreamNetwork }))
  .sort((left, right) => `${left.service}.localhost`.localeCompare(`${right.service}.localhost`));
const access = { exposure: "private", bindAddress: "127.0.0.1", httpsPort: 28443,
  public: false, httpRedirectPort: "disabled" };
const caddyPlan = { schemaVersion: 1, kind: "shared-private-caddy-plan", status: "pass",
  mutation: false, project: { id: selected.owner, owner: selected.owner,
    directory: `${root}/${selected.owner}`, ownership: "new" }, access,
  dockerSocket: "not-mounted", caExportPath: selected.caExportPath, existingLifecycle: null,
  approval: `APPLY:${selected.owner}:${"d".repeat(64)}`, caddyfileSha256: "e".repeat(64),
  routes: caddyRoutes, manifest: { services: [{ id: "caddy", image: caddyInputs.caddyImage }] } };
assert.deepEqual(reviewedPrivateCaddyPlan(caddyPlan, selected), {
  approval: caddyPlan.approval, image: caddyInputs.caddyImage });
assert.throws(() => reviewedPrivateCaddyPlan({ ...caddyPlan, routes: routes.map((route) => ({
  ...route, hostname: `${route.service}.localhost`, upstream: upstreams[route.service],
  network: route.upstreamNetwork })) }, selected), /route changed/);
assert.throws(() => reviewedPrivateCaddyPlan({ ...caddyPlan, routes: [
  { ...caddyRoutes[0], upstream: "other:3000" }, ...caddyRoutes.slice(1)] }, selected), /route changed/);
assert.throws(() => reviewedPrivateCaddyPlan({ ...caddyPlan, access: { ...access,
  public: true } }, selected), /ownership, exposure/);
assert.throws(() => reviewedPrivateCaddyPlan({ ...caddyPlan, existingLifecycle: {
  phase: "compose-started" } }, selected), /lifecycle/);

const proofs = caddyRoutes.map((route) => ({ hostname: `${route.service}.localhost`, origin: route.origin,
  method: "curl-cacert-resolve", verified: true, httpStatus: 502,
  verifiedAt: "2026-09-28T11:00:00Z" }));
reviewedPrivateCaddyApply({ schemaVersion: 1, kind: "shared-private-caddy-apply",
  status: "applied-transport-only", project: selected.owner, caExportPath: selected.caExportPath,
  access, routes: caddyRoutes, transportProofs: proofs }, selected);
assert.throws(() => reviewedPrivateCaddyApply({ schemaVersion: 1, kind: "shared-private-caddy-apply",
  status: "applied-transport-only", project: selected.owner, caExportPath: selected.caExportPath,
  access, routes: caddyRoutes,
  transportProofs: [...proofs.slice(0, 5), { ...proofs[5], verified: false }] }, selected), /transport proof/);
reviewedPrivateCaddyPrepared({ schemaVersion: 1, kind: "shared-private-caddy-status",
  project: selected.owner, applied: false, checkpointRecorded: false, current: false,
  currentInput: "valid-without-checkpoint", checkpoint: null, access }, selected);
reviewedPrivateCaddyStatus({ schemaVersion: 1, kind: "shared-private-caddy-status",
  project: selected.owner, applied: true, checkpointRecorded: true, current: true,
  currentInput: "matches-checkpoint", persistentCaMatchesExport: true,
  checkpoint: { phase: "verified", inputPath: selected.sharedInput },
  verification: { intendedClientCaTrust: { verified: false, caExportPath: selected.caExportPath } },
  access, routes: proofs.map((proof) => ({ hostname: proof.hostname, origin: proof.origin })),
  liveTransport: proofs }, selected);

const revisedApproval = reviewedVaultwardenRoute({ schemaVersion: 1,
  kind: "household-bundle-route-network", status: "revised", mutation: "owner-only-vaultwarden-input",
  bundle: selected.bundle, network: selected.bridge, previousApproval: bundleApproval,
  approval: `BUNDLE:home:${"f".repeat(64)}` }, selected, bundleApproval);
assert.equal(revisedApproval, `BUNDLE:home:${"f".repeat(64)}`);
const readyApproval = reviewedHttpsReady({ schemaVersion: 1, kind: "household-bundle-https-ready",
  status: "recorded", mutation: "owner-only-https-plan", bundle: selected.bundle,
  origin: selected.origin, routeOwner: selected.owner, tlsOwner: selected.owner,
  previousApproval: revisedApproval, approval: `BUNDLE:home:${"0".repeat(64)}` }, selected, revisedApproval);
assert.equal(readyApproval, `BUNDLE:home:${"0".repeat(64)}`);
console.log("PASS host-only Caddy TUI review contracts");
