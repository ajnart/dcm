import { createHash } from "node:crypto";

export const AISTOR_INSTALL_SOURCE = "https://docs.min.io/aistor/installation/container/install/";
export const AISTOR_CORE_SOURCE = "https://docs.min.io/aistor/reference/aistor-server/settings/core/";
export const AISTOR_ROOT_SOURCE = "https://docs.min.io/aistor/reference/aistor-server/settings/root-credentials/";
export const AISTOR_SITE_SOURCE = "https://docs.min.io/aistor/reference/aistor-server/settings/site/";
export const AISTOR_IMAGE = "quay.io/minio/aistor/minio:RELEASE.2026-09-19T17-05-25Z.hotfix.4ef74f03d6f2";
export const AISTOR_IMAGE_DIGEST = "sha256:e3a4c89118a0d02cbef43978172bd2bf4f43b6ba91d3d96618346cdb68bd73e8";

export type AistorConfigurationInput = {
  /** Required explicit product selection, not a default or license acceptance claim. */
  edition: "aistor-licensed";
  /** Reviewed non-secret login identifier, locally restricted to 20-32 safe characters;
   * this is conservative local policy, not a claim about upstream limits. */
  rootUsername: string;
};

/** Pure explicitly selected recipe compiler. No static recipe is discoverable, no license is acquired,
 * and no setup outcome is implied. Shared selection must bind the exact input,
 * recipe fingerprint, image digest and owner license import to its apply approval.
 * The derived adapter owns the explicit licensed-product gate; no static default.
 */
export function compileAistorConfiguration(input: AistorConfigurationInput) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).length !== 2
    || Object.keys(input).some((key) => key !== "edition" && key !== "rootUsername")
    || input.edition !== "aistor-licensed"
    || typeof input.rootUsername !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{19,31}$/.test(input.rootUsername)
    || /^minioadmin/i.test(input.rootUsername)) {
    throw new Error("AIStor requires an explicit licensed-edition choice and a reviewed non-default root identifier");
  }
  const selection = { edition: input.edition, rootUsername: input.rootUsername };
  const recipe = {
    schemaVersion: 2, kind: "multi-service-compose", appId: "minio", source: AISTOR_INSTALL_SOURCE,
    services: [{
      id: "minio", purpose: "Runs owner-selected licensed AIStor with private S3 and console listeners; license usability is unverified.",
      imageTag: AISTOR_IMAGE, imageSource: "https://quay.io/repository/minio/aistor/minio?tab=tags",
      user: "image-default", imageUserEvidence: { officialUrl: AISTOR_INSTALL_SOURCE, reason: "official-image-runtime-contract" },
      restart: "unless-stopped", readOnly: false,
      command: ["minio", "server", "/mnt/data", "--console-address", ":9001"],
      environment: [{ name: "MINIO_ROOT_USER", value: selection.rootUsername }, { name: "MINIO_SITE_REGION", value: "us-east-1" }],
      hostEnvironment: [],
      fileEnvironment: [{ name: "MINIO_LICENSE", fileId: "aistor-license", format: "file-path", officialUrl: AISTOR_CORE_SOURCE },
        { name: "MINIO_ROOT_PASSWORD_FILE", fileId: "admin-password" }],
      mounts: [{ name: "data", target: "/mnt/data", kind: "volume" }],
      dependsOn: [], publishTargetPort: 9000,
      additionalPorts: [{ id: "console", targetPort: 9001, protocol: "tcp", purpose: "application", required: true }],
    }],
    privateFiles: [
      { id: "admin-password", bytes: 48, format: "alphanumeric" },
      { id: "aistor-license", source: "owner", maxBytes: 16384 },
    ],
    onboarding: { kind: "initial-admin-from-file", officialUrl: AISTOR_ROOT_SOURCE,
      username: selection.rootUsername, usernameEnvironment: "MINIO_ROOT_USER",
      fileEnvironment: "MINIO_ROOT_PASSWORD_FILE", fileId: "admin-password" },
    defaults: { hostIp: "127.0.0.1", publishedPort: 9000, dataDirectoryName: "minio" },
    storage: { filesystem: "local-posix-locks", minimumFreeBytes: 1073741824 },
    acceptance: [
      { id: "root-authentication", method: "api", description: "Verify the saved root identity with canonical signed S3 authentication and wrong-credential denial; console health is insufficient." },
      { id: "licensed-object-roundtrip", method: "api", description: "Separately approve an isolated object write/read and license-state check; root login alone does not prove writable storage." },
      { id: "scoped-access-key", method: "api", description: "Create and privately save a reviewed scoped access-key pair through a pinned replay-safe contract; root credentials are not this pair." },
      { id: "restart-persistence", method: "persisted", description: "Restart the exact owner and recheck saved credentials, license usability and the isolated object; no automatic replay of key creation." },
    ],
  };
  const configurationFingerprint = createHash("sha256")
    .update(JSON.stringify({ selection, imageDigest: AISTOR_IMAGE_DIGEST, recipe })).digest("hex");
  return { recipe, binding: { selection, imageDigest: AISTOR_IMAGE_DIGEST, configurationFingerprint },
    installable: true, setupState: "pending", apiKey: "not-created",
    remaining: ["owner-license-import", "pinned-image-startup-proof", "signed-root-authentication", "scoped-key-pair-capture-and-replay", "license-and-storage-acceptance"] };
}

export function assertAistorConfigurationUnchanged(input: AistorConfigurationInput, fingerprint: string): void {
  if (compileAistorConfiguration(input).binding.configurationFingerprint !== fingerprint) {
    throw new Error("AIStor edition, identity or configuration changed; require a new reviewed selection");
  }
}
