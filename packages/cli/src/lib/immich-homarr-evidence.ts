type JsonRecord = Record<string, unknown>;

function object(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function boundedJson(response: Response, label: string): Promise<JsonRecord> {
  if (response.status !== 200 && response.status !== 201) {
    await response.body?.cancel();
    throw new Error(`${label} returned unexpected HTTP status ${response.status}`);
  }
  const length = response.headers.get("content-length");
  if (length !== null && Number(length) > 64 * 1024) {
    await response.body?.cancel();
    throw new Error(`${label} response is too large`);
  }
  if (!response.body) throw new Error(`${label} response body is missing`);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 64 * 1024) {
        await reader.cancel();
        throw new Error(`${label} response is too large`);
      }
      chunks.push(Buffer.from(next.value));
    }
  } finally {
    reader.releaseLock();
  }
  if (size < 1) throw new Error(`${label} response size is invalid`);
  const bytes = Buffer.concat(chunks, size);
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error(`${label} returned invalid JSON`); }
  if (!object(value)) throw new Error(`${label} returned an invalid object`);
  return value;
}

export async function verifyImmichAdminRelease(origin: string, email: string, password: string): Promise<void> {
  const login = await fetch(`${origin}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }), redirect: "error", signal: AbortSignal.timeout(20_000),
  });
  if (login.status !== 201) {
    await login.body?.cancel();
    throw new Error("Managed Immich admin login failed");
  }
  const session = await boundedJson(login, "Immich admin login");
  if (session.isAdmin !== true || session.userEmail !== email
    || typeof session.accessToken !== "string" || session.accessToken.length < 1) {
    throw new Error("Immich login did not identify the managed admin");
  }
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const version = await boundedJson(await fetch(`${origin}/api/server/version`, {
    headers, redirect: "error", signal: AbortSignal.timeout(20_000),
  }), "Immich release version");
  if (version.major !== 3 || version.minor !== 2 || version.patch !== 2) {
    throw new Error("Running Immich release differs from the approved v3.2.2 recipe");
  }
  const config = await boundedJson(await fetch(`${origin}/api/server/config`, {
    headers, redirect: "error", signal: AbortSignal.timeout(20_000),
  }), "Immich setup state");
  if (config.isInitialized !== true) throw new Error("Immich is not initialized");
}
