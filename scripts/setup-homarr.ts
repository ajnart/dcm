#!/usr/bin/env bun

import { pathToFileURL } from "node:url";
import {
  deriveSessionPassword,
  loadHomarrApiKey,
  loadSession,
  requireSessionPasswordScheme,
  sessionUsername,
  storeHomarrApiKey,
  useCurlTransport,
  writeSessionConnections,
} from "./lib/session-context.ts";
import { curlFetch } from "./lib/curl-http.ts";

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} response is invalid`);
  }
  return value;
}

async function jsonResponse(response, label) {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${label} returned HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} returned invalid JSON`);
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
    const path = `/api/trpc/${name}`;
    const options = { headers: { Accept: "application/json" } };
    if (name === "onboard.testIntegration") options.timeoutMs = 30_000;
    if (name === "onboard.completeSetup") options.timeoutMs = 120_000;
    let url = `${base}${path}`;
    if (mutation) {
      options.method = "POST";
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify({ json: input });
    } else if (input !== undefined) {
      url += `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
    }
    const payload = requireRecord(await jsonResponse(await curlFetch(url, options), `Homarr ${name}`), `Homarr ${name}`);
    return requireRecord(requireRecord(payload.result, `Homarr ${name}`).data, `Homarr ${name}`).json;
  };
  const step = requireRecord(await procedure("onboard.currentStep"), "Homarr onboarding step").current;
  if (step !== "start" && step !== "user" && step !== "setup" && step !== "finish") {
    throw new Error("Homarr onboarding step is unsupported");
  }
  if (step === "start" || step === "user") {
    const claim = await curlFetch(`${base}/api/onboarding/claim`, { method: "POST" });
    const claimBody = await jsonResponse(claim, "Homarr onboarding claim");
    if (claimBody.status !== "issued" && claimBody.status !== "active") {
      throw new Error("Homarr onboarding claim is unavailable");
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

  const csrf = requireRecord(await jsonResponse(await curlFetch(`${base}/api/auth/csrf`), "Homarr CSRF"), "Homarr CSRF").csrfToken;
  if (typeof csrf !== "string" || csrf.length < 8) throw new Error("Homarr CSRF token is unavailable");
  const login = new URLSearchParams({
    name: homarrUsername,
    password: deriveSessionPassword(session),
    csrfToken: csrf,
    callbackUrl: base,
  });
  await jsonResponse(await curlFetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1" },
    body: login,
  }), "Homarr admin login");
  const authenticated = requireRecord(await jsonResponse(await curlFetch(`${base}/api/auth/session`), "Homarr admin session"), "Homarr admin session");
  const user = requireRecord(authenticated.user, "Homarr admin user");
  if (user.name !== homarrUsername || !Array.isArray(user.permissions) || !user.permissions.includes("admin")) {
    throw new Error("Homarr admin login was not established");
  }

  const current = requireRecord(await procedure("onboard.currentStep"), "Homarr onboarding step").current;
  if (current === "setup") {
    const input = homarrSetupInput(session, boardName);
    for (const integration of input.integrations) {
      const result = requireRecord(await procedure("onboard.testIntegration", integration, true), "Homarr integration test");
      if (result.success !== true) throw new Error(`Homarr ${integration.name} integration test failed`);
    }
    await procedure("onboard.completeSetup", input, true);
  } else if (current !== "finish") {
    throw new Error("Homarr onboarding cannot be completed from its current step");
  }

  const existing = loadHomarrApiKey(session, { optional: true });
  let usableKey = false;
  if (existing) {
    const checked = await curlFetch(`${base}/api/trpc/apiKeys.getAll`, {
      headers: { Accept: "application/json", ApiKey: existing.apiKey, Cookie: "" },
    });
    if (checked.status === 200) {
      const payload = await checked.json().catch(() => null);
      usableKey = Array.isArray(payload?.result?.data?.json);
    }
  }
  if (!usableKey) {
    const created = requireRecord(await procedure("apiKeys.create", undefined, true), "Homarr API key");
    storeHomarrApiKey(session, created.apiKey);
  }
  writeSessionConnections(session.runId);
  return { status: "pass", boardName, integrations: 6, apiKeyStored: true };
}

if (Bun.argv[1] && pathToFileURL(Bun.argv[1]).href === import.meta.url) {
  try {
    if (Bun.argv.length < 3 || Bun.argv.length > 4) throw new Error("usage");
    const result = await configureHomarr(loadSession(Bun.argv[2]), Bun.argv[3] ?? "personal");
    console.log(`PASS Homarr onboarding, ${result.integrations} tested integrations, generated board, private API key`);
  } catch {
    console.error("FAIL Homarr setup; inspect the run-scoped session doctor without exposing credentials");
    process.exitCode = 1;
  }
}
