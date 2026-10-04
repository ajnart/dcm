import { immichHomarrPermissions } from "../immich-accept.ts";

type JsonObject = Record<string, unknown>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactPermissions(value: unknown): boolean {
  return Array.isArray(value) && value.length === immichHomarrPermissions.length
    && value.every((permission) => typeof permission === "string")
    && JSON.stringify([...value].sort()) === JSON.stringify([...immichHomarrPermissions].sort());
}

async function boundedJson(response: Response, expected: number, label: string): Promise<unknown> {
  if (response.status !== expected) {
    await response.body?.cancel();
    throw new Error(`${label} returned an unexpected status`);
  }
  const length = response.headers.get("content-length");
  if (length !== null && Number(length) > 64 * 1024) {
    await response.body?.cancel();
    throw new Error(`${label} returned an oversized body`);
  }
  if (!response.body) throw new Error(`${label} returned no body`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 64 * 1024) {
        await reader.cancel();
        throw new Error(`${label} returned an oversized body`);
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size === 0) throw new Error(`${label} returned no body`);
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size).toString("utf8")); }
  catch { throw new Error(`${label} returned invalid JSON`); }
  return value;
}

function endpoint(origin: string, path: string, init: RequestInit): Promise<Response> {
  return fetch(`${origin}/api${path}`, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) });
}

export async function inspectImmichHomarrKeys(origin: string, email: string,
  password: string): Promise<{ token: string; homarrIds: string[] }> {
  const login = await boundedJson(await endpoint(origin, "/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  }), 201, "Immich admin login");
  if (!object(login) || login.isAdmin !== true || login.userEmail !== email
    || typeof login.accessToken !== "string" || login.accessToken.length < 1) {
    throw new Error("Immich login did not identify the managed admin");
  }
  const token = login.accessToken;
  const keys = await boundedJson(await endpoint(origin, "/api-keys", {
    headers: { authorization: `Bearer ${token}` },
  }), 200, "Immich API key inventory");
  if (!Array.isArray(keys) || keys.some((key) => !object(key) || typeof key.name !== "string")) {
    throw new Error("Immich API key inventory is invalid");
  }
  const homarrIds = keys.filter((key) => key.name === "Homarr")
    .map((key) => key.id);
  if (homarrIds.some((id) => typeof id !== "string" || !uuid.test(id))) {
    throw new Error("Immich Homarr API key inventory is invalid");
  }
  return { token, homarrIds: homarrIds as string[] };
}

export async function createImmichHomarrKey(origin: string, token: string): Promise<{
  id: unknown; secret: string; metadataValid: boolean;
}> {
  const created = await boundedJson(await endpoint(origin, "/api-keys", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ name: "Homarr", permissions: immichHomarrPermissions }),
  }), 201, "Immich Homarr API key creation");
  if (!object(created) || typeof created.secret !== "string"
    || created.secret.length < 24 || created.secret.length > 4096
    || created.secret.trim() !== created.secret || /[\u0000-\u001f\u007f]/.test(created.secret)) {
    throw new Error("Immich created a key without a usable one-time secret; inspect and revoke it manually");
  }
  const metadataValid = typeof created.id === "string" && uuid.test(created.id)
    && created.name === "Homarr" && exactPermissions(created.permissions);
  return { id: created.id, secret: created.secret, metadataValid };
}

export async function verifyImmichHomarrKey(origin: string, secret: string,
  expectedId?: string): Promise<string> {
  const current = await boundedJson(await endpoint(origin, "/api-keys/me", {
    headers: { "x-api-key": secret },
  }), 200, "Immich Homarr API key verification");
  if (!object(current) || typeof current.id !== "string"
    || !uuid.test(current.id) || current.name !== "Homarr"
    || !exactPermissions(current.permissions) || (expectedId && current.id !== expectedId)) {
    throw new Error("Immich Homarr API key identity or permissions did not verify");
  }
  return current.id;
}
