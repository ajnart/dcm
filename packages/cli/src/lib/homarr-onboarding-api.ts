/**
 * Homarr v2's private, credentials-based onboarding API. The caller owns durable
 * checkpoints and the private API-key file; this module never writes either.
 */

/**
 * Persist `*-attempted` before sending the write. Persist the matching success
 * value after its accepted response. If a retry sees an attempted checkpoint
 * but the server has not advanced, stop for inspection rather than replaying.
 * `api-key-created` means the one-time key has already been saved privately.
 */
export type HomarrOnboardingCheckpoint =
  | "admin-create-attempted"
  | "admin-created"
  | "setup-submit-attempted"
  | "setup-completed"
  | "api-key-create-attempted"
  | "api-key-created";

export type HomarrOnboardingStage =
  | "input"
  | "inspect"
  | "claim"
  | "welcome"
  | "admin-create"
  | "admin-login"
  | "setup"
  | "api-key-validation"
  | "api-key-create"
  | "api-key-persistence";

export type HomarrOnboardingInput = {
  /** Explicit HTTP loopback origin including a port, e.g. http://127.0.0.1:7575. */
  origin: string;
  username: string;
  password: string;
  boardName: string;
  /** The last checkpoint durably saved by onStage, if resuming. */
  checkpoint?: HomarrOnboardingCheckpoint;
  /** A previously stored, private key; it is validated without session cookies. */
  existingApiKey?: string;
  /** Persist each checkpoint before returning. An attempted checkpoint precedes its write. */
  onStage: (checkpoint: HomarrOnboardingCheckpoint) => Promise<void> | void;
  /** Persist the one-time key immediately; no further request is made until this resolves. */
  onApiKeyCreated: (apiKey: string) => Promise<void> | void;
};

export type HomarrOnboardingResult = {
  status: "pass";
  adminVerified: true;
  apiKeyVerified: true;
  onboardingSubmitted: boolean;
  integrationsSubmitted: 0;
  apiKeySource: "existing" | "created";
};

/** Error messages and properties contain no URL, response body, cookie, or credential. */
export class HomarrOnboardingError extends Error {
  readonly stage: HomarrOnboardingStage;
  readonly uncertain: boolean;
  readonly httpStatus?: number;

  constructor(stage: HomarrOnboardingStage, message: string, uncertain = false, httpStatus?: number) {
    super(message);
    this.name = "HomarrOnboardingError";
    this.stage = stage;
    this.uncertain = uncertain;
    this.httpStatus = httpStatus;
  }
}

type OnboardingStep = "start" | "user" | "setup" | "finish";
type JsonRecord = Record<string, unknown>;

const checkpointOrder: HomarrOnboardingCheckpoint[] = [
  "admin-create-attempted",
  "admin-created",
  "setup-submit-attempted",
  "setup-completed",
  "api-key-create-attempted",
  "api-key-created",
];

function atOrAfter(checkpoint: HomarrOnboardingCheckpoint | undefined, target: HomarrOnboardingCheckpoint): boolean {
  if (!checkpoint) return false;
  return checkpointOrder.indexOf(checkpoint) >= checkpointOrder.indexOf(target);
}

function record(value: unknown): JsonRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function requireOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HomarrOnboardingError("input", "Homarr origin must be an explicit HTTP loopback origin.");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new HomarrOnboardingError("input", "Homarr origin must be an explicit HTTP loopback origin.");
  }
  return url.origin;
}

class PrivateSession {
  private readonly cookies = new Map<string, string>();

  constructor(readonly origin: string) {}

  private receiveCookies(response: Response): void {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const setCookies = headers.getSetCookie?.() ?? [headers.get("set-cookie")].filter((value): value is string => !!value);
    for (const setCookie of setCookies) {
      const first = setCookie.split(";", 1)[0];
      if (!first) continue;
      const separator = first.indexOf("=");
      if (separator <= 0) continue;
      const name = first.slice(0, separator).trim();
      const value = first.slice(separator + 1).trim();
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n;]/.test(value)) continue;
      if (/(?:^|;)\s*max-age=0(?:;|$)/i.test(setCookie)) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  async request(
    path: string,
    stage: HomarrOnboardingStage,
    options: { method?: "GET" | "POST"; headers?: Record<string, string>; body?: string; timeoutMs?: number; isolated?: boolean } = {},
  ): Promise<Response> {
    const headers = new Headers(options.headers);
    headers.set("Accept", "application/json");
    if (options.isolated) {
      headers.set("Cookie", "");
    } else if (this.cookies.size > 0) {
      headers.set("Cookie", [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "));
    }
    let response: Response;
    try {
      response = await fetch(`${this.origin}${path}`, {
        method: options.method ?? "GET",
        headers,
        body: options.body,
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      });
    } catch {
      throw new HomarrOnboardingError(stage, "Homarr request outcome could not be confirmed.", options.method === "POST");
    }
    if (!options.isolated) this.receiveCookies(response);
    return response;
  }
}

async function jsonResponse(response: Response, stage: HomarrOnboardingStage, mutation = false): Promise<JsonRecord> {
  if (response.status < 200 || response.status >= 300) {
    await response.body?.cancel();
    throw new HomarrOnboardingError(stage, "Homarr rejected the request.", mutation, response.status);
  }
  let value: unknown;
  try {
    const text = await response.text();
    if (Buffer.byteLength(text) > 1024 * 1024) throw new Error("oversized");
    value = JSON.parse(text);
  } catch {
    throw new HomarrOnboardingError(stage, "Homarr returned an invalid response.", mutation, response.status);
  }
  const parsed = record(value);
  if (!parsed) throw new HomarrOnboardingError(stage, "Homarr returned an invalid response.", mutation, response.status);
  return parsed;
}

async function procedure(
  session: PrivateSession,
  name: string,
  stage: HomarrOnboardingStage,
  input?: unknown,
  mutation = false,
  timeoutMs = 10_000,
): Promise<unknown> {
  let path = `/api/trpc/${name}`;
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (mutation) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ json: input });
  } else if (input !== undefined) {
    path += `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  }
  const response = await session.request(path, stage, {
    method: mutation ? "POST" : "GET",
    headers,
    body,
    timeoutMs,
  });
  const payload = await jsonResponse(response, stage, mutation);
  const result = record(payload.result);
  const data = record(result?.data);
  if (!data) throw new HomarrOnboardingError(stage, "Homarr returned an invalid response.", mutation, response.status);
  return data.json;
}

async function currentStep(session: PrivateSession): Promise<OnboardingStep> {
  const value = record(await procedure(session, "onboard.currentStep", "inspect"));
  const step = value?.current;
  if (step === "start" || step === "user" || step === "setup" || step === "finish") return step;
  throw new HomarrOnboardingError("inspect", "Homarr onboarding step is unsupported.");
}

async function checkpoint(input: HomarrOnboardingInput, stage: HomarrOnboardingCheckpoint, uncertain: boolean): Promise<void> {
  try {
    await input.onStage(stage);
  } catch {
    let errorStage: HomarrOnboardingStage = "setup";
    if (stage.startsWith("admin-")) errorStage = "admin-create";
    if (stage.startsWith("api-key-")) errorStage = "api-key-create";
    throw new HomarrOnboardingError(errorStage, "Homarr checkpoint could not be saved.", uncertain);
  }
}

async function verifyAdmin(session: PrivateSession, username: string, password: string): Promise<void> {
  const csrfResponse = await session.request("/api/auth/csrf", "admin-login");
  const csrf = (await jsonResponse(csrfResponse, "admin-login")).csrfToken;
  if (typeof csrf !== "string" || csrf.length < 8) {
    throw new HomarrOnboardingError("admin-login", "Homarr CSRF token is unavailable.");
  }
  const body = new URLSearchParams({ name: username, password, csrfToken: csrf, callbackUrl: session.origin });
  const loginResponse = await session.request("/api/auth/callback/credentials", "admin-login", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Auth-Return-Redirect": "1",
    },
    body: body.toString(),
  });
  await jsonResponse(loginResponse, "admin-login");
  const sessionResponse = await session.request("/api/auth/session", "admin-login");
  const authenticated = await jsonResponse(sessionResponse, "admin-login");
  const user = record(authenticated.user);
  if (user?.name !== username || !Array.isArray(user.permissions) || !user.permissions.includes("admin")) {
    throw new HomarrOnboardingError("admin-login", "Homarr admin session was not established.");
  }
}

function setupInput(boardName: string): JsonRecord {
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
    integrations: [],
    apps: [],
    selectedDockerSourceIds: [],
    selectedWidgetKinds: [],
  };
}

async function verifyApiKey(session: PrivateSession, key: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) {
    throw new HomarrOnboardingError("input", "Homarr API key format is invalid.");
  }
  const response = await session.request("/api/trpc/apiKeys.getAll", "api-key-validation", {
    headers: { ApiKey: key },
    isolated: true,
  });
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    return false;
  }
  const payload = await jsonResponse(response, "api-key-validation");
  const result = record(payload.result);
  const data = record(result?.data);
  if (!Array.isArray(data?.json)) {
    throw new HomarrOnboardingError("api-key-validation", "Homarr API-key verification was inconclusive.");
  }
  return true;
}

export async function bootstrapHomarrApi(input: HomarrOnboardingInput): Promise<HomarrOnboardingResult> {
  const origin = requireOrigin(input.origin);
  const username = input.username.trim().toLowerCase();
  if (username.length < 3 || username.length > 255 || input.password.length < 8 || input.password.length > 255) {
    throw new HomarrOnboardingError("input", "Homarr admin credentials do not meet the input limits.");
  }
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(input.boardName)) {
    throw new HomarrOnboardingError("input", "Homarr board name is invalid.");
  }
  if (typeof input.onStage !== "function" || typeof input.onApiKeyCreated !== "function") {
    throw new HomarrOnboardingError("input", "Homarr persistence callbacks are required.");
  }
  if (input.checkpoint && !checkpointOrder.includes(input.checkpoint)) {
    throw new HomarrOnboardingError("input", "Homarr checkpoint is unsupported.");
  }
  const session = new PrivateSession(origin);
  let step = await currentStep(session);
  if ((step === "start" || step === "user") && atOrAfter(input.checkpoint, "admin-create-attempted")) {
    throw new HomarrOnboardingError("admin-create", "Homarr admin creation is uncertain; manual inspection is required.", true);
  }
  if (step === "start" || step === "user") {
    const claimResponse = await session.request("/api/onboarding/claim", "claim", { method: "POST" });
    const claim = await jsonResponse(claimResponse, "claim");
    if (claim.status !== "issued" && claim.status !== "active") {
      throw new HomarrOnboardingError("claim", "Homarr onboarding claim is unavailable.");
    }
  }
  if (step === "start") {
    await procedure(session, "onboard.nextStep", "welcome", undefined, true);
    step = await currentStep(session);
  }
  if (step === "user") {
    await checkpoint(input, "admin-create-attempted", false);
    await procedure(session, "user.initUser", "admin-create", {
      username,
      password: input.password,
      confirmPassword: input.password,
      email: "admin@example.test",
    }, true);
    await checkpoint(input, "admin-created", true);
  } else if (step !== "setup" && step !== "finish") {
    throw new HomarrOnboardingError("inspect", "Homarr onboarding step is unsupported.");
  }

  await verifyAdmin(session, username, input.password);
  step = await currentStep(session);
  let onboardingSubmitted = false;
  if (step === "setup") {
    if (atOrAfter(input.checkpoint, "setup-submit-attempted")) {
      throw new HomarrOnboardingError("setup", "Homarr setup submission is uncertain; manual inspection is required.", true);
    }
    await checkpoint(input, "setup-submit-attempted", false);
    await procedure(session, "onboard.completeSetup", "setup", setupInput(input.boardName), true, 120_000);
    await checkpoint(input, "setup-completed", true);
    onboardingSubmitted = true;
    step = await currentStep(session);
  }
  if (step !== "finish") {
    throw new HomarrOnboardingError("setup", "Homarr onboarding did not reach the finished step.", true);
  }

  if (input.existingApiKey && await verifyApiKey(session, input.existingApiKey)) {
    return { status: "pass", adminVerified: true, apiKeyVerified: true, onboardingSubmitted, integrationsSubmitted: 0, apiKeySource: "existing" };
  }
  if (atOrAfter(input.checkpoint, "api-key-create-attempted")) {
    throw new HomarrOnboardingError("api-key-create", "Homarr API-key creation is uncertain; recover the saved key or inspect manually.", true);
  }
  await checkpoint(input, "api-key-create-attempted", false);
  const created = record(await procedure(session, "apiKeys.create", "api-key-create", undefined, true));
  const apiKey = created?.apiKey;
  if (typeof apiKey !== "string" || !/^[^.]+\.[^.]+$/.test(apiKey)) {
    throw new HomarrOnboardingError("api-key-create", "Homarr returned an invalid one-time API key.", true);
  }
  try {
    await input.onApiKeyCreated(apiKey);
  } catch {
    throw new HomarrOnboardingError("api-key-persistence", "Homarr API key could not be saved; creation may have succeeded.", true);
  }
  await checkpoint(input, "api-key-created", true);
  if (!await verifyApiKey(session, apiKey)) {
    throw new HomarrOnboardingError("api-key-validation", "Homarr created API key could not be verified.", true);
  }
  return { status: "pass", adminVerified: true, apiKeyVerified: true, onboardingSubmitted, integrationsSubmitted: 0, apiKeySource: "created" };
}
