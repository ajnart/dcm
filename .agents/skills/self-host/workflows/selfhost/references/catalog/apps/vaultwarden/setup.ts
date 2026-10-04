import { isAbsolute, join } from "node:path";
import { appliedStatus, setupRecord, type SetupAdapter, type SetupContext,
  type SetupInspectionContext, type SetupRecord } from "../../types/setup.ts";

/** Called by the approved same-owner HTTPS compiler, never by browser setup. */
export function deriveCanonicalEnvironment(origin: string): Array<{ name: string; value: string }> {
  let url: URL;
  try { url = new URL(origin); }
  catch { throw new Error("Vaultwarden needs an exact approved HTTPS origin"); }
  if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Vaultwarden needs an exact approved HTTPS origin without credentials or path");
  }
  return [{ name: "DOMAIN", value: origin }];
}

/** Pinned /api/config readback, not an account, invitation or unlock proof. */
export function verifyCanonicalConfig(value: unknown, origin: string): void {
  deriveCanonicalEnvironment(origin);
  const config = setupRecord(value, "Vaultwarden config");
  const server = setupRecord(config.server, "Vaultwarden server identity");
  const environment = setupRecord(config.environment, "Vaultwarden environment");
  const settings = setupRecord(config.settings, "Vaultwarden settings");
  if (config.object !== "config" || server.name !== "Vaultwarden"
    || server.url !== "https://github.com/dani-garcia/vaultwarden"
    || environment.vault !== origin || environment.api !== `${origin}/api`
    || environment.identity !== `${origin}/identity`
    || environment.notifications !== `${origin}/notifications`
    || settings.disableUserRegistration !== true) {
    throw new Error("Vaultwarden canonical environment or effective registration policy differs");
  }
}

async function inspectServer(context: SetupContext | SetupInspectionContext): Promise<SetupRecord> {
  const status = appliedStatus(context, await context.status());
  if (status.ownerKind !== "shared" || typeof status.privateFiles !== "string"
    || !isAbsolute(status.privateFiles)
    || status.passwordFile !== join(status.privateFiles, "admin-password")) {
    throw new Error("Vaultwarden needs its exact shared-owner master-password file");
  }
  // DOMAIN and TLS transport are supplied only by the approved shared route.
  // Never derive a trusted vault identity from the loopback HTTP listener.
  const origin = status.setupUrl ?? status.url;
  if (typeof origin !== "string" || !origin.startsWith("https://")) {
    throw new Error("Vaultwarden needs approved same-owner canonical HTTPS before client enrollment");
  }
  deriveCanonicalEnvironment(origin);
  const response = await context.http.request({ method: "GET", path: "/api/config", requireHttps: true });
  if (response.status !== 200) throw new Error("Vaultwarden canonical config could not be read");
  verifyCanonicalConfig(await response.json(), origin);
  return { appId: "vaultwarden", projectRoot: context.projectRoot,
    stage: "official-client-enrollment-required", canonicalOrigin: origin,
    passwordFile: status.passwordFile, canonicalConfigVerified: true,
    clientTrustVerified: false, accountCreated: false, loginVerified: false,
    unlockVerified: false, apiKeyFile: null };
}

const adapter: SetupAdapter = {
  appId: "vaultwarden",
  credentialCommand: "app handoff",
  apiKey: "not-created",
  healthSource: null,
  homarrIntegration: null,
  // API metadata and a saved password are deliberately insufficient for ready.
  ready() { return false; },
  inspect: inspectServer,
  firstRun: inspectServer,
};

export default adapter;
