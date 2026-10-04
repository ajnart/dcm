import { appliedStatus, setupRecord, type SetupAdapter, type SetupContext, type SetupInspectionContext,
  type SetupJmapRequest, type SetupRecord } from "../../types/setup.ts";
import { stalwartManagementListener } from "./closure-contract.ts";
import { verifyStalwartRecoveryClosure } from "./headless.ts";

const APP = "stalwart-mail";
const BOOTSTRAP = "stalwart-bootstrap";
const ACTIVATE = "stalwart-activate-captured-administrator";
type Context = SetupContext | SetupInspectionContext;
function auth(username: string, password: string): string { return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`; }
async function get(context: Context, authorization: string, method: string, args: object): Promise<SetupRecord[]> {
  const capture = await context.jmap.captured();
  let endpoint: "recovery" | "https" = "recovery";
  if (capture.httpsOrigin) endpoint = "https";
  const response = await context.jmap.request({ endpoint, origin: capture.httpsOrigin, path: "/api", authorization, effect: "read",
    body: JSON.stringify({ using: ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"], methodCalls: [[method, args, "c1"]] }) });
  const calls = setupRecord(response.json, "Stalwart response").methodResponses as any;
  if (response.status !== 200 || !Array.isArray(calls) || calls.length !== 1 || calls[0]?.[0] !== method || calls[0]?.[2] !== "c1") {
    throw new Error("Stalwart management readback failed; do not replay an uncertain credential write");
  }
  const data = setupRecord(calls[0][1], "Stalwart readback");
  if (!Array.isArray(data.list) || (data.notFound as any)?.length) throw new Error("Stalwart management readback is incomplete");
  return data.list.map((item) => setupRecord(item, "Stalwart object"));
}
async function listenerPolicy(context: Context, authorization: string): Promise<SetupRecord[]> {
  return get(context, authorization, "x:NetworkListener/get", { ids: null, properties: ["id", "name", "protocol", "bind", "useTls", "tlsImplicit"] });
}
function requireListener(listeners: SetupRecord[]): void {
  const listener = listeners[0];
  if (listeners.length !== 1 || typeof listener?.id !== "string" || !listener.id
    || listener.name !== stalwartManagementListener.name || listener.protocol !== "http"
    || JSON.stringify(listener.bind) !== JSON.stringify(stalwartManagementListener.bind)
    || listener.useTls !== false || listener.tlsImplicit !== false) {
    throw new Error("Stalwart exact management-only native listener policy is unproven; recovery removal is not allowed");
  }
}
async function identity(context: Context, authorization: string, username: string): Promise<void> {
  const settings = await get(context, authorization, "x:SystemSettings/get", { ids: ["singleton"] });
  const domain = username.slice("admin@".length);
  if (settings.length !== 1 || typeof settings[0]!.defaultDomainId !== "string") throw new Error("Stalwart system identity is unproven");
  const domains = await get(context, authorization, "x:Domain/get", { ids: [settings[0]!.defaultDomainId] });
  if (domains.length !== 1 || domains[0]!.name !== domain || domains[0]!.isEnabled !== true) throw new Error("Stalwart administrative domain differs from its saved identity");
  const accounts = await get(context, authorization, "x:Account/get", { ids: null, properties: ["id", "@type", "name", "emailAddress", "domainId", "roles"] });
  const administrators = accounts.filter((account) => account.emailAddress === username && account.name === "admin"
    && account.domainId === settings[0]!.defaultDomainId && account["@type"] === "User"
    && (account.roles as any)?.["@type"] === "Admin");
  if (administrators.length !== 1) throw new Error("Stalwart permanent administrator identity is unproven");
}
async function verify(context: Context): Promise<SetupRecord> {
  const status = appliedStatus(context, await context.status());
  if (typeof status.username !== "string" || !/^admin@/.test(status.username) || typeof status.passwordFile !== "string") {
    throw new Error("Stalwart has no exact saved administrative account");
  }
  const capture = await context.jmap.captured();
  if (!capture.administrator || !capture.managementKeyId) throw new Error("Stalwart permanent administrator/key capture is incomplete");
  const password = await context.secrets.readAdminPassword();
  const key = await context.secrets.readApiKey();
  if (!/^[A-Za-z0-9]{16}$/.test(password) || !/^API_[A-Za-z0-9_-]{38}$/.test(key ?? "")) throw new Error("Stalwart captured administrator/key format differs from the pinned release");
  let endpoint: "recovery" | "https" = "recovery";
  if (capture.httpsOrigin) endpoint = "https";
  const denied = await context.jmap.request({ endpoint, origin: capture.httpsOrigin, path: "/api", authorization: auth(status.username, `${password}-invalid`), effect: "read",
    body: JSON.stringify({ using: ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"], methodCalls: [["x:SystemSettings/get", { ids: ["singleton"] }, "c1"]] }) });
  if (denied.status !== 401) throw new Error("Stalwart wrong-password login was not denied");
  await identity(context, auth(status.username, password), status.username);
  const checkpoint = await context.checkpoint.read();
  if (checkpoint?.stage === "account-verified" && !capture.httpsOrigin) throw new Error("Stalwart closure proof requires its existing verified HTTPS owner");
  const settings = await get(context, auth(status.username, password), "x:SystemSettings/get", { ids: ["singleton"] });
  if (!checkpoint || settings[0]?.defaultHostname !== checkpoint.data.hostname) throw new Error("Stalwart hostname differs from its saved first-run intent");
  await identity(context, `Bearer ${key}`, status.username);
  const keys = await get(context, `Bearer ${key}`, "x:ApiKey/get", { ids: [capture.managementKeyId], properties: ["id", "description", "permissions", "allowedIps"] });
  if (keys.length !== 1 || keys[0]!.id !== capture.managementKeyId || keys[0]!.description !== "selfhost shared-owner management"
    || (keys[0]!.permissions as any)?.["@type"] !== "Inherit" || Object.keys(setupRecord(keys[0]!.allowedIps, "Stalwart key scope")).length !== 0) {
    throw new Error("Stalwart management key identity or inherited administrator scope is unproven");
  }
  let recoveryClosure = "pending-native-listener-policy";
  let registrationClosed = false;
  if (capture.httpsOrigin) {
    requireListener(await listenerPolicy(context, auth(status.username, password)));
    const original = await context.jmap.bootstrapRejectionPassword();
    // The shared transport registers and redacts all authorization credentials;
    // this reused verifier receives only its narrow read request capability.
    await verifyStalwartRecoveryClosure({ request: (request) => {
      if (request.effect !== "read" || request.beforeSend || request.capture) throw new Error("Stalwart closure verification cannot authorize a write");
      return context.jmap.request({ ...request, effect: "read" });
    }, registerSecret() {} }, {
      hostname: String(checkpoint.data.hostname), domain: status.username.slice("admin@".length),
      httpsOrigin: capture.httpsOrigin, dataPath: "/var/lib/stalwart/", logPath: "/var/lib/stalwart/logs/",
    }, password, { username: "admin", password: original });
    recoveryClosure = "pending-shared-transition";
    const transition = status.environmentTransition as SetupRecord | undefined;
    if (transition?.name === "STALWART_RECOVERY_MODE" && transition.value === null && capture.recoveryEnvironmentAbsent === true) {
      registrationClosed = true;
      recoveryClosure = "verified-administration-only";
    }
  }
  return { appId: APP, projectRoot: context.projectRoot, stage: "administration-verified", username: status.username, passwordFile: status.passwordFile,
    adminLoginVerified: true, apiKeyVerified: true, registrationClosed,
    apiKeyFile: await context.secrets.apiKeyPath(), scope: "administration-only", recoveryClosure,
    mailDelivery: "pending", nativeTls: "pending", dns: "not-changed", restartPersistence: "not-verified" };
}
const adapter: SetupAdapter = {
  appId: APP, sharedOwner: true, credentialCommand: "app handoff", apiKey: "saved-by-onboarding", healthSource: null, homarrIntegration: null,
  inputDefinitions: [{ key: "hostname", label: "Reviewed first-run server FQDN" }, { key: "domain", label: "Reviewed administrative account domain" }],
  ready(value) { return value.appId === APP && value.stage === "administration-verified" && value.scope === "administration-only"
    && ["pending-native-listener-policy", "pending-shared-transition", "verified-administration-only"].includes(String(value.recoveryClosure))
    && value.mailDelivery === "pending" && typeof value.apiKeyFile === "string"; },
  inspect: verify,
  async firstRun(context) {
    const status = appliedStatus(context, await context.status());
    const fqdn = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
    const { hostname, domain } = context.inputs;
    if (!fqdn.test(hostname ?? "") || !fqdn.test(domain ?? "") || status.username !== `admin@${domain}`) throw new Error("Stalwart setup identity differs from its reviewed recipe");
    let capture = await context.jmap.captured();
    let checkpoint = await context.checkpoint.read();
    if (checkpoint && (checkpoint.data.hostname !== hostname || checkpoint.data.domain !== domain)) throw new Error("Stalwart saved setup intent changed");
    if (!capture.administrator) {
      if (checkpoint?.attemptedActions.includes(BOOTSTRAP)) throw new Error("Stalwart bootstrap outcome is unresolved; never recreate the administrator");
      const fresh = await context.container.exec({ effect: "read", argv: ["test", "!", "-e", "/etc/stalwart/config.json"],
        approval: { action: "stalwart-inspect-fresh-config", progress: "Prove the exact owned Stalwart configuration is absent before bootstrap" } });
      if (fresh.exitCode !== 0) throw new Error("Stalwart configuration already exists; cannot adopt an unknown administrator");
      const temporary = await context.secrets.readBootstrapPassword();
      await get(context, auth("admin", temporary), "x:Bootstrap/get", { ids: ["singleton"] });
      if (!checkpoint) checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: null, stage: "stalwart-bootstrap-inspected", data: { hostname: hostname!, domain: domain! } });
      const request: SetupJmapRequest = { endpoint: "recovery", path: "/api", effect: "write", capture: "administrator", authorization: auth("admin", temporary),
        beforeSend: async () => {}, body: JSON.stringify({ using: ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"], methodCalls: [["x:Bootstrap/set", { update: { singleton: {
          serverHostname: hostname, defaultDomain: domain, requestTlsCertificate: false, generateDkimKeys: false,
          dataStore: { "@type": "RocksDb", path: "/var/lib/stalwart/" }, blobStore: { "@type": "Default" },
          searchStore: { "@type": "Default" }, inMemoryStore: { "@type": "Default" }, directory: { "@type": "Internal" },
          tracer: { "@type": "Log", path: "/var/lib/stalwart/logs/", prefix: "stalwart", enable: true, ansi: false }, dnsServer: { "@type": "Manual" },
        } } }, "c1"]] }) };
      await context.jmap.request(request);
      capture = await context.jmap.captured();
      if (!capture.administrator) throw new Error("Stalwart bootstrap returned no captured administrator");
    }
    checkpoint = await context.checkpoint.read();
    if (!checkpoint?.attemptedActions.includes(ACTIVATE)) await context.jmap.restartBootstrap();
    const password = await context.secrets.readAdminPassword();
    await identity(context, auth(`admin@${domain}`, password), `admin@${domain}`);
    capture = await context.jmap.captured();
    if (!capture.managementKeyId) {
      const existing = await get(context, auth(`admin@${domain}`, password), "x:ApiKey/get", { ids: null, properties: ["id", "description"] });
      if (existing.length !== 0) throw new Error("Stalwart existing management keys require ownership reconciliation");
      await context.jmap.request({ endpoint: "recovery", path: "/api", effect: "write", capture: "management-key", authorization: auth(`admin@${domain}`, password),
        beforeSend: async () => {}, body: JSON.stringify({ using: ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"], methodCalls: [["x:ApiKey/set", { create: { selfhost: {
          description: "selfhost shared-owner management", allowedIps: {}, permissions: { "@type": "Inherit" },
        } } }, "c1"]] }) });
    }
    capture = await context.jmap.captured();
    if (capture.httpsOrigin) {
      const listeners = await listenerPolicy(context, auth(`admin@${domain}`, password));
      checkpoint = await context.checkpoint.read();
      if (listeners.length === 0) {
        if (checkpoint?.attemptedActions.includes("stalwart-management-listener")) throw new Error("Stalwart listener creation outcome is unresolved; do not replay it");
        await context.jmap.request({ endpoint: "https", origin: capture.httpsOrigin, path: "/api", effect: "write",
          authorization: auth(`admin@${domain}`, password), beforeSend: async () => {},
          body: JSON.stringify({ using: ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"],
            methodCalls: [["x:NetworkListener/set", { create: { selfhost: stalwartManagementListener } }, "c1"]] }) });
      } else if (!checkpoint?.attemptedActions.includes("stalwart-management-listener")) {
        throw new Error("Stalwart listener policy has no saved adapter-owned creation attempt");
      }
    }
    const result = await verify(context);
    checkpoint = await context.checkpoint.read();
    let stage = "administration-verified";
    if (capture.httpsOrigin) stage = "account-verified";
    await context.checkpoint.compareAndSet({ expectedRevision: checkpoint?.revision ?? null, stage,
      data: { hostname: hostname!, domain: domain!, scope: "administration-only", ownerManifestHash: status.manifestHash,
        identity: status.username, credentialRef: status.passwordFile, apiKeyRef: await context.secrets.apiKeyPath() } });
    return result;
  },
};
export default adapter;
