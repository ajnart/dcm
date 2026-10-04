import type { SetupAdapter, SetupContext, SetupInspectionContext, SetupRecord } from "../../types/setup";
import { appliedStatus } from "../../types/setup";

const APP_ID = "ollama";
const VERSION = "0.34.1";

type ReadContext = Pick<SetupInspectionContext, "http" | "projectRoot">;

async function inspectApi(context: ReadContext): Promise<SetupRecord> {
  let versionResponse;
  let tagsResponse;
  try {
    versionResponse = await context.http.request({ method: "GET", path: "/api/version" });
    tagsResponse = await context.http.request({ method: "GET", path: "/api/tags" });
  } catch {
    throw new Error("Ollama's private API could not be reached");
  }
  if (versionResponse.status !== 200 || !versionResponse.ok || tagsResponse.status !== 200 || !tagsResponse.ok) {
    throw new Error("Ollama's version or model inventory could not be verified");
  }
  let version: unknown;
  let tags: unknown;
  try {
    version = await versionResponse.json();
    tags = await tagsResponse.json();
  } catch {
    throw new Error("Ollama returned invalid JSON");
  }
  if (!version || typeof version !== "object" || Array.isArray(version)
    || (version as Record<string, unknown>).version !== VERSION) {
    throw new Error(`Ollama setup requires the pinned ${VERSION} server`);
  }
  if (!tags || typeof tags !== "object" || Array.isArray(tags)
    || !Array.isArray((tags as Record<string, unknown>).models)) {
    throw new Error("Ollama returned an invalid model inventory");
  }
  return { appId: APP_ID, projectRoot: context.projectRoot, ready: true, version: VERSION,
    modelCount: ((tags as Record<string, unknown>).models as unknown[]).length,
    account: "none", apiKey: "not-created" };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  sharedOwner: true,
  async firstRun(context: SetupContext): Promise<SetupRecord> {
    if (context.appId !== APP_ID) throw new Error("Ollama setup received a different app ID");
    appliedStatus(context, await context.status());
    return inspectApi(context);
  },
  async inspect(context: SetupInspectionContext): Promise<SetupRecord> {
    if (context.appId !== APP_ID) throw new Error("Ollama inspection received a different app ID");
    appliedStatus(context, await context.status());
    return inspectApi(context);
  },
  ready(status) { return status.appId === APP_ID && status.ready === true && status.version === VERSION; },
  credentialCommand: "app handoff",
  apiKey: "not-created",
  healthSource: null,
  homarrIntegration: null,
};

export default adapter;
