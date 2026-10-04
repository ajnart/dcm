import { compilePassboltFirstStartEnvironment } from "./configuration.ts";

export const PASSBOLT_COMPOSE_SOURCE = "https://github.com/passbolt/passbolt_docker/blob/master/docker-compose/docker-compose-ce.yaml";
export const PASSBOLT_CLIENT_SOURCE = "https://www.passbolt.com/docs/user/quickstart/browser/first-setup/";

/** Official topology, explicit SMTP relay choice, no invented local password or
 * enrolled OpenPGP identity. Server keys persist independently of the database. */
export function compilePassboltRecipe(inputs: Readonly<Record<string, string>>) {
  if (inputs["smtp-auth"] !== "none" || !/^[1-9][0-9]{0,4}$/.test(inputs["smtp-port"] ?? "")) {
    throw new Error("Passbolt requires an explicitly approved no-auth STARTTLS relay; authenticated SMTP needs private credential transport");
  }
  const environment = compilePassboltFirstStartEnvironment({
    canonicalOrigin: inputs["canonical-origin"]!,
    smtp: { host: inputs["smtp-host"]!, port: Number(inputs["smtp-port"]), transport: "starttls",
      fromEmail: inputs["from-email"]!, fromName: inputs["from-name"]! },
    serverKey: { email: inputs["server-key-email"]!, name: inputs["server-key-name"]! },
  });
  const common = { imageSource: PASSBOLT_COMPOSE_SOURCE, user: "image-default",
    imageUserEvidence: { officialUrl: PASSBOLT_COMPOSE_SOURCE, reason: "official-image-runtime-contract" },
    restart: "unless-stopped", readOnly: false, hostEnvironment: [] };
  const recipe = {
    schemaVersion: 2, kind: "multi-service-compose", appId: "passbolt", source: PASSBOLT_COMPOSE_SOURCE,
    services: [
      { ...common, id: "passbolt", purpose: "Private Passbolt API and enrollment interface; requires client OpenPGP setup.",
        imageTag: "docker.io/passbolt/passbolt:5.16.0-1-ce",
        environment: [...environment,
          { name: "DATASOURCES_DEFAULT_HOST", value: "db" },
          { name: "DATASOURCES_DEFAULT_USERNAME", value: "passbolt" },
          { name: "DATASOURCES_DEFAULT_DATABASE", value: "passbolt" }],
        fileEnvironment: [{ name: "DATASOURCES_DEFAULT_PASSWORD_FILE", fileId: "database-password" }],
        mounts: [{ name: "gpg", target: "/etc/passbolt/gpg", kind: "volume" },
          { name: "jwt", target: "/etc/passbolt/jwt", kind: "volume" }],
        dependsOn: [{ service: "db", condition: "service_started" }],
        command: ["/usr/bin/wait-for.sh", "-t", "0", "db:3306", "--", "/docker-entrypoint.sh"],
        publishTargetPort: 80 },
      { ...common, id: "db", purpose: "Persists Passbolt identities, encrypted resources and configuration.",
        imageTag: "docker.io/library/mariadb:10.11",
        environment: [{ name: "MYSQL_DATABASE", value: "passbolt" }, { name: "MYSQL_USER", value: "passbolt" }],
        fileEnvironment: [{ name: "MYSQL_PASSWORD_FILE", fileId: "database-password" },
          { name: "MYSQL_ROOT_PASSWORD_FILE", fileId: "database-root-password" }],
        mounts: [{ name: "database", target: "/var/lib/mysql", kind: "volume" }],
        dependsOn: [], publishTargetPort: null },
    ],
    privateFiles: [{ id: "database-password", bytes: 48, format: "alphanumeric" },
      { id: "database-root-password", bytes: 48, format: "alphanumeric" }],
    onboarding: { kind: "gpg-client-enrollment", officialUrl: PASSBOLT_CLIENT_SOURCE },
    defaults: { hostIp: "127.0.0.1", publishedPort: 18085, dataDirectoryName: "passbolt" },
    storage: { filesystem: "local-posix-locks", minimumFreeBytes: 5368709120 },
    acceptance: [
      { id: "gpg-owner", method: "api", description: "Enroll one authorized OpenPGP owner with durable private key and recovery custody; verify authenticated administrator role and server fingerprint." },
      { id: "smtp-delivery", method: "api", description: "Verify actual notification delivery through the selected STARTTLS relay; configuration alone is not delivery evidence." },
      { id: "encrypted-round-trip", method: "api", description: "Save and decrypt one authorized encrypted resource using the enrolled client; invitation capture alone is insufficient." },
      { id: "restart-persistence", method: "persisted", description: "After a scoped restart, verify the same server keys, owner authentication and encrypted resource readback." },
    ],
  };
  return { recipe, configuration: { canonicalOrigin: inputs["canonical-origin"], smtpAuth: "none",
    smtpDeliveryVerified: false, clientEnrollmentVerified: false, timeSynchronizationVerified: false } };
}
