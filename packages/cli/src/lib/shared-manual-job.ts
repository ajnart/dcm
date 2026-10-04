import { assertPrivatePath, ownedByCurrentUser, privateMode } from "./platform-private.ts";
import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SetupManualJobPreparation } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { generatedPrivateFileLength } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/private-file.ts";
import { checkedManualJobRecipe } from "./manual-job.ts";
import { verifySharedGeneratedConfigFiles } from "./multi-service-recipe.ts";
import { sharedProjectCandidate } from "./shared-compose-project.ts";
import { restoreSavedSharedSelection, type SharedSavedRecipeFor } from "./shared-saved-recipe.ts";
import { loadSharedProjectState, type SharedProjectState } from "./shared-project-state.ts";
import { readSharedHttpsPrivateFile } from "./shared-private-https-state.ts";
import { setupContractSha256 } from "./setup-contract.ts";
import { createSelfhostComposeOwner } from "./selfhost-compose.ts";

const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function fail(): never { throw new Error("Manual-job preparation differs from its exact saved owner, source, or private configuration"); }
function comparable(value: Record<string, any>): string {
  const copy = structuredClone(value);
  delete copy.ownership;
  for (const mount of copy.mounts ?? []) delete mount.ownership;
  return JSON.stringify(copy);
}
async function directory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (process.platform === "win32") assertPrivatePath(path, 0o700);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path
    || !ownedByCurrentUser(metadata) || !privateMode(metadata, 0o700)) fail();
}

/** No status/HTTP/Docker, initialization, repair, or probe. Existing bytes only. */
export async function inspectSharedManualJobPreparation(state: SharedProjectState, appId: string,
  recipeFor: SharedSavedRecipeFor): Promise<SetupManualJobPreparation> {
  const projectDirectory = state.project.directory;
  const projectRoot = dirname(dirname(dirname(projectDirectory)));
  const ownerAppIds = Object.keys(state.units).sort();
  const sourceSha256 = await setupContractSha256(appId, ownerAppIds);
  async function revalidate() {
    const latest = await loadSharedProjectState(projectDirectory, state.project.id);
    if (!latest || latest.recordHash !== state.recordHash || latest.checkpoint.phase !== "completed"
      || latest.manifestHash !== state.manifestHash || !Object.hasOwn(latest.units, appId)
      || await setupContractSha256(appId, ownerAppIds) !== sourceSha256) fail();
    return latest;
  }
  const current = await revalidate();
  const selection = restoreSavedSharedSelection(current, appId, recipeFor);
  const recipe = selection.recipe;
  if (!checkedManualJobRecipe(recipe) || selection.port !== null
    || recipe.privateConfigs?.length || recipe.mutableConfigs?.length) fail();
  const recipeSha256 = sha256(JSON.stringify(recipe));
  const replay = sharedProjectCandidate({ projectRoot, projectId: current.project.id,
    dockerContext: current.project.dockerContext, ...current.settings, apps: [selection],
    observed: current.manifest.observed });
  const service = current.manifest.services.find((entry: Record<string, any>) => entry.id === appId);
  const expected = replay.manifest.services.find((entry: Record<string, any>) => entry.id === appId);
  if (!service || !expected || comparable(service) !== comparable(expected)) fail();
  const owner = createSelfhostComposeOwner(current.manifest);
  await owner.checkRendered(await owner.plan());
  const privateDirectory = join(projectDirectory, "secrets", appId);
  const dataDirectory = join(projectDirectory, "data", appId);
  for (const path of [projectDirectory, join(projectDirectory, "secrets"), privateDirectory,
    join(projectDirectory, "data"), dataDirectory]) await directory(path);
  const credentialFiles: SetupManualJobPreparation["credentialFiles"] = [];
  const values = new Map<string, string>();
  for (const file of recipe.privateFiles) {
    const path = join(privateDirectory, file.id);
    let maximumBytes = 256;
    if (file.source === "owner") maximumBytes = file.maxBytes;
    const bytes = await readSharedHttpsPrivateFile(path, maximumBytes);
    const value = bytes.toString("utf8");
    if (!/^[A-Za-z0-9_-]+$/.test(value) || !bytes.equals(Buffer.from(value))) fail();
    if (file.source !== "owner" && (file.format !== undefined && file.format !== "base64url"
      || bytes.length !== generatedPrivateFileLength(file.bytes, "base64url"))) fail();
    let source: "generated" | "owner" = "generated";
    if (file.source === "owner") source = "owner";
    credentialFiles.push({ id: file.id, path, source, verified: true });
    values.set(file.id, value);
  }
  for (const selected of recipe.services) {
    if (!selected.secretEnvironment?.length) continue;
    const path = join(privateDirectory, `${selected.id}.env`);
    const expectedLines = selected.secretEnvironment.map((binding: Record<string, any>) => {
      if (binding.format !== "owner-token" || !values.has(binding.fileId)) fail();
      return `${binding.name}=${values.get(binding.fileId)}`;
    }).join("\n") + "\n";
    if (!(await readSharedHttpsPrivateFile(path, 8192)).equals(Buffer.from(expectedLines))) fail();
  }
  await verifySharedGeneratedConfigFiles(recipe, projectDirectory);
  const configFiles: SetupManualJobPreparation["configFiles"] = [];
  for (const file of recipe.configFiles ?? []) {
    const path = join(dataDirectory, "config-files", file.id);
    const bytes = await readSharedHttpsPrivateFile(path, 131072);
    if (!bytes.equals(Buffer.from(file.content))) fail();
    configFiles.push({ id: file.id, path, sha256: sha256(bytes), verified: true });
  }
  for (const mount of service.mounts) {
    if (configFiles.some((file) => file.path === mount.source)) continue;
    if (mount.source !== join(dataDirectory, recipe.services[0].mounts
      .find((selected: Record<string, any>) => selected.target === mount.target)?.name ?? "")) fail();
    await directory(mount.source);
  }
  await revalidate();
  if (sha256(JSON.stringify(restoreSavedSharedSelection(current, appId, recipeFor).recipe)) !== recipeSha256) fail();
  return { appId, projectRoot, projectDirectory,
    ownerRevision: current.revision, ownerRecordHash: current.recordHash, sourceSha256, recipeSha256,
    service: structuredClone(service), credentialFiles, configFiles,
    ownerBindingVerified: true, generatedFilesVerified: true, executed: false };
}
