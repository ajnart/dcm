type BootstrapInput = {
  origin: string;
  email: string;
  name: string;
  password: string;
};

type BootstrapResult =
  | { status: "bootstrapped" | "already-initialized"; loginVerified: true }
  | { status: "browser-fallback-required"; loginVerified: false; reason: string };

export async function inspectInitialization(origin: string): Promise<boolean | null> {
  try {
    const response = await fetch(`${origin}/api/server/config`, {
      signal: AbortSignal.timeout(8000), redirect: "error",
    });
    if (response.status !== 200) { await response.body?.cancel(); return null; }
    const text = await response.text();
    if (Buffer.byteLength(text) > 64 * 1024) return null;
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || typeof value.isInitialized !== "boolean") return null;
    return value.isInitialized;
  } catch {
    return null;
  }
}

async function postPrivateBody(origin: string, path: string, body: Record<string, string>): Promise<number | null> {
  try {
    const response = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    const status = response.status;
    await response.body?.cancel();
    return status;
  } catch {
    return null;
  }
}

export async function verifyLogin(origin: string, email: string, password: string): Promise<boolean> {
  const status = await postPrivateBody(origin, "/api/auth/login", { email, password });
  return status === 201;
}

export async function bootstrapImmichAdmin(input: BootstrapInput): Promise<BootstrapResult> {
  const initialized = await inspectInitialization(input.origin);
  if (initialized === null) {
    return { status: "browser-fallback-required", loginVerified: false,
      reason: "Immich setup state could not be confirmed; no signup request was sent." };
  }
  if (initialized) {
    const loginVerified = await verifyLogin(input.origin, input.email, input.password);
    if (!loginVerified) {
      return { status: "browser-fallback-required", loginVerified: false,
        reason: "Immich is initialized, but the managed admin login could not be verified; signup was not retried." };
    }
    return { status: "already-initialized", loginVerified: true };
  }
  const status = await postPrivateBody(input.origin, "/api/auth/admin-sign-up", {
    email: input.email, name: input.name, password: input.password,
  });
  const nowInitialized = await inspectInitialization(input.origin);
  let loginVerified = false;
  if (nowInitialized === true) loginVerified = await verifyLogin(input.origin, input.email, input.password);
  if (status !== 201 || nowInitialized !== true || !loginVerified) {
    return { status: "browser-fallback-required", loginVerified: false,
      reason: "Headless admin bootstrap was not fully confirmed; it will not be retried blindly." };
  }
  return { status: "bootstrapped", loginVerified: true };
}
