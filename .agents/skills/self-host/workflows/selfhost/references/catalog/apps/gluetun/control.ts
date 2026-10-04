import type { PrivateConfigDeclaration } from "../../types/private-config-environment.ts";
import type { SetupHttpReadRequest, SetupHttpResponse } from "../../types/setup.ts";
import { generatedPrivateFileLength } from "../../types/private-file.ts";

export const GLUETUN_AUTH_SOURCE = "https://github.com/passteque/gluetun/blob/v3.41.3/internal/server/middlewares/auth/settings.go";
export const GLUETUN_CONTROL_ROUTES = ["GET /v1/vpn/status", "GET /v1/publicip/ip", "GET /v1/portforward"] as const;

/** Fragment consumed by the derived recipe's privateConfigs preparation boundary.
 * A nonempty role list replaces the pinned public defaults; omitted routes deny
 * access. No provider, capability, device, namespace or deployment is selected. */
export function gluetunControlConfiguration() {
  const config: PrivateConfigDeclaration = {
    id: "control-auth", officialUrl: GLUETUN_AUTH_SOURCE,
    parts: [
      { literal: `[[roles]]\nname = "private-readonly"\nroutes = ${JSON.stringify(GLUETUN_CONTROL_ROUTES)}\nauth = "apikey"\napikey = ` },
      { literal: '"' },
      { fileId: "control-api-key" }, { literal: '"\n' },
    ],
  };
  return {
    privateFiles: [{ id: "control-api-key", bytes: 32, format: "hex" as const }],
    privateConfigs: [config],
    mountTarget: "/run/secrets/control-auth",
  };
}

type ControlHttp = { request(request: SetupHttpReadRequest): Promise<SetupHttpResponse> };

/** Exact-owner transport and private key are supplied by the caller's approved
 * boundary. This has no URL, filesystem, setup registration or write surface.
 * It verifies control authentication only, never namespace or fail-closed VPN. */
export async function verifyGluetunControl(http: ControlHttp, apiKey: string) {
  if (typeof apiKey !== "string" || apiKey.length !== generatedPrivateFileLength(32, "hex")
    || !/^[0-9a-f]+$/.test(apiKey)) {
    throw new Error("Gluetun control needs the exact generated private key; payload withheld");
  }
  const anonymous = await http.request({ method: "GET", path: "/v1/vpn/status" });
  if (anonymous.status !== 401) {
    throw new Error("Gluetun anonymous control access was not denied");
  }
  const response = await http.request({ method: "GET", path: "/v1/vpn/status", headers: { "X-API-Key": apiKey } });
  if (response.status !== 200) throw new Error("Gluetun saved control key was not accepted");
  const value = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).join(",") !== "status"
    || !["running", "stopped"].includes((value as { status: string }).status)) {
    throw new Error("Gluetun control status differs from the pinned contract");
  }
  return { controlAuthenticationVerified: true, vpnStatus: (value as { status: string }).status,
    writeAuthorizationVerified: false, downloaderNamespaceVerified: false,
    tunnelBreakVerified: false, restartPersistenceVerified: false, ready: false };
}
