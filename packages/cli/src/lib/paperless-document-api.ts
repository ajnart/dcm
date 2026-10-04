import { createHash } from "node:crypto";

// A fixed, harmless raster image: the phrase has no embedded text layer.
const CANARY_PNG_BASE64 = "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";
export const PAPERLESS_OCR_PHRASE = "SELFHOST OCR CHECK";
const taskIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function paperlessCanary(): { bytes: Buffer; sha256: string } {
  const bytes = Buffer.from(CANARY_PNG_BASE64, "base64");
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function authorization(username: string, password: string): string {
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(username)
    || !/^[A-Za-z0-9_-]{43,172}$/.test(password)) {
    throw new Error("Paperless document probe needs the managed administrator");
  }
  return "Basic " + Buffer.from(username + ":" + password).toString("base64");
}

function endpoint(origin: string, path: string): string {
  if (!/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(origin)) {
    throw new Error("Paperless document probe needs the exact loopback origin");
  }
  return origin + path;
}

async function boundedText(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > limit) throw new Error("Paperless API response exceeded its size limit");
  if (!response.body) throw new Error("Paperless API returned no response body");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error("Paperless API response exceeded its size limit");
    }
    chunks.push(Buffer.from(part.value));
  }
  return Buffer.concat(chunks, size).toString("utf8");
}

async function jsonResponse(response: Response): Promise<Record<string, unknown>> {
  if (response.status !== 200) throw new Error("Paperless API returned HTTP " + response.status);
  const text = await boundedText(response, 128 * 1024);
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error("Paperless API returned invalid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Paperless API returned an unexpected object");
  }
  return value as Record<string, unknown>;
}

export async function uploadPaperlessCanary(origin: string, username: string,
  password: string, title: string): Promise<string> {
  if (!/^[A-Za-z0-9 _-]{1,100}$/.test(title)) throw new Error("Paperless canary title is invalid");
  const form = new FormData();
  const canary = paperlessCanary();
  form.append("document", new Blob([canary.bytes], { type: "image/png" }), "selfhost-ocr-check.png");
  form.append("title", title);
  const response = await fetch(endpoint(origin, "/api/documents/post_document/"), {
    method: "POST", headers: { Authorization: authorization(username, password) },
    body: form, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000),
  });
  if (response.status !== 200) throw new Error("Paperless upload returned HTTP " + response.status);
  const text = (await boundedText(response, 1024)).trim();
  let taskId = text;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === "string") taskId = value;
  } catch { /* The official endpoint may return the UUID as plain text. */ }
  if (!taskIdPattern.test(taskId)) throw new Error("Paperless upload returned no usable task UUID");
  return taskId;
}

export async function paperlessTask(origin: string, username: string, password: string,
  taskId: string): Promise<{ status: "pending" | "started" | "success" | "failure" | "revoked";
    documentId?: number }> {
  if (!taskIdPattern.test(taskId)) throw new Error("Saved Paperless task UUID is invalid");
  const response = await fetch(endpoint(origin, "/api/tasks/?task_id=" + encodeURIComponent(taskId)), {
    method: "GET", headers: { Authorization: authorization(username, password), Accept: "application/json" },
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  const value = await jsonResponse(response);
  if (!Array.isArray(value.results)) throw new Error("Paperless task API did not return a paginated list");
  const tasks = value.results.filter((task) => task && typeof task === "object"
    && (task as Record<string, unknown>).task_id === taskId);
  if (tasks.length !== 1) throw new Error("Paperless task is missing or duplicated; do not upload another canary");
  const task = tasks[0] as Record<string, unknown>;
  if (!["pending", "started", "success", "failure", "revoked"].includes(String(task.status))) {
    throw new Error("Paperless task returned an unknown status");
  }
  const status = task.status as "pending" | "started" | "success" | "failure" | "revoked";
  if (status !== "success") return { status };
  const result = task.result_data;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Paperless task succeeded without a document result");
  }
  const documentId = (result as Record<string, unknown>).document_id;
  if (!Number.isSafeInteger(documentId) || (documentId as number) <= 0) {
    throw new Error("Paperless task succeeded without one new document ID");
  }
  return { status, documentId: documentId as number };
}

export async function verifyPaperlessCanary(origin: string, username: string, password: string,
  documentId: number, expectedSha256: string): Promise<{ contentMatched: true; sha256: string }> {
  if (!Number.isSafeInteger(documentId) || documentId <= 0 || !/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new Error("Saved Paperless document evidence is invalid");
  }
  const headers = { Authorization: authorization(username, password), Accept: "application/json" };
  const detail = await fetch(endpoint(origin, "/api/documents/" + documentId + "/"), {
    headers, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  const metadata = await jsonResponse(detail);
  if (metadata.id !== documentId || typeof metadata.content !== "string"
    || !/\bSELFHOST\s+OCR\s+CHECK\b/i.test(metadata.content)) {
    throw new Error("Paperless document did not contain the expected OCR text");
  }
  const download = await fetch(endpoint(origin,
    "/api/documents/" + documentId + "/download/?original=true"), {
    headers: { Authorization: headers.Authorization },
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000),
  });
  if (download.status !== 200) throw new Error("Paperless original download returned HTTP " + download.status);
  const declared = Number(download.headers.get("content-length") ?? "0");
  if (declared > 1024 * 1024) throw new Error("Paperless original exceeds the canary size limit");
  const bytes = Buffer.from(await download.arrayBuffer());
  if (bytes.length > 1024 * 1024) throw new Error("Paperless original exceeds the canary size limit");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== expectedSha256) throw new Error("Paperless original bytes differ from the uploaded canary");
  return { contentMatched: true, sha256 };
}

async function findPaperlessTrashCanary(origin: string, username: string, password: string,
  documentId: number, expectedTitle: string): Promise<boolean> {
  const headers = { Authorization: authorization(username, password), Accept: "application/json" };
  // TrashView serializes full OCR content and offers no ID or field filter.
  // Keep each page small; fail closed if the bounded scan cannot prove absence.
  for (let page = 1; page <= 50; page += 1) {
    const response = await fetch(endpoint(origin, `/api/trash/?page=${page}&page_size=5`), {
      headers, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 200) throw new Error("Paperless trash API returned HTTP " + response.status);
    const body = await boundedText(response, 8 * 1024 * 1024);
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(body) as Record<string, unknown>;
    } catch {
      throw new Error("Paperless trash API returned invalid JSON");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Paperless trash API returned an unexpected object");
    }
    if (!Array.isArray(value.results) || value.results.length > 5 || typeof value.count !== "number"
      || !Number.isSafeInteger(value.count) || value.count < 0) {
      throw new Error("Paperless trash list returned an unexpected page");
    }
    const matches = value.results.filter((item) => item && typeof item === "object"
      && (item as Record<string, unknown>).id === documentId);
    if (matches.length > 1) throw new Error("Paperless trash returned duplicate canary IDs");
    if (matches.length === 1) {
      if ((matches[0] as Record<string, unknown>).title !== expectedTitle) {
        throw new Error("Paperless trash document title no longer matches the saved canary");
      }
      return true;
    }
    if (value.next === null) return false;
    if (typeof value.next !== "string") throw new Error("Paperless trash pagination is invalid");
  }
  throw new Error("Paperless trash exceeds the bounded canary search; inspect it before cleanup");
}

export async function trashPaperlessCanary(origin: string, username: string, password: string,
  documentId: number, expectedTitle: string, expectedSha256: string): Promise<"already-trashed" | "trashed"> {
  if (!Number.isSafeInteger(documentId) || documentId <= 0
    || !/^[A-Za-z0-9 _-]{1,100}$/.test(expectedTitle)
    || !/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new Error("Saved Paperless canary cleanup target is invalid");
  }
  if (await findPaperlessTrashCanary(origin, username, password, documentId, expectedTitle)) {
    return "already-trashed";
  }
  const headers = { Authorization: authorization(username, password), Accept: "application/json" };
  const detail = await fetch(endpoint(origin, `/api/documents/${documentId}/`), {
    headers, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  const metadata = await jsonResponse(detail);
  if (metadata.id !== documentId || metadata.title !== expectedTitle) {
    throw new Error("Paperless active document no longer matches the saved canary");
  }
  await verifyPaperlessCanary(origin, username, password, documentId, expectedSha256);
  const deleted = await fetch(endpoint(origin, `/api/documents/${documentId}/`), {
    method: "DELETE", headers, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000),
  });
  if (deleted.status !== 204) throw new Error("Paperless canary trash move returned HTTP " + deleted.status);
  if (!await findPaperlessTrashCanary(origin, username, password, documentId, expectedTitle)) {
    throw new Error("Paperless canary was not found in recoverable trash after deletion");
  }
  return "trashed";
}
