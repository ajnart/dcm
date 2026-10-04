import { createHash, X509Certificate } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  createHouseholdCredentials,
  householdCredentialStatus,
  loadHouseholdCredential,
} from "../../../.agents/skills/self-host/workflows/selfhost-setup/scripts/household-credentials";
import { buildHouseholdManifest } from "../../../.agents/skills/self-host/workflows/selfhost-setup/scripts/household-plan";
import { createSelfhostComposeOwner } from "./lib/selfhost-compose.ts";
import { vaultwardenLocalHttpsCommand } from "./vaultwarden-local-https.ts";
import {
  householdVaultwardenCredentialFingerprint,
  describeHouseholdVaultwardenSignupFailure,
  signupHouseholdVaultwarden,
  VAULTWARDEN_SIGNUP_STAGES,
} from "../../../.agents/skills/self-host/workflows/selfhost-setup/scripts/household-browser-credentials.ts";

type JsonObject = Record<string, any>;

type HttpsPlan = {
  schemaVersion: 1;
  origin: string;
  exposure: "private";
  routeStatus: "configured";
  routeOwner: string;
  tlsOwner: string;
  clientCertificateTrust: "verified-for-intended-client";
  backend: { hostIp: string; publishedPort: number };
};

type SignupEvidence = {
  schemaVersion: 1;
  origin: string;
  observedAt: string;
  secureContext: true;
  cryptoSubtle: true;
  accountCreated: true;
  freshLoginVerified: true;
};

type AccountMetadata = {
  schemaVersion: 1;
  username: string;
  email: string;
};

type Phase = "bootstrap-registration" | "close-registration";

const RUN_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const OWNER = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/;
const USERNAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const EMAIL = /^[\x21-\x7e]{3,254}$/;
const MAX_JSON_BYTES = 256 * 1024;
const SIGNUP_IMAGE = "docker.io/vaultwarden/server:1.37.3@sha256:1587c45feaa479f1f5e8af3b00eded36bff77bcf1880cf8dbf0541706dd470e0";
const SIGNUP_CONTRACT = "vaultwarden-1.37.3-20260927";

function fail(message: string): never {
  throw new Error(message);
}

function exactKeys(value: JsonObject, keys: string[], name: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail(`${name} has unsupported or missing fields`);
  }
}

function requireObject(value: unknown, name: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${name} must be an object`);
  }
  return value as JsonObject;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertSafeOwner(metadata: Awaited<ReturnType<typeof lstat>>, name: string): void {
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    fail(`${name} has a different owner`);
  }
}

async function assertDirectory(path: string, name: string, privateMode: boolean): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path) {
    fail(`${name} must be a real canonical directory`);
  }
  assertSafeOwner(metadata, name);
  const mode = metadata.mode & 0o777;
  if (privateMode && mode !== 0o700) {
    fail(`${name} must use mode 0700`);
  }
  if (!privateMode && (mode & 0o002) !== 0) {
    fail(`${name} must not be world-writable`);
  }
}

async function projectPaths(projectRootInput: string, runId: string) {
  if (!isAbsolute(projectRootInput) || resolve(projectRootInput) !== projectRootInput
    || projectRootInput === sep || projectRootInput === await realpath(homedir())) {
    fail("--project-root must be an exact absolute project path, not home or the filesystem root");
  }
  if (!RUN_ID.test(runId)) {
    fail("--run-id is invalid");
  }
  await assertDirectory(projectRootInput, "project root", false);
  const local = join(projectRootInput, ".selfhost");
  await assertDirectory(local, ".selfhost directory", true);
  const vaultwarden = join(local, "vaultwarden");
  const run = join(vaultwarden, runId);
  return { projectRoot: projectRootInput, local, vaultwarden, run, runId };
}

async function validateProjectRoot(projectRootInput: string): Promise<void> {
  if (!isAbsolute(projectRootInput) || resolve(projectRootInput) !== projectRootInput
    || projectRootInput === sep || projectRootInput === await realpath(homedir())) {
    fail("--project-root must be an exact absolute project path, not home or the filesystem root");
  }
  await assertDirectory(projectRootInput, "project root", false);
}

async function writePrivateText(file: string, value: string): Promise<void> {
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(value);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function ensureLocalState(projectRootInput: string): Promise<void> {
  await validateProjectRoot(projectRootInput);
  const local = join(projectRootInput, ".selfhost");
  if (!existsSync(local)) {
    await mkdir(local, { mode: 0o700 });
  }
  await assertDirectory(local, ".selfhost directory", true);
  const ignore = join(local, ".gitignore");
  if (!existsSync(ignore)) {
    await writePrivateText(ignore, "*\n");
  }
  const metadata = await lstat(ignore);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || (metadata.mode & 0o777) !== 0o600 || await realpath(ignore) !== ignore) {
    fail(".selfhost ignore file must be an owner-only regular file");
  }
  assertSafeOwner(metadata, ".selfhost ignore file");
  if (await readFile(ignore, "utf8") !== "*\n") {
    fail(".selfhost ignore file must contain only the wildcard ignore rule");
  }
}

async function ensureDirectory(path: string, name: string): Promise<void> {
  if (!existsSync(path)) {
    await mkdir(path, { mode: 0o700 });
  }
  await assertDirectory(path, name, true);
}

async function readInputJson(file: string, name: string): Promise<unknown> {
  if (!isAbsolute(file) || resolve(file) !== file) {
    fail(`${name} must be an absolute normalized path`);
  }
  const metadata = await lstat(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 2 || metadata.size > MAX_JSON_BYTES) {
    fail(`${name} must be a bounded regular non-symlink JSON file`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch {
    fail(`${name} is not valid JSON`);
  }
  return parsed;
}

async function readPrivateJson(file: string): Promise<any> {
  const metadata = await lstat(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || metadata.size < 2 || metadata.size > MAX_JSON_BYTES || (metadata.mode & 0o777) !== 0o600
    || await realpath(file) !== file) {
    fail("Vaultwarden CLI state is unsafe");
  }
  assertSafeOwner(metadata, "Vaultwarden CLI state");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch {
    fail("Vaultwarden CLI state is invalid JSON");
  }
  return parsed;
}

async function readAccountMetadata(projectRoot: string, file: string): Promise<AccountMetadata> {
  if (!isAbsolute(file) || resolve(file) !== file) {
    fail("--account-file must be an absolute normalized path");
  }
  const localPath = relative(projectRoot, file);
  if (localPath === ".." || localPath.startsWith(`..${sep}`) || isAbsolute(localPath)) {
    fail("--account-file must stay inside the selected project root");
  }
  const account = requireObject(await readPrivateJson(file), "account metadata");
  exactKeys(account, ["schemaVersion", "username", "email"], "account metadata");
  if (account.schemaVersion !== 1 || typeof account.username !== "string" || !USERNAME.test(account.username)
    || typeof account.email !== "string" || !EMAIL.test(account.email) || account.email.trim() !== account.email
    || !/^[^@]+@[^@.]+(?:\.[^@.]+)+$/.test(account.email)) {
    fail("account metadata must contain the exact selected ASCII username and email");
  }
  return account as AccountMetadata;
}

async function writePrivateJson(file: string, value: unknown): Promise<void> {
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function validateHttpsOrigin(value: unknown, name: string): string {
  if (typeof value !== "string") {
    fail(`${name} must be an HTTPS origin`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${name} must be an HTTPS origin`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/"
    || parsed.search || parsed.hash || parsed.origin !== value) {
    fail(`${name} must be an exact HTTPS origin without credentials, path, query, or fragment`);
  }
  return parsed.origin;
}

function validateHttpsPlan(value: unknown, manifest: JsonObject): HttpsPlan {
  const plan = requireObject(value, "private HTTPS plan");
  exactKeys(plan, ["schemaVersion", "origin", "exposure", "routeStatus", "routeOwner", "tlsOwner", "clientCertificateTrust", "backend"], "private HTTPS plan");
  if (plan.schemaVersion !== 1 || plan.exposure !== "private" || plan.routeStatus !== "configured"
    || plan.clientCertificateTrust !== "verified-for-intended-client") {
    fail("private HTTPS plan must record a configured private route and verified intended-client certificate trust");
  }
  if (typeof plan.routeOwner !== "string" || !OWNER.test(plan.routeOwner)
    || typeof plan.tlsOwner !== "string" || !OWNER.test(plan.tlsOwner)) {
    fail("private HTTPS route and TLS owners are invalid");
  }
  const backend = requireObject(plan.backend, "private HTTPS backend");
  exactKeys(backend, ["hostIp", "publishedPort"], "private HTTPS backend");
  const service = manifest.services[0];
  const port = service.ports[0];
  const domain = service.environment.find((entry: JsonObject) => entry.name === "DOMAIN")?.value;
  if (validateHttpsOrigin(plan.origin, "private HTTPS origin") !== domain
    || backend.hostIp !== port.hostIp || backend.publishedPort !== port.published) {
    fail("private HTTPS plan must match the exact Vaultwarden DOMAIN and private backend bind");
  }
  return plan as HttpsPlan;
}

function validateSignupEvidence(value: unknown, origin: string): SignupEvidence {
  const evidence = requireObject(value, "signup evidence");
  exactKeys(evidence, ["schemaVersion", "origin", "observedAt", "secureContext", "cryptoSubtle", "accountCreated", "freshLoginVerified"], "signup evidence");
  if (evidence.schemaVersion !== 1 || evidence.origin !== origin || evidence.secureContext !== true
    || evidence.cryptoSubtle !== true || evidence.accountCreated !== true || evidence.freshLoginVerified !== true
    || typeof evidence.observedAt !== "string" || Number.isNaN(Date.parse(evidence.observedAt))) {
    fail("signup evidence must record secure-context WebCrypto, account creation, and a fresh login at the approved origin");
  }
  return evidence as SignupEvidence;
}

function selectedVaultwardenInput(rawInput: unknown, bootstrapRegistration: boolean): JsonObject {
  const input = requireObject(rawInput, "household input");
  const apps = requireObject(input.apps, "household input apps");
  if (JSON.stringify(Object.keys(apps).sort()) !== JSON.stringify(["vaultwarden"])) {
    fail("Vaultwarden CLI requires a dedicated Vaultwarden-only Compose project");
  }
  const vaultwarden = requireObject(apps.vaultwarden, "Vaultwarden input");
  if (!Object.hasOwn(vaultwarden, "bootstrapRegistration") || vaultwarden.bootstrapRegistration !== bootstrapRegistration) {
    let required = "false";
    if (bootstrapRegistration) {
      required = "true";
    }
    fail(`Vaultwarden input must explicitly set bootstrapRegistration to ${required}`);
  }
  return input;
}

function environmentValue(manifest: JsonObject, name: string): string {
  const service = manifest.services[0];
  const entry = service.environment.find((candidate: JsonObject) => candidate.name === name);
  if (!entry || typeof entry.value !== "string") {
    fail(`Vaultwarden manifest is missing ${name}`);
  }
  return entry.value;
}

function assertVaultwardenManifest(manifest: JsonObject, signupsAllowed: boolean): void {
  if (!Array.isArray(manifest.services) || manifest.services.length !== 1 || manifest.services[0].id !== "vaultwarden") {
    fail("Vaultwarden manifest must contain only Vaultwarden");
  }
  let expected = "false";
  if (signupsAllowed) {
    expected = "true";
  }
  if (environmentValue(manifest, "SIGNUPS_ALLOWED") !== expected
    || environmentValue(manifest, "INVITATIONS_ALLOWED") !== "false"
    || environmentValue(manifest, "ROCKET_PORT") !== "8080") {
    fail("Vaultwarden registration or listener policy is invalid");
  }
  validateHttpsOrigin(environmentValue(manifest, "DOMAIN"), "Vaultwarden DOMAIN");
  const service = manifest.services[0];
  if (service.secretRefs.length !== 0) {
    fail("Vaultwarden deployment manifest must not contain account credentials or server administration secrets");
  }
  if (!Array.isArray(service.ports) || service.ports.length !== 1 || service.ports[0].publicApproved !== false) {
    fail("Vaultwarden backend must use one non-public approved bind");
  }
}

function prepareCloseManifest(manifest: JsonObject): JsonObject {
  const result = structuredClone(manifest);
  if (result.project.ownership !== "verified-existing") {
    fail("close-registration input must record the Compose project as verified-existing");
  }
  for (const mount of result.services[0].mounts) {
    if (mount.ownership !== "verified-existing") {
      fail("close-registration input must record Vaultwarden storage as verified-existing");
    }
  }
  for (const network of result.networks) {
    if (network.owner === result.project.owner) {
      if (network.ownership === "new") network.ownership = "verified-existing";
      if (network.ownership !== "verified-existing") fail("close-registration network ownership is invalid");
      delete network.subnet;
    }
  }
  return result;
}

function comparableDeployment(manifest: JsonObject): JsonObject {
  const value = structuredClone(manifest);
  delete value.observed;
  value.project.ownership = "same-deployment";
  for (const service of value.services) {
    for (const environment of service.environment) {
      if (environment.name === "SIGNUPS_ALLOWED") {
        environment.value = "phase-specific";
      }
    }
    for (const mount of service.mounts) {
      mount.ownership = "same-deployment";
    }
  }
  for (const network of value.networks) {
    network.ownership = "same-deployment";
  }
  return value;
}

function assertSameDeployment(bootstrap: JsonObject, close: JsonObject): void {
  if (JSON.stringify(comparableDeployment(bootstrap)) !== JSON.stringify(comparableDeployment(close))) {
    fail("close-registration may change only observed ownership and the registration setting");
  }
}

function credentialBoundary(projectRoot: string, runId: string) {
  const status = householdCredentialStatus(projectRoot, runId);
  if (!status.services.some((service) => service.id === "vaultwarden")) {
    fail("the private household credential run does not select Vaultwarden");
  }
  return {
    runId,
    privateHandoffPath: status.path,
    vaultwardenSelected: true,
    secretsInPlan: false,
  };
}

function ensureVaultwardenCredentials(projectRoot: string, runId: string, account: AccountMetadata): void {
  const handoff = join(projectRoot, ".selfhost", "household", ".sessions", runId, "artifacts", "private-handoff.json");
  if (!existsSync(handoff)) {
    createHouseholdCredentials({
      projectRoot,
      runId,
      username: account.username,
      email: account.email,
      services: ["vaultwarden"],
    });
  }
  const status = householdCredentialStatus(projectRoot, runId);
  if (status.services.length !== 1 || status.services[0].id !== "vaultwarden") {
    fail("existing household credential run must contain only Vaultwarden");
  }
  const credential = loadHouseholdCredential(projectRoot, runId, "vaultwarden");
  if (credential.username !== account.username || credential.email !== account.email) {
    fail("existing Vaultwarden credential run belongs to different account metadata");
  }
}

function phaseFiles(run: string, phase: Phase) {
  if (phase === "close-registration") {
    const directory = join(run, "close-registration");
    return {
      manifest: join(directory, "manifest.json"),
      httpsPlan: join(run, "private-https-plan.json"),
      evidence: join(directory, "signup-evidence.json"),
      approval: join(directory, "approval-plan.json"),
      applied: join(directory, "applied.json"),
    };
  }
  return {
    manifest: join(run, "bootstrap-manifest.json"),
    httpsPlan: join(run, "private-https-plan.json"),
    evidence: join(run, "signup-evidence.json"),
    approval: join(run, "bootstrap-approval-plan.json"),
    applied: join(run, "bootstrap-applied.json"),
  };
}

function planFacts(input: {
  phase: Phase;
  runId: string;
  manifest: JsonObject;
  compose: JsonObject;
  https: HttpsPlan;
  credentials: ReturnType<typeof credentialBoundary>;
  signupEvidence?: SignupEvidence;
  previousRenderTarget?: string;
}) {
  const facts: JsonObject = {
    schemaVersion: 1,
    kind: "selfhost-vaultwarden-plan",
    phase: input.phase,
    runId: input.runId,
    manifest: input.manifest,
    composePlan: input.compose,
    privateHttps: input.https,
    credentialBoundary: input.credentials,
    accountBootstrap: {
      method: "official-web-client",
      secretTransport: "household-browser-credentials-stdin",
      browserFallback: "agent-browser",
      snapshotsWithPopulatedCredentials: false,
    },
  };
  if (input.signupEvidence) {
    facts.signupEvidence = input.signupEvidence;
  }
  if (input.previousRenderTarget) {
    facts.composeRevision = {
      previousRenderTarget: input.previousRenderTarget,
      newRenderTarget: input.compose.render.target,
      noClobber: true,
      previousRenderPreserved: true,
    };
  }
  return facts;
}

async function currentPlan(paths: Awaited<ReturnType<typeof projectPaths>>, phase: Phase) {
  const files = phaseFiles(paths.run, phase);
  if (phase === "close-registration") {
    await assertDirectory(dirname(files.approval), "close-registration plan directory", true);
  }
  const saved = await readPrivateJson(files.approval);
  const manifest = await readPrivateJson(files.manifest);
  assertVaultwardenManifest(manifest, phase === "bootstrap-registration");
  const httpsPlan = validateHttpsPlan(await readPrivateJson(files.httpsPlan), manifest);
  let signupEvidence: SignupEvidence | undefined;
  let previousRenderTarget: string | undefined;
  if (phase === "close-registration") {
    signupEvidence = validateSignupEvidence(await readPrivateJson(files.evidence), httpsPlan.origin);
    const bootstrap = await currentPlan(paths, "bootstrap-registration");
    previousRenderTarget = bootstrap.plan.composePlan.render.target;
  }
  const composeOwner = createSelfhostComposeOwner(manifest, files.manifest);
  const compose = await composeOwner.plan();
  if (previousRenderTarget && previousRenderTarget === compose.render.target) {
    fail("selfhost-compose did not allocate a distinct no-clobber target for registration closure");
  }
  const facts = planFacts({
    phase,
    runId: paths.runId,
    manifest,
    compose,
    https: httpsPlan,
    credentials: credentialBoundary(paths.projectRoot, paths.runId),
    signupEvidence,
    previousRenderTarget,
  });
  const approvalDigest = hash(facts);
  if (saved.approvalDigest !== approvalDigest || JSON.stringify(saved) !== JSON.stringify({ ...facts, approvalDigest })) {
    fail("saved Vaultwarden plan changed; prepare a new run before applying");
  }
  return { plan: saved, manifest, files, composeOwner };
}

async function prepareBootstrap(args: Record<string, string>): Promise<void> {
  const runId = args["--run-id"];
  await ensureLocalState(args["--project-root"]);
  const account = await readAccountMetadata(args["--project-root"], args["--account-file"]);
  const paths = await projectPaths(args["--project-root"], runId);
  const rawInput = selectedVaultwardenInput(await readInputJson(args["--input"], "--input"), true);
  const manifest = buildHouseholdManifest(rawInput) as JsonObject;
  assertVaultwardenManifest(manifest, true);
  if (manifest.project.ownership !== "new") {
    fail("Vaultwarden bootstrap requires a new dedicated Compose project");
  }
  const httpsPlan = validateHttpsPlan(await readInputJson(args["--https-plan"], "--https-plan"), manifest);
  ensureVaultwardenCredentials(paths.projectRoot, runId, account);
  const credentials = credentialBoundary(paths.projectRoot, runId);
  await ensureDirectory(paths.vaultwarden, "Vaultwarden CLI directory");
  if (existsSync(paths.run)) {
    fail("Vaultwarden run already exists; use status or choose a new run ID");
  }
  await mkdir(paths.run, { mode: 0o700 });
  try {
    const files = phaseFiles(paths.run, "bootstrap-registration");
    await writePrivateJson(files.manifest, manifest);
    await writePrivateJson(files.httpsPlan, httpsPlan);
    const compose = await createSelfhostComposeOwner(manifest, files.manifest).plan();
    const facts = planFacts({ phase: "bootstrap-registration", runId, manifest, compose, https: httpsPlan, credentials });
    const plan = { ...facts, approvalDigest: hash(facts) };
    await writePrivateJson(files.approval, plan);
    await writePrivateJson(join(paths.run, "signup-eligibility.json"), {
      schemaVersion: 1,
      kind: "vaultwarden-bounded-first-signup",
      bootstrapApprovalDigest: plan.approvalDigest,
      preparedAt: new Date().toISOString(),
      signupAttemptsBeforePreparation: false,
    });
    console.log(JSON.stringify({
      ...plan,
      next: `Review this exact bootstrap plan, then apply with --approve ${plan.approvalDigest}`,
    }, null, 2));
  } catch (error) {
    await rm(paths.run, { recursive: true, force: true });
    throw error;
  }
}

async function appliedEvidence(file: string, phase: Phase, approvalDigest: string, composePlanId: string) {
  if (!existsSync(file)) {
    return null;
  }
  const evidence = await readPrivateJson(file);
  exactKeys(evidence, ["schemaVersion", "phase", "approvalDigest", "composePlanId", "appliedAt", "configVerified"], "Vaultwarden apply evidence");
  if (evidence.schemaVersion !== 1 || evidence.phase !== phase || evidence.approvalDigest !== approvalDigest
    || evidence.composePlanId !== composePlanId || evidence.configVerified !== true
    || typeof evidence.appliedAt !== "string" || Number.isNaN(Date.parse(evidence.appliedAt))) {
    fail("Vaultwarden apply evidence does not match the current plan");
  }
  return evidence;
}

async function renderAndApply(current: Awaited<ReturnType<typeof currentPlan>>): Promise<void> {
  const composeFile = await current.composeOwner.render(current.plan.composePlan);
  const mounts = current.manifest.services[0].mounts;
  if (!Array.isArray(mounts) || mounts.length !== 1 || mounts[0].target !== "/data"
    || mounts[0].readOnly !== false || typeof mounts[0].source !== "string") {
    fail("Vaultwarden needs exactly one writable /data mount");
  }
  const source = mounts[0].source;
  const projectDirectory = current.manifest.project.directory;
  const storageRelative = relative(projectDirectory, source);
  if (storageRelative === "" || storageRelative === ".." || storageRelative.startsWith(`..${sep}`)
    || isAbsolute(storageRelative)) {
    fail("Vaultwarden /data must stay inside its exact Compose project directory");
  }
  await assertDirectory(dirname(source), "Vaultwarden data parent", true);
  if (current.manifest.project.dockerContext === "rootless"
    && current.manifest.project.ownership === "verified-existing") {
    const metadata = await lstat(source);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(source) !== source
      || (metadata.mode & 0o077) !== 0) {
      fail("Existing rootless Vaultwarden /data must be a private real directory");
    }
  } else {
    await ensureDirectory(source, "Vaultwarden data directory");
  }
  if (current.manifest.project.dockerContext === "rootless"
    && current.manifest.project.ownership === "new") {
    const user = current.manifest.services[0].user;
    if (typeof user !== "string" || !/^\d+:\d+$/.test(user)) {
      fail("Rootless Vaultwarden requires an exact numeric container identity");
    }
    if (user !== "0:0") {
      const result = spawnSync("docker", [
        "--context", "rootless", "compose",
        "--project-name", current.manifest.project.id,
        "--file", composeFile,
        "run", "--rm", "--no-deps", "--user", "0:0",
        "--entrypoint", "/bin/chown", "vaultwarden", "-R", user, "/data",
      ], { stdio: "ignore", timeout: 120_000 });
      if (result.status !== 0) {
        fail("Vaultwarden rootless /data ownership repair failed within its exact Compose project; data was retained");
      }
    }
  }
  await current.composeOwner.apply(current.plan.composePlan);
}

async function applyPhase(args: Record<string, string>, phase: Phase): Promise<void> {
  const runId = args["--run-id"];
  const digest = args["--approve"];
  if (!DIGEST.test(digest)) {
    fail("--approve must be the exact 64-character Vaultwarden plan digest");
  }
  const paths = await projectPaths(args["--project-root"], runId);
  await assertDirectory(paths.run, "Vaultwarden run directory", true);
  const current = await currentPlan(paths, phase);
  if (phase === "bootstrap-registration" && existsSync(phaseFiles(paths.run, "close-registration").applied)) {
    fail("registration closure is already applied; use Vaultwarden checkpoint status");
  }
  if (current.plan.approvalDigest !== digest) {
    fail("Vaultwarden plan approval does not match the current exact plan");
  }
  const existing = await appliedEvidence(current.files.applied, phase, digest, current.plan.composePlan.planId);
  if (!existing) {
    await renderAndApply(current);
    await writePrivateJson(current.files.applied, {
      schemaVersion: 1,
      phase,
      approvalDigest: digest,
      composePlanId: current.plan.composePlan.planId,
      appliedAt: new Date().toISOString(),
      configVerified: true,
    });
  }
  if (phase === "bootstrap-registration") {
    const signup = signupFiles(paths.run);
    if (!existsSync(signup.eligibility) || existsSync(signup.attempt) || existsSync(signup.evidence)) {
      console.log(JSON.stringify({ status: "existing-login-reconciliation-only", phase,
        origin: current.plan.privateHttps.origin, signupRepeatAllowed: false,
        required: ["Inspect signup status and reconcile the existing managed account with fresh identity-matched login.",
          "Never repeat signup, reset the vault, or re-enable registration."], acceptance: "pending" }, null, 2));
      return;
    }
    console.log(JSON.stringify({
      status: "browser-signup-required",
      phase,
      origin: current.plan.privateHttps.origin,
      privateCredentialHandoff: current.plan.credentialBoundary.privateHandoffPath,
      required: [
        "Run signup plan with the exact browser executable and public CA certificate; review its separate approval.",
        "Use signup apply once under that content-bound approval; do not submit signup manually before this bounded attempt.",
        "Record non-secret signup evidence, then prepare close-registration with verified-existing host observations.",
      ],
      acceptance: "pending",
    }, null, 2));
    return;
  }
  console.log(JSON.stringify({
    status: "registration-config-closed",
    phase,
    origin: current.plan.privateHttps.origin,
    configVerified: true,
    required: [
      "Verify the saved account still signs in and unlocks through the private HTTPS origin.",
      "Verify new account registration is unavailable.",
    ],
    acceptance: "pending-browser-verification",
  }, null, 2));
}

async function prepareCloseRegistration(args: Record<string, string>): Promise<void> {
  const runId = args["--run-id"];
  const paths = await projectPaths(args["--project-root"], runId);
  await assertDirectory(paths.run, "Vaultwarden run directory", true);
  const bootstrap = await currentPlan(paths, "bootstrap-registration");
  const bootstrapApplied = await appliedEvidence(
    bootstrap.files.applied,
    "bootstrap-registration",
    bootstrap.plan.approvalDigest,
    bootstrap.plan.composePlan.planId,
  );
  if (!bootstrapApplied) {
    fail("bootstrap registration must be applied before close-registration can be planned");
  }
  const rawInput = selectedVaultwardenInput(await readInputJson(args["--input"], "--input"), false);
  const observed = requireObject(rawInput.observed, "close-registration observed facts");
  if (typeof observed.checkedAt !== "string" || Number.isNaN(Date.parse(observed.checkedAt))
    || Date.parse(observed.checkedAt) < Date.parse(bootstrapApplied.appliedAt)) {
    fail("close-registration observations must be recorded after bootstrap apply");
  }
  const requestedCloseManifest = buildHouseholdManifest(rawInput) as JsonObject;
  assertVaultwardenManifest(requestedCloseManifest, false);
  assertSameDeployment(bootstrap.manifest, requestedCloseManifest);
  const closeManifest = prepareCloseManifest(requestedCloseManifest);
  const evidence = validateSignupEvidence(
    await readInputJson(args["--signup-evidence"], "--signup-evidence"),
    bootstrap.plan.privateHttps.origin,
  );
  if (Date.parse(evidence.observedAt) < Date.parse(bootstrapApplied.appliedAt)) {
    fail("signup evidence must be recorded after bootstrap apply");
  }
  const files = phaseFiles(paths.run, "close-registration");
  const phaseDirectory = dirname(files.manifest);
  if (existsSync(phaseDirectory)) {
    fail("close-registration plan already exists; use status or apply its exact digest");
  }
  const temporary = join(paths.run, `.close-registration-${process.pid}-${Date.now()}`);
  await mkdir(temporary, { mode: 0o700 });
  try {
    const stagedManifest = join(temporary, "manifest.json");
    await writePrivateJson(stagedManifest, closeManifest);
    const compose = await createSelfhostComposeOwner(closeManifest, stagedManifest).plan();
    if (compose.render.target === bootstrap.plan.composePlan.render.target) {
      fail("selfhost-compose did not allocate a distinct no-clobber target for registration closure");
    }
    const facts = planFacts({
      phase: "close-registration",
      runId,
      manifest: closeManifest,
      compose,
      https: bootstrap.plan.privateHttps,
      credentials: credentialBoundary(paths.projectRoot, runId),
      signupEvidence: evidence,
      previousRenderTarget: bootstrap.plan.composePlan.render.target,
    });
    const plan = { ...facts, approvalDigest: hash(facts) };
    await writePrivateJson(join(temporary, "signup-evidence.json"), evidence);
    await writePrivateJson(join(temporary, "approval-plan.json"), plan);
    await rename(temporary, phaseDirectory);
    console.log(JSON.stringify({
      ...plan,
      next: `Review this exact registration-closure plan, then run close-registration with --approve ${plan.approvalDigest}`,
    }, null, 2));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function signupFiles(run: string) {
  return {
    eligibility: join(run, "signup-eligibility.json"),
    attempt: join(run, "signup-attempt.jsonl"),
    evidence: join(run, "signup-evidence.json"),
  };
}

function validateSignupFailure(value: unknown, runId: string) {
  const failure = requireObject(value, "signup failure descriptor");
  exactKeys(failure, ["stage", "submitted", "browserSession"], "signup failure descriptor");
  const stages: readonly string[] = [...VAULTWARDEN_SIGNUP_STAGES, "invoke-signup-helper", "record-signup-evidence"];
  const runHash = createHash("sha256").update(runId).digest("hex").slice(0, 12);
  if (!stages.includes(failure.stage) || typeof failure.submitted !== "boolean"
    || (failure.browserSession !== null && (typeof failure.browserSession !== "string"
      || !new RegExp(`^selfhost-vault-signup-${runHash}-[a-f0-9]{24}$`).test(failure.browserSession)))) {
    fail("Vaultwarden signup failure descriptor is invalid; no actions can be replayed");
  }
  return failure as { stage: string; submitted: boolean; browserSession: string | null };
}

async function signupAttempt(file: string, runId: string): Promise<{ records: JsonObject[]; interruptedTail: boolean } | null> {
  if (!existsSync(file)) return null;
  const metadata = await lstat(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || (metadata.mode & 0o777) !== 0o600 || metadata.size > MAX_JSON_BYTES || await realpath(file) !== file) {
    fail("Vaultwarden signup attempt ledger is unsafe; signup cannot be repeated");
  }
  assertSafeOwner(metadata, "Vaultwarden signup attempt ledger");
  try {
    const raw = await readFile(file, "utf8");
    const interruptedTail = !raw.endsWith("\n");
    let completePrefix = raw;
    if (interruptedTail) completePrefix = raw.slice(0, raw.lastIndexOf("\n") + 1);
    let lines: string[] = [];
    if (completePrefix !== "") lines = completePrefix.slice(0, -1).split("\n");
    const records = lines.map((line) => requireObject(JSON.parse(line), "signup attempt"));
    if ((!interruptedTail && records.length < 1) || records.length > 5 || records.some((record) => record.schemaVersion !== 1
      || !["intent", "browser-session-intent", "submission-intent", "accepted", "unknown"].includes(record.stage)
      || !DIGEST.test(record.approvalDigest) || typeof record.observedAt !== "string"
      || Number.isNaN(Date.parse(record.observedAt)))) {
      fail("invalid ledger");
    }
    for (const record of records) {
      const keys = ["schemaVersion", "stage", "approvalDigest", "observedAt"];
      if (record.stage === "intent") keys.push("approvedPlan");
      if (record.stage === "browser-session-intent") {
        keys.push("browserSession");
        validateSignupFailure({ stage: "invoke-signup-helper", submitted: false, browserSession: record.browserSession }, runId);
        if (record.browserSession === null) fail("signup browser-session intent must name its owned nonce");
      }
      if (record.stage === "unknown" && record.failure !== undefined) {
        keys.push("failure");
        validateSignupFailure(record.failure, runId);
      }
      exactKeys(record, keys, "signup attempt record");
    }
    return { records, interruptedTail };
  } catch {
    fail("Vaultwarden signup attempt is interrupted or invalid; reconcile existing login, never repeat signup");
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function signupFacts(args: Record<string, string>) {
  const paths = await projectPaths(args["--project-root"], args["--run-id"]);
  await assertDirectory(paths.vaultwarden, "Vaultwarden CLI directory", true);
  await assertDirectory(paths.run, "Vaultwarden run directory", true);
  const files = signupFiles(paths.run);
  const bootstrap = await currentPlan(paths, "bootstrap-registration");
  const applied = await appliedEvidence(bootstrap.files.applied, "bootstrap-registration",
    bootstrap.plan.approvalDigest, bootstrap.plan.composePlan.planId);
  if (!applied) fail("Vaultwarden signup needs the exact applied bootstrap checkpoint");
  if (bootstrap.manifest.project.ownership !== "new" || bootstrap.manifest.services[0].image !== SIGNUP_IMAGE
    || bootstrap.manifest.services[0].mounts.some((mount: JsonObject) => mount.ownership !== "new")) {
    fail("Vaultwarden signup supports only the originally-new exact observed 1.37.3 image");
  }
  if (existsSync(dirname(phaseFiles(paths.run, "close-registration").approval))
    || existsSync(files.evidence)) fail("Vaultwarden signup is already evidenced or registration closure is planned; use existing login only");
  if (existsSync(files.attempt)) {
    await signupAttempt(files.attempt, paths.runId);
    fail("Vaultwarden signup has already been attempted; reconcile existing fresh login only, never repeat signup");
  }
  if (!existsSync(files.eligibility)) fail("Legacy Vaultwarden runs have unknown signup history; use existing login only");
  const eligibility = requireObject(await readPrivateJson(files.eligibility), "signup eligibility");
  exactKeys(eligibility, ["schemaVersion", "kind", "bootstrapApprovalDigest", "preparedAt", "signupAttemptsBeforePreparation"], "signup eligibility");
  if (eligibility.schemaVersion !== 1 || eligibility.kind !== "vaultwarden-bounded-first-signup"
    || eligibility.bootstrapApprovalDigest !== bootstrap.plan.approvalDigest || eligibility.signupAttemptsBeforePreparation !== false
    || typeof eligibility.preparedAt !== "string" || Number.isNaN(Date.parse(eligibility.preparedAt))
    || Date.parse(eligibility.preparedAt) > Date.parse(applied.appliedAt)) {
    fail("Vaultwarden first-signup eligibility does not match the original bootstrap apply");
  }
  const browserBin = args["--browser-bin"];
  if (!isAbsolute(browserBin) || resolve(browserBin) !== browserBin) fail("--browser-bin must name the exact absolute browser executable");
  const browserMetadata = await lstat(browserBin);
  if (!browserMetadata.isFile() || browserMetadata.isSymbolicLink() || await realpath(browserBin) !== browserBin
    || (browserMetadata.mode & 0o022) !== 0 || (browserMetadata.mode & 0o111) === 0) {
    fail("--browser-bin must be a canonical executable, not group/world writable");
  }
  const browserSandbox = args["--browser-sandbox"] ?? "enabled";
  if (!["enabled", "disabled"].includes(browserSandbox)) fail("--browser-sandbox must be enabled or disabled");
  const browserHelp = spawnSync(browserBin, ["--help"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000, maxBuffer: 128 * 1024 });
  if (browserHelp.status !== 0 || ["--ca-cert", "--config", "--allowed-domains"].some((flag) => !browserHelp.stdout.includes(flag))) {
    fail("The exact browser must support explicit --ca-cert, isolated --config, and --allowed-domains");
  }
  if (browserSandbox === "disabled" && !browserHelp.stdout.includes("--args")) fail("The exact browser cannot apply the explicit disabled-sandbox choice");
  for (const executable of ["bun", "certutil"]) {
    let argumentsForCheck = ["--version"];
    if (executable === "certutil") argumentsForCheck = ["-H"];
    const checked = spawnSync(executable, argumentsForCheck, { stdio: "ignore", timeout: 10_000 });
    if (checked.error || (executable === "bun" && checked.status !== 0)) fail(`Vaultwarden signup requires installed ${executable}`);
  }
  const caCert = args["--ca-cert"];
  if (!isAbsolute(caCert) || resolve(caCert) !== caCert) fail("--ca-cert must be an exact absolute public CA certificate path");
  const caMetadata = await lstat(caCert);
  if (!caMetadata.isFile() || caMetadata.isSymbolicLink() || await realpath(caCert) !== caCert
    || caMetadata.size < 1 || caMetadata.size > 16_384 || (caMetadata.mode & 0o022) !== 0) fail("Public CA certificate is unsafe");
  const caBytes = await readFile(caCert);
  const caText = caBytes.toString("utf8");
  if (!/^\s*-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/.test(caText)
    || (caText.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length !== 1 || caText.includes("PRIVATE KEY")) fail("--ca-cert must contain only one public CA certificate");
  const certificate = new X509Certificate(caBytes);
  if (!certificate.ca || !certificate.verify(certificate.publicKey) || certificate.subject !== certificate.issuer
    || Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) < Date.now()) fail("Public CA must be a currently-valid self-signed root");
  const facts = {
    schemaVersion: 1, kind: "vaultwarden-signup-plan", runId: paths.runId,
    bootstrapApply: applied, bootstrapApprovalDigest: bootstrap.plan.approvalDigest,
    manifestFingerprint: hash(bootstrap.manifest), image: SIGNUP_IMAGE,
    privateHttps: bootstrap.plan.privateHttps, eligibility,
    publicCa: { path: caCert, fingerprint: certificate.fingerprint256 },
    browser: { executable: browserBin, fingerprint: createHash("sha256").update(await readFile(browserBin)).digest("hex"),
      sandbox: browserSandbox, trust: "fresh-isolated-session-explicit-ca-cert", certificateBypass: false },
    credentialFingerprint: householdVaultwardenCredentialFingerprint(paths.projectRoot, paths.runId),
    uiContractVersion: SIGNUP_CONTRACT,
    policy: { signupSubmissions: 1, breachLookup: false, reset: false, reenableRegistration: false,
      freshIdentityMatchedLogin: true, registrationClosure: "separate-approval", retryAfterUnknown: false },
  };
  return { paths, files, facts, approvalDigest: hash(facts) };
}

async function signupCommand(input: string[]): Promise<void> {
  const parsed = parse([`signup-${input[0]}`, ...input.slice(1)]);
  const args = parsed.values;
  if (parsed.action === "signup-status") {
    const paths = await projectPaths(args["--project-root"], args["--run-id"]);
    await assertDirectory(paths.vaultwarden, "Vaultwarden CLI directory", true);
    await assertDirectory(paths.run, "Vaultwarden run directory", true);
    const files = signupFiles(paths.run);
    const attempt = await signupAttempt(files.attempt, paths.runId);
    const records = attempt?.records;
    let evidence: SignupEvidence | null = null;
    const bootstrap = await currentPlan(paths, "bootstrap-registration");
    if (existsSync(files.evidence)) evidence = validateSignupEvidence(await readPrivateJson(files.evidence), bootstrap.plan.privateHttps.origin);
    let state = "not-attempted";
    if (!existsSync(files.eligibility)) state = "legacy-history-unknown";
    if (attempt) state = "attempted-reconciliation-required";
    if (evidence) state = "signup-and-fresh-login-recorded";
    const failure = records?.find((record) => record.stage === "unknown")?.failure ?? null;
    const browserSessionIntent = records?.find((record) => record.stage === "browser-session-intent")?.browserSession ?? null;
    let takeoverSession: string | null = null;
    if (!evidence) takeoverSession = failure?.browserSession ?? browserSessionIntent;
    let next = "Use existing identity-matched fresh login for reconciliation; never reset or re-enable signup.";
    if (evidence) next = "Signup and identity-matched fresh login are recorded; prepare registration closure under its separate exact approval.";
    const report: JsonObject = { schemaVersion: 1, kind: "vaultwarden-signup-status", runId: paths.runId,
      state, attemptRecorded: attempt !== null, evidenceRecorded: evidence !== null,
      signupRepeatAllowed: false, runtimeInspected: false,
      evidencePath: files.evidence, acceptance: "pending-registration-closure-and-recovery",
      failure,
      interruptedTail: attempt?.interruptedTail ?? false,
      lastDurableStage: records?.at(-1)?.stage ?? null,
      next };
    if (takeoverSession) {
      report.takeover = { browserSession: takeoverSession,
        launchProvenance: failure?.browserSession ? "confirmed-before-failure" : "recorded-session-intent-only",
        scope: "owned isolated browser only; private metadata inspection, no action replay",
        privateCredentialHandoff: credentialBoundary(paths.projectRoot, paths.runId).privateHandoffPath,
        warning: "Do not export populated snapshots, field values, full URLs, or raw browser envelopes. Fixed-session CLI login does not target this owned nonce session." };
    } else {
      report.loginCommand = ["self-host", "browser", "login", "--project-root", paths.projectRoot,
        "--run-id", paths.runId, "--service", "vaultwarden", "--origin", bootstrap.plan.privateHttps.origin];
      report.loginPrerequisite = "Open the initial email login form in the exact fresh CA-trusted fixed household session; login does not repeat signup.";
    }
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const current = await signupFacts(args);
  if (parsed.action === "signup-plan") {
    console.log(JSON.stringify({ ...current.facts, approvalDigest: current.approvalDigest,
      mutation: false, next: `Review this exact signup plan, then signup apply with --approve ${current.approvalDigest}` }, null, 2));
    return;
  }
  if (!DIGEST.test(args["--approve"]) || args["--approve"] !== current.approvalDigest) fail("Vaultwarden signup approval does not match the current content-bound plan");
  const ledger = await open(current.files.attempt, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let ownedBrowserSession: string | null = null;
  async function append(stage: string, failure?: { stage: string; submitted: boolean; browserSession: string | null }) {
    const record: JsonObject = { schemaVersion: 1, stage, approvalDigest: current.approvalDigest, observedAt: new Date().toISOString() };
    if (stage === "intent") record.approvedPlan = current.facts;
    if (stage === "browser-session-intent") record.browserSession = ownedBrowserSession;
    if (failure) record.failure = failure;
    await ledger.writeFile(`${JSON.stringify(record)}\n`);
    await ledger.sync();
  }
  let submitted = false;
  let failureStage = "invoke-signup-helper";
  try {
    await append("intent");
    await syncDirectory(current.paths.run);
    const result = await signupHouseholdVaultwarden({ projectRoot: current.paths.projectRoot, runId: current.paths.runId,
      origin: current.facts.privateHttps.origin, browserBin: args["--browser-bin"], caCert: args["--ca-cert"],
      browserSandbox: current.facts.browser.sandbox as "enabled" | "disabled",
      expectedCredentialFingerprint: current.facts.credentialFingerprint,
      expectedCaFingerprint: current.facts.publicCa.fingerprint,
      onBrowserSession: async (browserSession: string) => {
        validateSignupFailure({ stage: "invoke-signup-helper", submitted: false, browserSession }, current.paths.runId);
        if (ownedBrowserSession !== null) fail("Vaultwarden signup browser-session intent cannot repeat");
        ownedBrowserSession = browserSession;
        await append("browser-session-intent");
      },
      uiContractVersion: SIGNUP_CONTRACT, beforeSubmit: async () => {
        if (submitted) fail("Vaultwarden signup submission cannot repeat");
        submitted = true;
        await append("submission-intent");
      } });
    if (!submitted || result.status !== "accepted" || result.freshLoginVerified !== true
      || result.secureContext !== true || result.cryptoSubtle !== true) fail("Vaultwarden signup was not accepted");
    failureStage = "record-signup-evidence";
    const evidence = validateSignupEvidence({ schemaVersion: 1, origin: current.facts.privateHttps.origin,
      observedAt: result.observedAt, secureContext: true, cryptoSubtle: true, accountCreated: true, freshLoginVerified: true }, current.facts.privateHttps.origin);
    if (Date.parse(evidence.observedAt) < Date.parse(current.facts.bootstrapApply.appliedAt)
      || Date.parse(evidence.observedAt) > Date.now()) fail("Vaultwarden signup evidence is outside the applied bootstrap interval");
    await writePrivateJson(current.files.evidence, evidence);
    await syncDirectory(current.paths.run);
    await append("accepted");
    console.log(JSON.stringify({ schemaVersion: 1, kind: "vaultwarden-signup-result", status: "accepted",
      evidencePath: current.files.evidence, registrationClosure: "separate-approval-required",
      acceptance: "pending-registration-closure-and-recovery" }, null, 2));
  } catch (error) {
    const failure = validateSignupFailure(describeHouseholdVaultwardenSignupFailure(error)
      ?? { stage: failureStage, submitted, browserSession: null }, current.paths.runId);
    await append("unknown", failure);
    console.log(JSON.stringify({ schemaVersion: 1, kind: "vaultwarden-signup-result", status: "unknown",
      failure, signupRepeatAllowed: false, attemptPath: current.files.attempt,
      takeover: { browserSession: failure.browserSession ?? ownedBrowserSession,
        launchProvenance: failure.browserSession ? "confirmed-before-failure" : "recorded-session-intent-only",
        scope: "owned isolated browser only; private form-control metadata inspection",
        privateCredentialHandoff: credentialBoundary(current.paths.projectRoot, current.paths.runId).privateHandoffPath },
      next: "Inspect signup status and reconcile existing login privately. Never replay signup, reset the vault, or re-enable registration.",
      warning: "Never print populated snapshots, field values, full URLs, or raw browser envelopes; fixed-session CLI login does not target an owned nonce session.",
      acceptance: "pending" }, null, 2));
    process.exitCode = 1;
  } finally { await ledger.close(); }
}

async function status(args: Record<string, string>): Promise<void> {
  const runId = args["--run-id"];
  const paths = await projectPaths(args["--project-root"], runId);
  await assertDirectory(paths.run, "Vaultwarden run directory", true);
  const bootstrap = await currentPlan(paths, "bootstrap-registration");
  const bootstrapApplied = await appliedEvidence(
    bootstrap.files.applied,
    "bootstrap-registration",
    bootstrap.plan.approvalDigest,
    bootstrap.plan.composePlan.planId,
  );
  let closePlan: JsonObject | null = null;
  let closeApplied: JsonObject | null = null;
  const closeFiles = phaseFiles(paths.run, "close-registration");
  if (existsSync(closeFiles.approval)) {
    const close = await currentPlan(paths, "close-registration");
    closePlan = close.plan;
    closeApplied = await appliedEvidence(close.files.applied, "close-registration", close.plan.approvalDigest, close.plan.composePlan.planId);
  }
  let next = "Apply the exact bootstrap plan digest.";
  if (bootstrapApplied) {
    next = "Complete browser signup and prepare close-registration.";
  }
  const signup = signupFiles(paths.run);
  const signupAttemptRecorded = existsSync(signup.attempt);
  const signupEvidenceRecorded = existsSync(signup.evidence);
  if (bootstrapApplied && !existsSync(signup.eligibility)) {
    next = "Legacy signup history is unknown; reconcile existing identity-matched fresh login only. Never repeat signup.";
  }
  if (signupAttemptRecorded) {
    next = "Signup was already attempted; reconcile existing identity-matched fresh login only. Never repeat signup.";
  }
  if (signupEvidenceRecorded) {
    next = "Signup and fresh login are recorded; prepare registration closure under its separate approval.";
  }
  if (closePlan) {
    next = "Verify fresh login with the stored account, then apply the exact close-registration plan digest.";
  }
  if (closeApplied) {
    next = "Verify existing login and confirm new registration is unavailable.";
  }
  let closeApprovalDigest: string | null = null;
  if (closePlan) {
    closeApprovalDigest = closePlan.approvalDigest;
  }
  let acceptance = "pending";
  if (closeApplied) {
    acceptance = "pending-browser-verification";
  }
  console.log(JSON.stringify({
    schemaVersion: 1,
    kind: "vaultwarden-plan-checkpoint-status",
    profile: "vaultwarden",
    runId,
    origin: bootstrap.plan.privateHttps.origin,
    bootstrap: {
      approvalDigest: bootstrap.plan.approvalDigest,
      applied: bootstrapApplied !== null,
    },
    accountBootstrap: {
      method: "official-web-client",
      evidenceRecorded: signupEvidenceRecorded || existsSync(closeFiles.evidence),
      attemptRecorded: signupAttemptRecorded,
      boundedSignupEligible: bootstrapApplied !== null && bootstrap.manifest.services[0].image === SIGNUP_IMAGE
        && bootstrap.manifest.project.ownership === "new"
        && bootstrap.manifest.services[0].mounts.every((mount: JsonObject) => mount.ownership === "new")
        && existsSync(signup.eligibility) && !signupAttemptRecorded && !signupEvidenceRecorded && closePlan === null,
    },
    registrationClosure: {
      approvalDigest: closeApprovalDigest,
      applied: closeApplied !== null,
    },
    runtimeInspected: false,
    scope: "saved plans and local checkpoint files only",
    acceptance,
    next,
  }, null, 2));
}

async function lifecycle(args: Record<string, string>, action: "up" | "down" | "lifecycle-check"): Promise<void> {
  const paths = await projectPaths(args["--project-root"], args["--run-id"]);
  await assertDirectory(paths.run, "Vaultwarden run directory", true);
  let phase: Phase = "bootstrap-registration";
  let current = await currentPlan(paths, phase);
  let applied = await appliedEvidence(current.files.applied, phase, current.plan.approvalDigest, current.plan.composePlan.planId);
  if (existsSync(phaseFiles(paths.run, "close-registration").approval)) {
    const closePhase: Phase = "close-registration";
    const close = await currentPlan(paths, closePhase);
    const closeApplied = await appliedEvidence(close.files.applied, closePhase, close.plan.approvalDigest, close.plan.composePlan.planId);
    if (closeApplied) {
      phase = closePhase;
      current = close;
      applied = closeApplied;
    }
  }
  if (!applied) fail(`Vaultwarden lifecycle needs the applied ${phase} checkpoint`);
  const target = current.plan.composePlan.render.target;
  if (!existsSync(target)) fail("The exact applied Vaultwarden Compose file is missing");
  if (action === "lifecycle-check") await current.composeOwner.preflight(current.plan.composePlan);
  else if (action === "up") await current.composeOwner.apply(current.plan.composePlan);
  else await current.composeOwner.stop(current.plan.composePlan);
  console.log(JSON.stringify({ schemaVersion: 1, kind: "vaultwarden-bundle-lifecycle", action,
    phase, project: current.manifest.project.id, runId: paths.runId, composeFile: target,
    volumesDeleted: false, acceptance: "pending-browser-verification" }, null, 2));
}

function parse(args: string[]) {
  const action = args[0];
  const values: Record<string, string> = {};
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || !value || value.startsWith("--") || Object.hasOwn(values, flag)) {
      fail("Vaultwarden CLI options are invalid or repeated");
    }
    values[flag] = value;
  }
  let allowed: string[] = [];
  if (action === "prepare") {
    allowed = ["--project-root", "--run-id", "--input", "--https-plan", "--account-file"];
  }
  if (action === "apply") {
    allowed = ["--project-root", "--run-id", "--approve"];
  }
  if (action === "status") {
    allowed = ["--project-root", "--run-id"];
  }
  if (action === "signup-plan" || action === "signup-apply") {
    allowed = ["--project-root", "--run-id", "--browser-bin", "--ca-cert", "--browser-sandbox"];
    if (action === "signup-apply") allowed.push("--approve");
  }
  if (action === "signup-status") allowed = ["--project-root", "--run-id"];
  if (action === "up" || action === "down" || action === "lifecycle-check") {
    allowed = ["--project-root", "--run-id"];
  }
  if (action === "close-registration") {
    allowed = ["--project-root", "--run-id", "--input", "--signup-evidence"];
    if (values["--approve"]) {
      allowed = ["--project-root", "--run-id", "--approve"];
    }
  }
  if (allowed.length === 0 || Object.keys(values).some((flag) => !allowed.includes(flag))
    || allowed.filter((flag) => flag !== "--browser-sandbox").some((flag) => !Object.hasOwn(values, flag))) {
    fail("Vaultwarden CLI action or options are invalid");
  }
  return { action, values };
}

export async function vaultwardenCommand(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "help" || args[0] === "--help") {
    console.log("vaultwarden signup plan --project-root ABSOLUTE --run-id ID --browser-bin ABSOLUTE --ca-cert PUBLIC_ROOT_CERT [--browser-sandbox enabled|disabled]\nvaultwarden signup apply --project-root ABSOLUTE --run-id ID --browser-bin ABSOLUTE --ca-cert PUBLIC_ROOT_CERT [--browser-sandbox enabled|disabled] --approve SIGNUP_DIGEST\nvaultwarden signup status --project-root ABSOLUTE --run-id ID\nSignup is one durable attempt for newly prepared, originally-new exact pinned 1.37.3 runs only. Interrupted/unknown attempts require existing-login reconciliation, never repeat signup. Registration closure needs separate approval.");
    console.log("vaultwarden local-https init --project-root ABSOLUTE --run-id ID --host-inspection OWNER_ONLY_JSON --caddy-image DIGEST_REF [--hostname LOCAL_NAME] [--https-port HIGH_PORT] [--bind-address PRIVATE_IP --dns-owner OWNER] [--route-subnet CIDR --ingress-subnet CIDR]\nvaultwarden local-https plan|apply|status --project-root ABSOLUTE --run-id ID --input CADDY_ROUTE_JSON [--approve APPLY_TOKEN]\nvaultwarden prepare --project-root ABSOLUTE --run-id ID --account-file OWNER_ONLY_JSON --input HOUSEHOLD_JSON --https-plan PRIVATE_HTTPS_JSON\nvaultwarden apply --project-root ABSOLUTE --run-id ID --approve DIGEST\nvaultwarden close-registration --project-root ABSOLUTE --run-id ID --input VERIFIED_EXISTING_HOUSEHOLD_JSON --signup-evidence JSON\nvaultwarden close-registration --project-root ABSOLUTE --run-id ID --approve DIGEST\nvaultwarden status --project-root ABSOLUTE --run-id ID");
    return;
  }
  if (args[0] === "local-https") {
    await vaultwardenLocalHttpsCommand(args.slice(1));
    return;
  }
  if (args[0] === "signup") {
    await signupCommand(args.slice(1));
    return;
  }
  const parsed = parse(args);
  if (parsed.action === "prepare") {
    await prepareBootstrap(parsed.values);
    return;
  }
  if (parsed.action === "apply") {
    await applyPhase(parsed.values, "bootstrap-registration");
    return;
  }
  if (parsed.action === "status") {
    await status(parsed.values);
    return;
  }
  if (parsed.action === "up" || parsed.action === "down" || parsed.action === "lifecycle-check") {
    await lifecycle(parsed.values, parsed.action);
    return;
  }
  if (parsed.values["--approve"]) {
    await applyPhase(parsed.values, "close-registration");
    return;
  }
  await prepareCloseRegistration(parsed.values);
}
