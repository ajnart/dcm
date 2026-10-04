export const WARRIOR_SOURCE = "https://github.com/ArchiveTeam/warrior-dockerfile/blob/7682e0a0f35266fd1d31d4efe172f495c4ce10f3/start.py";
export const WARRIOR_RUNNER_SOURCE = "https://github.com/ArchiveTeam/seesaw-kit/blob/bb6673d27a8717e13efe5d7deb3628349cd08585/seesaw/warrior.py";
export const WARRIOR_IMAGE = "atdr.meo.ws/archiveteam/warrior-dockerfile@sha256:19337aa9157e04f6cdb8f7c6f8c98e27d14efb0d9525334995fbdb036b95e1ca";

/** Selections describe a policy, never grant consent. The owner start gate must
 * separately bind the resulting recipe, exact owner, and disclosed HQ effects. */
export function compileWarriorRecipe(inputs: Readonly<Record<string, string>>) {
  if (!/^[-_a-zA-Z0-9]{3,30}$/.test(inputs.downloader ?? "")
    || inputs["selected-project"] !== "none" || inputs.concurrency !== "1"
    || inputs["outbound-policy"] !== "hq-registration-and-updates-only"
    || inputs["resource-policy"] !== "idle-no-archival-transfers") {
    throw new Error("Warrior requires an exact nickname, idle workload, HQ outbound and resource policy");
  }
  const policy = { downloader: inputs.downloader!, selectedProject: "none", concurrency: 1,
    outboundPolicy: "hq-registration-and-updates-only", resourcePolicy: "idle-no-archival-transfers",
    hqOrigin: "https://warriorhq.archiveteam.org", startupRegistration: true,
    updateIntervalSeconds: 600, archivalTransfersApproved: false,
    destinationPolicyEnforced: false, bandwidthLimitEnforced: false };
  const recipe = {
    schemaVersion: 2, kind: "multi-service-compose", appId: "archive-team-warrior", source: WARRIOR_RUNNER_SOURCE,
    services: [{ id: "archive-team-warrior",
      purpose: "Private authenticated idle Warrior with reviewed HQ registration/updates; no archival project selected.",
      imageTag: WARRIOR_IMAGE, imageSource: "https://atdr.meo.ws/v2/archiveteam/warrior-dockerfile/blobs/sha256:257eecbae05ceedd514feb0a71ffc29681f451f618595db11428361e5fb20d96",
      user: "image-default", imageUserEvidence: { officialUrl: WARRIOR_RUNNER_SOURCE, reason: "official-image-runtime-contract" },
      restart: "unless-stopped", readOnly: false, cpuLimit: 1, memoryLimitBytes: 536870912,
      environment: [], hostEnvironment: [],
      fileEnvironment: [],
      mounts: [{ kind: "mutable-directory", fileId: "warrior-config", name: "warrior-config", target: "/home/warrior/projects" },
        { kind: "volume", name: "data", target: "/home/warrior/data" }],
      dependsOn: [], publishTargetPort: 8001 }],
    privateFiles: [{ id: "admin-password", bytes: 48, format: "alphanumeric" }],
    mutableConfigs: [{ id: "warrior-config", filename: "config.json", officialUrl: WARRIOR_RUNNER_SOURCE,
      hook: "./mutable-config.ts", containerUid: 1000,
      containerUidEvidence: { image: WARRIOR_IMAGE, uid: 1000, officialUrl: "https://atdr.meo.ws/v2/archiveteam/warrior-dockerfile/blobs/sha256:257eecbae05ceedd514feb0a71ffc29681f451f618595db11428361e5fb20d96" },
      sourceFiles: ["mutable-config.ts", "idle-config.ts", "runtime-provenance.json"],
      inputs: { downloader: inputs.downloader!, selectedProject: "none", concurrency: 1 } }],
    onboarding: { kind: "http-basic-from-mutable-config", officialUrl: WARRIOR_RUNNER_SOURCE,
      username: "warrior-admin", fileId: "admin-password", configId: "warrior-config" },
    defaults: { hostIp: "127.0.0.1", publishedPort: 8001, dataDirectoryName: "archive-team-warrior" },
    storage: { filesystem: "local-posix-locks", minimumFreeBytes: 1073741824 },
    acceptance: [{ id: "basic-login-and-effective-idle", method: "api", description: "Verify generated Basic credentials, anonymous denial and one bounded NO_PROJECT/null-project snapshot; not archival acceptance or offline operation." },
      { id: "restart-persistence", method: "persisted", description: "After separately approved owner restart, verify saved Basic credentials, writable private config and upstream warrior_id are retained, and effective idle state remains." }],
  };
  return { recipe, configuration: policy };
}
