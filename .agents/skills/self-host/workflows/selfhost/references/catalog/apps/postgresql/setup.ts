import { appliedStatus, type SetupAdapter, type SetupContext, type SetupRecord } from "../../types/setup";

const APP_ID = "postgresql";
const USERNAME = "postgres";

async function verifyPassword(context: SetupContext): Promise<void> {
  const password = await context.secrets.readAdminPassword();
  if (password.length < 32 || password.length > 128 || !/^[A-Za-z0-9]+$/.test(password)) {
    throw new Error("PostgreSQL has no valid saved administrator password");
  }
  // -h forces TCP rather than the image's potentially trusted local socket.
  // Both password attempts stay inside the exact owned container; the real one enters only via stdin.
  const script = "IFS= read -r PGPASSWORD; "
    + "if PGPASSWORD=wrong-$PGPASSWORD PGPASSFILE=/dev/null psql -w -h 127.0.0.1 -U postgres -d postgres -tA -c 'SELECT current_user' >/dev/null 2>&1; then exit 23; fi; "
    + "export PGPASSWORD; PGPASSFILE=/dev/null exec psql -w -h 127.0.0.1 -U postgres -d postgres -tA -c 'SELECT current_user'";
  const result = await context.container.exec({
    effect: "read",
    argv: ["sh", "-ec", script], stdin: `${password}\n`,
    approval: { action: "postgresql-auth-query",
      progress: "Reject a wrong password, then verify the saved PostgreSQL administrator with a read-only TCP query" },
  });
  if (result.exitCode !== 0 || result.stdout.trim() !== USERNAME) {
    throw new Error("PostgreSQL did not prove authenticated administrator access");
  }
}

const setup: SetupAdapter = {
  appId: APP_ID,
  credentialCommand: "app handoff",
  apiKey: "not-created",
  healthSource: "pg_isready (readiness only)",
  homarrIntegration: null,
  ready(record: SetupRecord) {
    return record.appId === APP_ID && record.stage === "tcp-admin-auth-verified"
      && record.username === USERNAME && record.credentialRef === "app handoff";
  },
  async firstRun(context) {
    if (context.appId !== APP_ID) throw new Error("PostgreSQL setup received a different app ID");
    appliedStatus(context, await context.status());
    await verifyPassword(context);
    return { appId: APP_ID, projectRoot: context.projectRoot, stage: "tcp-admin-auth-verified",
      username: USERNAME, credentialRef: "app handoff" };
  },
};

export default setup;
