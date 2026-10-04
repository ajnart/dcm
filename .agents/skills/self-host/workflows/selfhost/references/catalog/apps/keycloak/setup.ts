import { appliedStatus, setupRecord, type SetupAdapter, type SetupContext, type SetupRecord } from "../../types/setup";

const APP_ID = "keycloak";
const TOKEN_PATH = "/realms/master/protocol/openid-connect/token";

async function verifyAdmin(context: SetupContext): Promise<SetupRecord> {
  if (context.appId !== APP_ID) throw new Error("Keycloak setup received a different app ID");
  appliedStatus(context, await context.status());
  const checkpoint = await context.checkpoint.read();
  if (checkpoint && (checkpoint.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot
    || checkpoint.stage !== "admin-auth-verified" || typeof checkpoint.data.adminId !== "string"
    || typeof checkpoint.data.realmId !== "string")) {
    throw new Error("Keycloak has an unrecognized administrator identity checkpoint");
  }
  const password = await context.secrets.readAdminPassword();
  if (password.length < 32 || password.length > 128 || !/^[A-Za-z0-9]+$/.test(password)) {
    throw new Error("Keycloak has no valid saved administrator password");
  }
  const body = new URLSearchParams({ client_id: "admin-cli", username: "admin", password, grant_type: "password" });
  const tokenResponse = await context.http.request({
    method: "POST", path: TOKEN_PATH,
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
    approval: { action: "keycloak-verify-admin-login", progress: "Verify the saved Keycloak administrator on the exact private origin" },
  });
  if (tokenResponse.status !== 200) throw new Error("Keycloak rejected the saved administrator credential");
  const tokenValue = await tokenResponse.json();
  if (!tokenValue || typeof tokenValue !== "object" || Array.isArray(tokenValue)) {
    throw new Error("Keycloak returned an invalid administrator token response");
  }
  const token = (tokenValue as Record<string, unknown>).access_token;
  if (typeof token !== "string" || !token || token.length > 16384) {
    throw new Error("Keycloak returned no bounded administrator access token");
  }
  const realmResponse = await context.http.request({
    method: "GET", path: "/admin/realms/master",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (realmResponse.status !== 200) throw new Error("Keycloak administrator could not read the master realm");
  const realmValue = setupRecord(await realmResponse.json(), "Keycloak master realm");
  if (realmValue.realm !== "master" || typeof realmValue.id !== "string"
    || !/^[A-Za-z0-9_-]{1,128}$/.test(realmValue.id)) {
    throw new Error("Keycloak returned no authenticated master realm");
  }
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const usersResponse = await context.http.request({ method: "GET", path: "/admin/realms/master/users",
    query: { username: "admin", exact: "true" }, headers });
  if (usersResponse.status !== 200) throw new Error("Keycloak administrator identity is unavailable");
  const users = await usersResponse.json();
  if (!Array.isArray(users) || users.length !== 1) {
    throw new Error("Keycloak returned no unique exact administrator");
  }
  const user = setupRecord(users[0], "Keycloak administrator");
  if (user.username !== "admin" || user.enabled !== true || typeof user.id !== "string"
    || !/^[A-Za-z0-9_-]{1,128}$/.test(user.id)) {
    throw new Error("Keycloak returned no enabled exact administrator");
  }
  // Reading a realm alone also succeeds for delegated view-only administrators.
  // ApplianceBootstrap grants the initial owner this master-realm admin role.
  const rolesResponse = await context.http.request({ method: "GET",
    path: `/admin/realms/master/users/${user.id}/role-mappings/realm/composite`, headers });
  if (rolesResponse.status !== 200) throw new Error("Keycloak administrator roles are unavailable");
  const roles = await rolesResponse.json();
  if (!Array.isArray(roles) || !roles.some((role) => role && typeof role === "object"
    && role.name === "admin" && role.clientRole === false && role.containerId === realmValue.id)) {
    throw new Error("Keycloak saved login is not a master-realm administrator");
  }
  if (checkpoint && (checkpoint.data.adminId !== user.id || checkpoint.data.realmId !== realmValue.id)) {
    throw new Error("Keycloak administrator identity changed; do not adopt the replacement");
  }
  if (!checkpoint) {
    await context.checkpoint.compareAndSet({ expectedRevision: null, stage: "admin-auth-verified",
      data: { adminId: user.id, realmId: realmValue.id } });
  }
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: "admin-auth-verified",
    adminUsername: "admin", adminId: user.id, realmId: realmValue.id,
    adminRoleVerified: true, passwordLoginVerified: true,
    credentialRef: "app handoff", productionEdgeVerified: false };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  sharedOwner: true,
  credentialCommand: "app handoff",
  apiKey: "not-created",
  healthSource: null,
  homarrIntegration: null,
  ready(record) {
    return record.appId === APP_ID && record.stage === "admin-auth-verified"
      && record.adminUsername === "admin" && record.adminRoleVerified === true
      && typeof record.adminId === "string" && typeof record.realmId === "string"
      && record.productionEdgeVerified === false;
  },
  firstRun: verifyAdmin,
};

export default adapter;
