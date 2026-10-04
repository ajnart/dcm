import {
  appliedStatus,
  setupRecord,
  type SetupAdapter,
  type SetupContext,
  type SetupInspectionContext,
  type SetupRecord,
} from "../../types/setup";

const APP_ID = "plex";
const PREFS = "/config/Library/Application Support/Plex Media Server/Preferences.xml";
const STAGE = "local-token-verified";

function token(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,256}$/.test(value)) {
    throw new Error("Plex has no valid private server token; inspect claim status without replaying or replacing the claim");
  }
  return value;
}

function machine(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9-]{16,128}$/.test(value)) {
    throw new Error("Plex returned no valid machine identity");
  }
  return value;
}

type ReadContext = Pick<SetupInspectionContext, "appId" | "projectRoot" | "http" | "secrets" | "checkpoint">;

async function verify(context: ReadContext, key: string, expectedMachine: string): Promise<SetupRecord> {
  const identityResponse = await context.http.request({
    method: "GET", path: "/identity", headers: { Accept: "application/json" },
  });
  if (identityResponse.status !== 200) throw new Error("Plex identity is unavailable");
  const identity = setupRecord(setupRecord(await identityResponse.json(), "Plex identity").MediaContainer, "Plex identity container");
  if (machine(identity.machineIdentifier) !== expectedMachine || identity.claimed !== true) {
    throw new Error("Plex machine identity or claimed state differs from the saved owner");
  }
  const anonymous = await context.http.request({
    method: "GET", path: "/library/sections", headers: { Accept: "application/json" },
  });
  if (anonymous.status !== 401 && anonymous.status !== 403) {
    throw new Error("Plex library access did not deny anonymous requests; do not treat local access as token proof");
  }
  const protectedResponse = await context.http.request({
    method: "GET", path: "/library/sections",
    headers: { Accept: "application/json", "X-Plex-Token": key },
  });
  if (protectedResponse.status !== 200) throw new Error("Plex did not accept its saved server token");
  const libraries = setupRecord(setupRecord(await protectedResponse.json(), "Plex library sections").MediaContainer, "Plex library container");
  if (typeof libraries.size !== "number" || !Number.isSafeInteger(libraries.size) || libraries.size < 0) {
    throw new Error("Plex returned invalid authenticated library sections");
  }
  return {
    appId: APP_ID, projectRoot: context.projectRoot, stage: STAGE,
    machineIdentifier: expectedMachine, adminUsername: null, passwordFile: null,
    apiKeyVerified: true, apiKeyFile: await context.secrets.apiKeyPath(),
    anonymousLibraryDenied: true, accountOwnershipVerified: false,
    mediaLibraryVerified: false, restartPersistenceVerified: false,
  };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  sharedOwner: true,
  async firstRun(context: SetupContext): Promise<SetupRecord> {
    appliedStatus(context, await context.status());
    const saved = await context.checkpoint.read();
    if (saved !== null && (saved.appId !== APP_ID || saved.projectRoot !== context.projectRoot
      || saved.stage !== STAGE || saved.attemptedActions.length !== 0)) {
      throw new Error("Plex setup checkpoint is not the exact read-only token extraction");
    }
    // xmlstarlet is installed by the vendor Dockerfile and used by its own first-run script.
    // Read only two attributes, never the complete secret-bearing Preferences.xml.
    const extracted = await context.container.exec({
      effect: "read",
      argv: ["xmlstarlet", "sel", "-T", "-t", "-m", "/Preferences", "-v", "@PlexOnlineToken", "-n", "-v", "@ProcessedMachineIdentifier", "-n", PREFS],
      approval: { action: "plex-read-own-server-token", progress: "Privately read the exact owned Plex server token and machine identifier." },
    });
    if (extracted.exitCode !== 0 || extracted.stdout.length > 1024) {
      throw new Error("Plex owned server-token extraction failed; inspect without repeating the claim");
    }
    const lines = extracted.stdout.trim().split(/\r?\n/);
    if (lines.length !== 2) throw new Error("Plex token extraction returned an unexpected format");
    const key = token(lines[0]);
    const identifier = machine(lines[1]);
    const stored = await context.secrets.readApiKey();
    if (stored !== null && stored !== key) {
      throw new Error("Plex server token differs from its saved private token; never rotate or adopt it implicitly");
    }
    if (saved !== null && saved.data.machineIdentifier !== identifier) {
      throw new Error("Plex machine identity changed; refuse replacement-server adoption");
    }
    // Register and save immediately before submitting the extracted token to HTTP.
    if (stored === null) await context.secrets.writeApiKey(key);
    if (await context.secrets.readApiKey() !== key) throw new Error("Plex private token was not saved exactly");
    const result = await verify(context, key, identifier);
    if (saved === null) {
      await context.checkpoint.compareAndSet({
        expectedRevision: null, stage: STAGE,
        data: { machineIdentifier: identifier },
      });
    }
    return result;
  },
  async inspect(context: SetupInspectionContext): Promise<SetupRecord> {
    appliedStatus(context, await context.status());
    const saved = await context.checkpoint.read();
    if (saved === null || saved.appId !== APP_ID || saved.projectRoot !== context.projectRoot
      || saved.stage !== STAGE || saved.attemptedActions.length !== 0) {
      throw new Error("Plex has no matching completed local token extraction");
    }
    return verify(context, token(await context.secrets.readApiKey()), machine(saved.data.machineIdentifier));
  },
  // Bootstrap readiness is narrower than ownership of the intended external Plex account.
  ready(status): boolean {
    return status.appId === APP_ID && status.stage === STAGE
      && status.apiKeyVerified === true && status.anonymousLibraryDenied === true
      && status.accountOwnershipVerified === false && status.adminUsername === null
      && status.passwordFile === null && typeof status.apiKeyFile === "string";
  },
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  healthSource: "https://developer.plex.tv/pms/",
  homarrIntegration: "Plex",
};

export default adapter;
