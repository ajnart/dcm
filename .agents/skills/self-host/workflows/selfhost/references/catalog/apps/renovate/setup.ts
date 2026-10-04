import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import recipe from "./recipe.json";
import { checkedManualProbe } from "../../types/manual-job.ts";
import { setupRecord, type SetupAdapter, type SetupInspectionContext } from "../../types/setup.ts";

async function inspect(context: SetupInspectionContext) {
  if (context.appId !== "renovate" || !isAbsolute(context.projectRoot)) {
    throw new Error("renovate preparation requires its exact shared owner");
  }
  const preparation = setupRecord(await context.manualJob.inspect(), "renovate manual-job preparation");
  const service = setupRecord(preparation.service, "renovate saved job service");
  const projectDirectory = preparation.projectDirectory as string;
  if (preparation.appId !== context.appId || preparation.projectRoot !== context.projectRoot
    || !isAbsolute(projectDirectory) || preparation.ownerBindingVerified !== true
    || preparation.generatedFilesVerified !== true || preparation.executed !== false
    || preparation.recipeSha256 !== createHash("sha256").update(JSON.stringify(recipe)).digest("hex")
    || !/^[a-f0-9]{64}$/.test(String(preparation.sourceSha256))
    || !/^[a-f0-9]{64}$/.test(String(preparation.ownerRecordHash))
    || !Number.isSafeInteger(preparation.ownerRevision)
    || service.id !== "renovate" || service.restart !== "no"
    || JSON.stringify(service.profiles) !== '["self-host-manual"]'
    || JSON.stringify(service.command) !== JSON.stringify(recipe.services[0].command)
    || !Array.isArray(service.ports) || service.ports.length !== 0
    || !Array.isArray(service.environment) || !Array.isArray(service.mounts)
    || !Array.isArray(preparation.credentialFiles) || preparation.credentialFiles.length !== 1
    || !Array.isArray(preparation.configFiles)) {
    throw new Error("renovate differs from its exact prepared recipe, source, or shared owner");
  }
  checkedManualProbe(service.image as string, service.manualProbe);
  const credential = setupRecord(preparation.credentialFiles[0], "renovate private credential reference");
  if (credential.id !== "forge-token" || credential.source !== "owner"
    || credential.verified !== true
    || credential.path !== join(projectDirectory, "secrets", "renovate", "forge-token")) {
    throw new Error("renovate requires its exact verified private job credential");
  }

  const environment = new Map(service.environment.map((entry: any) => [entry.name, entry.value]));
  if (environment.get("RENOVATE_AUTODISCOVER") !== "false"
    || ["RENOVATE_ENDPOINT", "RENOVATE_PLATFORM", "RENOVATE_REPOSITORIES", "RENOVATE_TOKEN"].some((name) => environment.has(name))
    || service.envFilePath !== join(projectDirectory, "secrets", "renovate", "renovate.env")
    || service.mounts.length !== 0 || preparation.configFiles.length !== 0) {
    throw new Error("Renovate must retain its private token binding and explicitly unselected repository scope");
  }

  return {
    appId: "renovate", projectRoot: context.projectRoot, stage: "prepared-for-reviewed-job",
    readinessScope: "fixed-version-probe-preparation-only", credentialFiles: { "forge-token": credential.path },
    ownerRevision: preparation.ownerRevision, ownerRecordHash: preparation.ownerRecordHash,
    sourceSha256: preparation.sourceSha256, recipeSha256: preparation.recipeSha256,
    ownerBindingVerified: true, configurationVerified: true, executed: false,
    administratorCreated: false, apiKeyCreated: false, acceptanceVerified: false,
    repositoryChoice: "unselected", repositoryScopeConfigured: false,
    tokenScopeVerified: false, remoteWritesPerformed: false,
  };
}

const adapter: SetupAdapter = {
  appId: "renovate", sharedOwner: true, firstRun: inspect, inspect,
  ready(record) {
    return record.appId === "renovate" && record.stage === "prepared-for-reviewed-job"
      && record.readinessScope === "fixed-version-probe-preparation-only"
      && record.ownerBindingVerified === true && record.configurationVerified === true
      && record.executed === false && record.acceptanceVerified === false;
  },
  credentialCommand: "app handoff", apiKey: "not-created", healthSource: null, homarrIntegration: null,
};
export default adapter;
