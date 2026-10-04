import { spawnSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { join } from "node:path";
import { sharedPrivateHttpsHostnameScope } from "./shared-private-https.ts";
import { createSelfhostComposeOwner } from "./selfhost-compose.ts";
import { loadSharedProjectState, type SharedProjectState } from "./shared-project-state.ts";
import { loadSharedPrivateHttpsBinding, readSharedHttpsPrivateFile, restoreSharedPrivateHttpsSelection,
  sharedHttpsHash, writeSharedHttpsPrivateFile, type SharedPrivateHttpsBinding } from "./shared-private-https-state.ts";

type Entry = Record<string, any>;
type CommandResult = { status: number | null; stdout: string | Buffer };
export type SharedHttpsTransportDependencies = {
  /** Production default checks the canonical same-owner Compose file; fixtures may replace it. */
  checkOwner?: (state: SharedProjectState, composePath: string) => Promise<void>;
  run?: (command: string, args: string[]) => CommandResult;
};

function run(command: string, args: string[]): CommandResult {
  return spawnSync(command, args, { stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8", maxBuffer: 64 * 1024, timeout: 15000 });
}

/** This token approves CA export and TLS probes, not container addition or application settings. */
export function reviewSharedPrivateHttpsTransport(state: SharedProjectState, canonicalRecipe: Entry,
  binding: SharedPrivateHttpsBinding) {
  restoreSharedPrivateHttpsSelection(state, canonicalRecipe, binding);
  if (state.checkpoint.phase !== "completed") {
    throw new Error("Shared HTTPS transport requires a completed owner; inspect uncertain Compose outcomes first");
  }
  return { approval: `SHARED-HTTPS-PROOF:${state.project.id}:${sharedHttpsHash({
    recordHash: state.recordHash, bindingHash: binding.bindingHash, action: "export-ca-and-prove-tls" })}`,
  hostnameScope: sharedPrivateHttpsHostnameScope(binding.routes),
  routes: binding.routes.map(({ appId, hostname }) => ({ appId, url: `https://${hostname}:${binding.port}` })) };
}

/**
 * No Compose mutation. Interrupted verification replays exact public-root export and
 * bounded TLS probes; it never re-adds/recreates Caddy or changes client trust stores.
 */
export async function applySharedPrivateHttpsTransport(state: SharedProjectState, canonicalRecipe: Entry,
  binding: SharedPrivateHttpsBinding, approval: string,
  dependencies: SharedHttpsTransportDependencies = {}) {
  const review = reviewSharedPrivateHttpsTransport(state, canonicalRecipe, binding);
  if (approval !== review.approval) throw new Error("Shared HTTPS transport requires its exact owner-bound approval");
  const latest = await loadSharedProjectState(state.project.directory, state.project.id, state.manifestHash);
  if (latest?.recordHash !== state.recordHash) throw new Error("Shared HTTPS owner changed after review");
  const persisted = await loadSharedPrivateHttpsBinding(state.project.directory, canonicalRecipe);
  if (persisted.bindingHash !== binding.bindingHash) throw new Error("Shared HTTPS persisted binding changed");
  const selection = restoreSharedPrivateHttpsSelection(state, canonicalRecipe, persisted);
  const caddy = state.manifest.services.find((service: Entry) => service.id === "caddy");
  const config = caddy.mounts.filter((mount: Entry) => mount.target === "/etc/caddy/Caddyfile");
  const expectedPath = join(state.project.directory, "data", "caddy", "config-files", "caddyfile");
  // The compiler owns this exact generated-file path. Never open an arbitrary sidecar path.
  if (config.length !== 1 || config[0].source !== expectedPath || config[0].readOnly !== true) {
    throw new Error("Shared HTTPS Caddy configuration is not the exact generated owner file");
  }
  const bytes = await readSharedHttpsPrivateFile(expectedPath, 256 * 1024);
  if (!bytes.equals(Buffer.from(selection.recipe.configFiles[0].content))) {
    throw new Error("Shared HTTPS Caddyfile differs from the persisted route identities");
  }
  const owner = createSelfhostComposeOwner(state.manifest);
  const ownerPlan = await owner.plan();
  if (dependencies.checkOwner) await dependencies.checkOwner(state, ownerPlan.render.target);
  else await owner.checkRendered(ownerPlan);
  const invoke = dependencies.run ?? run;
  const exported = invoke("docker", ["--context", state.project.dockerContext, "compose",
    "--project-directory", state.project.directory, "--project-name", state.project.id,
    "--file", ownerPlan.render.target, "exec", "-T", "caddy",
    "cat", "/data/caddy/pki/authorities/local/root.crt"]);
  const root = Buffer.from(exported.stdout);
  if (exported.status !== 0 || root.length < 128 || root.length > 65536) {
    throw new Error("Shared HTTPS CA export is unavailable; inspect exact Caddy runtime and retry proof only");
  }
  let cert: X509Certificate;
  try {
    const pem = root.toString("ascii").trim();
    if (!/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE-----$/.test(pem)) {
      throw new Error("not one PEM certificate");
    }
    cert = new X509Certificate(root);
    if (!cert.ca || !cert.checkIssued(cert) || !cert.verify(cert.publicKey) || Date.parse(cert.validFrom) > Date.now()
      || Date.parse(cert.validTo) <= Date.now()) throw new Error("not a current self-signed CA");
  } catch { throw new Error("Shared HTTPS exported root is not a current self-signed CA certificate"); }
  const caExportPath = await writeSharedHttpsPrivateFile(state.project.directory, "private-https-root.crt", root);
  const proofs = binding.routes.map(({ appId, hostname }) => {
    const url = `https://${hostname}:${binding.port}`;
    const result = invoke("curl", ["--disable", "--cacert", caExportPath,
      "--resolve", `${hostname}:${binding.port}:127.0.0.1`, "--noproxy", "*",
      "--silent", "--show-error", "--output", "/dev/null", "--write-out", "%{http_code}",
      "--connect-timeout", "3", "--max-time", "10", `${url}/`]);
    const output = String(result.stdout).trim();
    const verified = result.status === 0 && /^[1-5][0-9]{2}$/.test(output);
    let httpStatus: number | null = null;
    if (verified) httpStatus = Number(output);
    return { appId, hostname, url, method: "curl-cacert-resolve" as const,
      verified, httpStatus, verifiedAt: new Date().toISOString() };
  });
  return { projectId: state.project.id, ownerRecordHash: state.recordHash, bindingHash: binding.bindingHash,
    caExportPath, caSha256: createHash("sha256").update(root).digest("hex"),
    hostnameScope: sharedPrivateHttpsHostnameScope(binding.routes), proofs,
    transportVerified: proofs.every((proof) => proof.verified), dnsVerified: false as const,
    clientTrustVerified: false as const, applicationVerified: false as const,
    composeMutation: false as const, trustStoreMutation: false as const };
}
