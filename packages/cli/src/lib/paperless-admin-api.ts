/** Read-only first-admin proof for the bundled Paperless-ngx v3.2.1 recipe. */
export async function verifyPaperlessAdmin(origin: string, username: string,
  password: string): Promise<{ userId: number; username: string }> {
  if (!/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(origin)
    || !/^[A-Za-z0-9._-]{1,32}$/.test(username)
    || !/^[A-Za-z0-9_-]{43,172}$/.test(password)) {
    throw new Error("Paperless admin probe needs the exact local origin and managed account");
  }
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const url = `${origin}/api/users/?username=${encodeURIComponent(username)}&page_size=2`;
  const response = await fetch(url, {
    method: "GET", headers: { Authorization: authorization, Accept: "application/json" },
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== 200) {
    throw new Error(`Paperless admin API returned HTTP ${response.status}`);
  }
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > 128 * 1024) throw new Error("Paperless admin API response is too large");
  const body = await response.text();
  if (body.length > 128 * 1024) throw new Error("Paperless admin API response is too large");
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error("Paperless admin API returned invalid JSON");
  }
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { results?: unknown }).results)) {
    throw new Error("Paperless admin API returned an unexpected user list");
  }
  const users = (payload as { results: unknown[] }).results;
  const matching = users.filter((user): user is { id: number; username: string;
    is_superuser: boolean; is_active: boolean } => {
    if (!user || typeof user !== "object") return false;
    const candidate = user as Record<string, unknown>;
    return candidate.username === username && Number.isSafeInteger(candidate.id)
      && candidate.is_superuser === true && candidate.is_active === true;
  });
  if (matching.length !== 1) {
    throw new Error("Managed Paperless credentials did not prove one active superuser account");
  }
  return { userId: matching[0].id, username };
}
