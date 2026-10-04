import { Buffer } from "node:buffer";
import { isAbsolute } from "node:path";
import { appliedStatus, type SetupInspectionContext, type SetupRecord } from "../../types/setup.ts";
import { verifyWarriorIdleSnapshot } from "./idle-config.ts";

/** Discovered setup consumes the exact owner HTTP/WebSocket transports.
 * This proves Basic authentication and effective idle, not archival acceptance.
 */
export async function readWarriorIdle(context: SetupInspectionContext): Promise<SetupRecord> {
  if (context.appId !== "archive-team-warrior") throw new Error("Warrior idle readback received another app");
  const status = appliedStatus(context, await context.status());
  if (status.ownerKind !== "shared" || status.username !== "warrior-admin" || status.loginVia !== "http-basic"
    || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)) {
    throw new Error("Warrior idle readback requires the exact saved Basic credential owner");
  }
  await context.secrets.verifyMutableConfigs();
  const password = await context.secrets.readAdminPassword();
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(password)) throw new Error("Warrior saved Basic password is invalid");
  const anonymous = await context.http.request({ method: "GET", path: "/" });
  if (anonymous.status !== 401) throw new Error("Warrior private frontend did not reject anonymous access");
  const authorization = `Basic ${Buffer.from(`warrior-admin:${password}`).toString("base64")}`;
  const authenticated = await context.http.request({ method: "GET", path: "/api/settings",
    headers: { Authorization: authorization } });
  if (authenticated.status !== 200) throw new Error("Warrior did not authenticate its saved Basic identity");
  // Settings HTML contains credentials. Do not consume/report it; prove idle
  // with the source-defined read-only opening snapshot instead.
  const events = await context.webSocket.warriorIdleSnapshot({ path: "/000/auto-stack/websocket", authorization });
  verifyWarriorIdleSnapshot(events);
  return { appId: context.appId, projectRoot: context.projectRoot,
    stage: "basic-login-and-effective-idle-verified", httpUsername: "warrior-admin",
    anonymousDenied: true, selectedProject: "none", effectiveState: "NO_PROJECT",
    hqTrafficDisabled: false, archivalAcceptanceVerified: false, apiKeyCreated: false };
}
