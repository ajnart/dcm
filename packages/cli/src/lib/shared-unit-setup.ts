import { spawnSync } from "node:child_process";
import { closeSync, constants, existsSync, fstatSync, lstatSync,
  openSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSharedProjectState, loadSharedUnitComposeOrigins, hasValidatedSharedPostAccountTransition,
  type SharedProjectState } from "./shared-project-state.ts";
import { createSelfhostComposeOwner } from "./selfhost-compose.ts";
import { requireLocalSharedDockerContext } from "./shared-host-observation.ts";
import { restoreSavedSharedSelection, savedSharedPrivateHttpsRoutes } from "./shared-saved-recipe.ts";
import { sharedDerivedRecipeAdapter } from "./shared-derived-recipe.ts";
import { loadSharedDerivedRecipeBinding } from "./shared-derived-recipe-state.ts";
import { documentedUnitHealth, inheritedHealthcheckMatches } from "./documented-unit-health.ts";
import { checkedManualJobRecipe, isManualJobService } from "./manual-job.ts";
import { checkedConnectorRecipe, checkedPrivateDaemonRecipe, verifySharedGeneratedConfigFiles } from "./multi-service-recipe.ts";
import { resolveAppEndpoints } from "./resolved-app.ts";
import { checkedHttpBasicOnboarding } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/http-basic.ts";
import { checkedMutableAdminOnboarding } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/mutable-admin.ts";
import { readSetupRecoverySummary } from "../control-panel/setup-transport.ts";
import { setupAdapterSource } from "./setup-contract.ts";

type Entry = Record<string, any>;
type RecipeInfo = { recipe: Entry; boundedApply: boolean; app?: Entry };
type RecipeFor = (appId: string) => RecipeInfo;
type AppFor = (appId: string) => Entry;
type ApprovalFor = (state: SharedProjectState) => string;

function fail(message: string): never {
  throw new Error(`Shared setup: ${message}`);
}

/** Database credentials are not a Passbolt client identity or master password. */
export function gpgClientEnrollmentCredential(recipe: Entry): Entry | null {
  if (recipe.onboarding?.kind !== "gpg-client-enrollment") return null;
  if (recipe.appId !== "passbolt"
    || Object.keys(recipe.onboarding).sort().join(",") !== "kind,officialUrl"
    || recipe.onboarding.officialUrl !== "https://www.passbolt.com/docs/user/quickstart/browser/first-setup/"
    || !Array.isArray(recipe.privateFiles)
    || recipe.privateFiles.some((file: Entry) => !["database-password", "database-root-password"].includes(file.id))
    || recipe.services.some((service: Entry) => (service.secretEnvironment ?? []).length !== 0)) {
    fail("GPG client enrollment cannot invent an administrator password or API key");
  }
  return { username: null, email: null, loginVia: "gpg-client-enrollment", passwordFile: null,
    enrollmentStatus: "pending", accountCreated: false, loginVerified: false,
    clientPrivateKeyCustodyVerified: false, encryptedRoundTripVerified: false };
}

/** An unbound client master password is not a created server administrator. */
export function officialClientFirstEmailCredential(recipe: Entry, privateFiles: string): Entry | null {
  const onboarding = recipe.onboarding;
  if (onboarding?.kind !== "official-client-first-email") return null;
  const generated = recipe.privateFiles?.find((file: Entry) => file.id === onboarding.fileId);
  let evidence: URL;
  try { evidence = new URL(onboarding.officialUrl); }
  catch { fail("official-client enrollment needs an HTTPS source"); }
  if (Object.keys(onboarding).sort().join(",") !== "fileId,kind,officialUrl"
    || evidence.protocol !== "https:" || evidence.username || evidence.password
    || onboarding.fileId !== "admin-password" || !generated || generated.source !== undefined
    || ![undefined, "base64url", "alphanumeric", "hex"].includes(generated.format)
    || !Number.isInteger(generated.bytes) || generated.bytes < 32 || generated.bytes > 128
    || !Array.isArray(recipe.services)
    || recipe.services.some((service: Entry) => [...(service.fileEnvironment ?? []), ...(service.secretEnvironment ?? [])]
      .some((binding: Entry) => binding.fileId === onboarding.fileId))
    || (recipe.privateConfigs ?? []).some((config: Entry) => config.parts.some((part: Entry) => part.fileId === onboarding.fileId))
    || !isAbsolute(privateFiles)) {
    fail("official-client enrollment needs an unbound generated master password and no invented identity");
  }
  return { username: null, email: null, loginVia: "official-client-email",
    passwordFile: join(privateFiles, onboarding.fileId), credentialUsage: "generated-master-password",
    enrollmentStatus: "pending", accountCreated: false, loginVerified: false, unlockVerified: false };
}

function dockerJson(context: string, args: string[], label: string): Entry {
  const result = spawnSync("docker", ["--context", context, ...args], {
    encoding: "utf8", timeout: 15_000, maxBuffer: 256 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) fail(`${label} could not be inspected`);
  let value: unknown;
  try { value = JSON.parse(result.stdout.trim()); }
  catch { fail(`${label} returned invalid JSON`); }
  if (value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) fail(`${label} returned invalid data`);
  return value as Entry;
}

function selectedRecipe(state: SharedProjectState, appId: string,
  recipeFor: RecipeFor): { recipe: Entry; port: number | null } {
  const selection = restoreSavedSharedSelection(state, appId, recipeFor);
  return { recipe: selection.recipe, port: selection.port ?? null };
}

/** Diagnostics only. A changed catalog never authorizes setup or credential export. */
export function sharedUnitRecipeCheck(state: SharedProjectState, appId: string,
  recipeFor: RecipeFor): "matches-saved-selection" | "recipe-unavailable-or-changed" {
  try {
    selectedRecipe(state, appId, recipeFor);
    return "matches-saved-selection";
  } catch {
    return "recipe-unavailable-or-changed";
  }
}

function runtime(state: SharedProjectState, appId: string, composeTarget: string,
  originTarget: string): Entry {
  const context = state.project.dockerContext;
  requireLocalSharedDockerContext(context);
  const result = spawnSync("docker", ["--context", context, "compose",
    "--project-name", state.project.id, "--file", composeTarget,
    "ps", "--all", "--format", "json"], {
    encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) fail("the exact Compose inventory is unavailable");
  let rows: Entry[];
  try {
    const lines = result.stdout.split("\n").filter(Boolean);
    rows = lines.length === 1 && result.stdout.trim().startsWith("[")
      ? JSON.parse(result.stdout) : lines.map((line) => JSON.parse(line));
  } catch { fail("the exact Compose inventory returned invalid JSON"); }
  const automatic = state.manifest.services.filter((service: Entry) => !isManualJobService(service));
  if (!Array.isArray(rows) || rows.length !== automatic.length) {
    fail("the exact Compose inventory does not cover every saved service");
  }
  const expected = new Map<string, Entry>(state.manifest.services.map((service: Entry) => [service.id, service]));
  const observed = new Map<string, Entry>();
  for (const row of rows) {
    const service = expected.get(row.Service);
    if (!service || isManualJobService(service) || row.Project !== state.project.id || row.Image !== service.image
      || observed.has(row.Service) || typeof row.ID !== "string"
      || !/^[0-9a-f]{12,64}$/.test(row.ID)
      || !["running", "exited", "created"].includes(row.State)) {
      fail("a container differs from the saved shared Compose project");
    }
    observed.set(row.Service, row);
  }
  if (state.units[appId].every((id) => isManualJobService(expected.get(id)!))) {
    return { state: "prepared", health: "not-applicable", executed: false,
      acceptanceVerified: false, checkedAt: new Date().toISOString() };
  }
  const networks = new Map<string, Entry>(state.manifest.networks.map((network: Entry) =>
    [network.id, network]));
  const inspectedNetworks = new Map<string, Entry>();
  const exactNetwork = (id: string): Entry => {
    const saved = networks.get(id);
    if (!saved || typeof saved.name !== "string") fail("a saved shared network is missing");
    const cached = inspectedNetworks.get(id);
    if (cached) return cached;
    const network = dockerJson(context, ["network", "inspect", saved.name,
      "--format", "{{json .}}"], "exact shared network");
    if (network.Name !== saved.name || network.Driver !== "bridge"
      || network.Internal !== saved.internal || typeof network.Id !== "string"
      || network.Labels?.["com.docker.compose.project"] !== state.project.id
      || network.Labels?.["com.docker.compose.network"] !== id) {
      fail("shared network ownership differs from the saved Compose project");
    }
    const members = network.Containers ?? {};
    if (typeof members !== "object" || Array.isArray(members)) {
      fail("shared network membership is invalid");
    }
    const expectedMembers = state.manifest.services
      .filter((service: Entry) => service.networks.includes(id))
      .map((service: Entry) => observed.get(service.id))
      .filter((row: Entry | undefined) => row?.State === "running");
    const actualIds = Object.keys(members);
    if (actualIds.length !== expectedMembers.length
      || expectedMembers.some((row: Entry) =>
        actualIds.filter((actual) => actual.startsWith(row.ID)).length !== 1)) {
      fail("shared network members differ from the saved running Compose services");
    }
    inspectedNetworks.set(id, network);
    return network;
  };
  const unit = state.units[appId];
  for (const serviceId of unit) {
    const row = observed.get(serviceId);
    const service = expected.get(serviceId);
    if (!row || !service) fail(`${appId} has a missing owned service`);
    const labels = dockerJson(context, ["inspect", "--type", "container", row.ID,
      "--format", "{{json .Config.Labels}}"], "exact container labels");
    if (labels["com.docker.compose.project"] !== state.project.id
      || labels["com.docker.compose.service"] !== serviceId
      || labels["com.docker.compose.project.config_files"] !== originTarget
      || labels["com.docker.compose.project.working_dir"] !== state.project.directory) {
      fail(`${appId} container ownership labels differ from its saved Compose file`);
    }
    const bindings = dockerJson(context, ["inspect", "--type", "container", row.ID,
      "--format", "{{json .HostConfig.PortBindings}}"], "exact container ports");
    if (Object.keys(bindings).length !== service.ports.length) {
      fail(`${appId} container published ports differ from its saved manifest`);
    }
    for (const port of service.ports) {
      const actual = bindings[`${port.target}/${port.protocol}`];
      if (!Array.isArray(actual) || actual.length !== 1
        || actual[0].HostPort !== String(port.published)
        || actual[0].HostIp !== port.hostIp) {
        fail(`${appId} container origin differs from its saved manifest`);
      }
    }
    if (row.State === "running") {
      const memberships = dockerJson(context, ["inspect", "--type", "container", row.ID,
        "--format", "{{json .NetworkSettings.Networks}}"], "exact container networks");
      const expectedNames = service.networks.map((id: string) => {
        const saved = networks.get(id);
        if (!saved || typeof saved.name !== "string") fail("a saved service network is missing");
        return saved.name;
      }).sort();
      if (JSON.stringify(Object.keys(memberships).sort()) !== JSON.stringify(expectedNames)) {
        fail(`${appId} container networks differ from its saved Compose service`);
      }
      for (const id of service.networks) {
        const network = exactNetwork(id);
        const member = memberships[network.Name];
        if (member?.NetworkID !== network.Id
          || (id === "front" && (!Array.isArray(member.Aliases)
            || !member.Aliases.includes(serviceId)))) {
          fail(`${appId} container is not on its exact owned Compose network`);
        }
      }
    }
  }
  const states = unit.map((id) => observed.get(id)!);
  const running = states.filter((row) => row.State === "running").length;
  let stateName = "partial";
  if (running === states.length) stateName = "running";
  if (running === 0) stateName = "stopped";
  const imageChecks = new Map<string, Entry>();
  const health = documentedUnitHealth(states.map((row) => {
    const service = expected.get(row.Service)!;
    if (service.healthcheck) return { health: row.Health, documented: true };
    if (!["healthy", "unhealthy", "starting"].includes(row.Health)) {
      return { health: row.Health, documented: false };
    }
    let imageCheck = imageChecks.get(service.image);
    if (!imageCheck) {
      imageCheck = dockerJson(context, ["image", "inspect", service.image,
        "--format", "{{json .Config.Healthcheck}}"], "pinned image health check");
      imageChecks.set(service.image, imageCheck);
    }
    const actual = dockerJson(context, ["inspect", "--type", "container", row.ID,
      "--format", "{{json .Config.Healthcheck}}"], "exact container health check");
    return { health: row.Health, documented: inheritedHealthcheckMatches(actual, imageCheck) };
  }));
  return { state: stateName, health, checkedAt: new Date().toISOString() };
}

/** Observes an exact saved unit without depending on the current catalog recipe. */
export function sharedUnitRuntime(state: SharedProjectState, appId: string,
  composeTarget: string, originTarget = composeTarget): Entry {
  if (!Object.hasOwn(state.units, appId)) fail(`${appId} is not a saved shared unit`);
  return runtime(state, appId, composeTarget, originTarget);
}

/** Exact pre-mutation ownership observation; only non-secret Docker metadata is queried. */
export async function observeSharedSavedUnitRuntime(state: SharedProjectState, appId: string,
  expectedRecordHash = state.recordHash): Promise<Entry> {
  if (state.checkpoint.phase !== "completed" || !Object.hasOwn(state.units, appId)) {
    fail("runtime ownership observation needs a completed saved unit");
  }
  const origins = await loadSharedUnitComposeOrigins(state.project.directory, state.project.id, expectedRecordHash);
  const origin = origins[appId];
  if (!origin) fail(`${appId} has no exact saved Compose origin`);
  const owner = createSelfhostComposeOwner(state.manifest);
  const plan = await owner.plan();
  await owner.checkRendered(plan);
  return sharedUnitRuntime(state, appId, plan.render.target, origin);
}

/** Resolves one active unit of a completed shared owner, without creating a second project. */
export async function sharedUnitStatus(root: string, projectId: string, appId: string,
  recipeFor: RecipeFor, approvalFor: ApprovalFor, live = true, appFor?: AppFor): Promise<Entry> {
  const directory = join(root, ".selfhost", "shared", projectId);
  const state = await loadSharedProjectState(directory, projectId);
  if (!state || state.project.directory !== directory
    || state.checkpoint.phase !== "completed" || !Object.hasOwn(state.units, appId)) {
    fail(`${appId} needs a completed, active shared Compose unit`);
  }
  const { recipe, port } = selectedRecipe(state, appId, recipeFor);
  await verifySharedGeneratedConfigFiles(recipe, directory);
  const transitionSpec = recipe.postFirstAccountEnvironment;
  let environmentTransition: Entry | null = null;
  if (transitionSpec && hasValidatedSharedPostAccountTransition(state, appId)) {
    const serviceId = transitionSpec.serviceId === appId
      ? appId : `${appId}-${transitionSpec.serviceId}`;
    const service = state.manifest.services.find((item: Entry) => item.id === serviceId);
    let matches = service?.environment?.some((item: Entry) => item.name === transitionSpec.name && item.value === transitionSpec.to);
    if (transitionSpec.to === null) matches = Array.isArray(service?.environment)
      && !service.environment.some((item: Entry) => item.name === transitionSpec.name);
    if (matches) {
      environmentTransition = { serviceId, name: transitionSpec.name,
        value: transitionSpec.to, after: transitionSpec.after,
        manifestHash: state.manifestHash, revision: state.revision };
    }
  }
  const externalAdmin = appId === "seerr" && recipe.onboarding?.kind === "external-first-admin"
    && recipe.onboarding?.providerAppId === "jellyfin";
  const noAccount = recipe.onboarding?.kind === "no-account";
  const manualJob = checkedManualJobRecipe(recipe);
  const connector = checkedConnectorRecipe(recipe);
  const daemon = checkedPrivateDaemonRecipe(recipe);
  const externalSecret = recipe.onboarding?.kind === "external-secret"
    && recipe.privateFiles.some((file: Entry) => file.id === recipe.onboarding.fileId
      && file.source === "owner");
  const generatedApiToken = recipe.onboarding?.kind === "generated-api-token";
  const gpgClientCredential = gpgClientEnrollmentCredential(recipe);
  const httpBasic = checkedHttpBasicOnboarding(recipe);
  const mutableAdmin = checkedMutableAdminOnboarding(recipe);
  const officialClientCredential = officialClientFirstEmailCredential(recipe, join(directory, "secrets", appId));
  if (generatedApiToken && (typeof recipe.onboarding.fileId !== "string"
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(recipe.onboarding.fileId)
    || !recipe.privateFiles.some((file: Entry) =>
      file.id === recipe.onboarding.fileId && file.source === undefined
        && [undefined, "base64url", "alphanumeric", "hex"].includes(file.format)))) {
    fail(`${appId} has no generated API-token contract`);
  }
  const passwordOnly = recipe.onboarding?.kind === "initial-password-from-file"
    || recipe.onboarding?.kind === "manual-first-password";
  const emailAdmin = recipe.onboarding?.kind === "initial-admin-email-from-secret-env"
    || recipe.onboarding?.kind === "manual-first-email"
    || (appId === "immich" && recipe.onboarding?.kind === "api-first-admin"
      && recipe.onboarding?.adapter === "immich-v3.2.2");
  const declaredUsername = recipe.onboarding?.username;
  const usernameEnvironment = recipe.onboarding?.usernameEnvironment;
  const secretEnvAdmin = recipe.onboarding?.kind === "initial-admin-from-secret-env";
  const bootstrapServiceId = recipe.onboarding?.bootstrapServiceId ?? appId;
  const bootstrapService = recipe.services.find((service: Entry) => service.id === bootstrapServiceId);
  const environmentAdmin = ["initial-admin-from-file", "initial-admin-from-secret-env"]
    .includes(recipe.onboarding?.kind)
    && typeof declaredUsername === "string" && /^[A-Za-z0-9._-]{1,32}$/.test(declaredUsername)
    && typeof usernameEnvironment === "string"
    && (secretEnvAdmin ? bootstrapService !== undefined : true)
    && (secretEnvAdmin ? [bootstrapService] : recipe.services).some((service: Entry) => service.environment.some((entry: Entry) =>
      entry.name === usernameEnvironment && entry.value === declaredUsername));
  const fixedAdmin = secretEnvAdmin
    && recipe.onboarding.fixedUsername === true
    && typeof declaredUsername === "string" && /^[A-Za-z0-9._-]{1,32}$/.test(declaredUsername)
    && usernameEnvironment === undefined;
  const bootstrapSecretBound = !secretEnvAdmin || (typeof bootstrapServiceId === "string"
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(bootstrapServiceId)
    && bootstrapService?.secretEnvironment?.some((entry: Entry) =>
      entry.name === recipe.onboarding.secretEnvironment && entry.fileId === recipe.onboarding.fileId));
  const fileId = recipe.onboarding?.fileId;
  if (!externalAdmin && !noAccount && !manualJob && !connector && !externalSecret && !generatedApiToken && !officialClientCredential && !gpgClientCredential && (typeof fileId !== "string"
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fileId)
    || !bootstrapSecretBound
    || (!mutableAdmin && !httpBasic && !emailAdmin && !passwordOnly && !environmentAdmin && !fixedAdmin && declaredUsername !== "admin")
    || (emailAdmin && (typeof recipe.onboarding.email !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9._+-]*@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/.test(recipe.onboarding.email)))
    || (passwordOnly && fileId !== "admin-password"))) {
    fail(`${appId} has no saved administrator-password contract`);
  }
  if (noAccount && (recipe.privateFiles.length !== 0 || recipe.services.some((service: Entry) =>
    service.fileEnvironment.length !== 0))) {
    fail(`${appId} no-account recipe cannot hide an undeclared credential`);
  }
  const owner = createSelfhostComposeOwner(state.manifest);
  const plan = await owner.plan();
  await owner.checkRendered(plan);
  const origins = await loadSharedUnitComposeOrigins(directory, projectId, state.recordHash);
  const originTarget = origins[appId];
  if (!originTarget) fail(`${appId} has no verified saved Compose origin`);
  const privateFiles = join(directory, "secrets", appId);
  let username: string | null = recipe.onboarding.username;
  let loginVia = "local";
  if (httpBasic) loginVia = "http-basic";
  if (mutableAdmin) loginVia = "file-user";
  if (emailAdmin) {
    username = recipe.onboarding.email;
    loginVia = "email";
  }
  if (passwordOnly) {
    username = null;
    loginVia = "password-only";
  }
  let passwordFile: string | null = null;
  if (typeof fileId === "string") passwordFile = join(privateFiles, fileId);
  if (officialClientCredential) {
    username = null;
    loginVia = officialClientCredential.loginVia;
    passwordFile = officialClientCredential.passwordFile;
  }
  if (gpgClientCredential) {
    username = null;
    loginVia = gpgClientCredential.loginVia;
    passwordFile = null;
  }
  if (externalAdmin) {
    username = "admin";
    loginVia = "jellyfin";
    passwordFile = null;
  }
  if (noAccount) {
    username = null;
    loginVia = "none";
    passwordFile = null;
  }
  if (manualJob) {
    username = null;
    loginVia = "job-credentials";
    passwordFile = null;
  }
  if (connector) {
    username = null;
    loginVia = "connector-enrollment";
    passwordFile = null;
  }
  if (externalSecret) {
    username = null;
    loginVia = "external-secret";
    passwordFile = null;
  }
  let tokenFile: string | null = null;
  if (generatedApiToken) {
    username = null;
    loginVia = "api-token";
    passwordFile = null;
    tokenFile = join(privateFiles, fileId);
  }
  let status = "applied";
  let url: string | null = null;
  const jobMetadata: Entry = {};
  if (sharedDerivedRecipeAdapter(appId)) {
    const binding = await loadSharedDerivedRecipeBinding(directory, appId, state);
    jobMetadata.derivedRecipe = { appId, input: binding.derived.input,
      configuration: binding.derived.configuration, sourceSha256: binding.derived.sourceSha256,
      recipeSha256: binding.derived.recipeSha256, selectionFingerprint: binding.selectionFingerprint,
      bindingHash: binding.bindingHash, configurationFilesVerified: true };
  }
  if (officialClientCredential) Object.assign(jobMetadata, officialClientCredential);
  if (gpgClientCredential) Object.assign(jobMetadata, gpgClientCredential);
  if (httpBasic) Object.assign(jobMetadata, { credentialUsage: "http-basic-control-interface",
    administratorCreated: false, apiKeyCreated: false });
  const boundHttpsRoutes = savedSharedPrivateHttpsRoutes(state, recipeFor);
  let privateHttpsRoutes = null;
  if (appId === "caddy") privateHttpsRoutes = boundHttpsRoutes;
  const setupRoutes = boundHttpsRoutes?.filter((route) => route.appId === appId) ?? [];
  if (setupRoutes.length === 1) {
    Object.assign(jobMetadata, { setupUrl: setupRoutes[0]!.url,
      privateHttps: { transportVerified: false, clientTrustVerified: false } });
  }
  if (manualJob) Object.assign(jobMetadata, { manualJob: true, executed: false, acceptanceVerified: false });
  if (manualJob) status = "job-prepared";
  else if (connector) {
    Object.assign(jobMetadata, { connector: true, frontendSharing: recipe.execution.frontendSharing,
      enrollmentStatus: "pending", enrollmentVerified: false, clientAccessVerified: false });
    status = "connector-applied-unverified";
  }
  else if (daemon) {
    Object.assign(jobMetadata, { daemon: true, frontend: { kind: "none" },
      enrollmentStatus: "pending", enrollmentVerified: false, clientAccessVerified: false });
  }
  else if (privateHttpsRoutes) {
    Object.assign(jobMetadata, { privateHttps: { routes: privateHttpsRoutes,
      transportVerified: false, dnsVerified: false, clientTrustVerified: false } });
  }
  else {
    const manifest = appFor?.(appId) ?? recipeFor(appId).app ?? { id: appId };
    if (manifest.id !== appId) fail("frontend metadata differs from its saved app");
    const frontend = state.manifest.services.find((service: Entry) => service.id === appId);
    const target = frontend?.ports?.find((item: Entry) => item.published === port && item.protocol === "tcp")?.target;
    const endpoints = resolveAppEndpoints(manifest, port!, appId, target);
    url = endpoints.browserUrl;
    Object.assign(jobMetadata, { frontend: endpoints.frontend,
      endpoint: endpoints.endpoint, serverEndpoint: endpoints.serverEndpoint });
  }
  return { schemaVersion: 1, command: "app status", ownerKind: "shared",
    appId, projectRoot: root, projectId, mutation: false, status,
    ...jobMetadata,
    installedAppIds: Object.keys(state.units).sort(),
    dockerContext: state.project.dockerContext, applyApproval: approvalFor(state),
    ownerRevision: state.revision, ownerRecordHash: state.recordHash,
    ownerPhase: state.checkpoint.phase, manifestHash: state.manifestHash,
    selectionFingerprint: state.selectionFingerprints[appId],
    environmentTransition,
    username, loginVia,
    composeTarget: originTarget, port, url,
    privateFiles, privateFileIds: recipe.privateFiles.map((file: Entry) => file.id), passwordFile, tokenFile,
    runtime: live ? runtime(state, appId, plan.render.target, originTarget) : null };
}

export async function sharedUnitHandoff(root: string, projectId: string, appId: string,
  recipeFor: RecipeFor, approvalFor: ApprovalFor, appFor?: AppFor): Promise<Entry> {
  const status = await sharedUnitStatus(root, projectId, appId, recipeFor, approvalFor, false, appFor);
  const keyFile = join(status.privateFiles, `${appId}-api-key`);
  const enrollment: Entry = {};
  if (status.loginVia === "http-basic") {
    Object.assign(enrollment, { credentialUsage: "http-basic-control-interface",
      administratorCreated: false, apiKeyCreated: false });
  }
  if (status.loginVia === "official-client-email") {
    Object.assign(enrollment, { email: status.email, credentialUsage: status.credentialUsage,
      enrollmentStatus: status.enrollmentStatus, accountCreated: status.accountCreated,
      loginVerified: status.loginVerified, unlockVerified: status.unlockVerified });
  }
  if (status.loginVia === "gpg-client-enrollment") {
    const custodyPath = join(status.privateFiles, "client-openpgp.json");
    let clientKeyCustodyFile: string | null = null;
    if (existsSync(custodyPath)) {
      const file = lstatSync(custodyPath);
      if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1
        || file.uid !== process.getuid?.() || (file.mode & 0o7777) !== 0o600
        || realpathSync(custodyPath) !== custodyPath || file.size < 1 || file.size > 1048576) {
        fail("the client-key custody reference is not an exact owner-only file");
      }
      clientKeyCustodyFile = custodyPath;
    }
    Object.assign(enrollment, { clientKeyCustodyFile, credentialUsage: "native-openpgp-client-key",
      apiKeyCreated: false });
  }
  if (status.connector === true) {
    Object.assign(enrollment, { connector: true, frontendSharing: status.frontendSharing,
      enrollmentStatus: "pending", enrollmentVerified: false, clientAccessVerified: false });
  }
  let apiKeyFile: string | null = null;
  if (status.connector !== true && status.manualJob !== true && existsSync(keyFile)) apiKeyFile = keyFile;
  const credentialFiles: Record<string, string> = {};
  if (status.manualJob === true) {
    for (const fileId of status.privateFileIds) {
      credentialFiles[fileId] = join(status.privateFiles, fileId);
    }
    Object.assign(enrollment, { manualJob: true, executed: false, acceptanceVerified: false,
      credentialFiles });
  }
  const recovery = { ...readSetupRecoverySummary({ appDirectory: join(root, ".selfhost", "shared", projectId),
    privateFiles: status.privateFiles }, appId, root), owner: { ownerKind: "shared", projectRoot: root, projectId, appId,
      ownerRevision: status.ownerRevision, ownerRecordHash: status.ownerRecordHash,
      manifestHash: status.manifestHash, selectionFingerprint: status.selectionFingerprint } };
  let adapter: Entry = { state: "unavailable", path: null, sha256: null };
  try {
    const source = await setupAdapterSource(appId);
    if (source) adapter = { state: "present", path: fileURLToPath(source.url), sha256: source.sha256 };
  } catch { /* Unsafe adapter sources must not hide the existing private handoff. */ }
  Object.assign(recovery, { adapter, instructions: [
    `Read ${appId}'s referenced adapter; reconcile the saved stage and attempted actions before retrying.`,
    "Use its firstRun, inspect (when available), and ready contract for the same completion criterion; function and restart acceptance remain separate.",
    "Use only a documented shared-owner fallback with protected credential transport and exact approval; if unavailable, stop and report the gap.",
  ] });
  return { schemaVersion: 1, command: "app handoff", ownerKind: "shared",
    appId, projectRoot: root, projectId, mutation: false, secretful: false,
    ownerRevision: status.ownerRevision, manifestHash: status.manifestHash,
    username: status.username, loginVia: status.loginVia, url: status.url,
    frontend: status.frontend ?? null, endpoint: status.endpoint ?? null, serverEndpoint: status.serverEndpoint ?? null,
    setupUrl: status.setupUrl ?? null,
    passwordFile: status.passwordFile,
    ...enrollment,
    tokenFile: status.tokenFile,
    privateFiles: status.privateFiles, apiKeyFile, recovery };
}

function ownedSecret(path: string, directory: string): string {
  const folder = lstatSync(directory);
  if (!folder.isDirectory() || folder.isSymbolicLink() || realpathSync(directory) !== directory
    || (folder.mode & 0o7777) !== 0o700 || folder.uid !== process.getuid?.()) {
    fail("a requested credential is not an exact owner-only file");
  }
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const file = fstatSync(descriptor);
    const pathname = lstatSync(path);
    if (!file.isFile() || file.nlink !== 1 || file.uid !== process.getuid?.()
      || (file.mode & 0o7777) !== 0o600 || file.size < 4 || file.size > 8192
      || pathname.isSymbolicLink() || pathname.dev !== file.dev || pathname.ino !== file.ino) {
      fail("a requested credential is not an exact owner-only file");
    }
    const value = readFileSync(descriptor, "utf8").replace(/\r?\n$/, "");
    if (value.length < 4 || /[\r\n\0]/.test(value)) fail("a requested credential has an invalid format");
    return value;
  } finally { closeSync(descriptor); }
}

/** Explicit, secretful terminal handoff; ordinary status never calls this. */
export async function sharedUnitSecretHandoff(root: string, projectId: string, appId: string,
  recipeFor: RecipeFor, approvalFor: ApprovalFor, appFor?: AppFor): Promise<Entry> {
  const handoff = await sharedUnitHandoff(root, projectId, appId, recipeFor, approvalFor, appFor);
  const password = handoff.passwordFile === null ? null
    : ownedSecret(handoff.passwordFile, handoff.privateFiles);
  const apiKey = handoff.apiKeyFile === null
    ? null : ownedSecret(handoff.apiKeyFile, handoff.privateFiles);
  const credentials: Record<string, string> = {};
  for (const [fileId, path] of Object.entries(handoff.credentialFiles ?? {})) {
    credentials[fileId] = ownedSecret(path as string, handoff.privateFiles);
  }
  return { ...handoff, secretful: true, password, apiKey, credentials };
}
