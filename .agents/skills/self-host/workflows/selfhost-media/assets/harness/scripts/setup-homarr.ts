#!/usr/bin/env bun

import { pathToFileURL } from "node:url";
import {
  deriveSessionPassword,
  loadHomarrApiKey,
  requireSessionPasswordScheme,
  sessionUsername,
  storeHomarrApiKey,
  useCurlTransport,
  writeSessionConnections,
} from "./lib/session-context.ts";
import { curlFetch } from "./lib/curl-http.ts";
import { runManagedSetup, SetupStageError } from "./lib/setup-handoff.ts";

function requestMetadata(url, options = {}, status = null) {
  return {
    method: String(options.method ?? "GET").toUpperCase(),
    path: new URL(url).pathname,
    status,
  };
}

function requireRecord(value, label, request = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SetupStageError(label, new Error("response is invalid"), request);
  }
  return value;
}

async function jsonResponse(response, label, request = {}) {
  if (response.status < 200 || response.status >= 300) {
    throw new SetupStageError(label, new Error(`returned HTTP ${response.status}`), {
      ...request,
      status: response.status,
    });
  }
  try {
    return await response.json();
  } catch {
    throw new SetupStageError(label, new Error("returned invalid JSON"), {
      ...request,
      status: response.status,
    });
  }
}

async function curlJson(url, options, label) {
  const request = requestMetadata(url, options);
  let status = null;
  try {
    const response = await curlFetch(url, options);
    status = response.status;
    return {
      status,
      json: await jsonResponse(response, label, { ...request, status }),
    };
  } catch (error) {
    throw new SetupStageError(label, error, { ...request, status });
  }
}

export function homarrIntegrations(session) {
  const password = deriveSessionPassword(session);
  const username = sessionUsername(session);
  return [
    { sourceId: "managed:sonarr", name: "Sonarr", kind: "sonarr", url: "http://sonarr:8989", secrets: [{ kind: "apiKey", value: session.secrets.SONARR_API_KEY }] },
    { sourceId: "managed:radarr", name: "Radarr", kind: "radarr", url: "http://radarr:7878", secrets: [{ kind: "apiKey", value: session.secrets.RADARR_API_KEY }] },
    { sourceId: "managed:prowlarr", name: "Prowlarr", kind: "prowlarr", url: "http://prowlarr:9696", secrets: [{ kind: "apiKey", value: session.secrets.PROWLARR_API_KEY }] },
    { sourceId: "managed:qbittorrent", name: "qBittorrent", kind: "qBittorrent", url: `http://qbittorrent:${session.manifest.QBITTORRENT_PORT}`, secrets: [{ kind: "username", value: username }, { kind: "password", value: password }] },
    { sourceId: "managed:jellyfin", name: "Jellyfin", kind: "jellyfin", url: "http://jellyfin:8096", secrets: [{ kind: "username", value: username }, { kind: "password", value: password }] },
    { sourceId: "managed:seerr", name: "Seerr", kind: "seerr", url: "http://seerr:5055", secrets: [{ kind: "apiKey", value: session.secrets.SEERR_API_KEY }] },
  ];
}

export function homarrSetupInput(session, boardName) {
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(boardName)) throw new Error("Homarr board name is invalid");
  return {
    server: { defaultLocale: "en", defaultColorScheme: "dark", analyticsEnabled: false },
    board: {
      name: boardName,
      primaryColor: "#228BE6",
      secondaryColor: "#15AABF",
      itemRadius: "md",
      layoutPreset: "balanced",
      leftSidebar: false,
      rightSidebar: false,
    },
    selectedIntegrationIds: [],
    selectedAppIds: [],
    integrations: homarrIntegrations(session),
    apps: [],
    selectedDockerSourceIds: [],
    selectedWidgetKinds: [],
  };
}

export async function configureHomarr(session, boardName = "personal") {
  requireSessionPasswordScheme(session);
  useCurlTransport(session);
  const homarrUsername = sessionUsername(session).toLowerCase();
  if (homarrUsername.length < 3) throw new Error("Homarr needs a username of at least three characters");
  const base = `http://127.0.0.1:${session.manifest.HOMARR_PORT}`;
  const procedure = async (name, input, mutation = false) => {
    let url;
    let options;
    let status = null;
    try {
      const path = `/api/trpc/${name}`;
      options = { headers: { Accept: "application/json" } };
      if (name === "onboard.completeSetup") options.timeoutMs = 120_000;
      url = `${base}${path}`;
      if (mutation) {
        options.method = "POST";
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify({ json: input });
      } else if (input !== undefined) {
        url += `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
      }
      const response = await curlJson(url, options, `Homarr ${name}`);
      status = response.status;
      const request = requestMetadata(url, options, status);
      const payload = requireRecord(response.json, `Homarr ${name}`, request);
      const result = requireRecord(payload.result, `Homarr ${name}`, request);
      const data = requireRecord(result.data, `Homarr ${name}`, request);
      if (["onboard.currentStep", "apiKeys.create"].includes(name)) {
        return requireRecord(data.json, `Homarr ${name}`, request);
      }
      return data.json;
    } catch (error) {
      const step = `Homarr ${name}`;
      const request = url && options ? requestMetadata(url, options, status) : {};
      throw new SetupStageError(step, error, request);
    }
  };
  const step = requireRecord(await procedure("onboard.currentStep"), "Homarr onboarding step").current;
  if (step !== "start" && step !== "user" && step !== "setup" && step !== "finish") {
    throw new Error("Homarr onboarding step is unsupported");
  }
  if (step === "start" || step === "user") {
    const claimUrl = `${base}/api/onboarding/claim`;
    const claimOptions = { method: "POST" };
    const claimResponse = await curlJson(claimUrl, claimOptions, "Homarr onboarding claim");
    const claimRequest = requestMetadata(claimUrl, claimOptions, claimResponse.status);
    const claimBody = requireRecord(claimResponse.json, "Homarr onboarding claim", claimRequest);
    if (claimBody.status !== "issued" && claimBody.status !== "active") {
      throw new SetupStageError("Homarr onboarding claim", new Error("claim is unavailable"), claimRequest);
    }
  }
  if (step === "start") await procedure("onboard.nextStep", undefined, true);
  const afterWelcome = requireRecord(await procedure("onboard.currentStep"), "Homarr onboarding step").current;
  if (afterWelcome === "user") {
    const password = deriveSessionPassword(session);
    await procedure("user.initUser", {
      username: homarrUsername,
      password,
      confirmPassword: password,
      email: "admin@example.test",
    }, true);
  }

  const csrfUrl = `${base}/api/auth/csrf`;
  const csrfResponse = await curlJson(csrfUrl, {}, "Homarr CSRF");
  const csrfRequest = requestMetadata(csrfUrl, {}, csrfResponse.status);
  const csrf = requireRecord(csrfResponse.json, "Homarr CSRF", csrfRequest).csrfToken;
  if (typeof csrf !== "string" || csrf.length < 8) {
    throw new SetupStageError("Homarr CSRF", new Error("token is unavailable"), csrfRequest);
  }
  const login = new URLSearchParams({
    name: homarrUsername,
    password: deriveSessionPassword(session),
    csrfToken: csrf,
    callbackUrl: base,
  });
  const loginUrl = `${base}/api/auth/callback/credentials`;
  const loginOptions = {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1" },
    body: login,
  };
  await curlJson(loginUrl, loginOptions, "Homarr admin login");
  const authSessionUrl = `${base}/api/auth/session`;
  const authSession = await curlJson(authSessionUrl, {}, "Homarr admin session");
  const authSessionRequest = requestMetadata(authSessionUrl, {}, authSession.status);
  const authenticated = requireRecord(authSession.json, "Homarr admin session", authSessionRequest);
  const user = requireRecord(authenticated.user, "Homarr admin user", authSessionRequest);
  if (user.name !== homarrUsername || !Array.isArray(user.permissions) || !user.permissions.includes("admin")) {
    throw new SetupStageError("Homarr admin session", new Error("admin login was not established"), authSessionRequest);
  }

  const current = requireRecord(await procedure("onboard.currentStep"), "Homarr onboarding step").current;
  let integrationsSubmitted = 0;
  let onboardingSubmitted = false;
  if (current === "setup") {
    const input = homarrSetupInput(session, boardName);
    await procedure("onboard.completeSetup", input, true);
    integrationsSubmitted = input.integrations.length;
    onboardingSubmitted = true;
  } else if (current !== "finish") {
    throw new Error("Homarr onboarding cannot be completed from its current step");
  }

  let existing;
  try {
    existing = loadHomarrApiKey(session, { optional: true });
  } catch (error) {
    throw new SetupStageError("Homarr API key validation", error);
  }
  let usableKey = false;
  if (existing) {
    const apiKeyCheckUrl = `${base}/api/trpc/apiKeys.getAll`;
    const apiKeyCheckOptions = {
      headers: { Accept: "application/json", ApiKey: existing.apiKey, Cookie: "" },
    };
    const apiKeyCheckRequest = requestMetadata(apiKeyCheckUrl, apiKeyCheckOptions);
    let checked;
    try {
      checked = await curlFetch(apiKeyCheckUrl, apiKeyCheckOptions);
    } catch (error) {
      throw new SetupStageError("Homarr API key validation", error, apiKeyCheckRequest);
    }
    if (checked.status === 200) {
      let payload;
      try {
        payload = await checked.json();
      } catch {
        throw new SetupStageError("Homarr API key validation", new Error("returned invalid JSON"), {
          ...apiKeyCheckRequest,
          status: checked.status,
        });
      }
      if (!Array.isArray(payload?.result?.data?.json)) {
        throw new SetupStageError("Homarr API key validation", new Error("returned an invalid key response"), {
          ...apiKeyCheckRequest,
          status: checked.status,
        });
      }
      usableKey = true;
    } else if (checked.status === 401 || checked.status === 403) {
      usableKey = false;
    } else {
      throw new SetupStageError("Homarr API key validation", new Error(`returned HTTP ${checked.status}`), {
        ...apiKeyCheckRequest,
        status: checked.status,
      });
    }
  }
  if (!usableKey) {
    const created = requireRecord(await procedure("apiKeys.create", undefined, true), "Homarr API key");
    try {
      storeHomarrApiKey(session, created.apiKey);
    } catch (error) {
      throw new SetupStageError("Homarr API key persistence", error);
    }
  }
  try {
    writeSessionConnections(session.runId);
  } catch (error) {
    throw new SetupStageError("Homarr API key handoff", error);
  }
  return { status: "pass", boardName, integrationsSubmitted, onboardingSubmitted, apiKeyStored: true };
}

if (Bun.argv[1] && pathToFileURL(Bun.argv[1]).href === import.meta.url) {
  if (Bun.argv.length < 3 || Bun.argv.length > 4) {
    console.error("usage: setup-homarr.ts RUN_ID [BOARD_NAME]");
    process.exitCode = 2;
  } else {
    const boardName = Bun.argv[3] ?? "personal";
    await runManagedSetup(Bun.argv[2], "homarr", "Homarr onboarding and API key", async (session) => {
      const result = await configureHomarr(session, boardName);
      if (result.onboardingSubmitted) {
        return `Homarr onboarding accepted ${result.integrationsSubmitted} integrations after server validation, private API key stored; board/widgets still need acceptance verification`;
      }
      return "Homarr was already onboarded and its private API key is stored; existing board/integrations/widgets still need acceptance verification";
    }, { boardName });
  }
}
