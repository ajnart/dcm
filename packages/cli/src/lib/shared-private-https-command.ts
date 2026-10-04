import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { prepareSharedProjectFiles, type SharedAppSelection, type SharedProjectCandidate,
  type SharedProjectObservation } from "./shared-compose-project.ts";
import { loadSharedProjectState, loadReviewedSharedPrivateHttpsAddSource, saveSharedProjectState,
  type SharedProjectState } from "./shared-project-state.ts";
import { createSelfhostComposeOwner } from "./selfhost-compose.ts";
import { withSharedProjectMutationLock } from "./batch-mutation-lock.ts";
import { requireLocalSharedDockerContext } from "./shared-host-observation.ts";
import { planSharedPrivateHttps, sharedPrivateHttpsHostnameScope, type SharedPrivateHttpsRoute } from "./shared-private-https.ts";
import { createSharedPrivateHttpsBinding, loadSharedPrivateHttpsBinding, saveSharedPrivateHttpsBinding,
  readSharedHttpsPrivateFile, restoreSharedPrivateHttpsSelection, saveSharedPrivateHttpsTransportProof,
  sharedHttpsHash } from "./shared-private-https-state.ts";
import { applySharedPrivateHttpsTransport, reviewSharedPrivateHttpsTransport } from "./shared-private-https-apply.ts";
import { sharedRecipeEligible } from "./shared-app-eligibility.ts";

type Entry = Record<string, any>;
export type SharedHttpsCommandOptions = {
  action: "https-plan" | "https-apply" | "https-proof";
  projectRoot: string; projectId: string; appIds: string[];
  hostnames: Record<string, string>; httpsPort: number; approval: string | null;
};
export type SharedHttpsCommandDependencies = {
  recipeFor(appId: string): { recipe: Entry; boundedApply: boolean };
  image(recipe: Entry): Promise<string>;
  inspect(current: SharedProjectState, selection: SharedAppSelection): SharedProjectObservation;
  runtime(current: SharedProjectState, appIds: string[], target: string): Promise<Record<string, string>>;
  validateSaved(current: SharedProjectState): void;
  desiredApproval(candidate: SharedProjectCandidate): string;
};

/** Caddy is the only new unit; existing app settings and credentials are never prepared. */
export async function sharedPrivateHttpsCommand(options: SharedHttpsCommandOptions,
  dependencies: SharedHttpsCommandDependencies) {
  const directory = join(options.projectRoot, ".selfhost", "shared", options.projectId);
  const current = existsSync(directory) ? await loadSharedProjectState(directory, options.projectId) : null;
  const resumeReviewed = current?.checkpoint.operation === "add" && current.checkpoint.phase === "reviewed"
    && JSON.stringify(current.checkpoint.appIds) === '["caddy"]' && options.action !== "https-proof";
  if (!current || current.project.directory !== directory
    || (current.checkpoint.phase !== "completed" && !resumeReviewed)) {
    throw new Error("Private HTTPS needs one completed saved shared project; inspect pending or uncertain additions before retrying");
  }
  const info = dependencies.recipeFor("caddy");
  if (!sharedRecipeEligible("caddy", info.boundedApply) || info.recipe.schemaVersion !== 2
    || info.recipe.kind !== "multi-service-compose") {
    throw new Error("The bundled Caddy recipe is unavailable for private HTTPS");
  }
  const base = { command: `app shared ${options.action}`, projectId: options.projectId,
    projectRoot: options.projectRoot, dataPreserved: true, dnsVerified: false,
    clientTrustVerified: false, applicationVerified: false, trustStoreMutation: false };
  if (options.action === "https-proof") {
    const binding = await loadSharedPrivateHttpsBinding(directory, info.recipe);
    const review = reviewSharedPrivateHttpsTransport(current, info.recipe, binding);
    if (options.approval === null) {
      return { ...base, status: "review", mutation: false, composeMutation: false,
        transportVerified: false, ...review };
    }
    if (options.approval !== review.approval) throw new Error("Shared HTTPS proof needs its exact owner-bound approval");
    return withSharedProjectMutationLock(options.projectRoot, options.projectId, [binding.port], async () => {
      const latest = await loadSharedProjectState(directory, options.projectId);
      if (latest?.recordHash !== current.recordHash) throw new Error("Shared HTTPS owner changed after proof review");
      const result = await applySharedPrivateHttpsTransport(latest, info.recipe, binding, options.approval!);
      let status = "transport-unverified";
      if (result.transportVerified) {
        const published = await saveSharedPrivateHttpsTransportProof(latest, info.recipe, binding, result);
        return { ...base, ...published.proof, transportProofPath: published.path,
          status: "transport-verified-application-pending", mutation: true };
      }
      return { ...base, ...result, status, mutation: true };
    });
  }
  const routes: SharedPrivateHttpsRoute[] = options.appIds.map((appId) => ({ appId,
    hostname: options.hostnames[appId] ?? `${appId}.localhost` }));
  const reviewAdd = async (saved: SharedProjectState) => {
    let source = saved;
    let retainedBinding;
    const canonical = dependencies.recipeFor("caddy").recipe;
    if (resumeReviewed) {
      source = await loadReviewedSharedPrivateHttpsAddSource(saved);
      retainedBinding = await loadSharedPrivateHttpsBinding(directory, canonical);
      if (retainedBinding.source.recordHash !== source.recordHash
        || retainedBinding.candidateManifestHash !== saved.manifestHash) {
        throw new Error("Reviewed HTTPS add differs from its validated completed predecessor and binding");
      }
      restoreSharedPrivateHttpsSelection(saved, canonical, retainedBinding);
    }
    dependencies.validateSaved(source);
    const existingOwner = createSelfhostComposeOwner(source.manifest);
    const existingPlan = await existingOwner.plan();
    await existingOwner.checkRendered(existingPlan);
    const before = await dependencies.runtime(source, Object.keys(source.units).sort(), existingPlan.render.target);
    const image = await dependencies.image(canonical);
    const observation = dependencies.inspect(source, { appId: "caddy", recipe: canonical,
      images: { caddy: image }, port: options.httpsPort });
    let caddyRouteAliases = true;
    if (retainedBinding) caddyRouteAliases = retainedBinding.caddyRouteAliases === "owner-front-v1";
    const reviewed = planSharedPrivateHttps(source, canonical, image, routes, options.httpsPort, observation, caddyRouteAliases);
    if (retainedBinding) {
      const retained = { manifest: saved.manifest, units: saved.units,
        selectionFingerprints: saved.selectionFingerprints, settings: saved.settings,
        projectDirectory: saved.project.directory };
      if (dependencies.desiredApproval(retained) !== dependencies.desiredApproval(reviewed.candidate)) {
        throw new Error("Reviewed HTTPS add images, routes, port or candidate differ; no automatic replay");
      }
      const selection = restoreSharedPrivateHttpsSelection(saved, canonical, retainedBinding);
      const configPath = join(directory, "data", "caddy", "config-files", "caddyfile");
      if (!(await readSharedHttpsPrivateFile(configPath, 256 * 1024)).equals(Buffer.from(selection.recipe.configFiles[0].content))) {
        throw new Error("Reviewed HTTPS add Caddyfile differs from its immutable binding");
      }
      reviewed.candidate = retained;
      reviewed.caddySelection = selection;
      requireLocalSharedDockerContext(source.project.dockerContext);
      const absent = spawnSync("docker", ["--context", source.project.dockerContext,
        "ps", "--all", "--filter", `label=com.docker.compose.project=${options.projectId}`,
        "--filter", "label=com.docker.compose.service=caddy", "--format", "{{.ID}}"],
      { encoding: "utf8", timeout: 15000, maxBuffer: 4096, stdio: ["ignore", "pipe", "ignore"] });
      if (absent.error || absent.status !== 0 || absent.stdout.trim() !== "") {
        throw new Error("Reviewed HTTPS add has an existing or uncertain Caddy container; inspect without replay");
      }
    }
    const owner = createSelfhostComposeOwner(reviewed.candidate.manifest);
    const plan = await owner.plan();
    if (retainedBinding) await owner.checkRendered(plan);
    const selected = await owner.selectedPlan(plan, "add", ["caddy"]);
    // Observation timestamps and probe ordering are not approval identity; all fresh
    // observations still pass the planner on both sides of the mutation lock.
    let pendingRecordHash: string | null = null;
    if (retainedBinding) pendingRecordHash = saved.recordHash;
    const digest = sharedHttpsHash({ version: 1, sourceRecordHash: source.recordHash,
      pendingRecordHash,
      desired: dependencies.desiredApproval(reviewed.candidate), before,
      routes: reviewed.routes, caddyfileSha256: reviewed.caddyfileSha256 });
    const binding = retainedBinding ?? createSharedPrivateHttpsBinding(source, canonical, reviewed, observation);
    return { reviewed, canonical, owner, plan, selected, before, binding, source,
      approval: `SHARED-HTTPS-ADD:${options.projectId}:${digest}` };
  };
  const reviewed = await reviewAdd(current);
  const proposal = { ...base, ownerRevision: current.revision, ownerRecordHash: current.recordHash,
    added: ["caddy"], retained: Object.keys(reviewed.source.units).sort(), services: ["caddy"],
    images: reviewed.reviewed.caddySelection.images, routes: reviewed.reviewed.routes,
    caddyNetworkAliases: reviewed.reviewed.candidate.manifest.services
      .find((service: Entry) => service.id === "caddy")?.networkAliases ?? [],
    homarrIntegrationTransportVerified: false,
    hostnameScope: sharedPrivateHttpsHostnameScope(reviewed.reviewed.routes),
    caddyfileSha256: reviewed.reviewed.caddyfileSha256, composeStatus: reviewed.plan.status,
    evidence: reviewed.reviewed.evidence, transportVerified: false, applyAvailable: true,
    approval: reviewed.approval,
    blockers: reviewed.reviewed.blockers.filter((id) => id !== "persisted-route-bindings-and-resume") };
  if (options.action === "https-plan") {
    let status = "review";
    if (resumeReviewed) status = "resume-reviewed";
    return { ...proposal, status, resumeReviewed, mutation: false };
  }
  if (options.approval !== reviewed.approval) throw new Error("Private HTTPS addition needs its exact saved-owner approval");
  await withSharedProjectMutationLock(options.projectRoot, options.projectId, [options.httpsPort], async () => {
    const latest = await loadSharedProjectState(directory, options.projectId);
    if (!latest || latest.recordHash !== current.recordHash || latest.checkpoint.phase !== current.checkpoint.phase) {
      throw new Error("Shared HTTPS owner changed after addition review");
    }
    const locked = await reviewAdd(latest);
    if (locked.approval !== options.approval) throw new Error("Shared HTTPS images, routes, port, recipe or runtime changed after review");
    requireLocalSharedDockerContext(latest.project.dockerContext);
    // Persist immutable recipe/route identity before preparing or invoking Docker.
    if (!resumeReviewed) try {
      await saveSharedPrivateHttpsBinding(directory, locked.binding, locked.canonical);
      await prepareSharedProjectFiles(locked.reviewed.candidate, [locked.reviewed.caddySelection]);
      await locked.owner.render(locked.plan);
      await locked.owner.checkRendered(locked.plan);
    } catch {
      throw new Error("Shared HTTPS pre-Docker preparation requires inspection of the exact binding, Caddyfile and rendered file; no Docker addition was attempted. Do not blindly replay apply");
    }
    let first = latest;
    if (!resumeReviewed) first = await saveSharedProjectState(locked.reviewed.candidate,
        { operation: "add", phase: "reviewed", appIds: ["caddy"] },
        { revision: latest.revision, manifestHash: latest.manifestHash, checkpoint: latest.checkpoint });
    const attempted = await saveSharedProjectState(locked.reviewed.candidate,
      { operation: "add", phase: "attempted", appIds: ["caddy"] },
      { revision: first.revision, manifestHash: first.manifestHash, checkpoint: first.checkpoint });
    try {
      await locked.owner.addSelected(locked.plan, ["caddy"], locked.selected.approval);
      const after = await dependencies.runtime(attempted, Object.keys(attempted.units).sort(), locked.plan.render.target);
      if (after.caddy !== "running" || Object.keys(locked.before).some((appId) => after[appId] !== locked.before[appId])) {
        throw new Error("Added proxy or retained runtime differs from review");
      }
    } catch {
      await saveSharedProjectState(locked.reviewed.candidate,
        { operation: "add", phase: "inspect-required", appIds: ["caddy"] },
        { revision: attempted.revision, manifestHash: attempted.manifestHash, checkpoint: attempted.checkpoint });
      throw new Error("Shared HTTPS addition outcome is uncertain; inspect exact shared services before retrying; do not replay add");
    }
    await saveSharedProjectState(locked.reviewed.candidate,
      { operation: "add", phase: "completed", appIds: ["caddy"] },
      { revision: attempted.revision, manifestHash: attempted.manifestHash, checkpoint: attempted.checkpoint });
  });
  return { ...proposal, approval: null, status: "added-transport-unverified", mutation: true,
    next: "Review app shared https-proof for this exact owner; app canonical origins, setup, client trust and acceptance remain separate." };
}
