import { existingCurlCookieJar } from "./curl-http.ts";
import {
  loadHomarrApiKey,
  loadSession,
  privateHandoffContents,
  requireSessionPasswordScheme,
  SetupRequestError,
  useCurlTransport,
  writeSetupFallbackArtifact,
} from "./session-context.ts";

const PORT_KEYS = Object.freeze({
  qbittorrent: "QBITTORRENT_PORT",
  sonarr: "SONARR_PORT",
  radarr: "RADARR_PORT",
  prowlarr: "PROWLARR_PORT",
  jellyfin: "JELLYFIN_PORT",
  seerr: "SEERR_PORT",
  homarr: "HOMARR_PORT",
});

const BROWSER_PATHS = Object.freeze({
  qbittorrent: "/#/settings/webui",
  sonarr: "/settings/general",
  radarr: "/settings/general",
  prowlarr: "/settings/general",
  jellyfin: "/web/index.html#!/dashboard/keys",
  seerr: "/settings",
  homarr: "/init",
});

export class SetupStageError extends Error {
  constructor(step, cause, request = {}) {
    let message = String(cause);
    if (cause instanceof Error) message = cause.message;
    super(message);
    this.name = "SetupStageError";
    this.step = step;
    this.code = "STAGE_FAILED";
    this.method = request.method ?? cause?.method ?? null;
    this.path = request.path ?? cause?.path ?? null;
    this.status = request.status ?? cause?.status ?? null;
  }
}

function failureDetails(error, fallbackStep) {
  let rawMessage = String(error);
  if (error instanceof Error) rawMessage = error.message;
  if (error instanceof SetupRequestError) {
    return {
      step: error.step,
      code: error.code,
      method: error.method,
      requestPath: error.path,
      httpStatus: error.status,
      detail: rawMessage.slice(0, 2048),
    };
  }
  if (error instanceof SetupStageError) {
    return {
      step: error.step,
      code: error.code,
      method: error.method,
      requestPath: error.path,
      httpStatus: error.status,
      detail: rawMessage.slice(0, 2048),
    };
  }
  return {
    step: fallbackStep,
    code: "SETUP_ERROR",
    method: null,
    requestPath: null,
    httpStatus: null,
    detail: rawMessage.slice(0, 2048),
  };
}

function cookieJars(session) {
  const jars = {};
  for (const [service, portKey] of Object.entries(PORT_KEYS)) {
    const origin = `http://127.0.0.1:${session.manifest[portKey]}`;
    try {
      jars[service] = existingCurlCookieJar(session, origin);
    } catch {
      jars[service] = null;
    }
  }
  return jars;
}

export function writeSetupFailureHandoff(session, service, fallbackStep, error, options = {}) {
  requireSessionPasswordScheme(session);
  if (!Object.hasOwn(PORT_KEYS, service)) throw new Error("unsupported setup service");
  let homarrKey = "";
  try {
    homarrKey = loadHomarrApiKey(session, { optional: true })?.apiKey ?? "";
  } catch {
    // The failed setup may have left an incomplete one-time key file.
  }
  const handoff = JSON.parse(privateHandoffContents(session, homarrKey));
  const serviceAccess = handoff.services[service];
  let browserPath = BROWSER_PATHS[service];
  if (
    service === "homarr"
    && error instanceof SetupStageError
    && /^Homarr (?:apiKeys\.|API key )/i.test(error.step)
  ) {
    browserPath = "/manage/tools/api";
  }
  const browserUrl = `${serviceAccess.localUrl}${browserPath}`;
  const resumeArguments = ["bun", `scripts/setup-${service}.ts`, session.runId];
  if (service === "homarr" && /^[A-Za-z0-9_-]{1,255}$/.test(options.boardName ?? "")) {
    resumeArguments.push(options.boardName);
  }
  handoff.fallback = {
    schemaVersion: 1,
    failedAt: new Date().toISOString(),
    service,
    ...failureDetails(error, fallbackStep),
    browser: {
      session: session.manifest.AGENT_BROWSER_SESSION,
      url: browserUrl,
      cookieJars: cookieJars(session),
    },
    resume: {
      apiCommand: resumeArguments.join(" "),
      verifyCommand: `scripts/session.sh verify ${session.runId}`,
      doctorCommand: `scripts/session.sh doctor ${session.runId}`,
      guidance: "Inspect the saved service state, complete only the failed step with agent-browser, then rerun the API script and verification. Do not recreate the run.",
    },
  };
  return writeSetupFallbackArtifact(session, service, `${JSON.stringify(handoff, null, 2)}\n`);
}

export async function runManagedSetup(runId, service, fallbackStep, operation, options = {}) {
  let session;
  try {
    session = loadSession(runId);
    requireSessionPasswordScheme(session);
    useCurlTransport(session);
    const summary = await operation(session);
    console.log(`PASS ${summary}`);
  } catch (error) {
    if (!session) {
      console.error(`FAIL ${service} setup: run is unavailable or invalid`);
      process.exitCode = 1;
      return;
    }
    try {
      // A reconciler may have refreshed its API key after this runner loaded the run.
      session = loadSession(runId);
      const handoffPath = writeSetupFailureHandoff(session, service, fallbackStep, error, options);
      const failure = failureDetails(error, fallbackStep);
      console.error(`FAIL ${service} setup at ${failure.step} (${failure.code})`);
      console.error(`Private browser takeover handoff: ${handoffPath}`);
      console.error("Resume after repair: use the exact command in the private handoff");
    } catch {
      console.error(`FAIL ${service} setup; private takeover handoff could not be written`);
    }
    process.exitCode = 1;
  }
}
