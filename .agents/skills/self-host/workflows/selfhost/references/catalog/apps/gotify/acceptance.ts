import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { AcceptanceContext } from "../../types/acceptance";
import { createReadOnlyAcceptance } from "../../types/acceptance-lifecycle";
import { setupRecord, type SetupRecord } from "../../types/setup";

const SOURCE = "https://raw.githubusercontent.com/gotify/server/v3.1.1/api/message.go";
const MAX_BYTES = 1024 * 1024;

function positiveId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error("Gotify acceptance returned an invalid identity");
  }
  return value;
}

async function json(context: AcceptanceContext, path: string, authorization?: string,
  query?: Record<string, string>, afterRestart = false): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (authorization) headers.Authorization = authorization;
      const response = await context.http.request({ method: "GET", path, headers, query, timeoutMs: 2000 });
      if (afterRestart && [502, 503, 504].includes(response.status) && attempt < 2) {
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
        continue;
      }
      if (response.status !== 200 || !response.ok) throw new Error("unavailable read");
      const bytes = await response.text();
      if (Buffer.byteLength(bytes, "utf8") > MAX_BYTES) throw new Error("oversized read");
      return JSON.parse(bytes);
    } catch {
      // Do not expose transport errors, credentials, or returned workload bytes.
      throw new Error("Gotify authenticated selected-message read is unavailable or invalid");
    }
  }
  throw new Error("Gotify restart readiness read is unavailable");
}

// Ignore object-key ordering, but bind every field, array order and exact string bytes.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export default createReadOnlyAcceptance({
  appId: "gotify", source: SOURCE, stage: "gotify-existing-message-read",
  serviceIds: ["gotify"], cleanup: "not-required-existing-message-read-only",
  inputDefinitions: [{ key: "message-id", label: "Existing authorized Auto-Stack message ID (read only)" }],
  async observe(context, afterRestart) {
    const selected = context.inputs?.["message-id"];
    if (typeof selected !== "string" || !/^[1-9][0-9]{0,9}$/.test(selected)) {
      throw new Error("Gotify acceptance requires a reviewed positive existing message ID");
    }
    const messageId = positiveId(Number(selected));
    const version = setupRecord(await json(context, "/version", undefined, undefined, afterRestart), "Gotify version");
    if (version.version !== "3.1.1") throw new Error("Gotify acceptance is pinned to version 3.1.1");
    let password: string;
    try { password = await context.secrets.readAdminPassword(); }
    catch { throw new Error("Gotify acceptance saved administrator credential is unavailable"); }
    if (!password || password.length > 1024 || /[\r\n\0]/.test(password)) {
      throw new Error("Gotify acceptance saved administrator credential is invalid");
    }
    // Saved onboarding token is an application/publisher token, not read auth.
    const authorization = `Basic ${Buffer.from(`admin:${password}`, "utf8").toString("base64")}`;
    const user = setupRecord(await json(context, "/current/user", authorization), "Gotify user");
    if (user.name !== "admin" || user.admin !== true) throw new Error("Gotify authenticated administrator identity differs");
    const userId = positiveId(user.id);
    const applications = await json(context, "/application", authorization);
    if (!Array.isArray(applications) || applications.length > 1024) throw new Error("Gotify owned application inventory is invalid");
    const owned = applications.map((item) => setupRecord(item, "Gotify application"))
      .filter((item) => item.name === "Auto-Stack");
    if (owned.length !== 1) throw new Error("Gotify requires exactly one authenticated owned Auto-Stack application");
    const applicationId = positiveId(owned[0]!.id);
    // No GET /message/{id} exists. since is exclusive; newest-first limit=1 selects this exact ID.
    const page = setupRecord(await json(context, `/application/${applicationId}/message`, authorization,
      { limit: "1", since: String(messageId + 1) }), "Gotify messages");
    if (!Array.isArray(page.messages) || page.messages.length !== 1) throw new Error("Gotify selected existing message is missing");
    const message = setupRecord(page.messages[0], "Gotify selected message");
    if (message.id !== messageId || message.appid !== applicationId
      || typeof message.message !== "string" || message.message.trim().length < 1
      || typeof message.title !== "string" || typeof message.date !== "string"
      || !Number.isSafeInteger(message.priority)) {
      throw new Error("Gotify selected message identity, ownership or nonempty payload differs");
    }
    const payload = canonical(message);
    const messageSize = Buffer.byteLength(payload, "utf8");
    if (messageSize > MAX_BYTES) throw new Error("Gotify selected message exceeds the bounded payload size");
    const baseline: SetupRecord = { userId, applicationId, messageId, messageSize,
      messageSha256: createHash("sha256").update(payload, "utf8").digest("hex") };
    return { baseline, result: { ...baseline, appHealthObserved: true, authenticatedIdentityVerified: true,
      existingMessageReadVerified: true, workloadScope: "selected-existing-owned-message-read",
      pushDeliveryVerified: false, clientDeliveryVerified: false } };
  },
});
