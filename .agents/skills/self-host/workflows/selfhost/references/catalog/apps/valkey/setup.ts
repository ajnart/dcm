import { appliedStatus, type SetupAdapter, type SetupContext, type SetupRecord } from "../../types/setup";

const APP_ID = "valkey";

async function verify(context: SetupContext): Promise<SetupRecord> {
  if (context.appId !== APP_ID) throw new Error("Valkey setup received a different app ID");
  appliedStatus(context, await context.status());
  const result = await context.container.exec({
    effect: "read",
    argv: ["valkey-cli", "-h", "127.0.0.1", "-p", "6379", "PING"],
    approval: { action: "valkey-private-ping", progress: "Verify local Valkey PING in the exact owned container" },
  });
  if (result.exitCode !== 0 || result.stdout.trim() !== "PONG") {
    throw new Error("Valkey did not return PONG from its exact owned container");
  }
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: "local-ping-ready",
    peerAccessVerified: false, authenticationConfigured: false };
}

const setup: SetupAdapter = {
  appId: APP_ID,
  sharedOwner: true,
  credentialCommand: "app handoff",
  apiKey: "not-created",
  healthSource: "valkey-cli PING in the exact owned container (local readiness only)",
  homarrIntegration: null,
  ready(record) {
    return record.appId === APP_ID && record.stage === "local-ping-ready"
      && record.peerAccessVerified === false && record.authenticationConfigured === false;
  },
  firstRun: verify,
};

export default setup;
