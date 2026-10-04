import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import recipe from "./recipe.json";
import { checkedManualProbe } from "../../types/manual-job.ts";
import { setupRecord, type SetupAdapter, type SetupInspectionContext } from "../../types/setup.ts";

async function inspect(context: SetupInspectionContext) {
  if (context.appId !== "restic" || !isAbsolute(context.projectRoot)) {
    throw new Error("restic preparation requires its exact shared owner");
  }
  const preparation = setupRecord(await context.manualJob.inspect(), "restic manual-job preparation");
  const service = setupRecord(preparation.service, "restic saved job service");
  const projectDirectory = preparation.projectDirectory as string;
  const dataDirectory = join(projectDirectory, "data", "restic");
  if (preparation.appId !== context.appId || preparation.projectRoot !== context.projectRoot
    || !isAbsolute(projectDirectory) || preparation.ownerBindingVerified !== true
    || preparation.generatedFilesVerified !== true || preparation.executed !== false
    || preparation.recipeSha256 !== createHash("sha256").update(JSON.stringify(recipe)).digest("hex")
    || !/^[a-f0-9]{64}$/.test(String(preparation.sourceSha256))
    || !/^[a-f0-9]{64}$/.test(String(preparation.ownerRecordHash))
    || !Number.isSafeInteger(preparation.ownerRevision)
    || service.id !== "restic" || service.restart !== "no"
    || JSON.stringify(service.profiles) !== '["self-host-manual"]'
    || JSON.stringify(service.command) !== JSON.stringify(recipe.services[0].command)
    || !Array.isArray(service.ports) || service.ports.length !== 0
    || !Array.isArray(service.environment) || !Array.isArray(service.mounts)
    || !Array.isArray(preparation.credentialFiles) || preparation.credentialFiles.length !== 1
    || !Array.isArray(preparation.configFiles)) {
    throw new Error("restic differs from its exact prepared recipe, source, or shared owner");
  }
  checkedManualProbe(service.image as string, service.manualProbe);
  const credential = setupRecord(preparation.credentialFiles[0], "restic private credential reference");
  if (credential.id !== "repository-password" || credential.source !== "generated"
    || credential.verified !== true
    || credential.path !== join(projectDirectory, "secrets", "restic", "repository-password")) {
    throw new Error("restic requires its exact verified private job credential");
  }

  const source = service.mounts.find((mount: any) => mount.target === "/source");
  const repository = service.mounts.find((mount: any) => mount.target === "/repository");
  if (!source || source.source !== join(dataDirectory, "source") || source.readOnly !== true
    || !repository || repository.source !== join(dataDirectory, "repository") || repository.readOnly !== false) {
    throw new Error("restic source and local repository differ from their exact reviewed mounts");
  }
  const environment = new Map(service.environment.map((entry: any) => [entry.name, entry.value]));
  if (environment.get("RESTIC_PASSWORD_FILE") !== "/run/secrets/repository-password"
    || environment.has("RESTIC_PASSWORD")) {
    throw new Error("restic requires its saved private credential-file binding");
  }
  if (!Array.isArray(service.secretRefs) || service.secretRefs.length !== 1
    || service.secretRefs[0].name !== "repository-password" || service.secretRefs[0].filePath !== credential.path) {
    throw new Error("restic private credential does not belong to its reviewed job service");
  }

  if (environment.get("RESTIC_REPOSITORY") !== "/repository" || service.hostname !== "self-host-restic") {
    throw new Error("Restic requires its fixed local repository and stable hostname");
  }

  return {
    appId: "restic", projectRoot: context.projectRoot, stage: "prepared-for-reviewed-job",
    readinessScope: "fixed-version-probe-preparation-only", credentialFiles: { "repository-password": credential.path },
    ownerRevision: preparation.ownerRevision, ownerRecordHash: preparation.ownerRecordHash,
    sourceSha256: preparation.sourceSha256, recipeSha256: preparation.recipeSha256,
    ownerBindingVerified: true, configurationVerified: true, executed: false,
    administratorCreated: false, apiKeyCreated: false, acceptanceVerified: false,
    sourceDirectory: source.source, repositoryDirectory: repository.source,
    repositoryChoice: "project-owned-local-only", repositoryInitialized: false,
    backupVerified: false, restoreVerified: false, offHostProtectionVerified: false,
  };
}

const adapter: SetupAdapter = {
  appId: "restic", sharedOwner: true, firstRun: inspect, inspect,
  ready(record) {
    return record.appId === "restic" && record.stage === "prepared-for-reviewed-job"
      && record.readinessScope === "fixed-version-probe-preparation-only"
      && record.ownerBindingVerified === true && record.configurationVerified === true
      && record.executed === false && record.acceptanceVerified === false;
  },
  credentialCommand: "app handoff", apiKey: "not-created", healthSource: null, homarrIntegration: null,
};
export default adapter;
