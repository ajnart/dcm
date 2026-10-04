type HostConfig = Record<string, unknown> & {
  id: number;
  authenticationMethod: string;
  authenticationRequired: string;
  username: string | null;
};

async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(15_000), redirect: "manual" });
  } catch {
    throw new Error("Prowlarr did not respond on its exact loopback endpoint");
  }
}

export async function prowlarrHostConfig(origin: string, apiKey: string): Promise<HostConfig> {
  const response = await request(`${origin}/api/v1/config/host`, {
    headers: { "X-Api-Key": apiKey },
  });
  if (response.status !== 200) throw new Error("Prowlarr host configuration could not be read");
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error("Prowlarr host configuration was not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Prowlarr host configuration was not an object");
  }
  const config = value as HostConfig;
  if (!Number.isSafeInteger(config.id) || config.id < 1
    || typeof config.authenticationMethod !== "string"
    || typeof config.authenticationRequired !== "string"
    || (config.username !== null && typeof config.username !== "string")) {
    throw new Error("Prowlarr host configuration omitted required authentication fields");
  }
  return config;
}

export async function configureProwlarrAdmin(origin: string, apiKey: string,
  current: HostConfig, username: string, password: string): Promise<void> {
  const response = await request(`${origin}/api/v1/config/host/${current.id}`, {
    method: "PUT",
    headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ ...current, authenticationMethod: "forms",
      authenticationRequired: "enabled", username, password,
      passwordConfirmation: password }),
  });
  if (response.status !== 200 && response.status !== 202) {
    throw new Error("Prowlarr did not confirm the exact host authentication update");
  }
}

export type ProwlarrLoginResult = {
  verified: boolean;
  stage: "anonymous-gate" | "login-submit" | "cookie-readback" | "verified";
  anonymousStatus: number;
  anonymousRedirectPath: string | null;
  loginStatus: number | null;
  loginRedirectPath: string | null;
  cookiePresent: boolean;
  authenticatedStatus: number | null;
  authenticatedRedirectPath: string | null;
};

function redirectPath(response: Response, origin: string): string | null {
  const location = response.headers.get("location");
  if (!location) return null;
  try {
    const target = new URL(location, origin);
    if (target.origin !== origin) return null;
    return target.pathname;
  } catch {
    return null;
  }
}

export async function verifyProwlarrLogin(origin: string, username: string,
  password: string): Promise<ProwlarrLoginResult> {
  const anonymous = await request(`${origin}/`, { method: "GET" });
  const anonymousRedirectPath = redirectPath(anonymous, origin);
  const result: ProwlarrLoginResult = {
    verified: false, stage: "anonymous-gate", anonymousStatus: anonymous.status,
    anonymousRedirectPath, loginStatus: null, loginRedirectPath: null,
    cookiePresent: false, authenticatedStatus: null, authenticatedRedirectPath: null,
  };
  if ((anonymous.status !== 302 && anonymous.status !== 303)
    || anonymousRedirectPath !== "/login") return result;

  const form = new FormData();
  form.set("username", username);
  form.set("password", password);
  const login = await request(`${origin}/login`, { method: "POST", body: form });
  result.stage = "login-submit";
  result.loginStatus = login.status;
  result.loginRedirectPath = redirectPath(login, origin);
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
  result.cookiePresent = /^[^=;\s]+=[^;\r\n]+$/.test(cookie);
  if ((login.status !== 302 && login.status !== 303)
    || result.loginRedirectPath === null || result.loginRedirectPath === "/login"
    || !result.cookiePresent) return result;
  const authenticated = await request(`${origin}/`, {
    method: "GET", headers: { Cookie: cookie },
  });
  result.stage = "cookie-readback";
  result.authenticatedStatus = authenticated.status;
  result.authenticatedRedirectPath = redirectPath(authenticated, origin);
  if (authenticated.status === 200) {
    result.verified = true;
    result.stage = "verified";
  }
  return result;
}
