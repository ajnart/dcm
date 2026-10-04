import { isAbsolute } from "node:path";

import { appliedStatus, type SetupAdapter, type SetupContext, type SetupRecord } from "../../types/setup";

const APP_ID = "lldap";

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

async function verifyAdmin(context: SetupContext): Promise<SetupRecord> {
  if (context.appId !== APP_ID || !isAbsolute(context.projectRoot)) {
    throw new Error("LLDAP setup received a different app project");
  }
  const password = await context.secrets.readAdminPassword();
  if (password.length < 32 || password.length > 256 || /[\r\n\u0000]/.test(password)) {
    throw new Error("LLDAP has no valid generated administrator password");
  }

  // https://github.com/lldap/lldap/blob/main/docs/scripting.md#getting-a-token
  const login = await context.http.request({
    method: "POST",
    path: "/auth/simple/login",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password }),
    approval: { action: "lldap-admin-login", progress: "Verify the saved LLDAP administrator on the exact private origin" },
  });
  if (!login.ok || login.status !== 200) {
    throw new Error("LLDAP rejected its generated administrator credential");
  }
  const token = object(await login.json(), "LLDAP login response").token;
  if (typeof token !== "string" || token.length < 16 || token.length > 8192
    || !/^[A-Za-z0-9_.-]+$/.test(token)) {
    throw new Error("LLDAP did not return a valid authentication token");
  }

  // The documented GraphQL query and schema provide a read-only identity check.
  const user = await context.http.request({
    method: "POST",
    path: "/api/graphql",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: '{ user(userId: "admin") { id groups { displayName } } }' }),
    approval: { action: "lldap-admin-read", progress: "Read back the administrator identity and admin-group membership through LLDAP GraphQL" },
  });
  if (!user.ok || user.status !== 200) {
    throw new Error("LLDAP authenticated administrator read failed");
  }
  const result = object(await user.json(), "LLDAP GraphQL response");
  if (result.errors !== undefined) throw new Error("LLDAP administrator query returned errors");
  const account = object(object(result.data, "LLDAP GraphQL data").user, "LLDAP administrator");
  // Regular users can read themselves. The username alone does not prove
  // administrator authority after a saved account has been demoted.
  if (account.id !== "admin" || !Array.isArray(account.groups)
    || !account.groups.some((group) => group && typeof group === "object"
      && !Array.isArray(group) && (group as Record<string, unknown>).displayName === "lldap_admin")) {
    throw new Error("LLDAP did not confirm the saved administrator identity");
  }
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: "admin-login-verified", adminUsername: "admin" };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  credentialCommand: "app handoff",
  apiKey: "not-created",
  healthSource: null,
  homarrIntegration: null,
  ready(record) {
    return record.appId === APP_ID && record.stage === "admin-login-verified"
      && record.adminUsername === "admin";
  },
  async firstRun(context) {
    appliedStatus(context, await context.status());
    return verifyAdmin(context);
  },
};

export default adapter;
