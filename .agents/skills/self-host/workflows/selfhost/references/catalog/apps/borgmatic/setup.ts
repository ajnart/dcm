import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import recipe from "./recipe.json";
import { checkedManualProbe } from "../../types/manual-job.ts";
import { setupRecord, type SetupAdapter, type SetupInspectionContext } from "../../types/setup.ts";

async function inspect(context: SetupInspectionContext) {
  if (context.appId !== "borgmatic" || !isAbsolute(context.projectRoot)) {
    throw new Error("borgmatic preparation requires its exact shared owner");
  }
  const preparation = setupRecord(await context.manualJob.inspect(), "borgmatic manual-job preparation");
  const service = setupRecord(preparation.service, "borgmatic saved job service");
  const projectDirectory = preparation.projectDirectory as string;
  const dataDirectory = join(projectDirectory, "data", "borgmatic");
  if (preparation.appId !== context.appId || preparation.projectRoot !== context.projectRoot
    || !isAbsolute(projectDirectory) || preparation.ownerBindingVerified !== true
    || preparation.generatedFilesVerified !== true || preparation.executed !== false
    || preparation.recipeSha256 !== createHash("sha256").update(JSON.stringify(recipe)).digest("hex")
    || !/^[a-f0-9]{64}$/.test(String(preparation.sourceSha256))
    || !/^[a-f0-9]{64}$/.test(String(preparation.ownerRecordHash))
    || !Number.isSafeInteger(preparation.ownerRevision)
    || service.id !== "borgmatic" || service.restart !== "no"
    || JSON.stringify(service.profiles) !== '["self-host-manual"]'
    || JSON.stringify(service.command) !== JSON.stringify(recipe.services[0].command)
    || !Array.isArray(service.ports) || service.ports.length !== 0
    || !Array.isArray(service.environment) || !Array.isArray(service.mounts)
    || !Array.isArray(preparation.credentialFiles) || preparation.credentialFiles.length !== 1
    || !Array.isArray(preparation.configFiles)) {
    throw new Error("borgmatic differs from its exact prepared recipe, source, or shared owner");
  }
  checkedManualProbe(service.image as string, service.manualProbe);
  const credential = setupRecord(preparation.credentialFiles[0], "borgmatic private credential reference");
  if (credential.id !== "repository-passphrase" || credential.source !== "generated"
    || credential.verified !== true
    || credential.path !== join(projectDirectory, "secrets", "borgmatic", "repository-passphrase")) {
    throw new Error("borgmatic requires its exact verified private job credential");
  }

  const source = service.mounts.find((mount: any) => mount.target === "/mnt/source");
  const repository = service.mounts.find((mount: any) => mount.target === "/mnt/borg-repository");
  if (!source || source.source !== join(dataDirectory, "source") || source.readOnly !== true
    || !repository || repository.source !== join(dataDirectory, "repository") || repository.readOnly !== false) {
    throw new Error("borgmatic source and local repository differ from their exact reviewed mounts");
  }
  const environment = new Map(service.environment.map((entry: any) => [entry.name, entry.value]));
  if (environment.get("BORG_PASSPHRASE_FILE") !== "/run/secrets/repository-passphrase"
    || environment.has("BORG_PASSPHRASE")) {
    throw new Error("borgmatic requires its saved private credential-file binding");
  }
  if (!Array.isArray(service.secretRefs) || service.secretRefs.length !== 1
    || service.secretRefs[0].name !== "repository-passphrase" || service.secretRefs[0].filePath !== credential.path) {
    throw new Error("borgmatic private credential does not belong to its reviewed job service");
  }

  const config = preparation.configFiles.find((file: any) => file.id === "config");
  const configPath = join(dataDirectory, "config-files", "config");
  const configMount = service.mounts.find((mount: any) => mount.target === "/etc/borgmatic.d/config.yaml");
  if (environment.get("CRON") !== "false" || service.hostname !== "self-host-borgmatic"
    || preparation.configFiles.length !== 1 || !config || config.verified !== true || config.path !== configPath
    || config.sha256 !== createHash("sha256").update(recipe.configFiles[0].content).digest("hex")
    || !configMount || configMount.source !== configPath || configMount.readOnly !== true) {
    throw new Error("Borgmatic requires exact saved source/repository configuration with cron disabled");
  }

  return {
    appId: "borgmatic", projectRoot: context.projectRoot, stage: "prepared-for-reviewed-job",
    readinessScope: "fixed-version-probe-preparation-only", credentialFiles: { "repository-passphrase": credential.path },
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
  appId: "borgmatic", sharedOwner: true, firstRun: inspect, inspect,
  ready(record) {
    return record.appId === "borgmatic" && record.stage === "prepared-for-reviewed-job"
      && record.readinessScope === "fixed-version-probe-preparation-only"
      && record.ownerBindingVerified === true && record.configurationVerified === true
      && record.executed === false && record.acceptanceVerified === false;
  },
  credentialCommand: "app handoff", apiKey: "not-created", healthSource: null, homarrIntegration: null,
};
export default adapter;
