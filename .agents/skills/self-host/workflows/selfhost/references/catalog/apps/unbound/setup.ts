import { appliedStatus, type SetupAdapter, type SetupContext, type SetupRecord } from "../../types/setup";

const APP_ID = "unbound";
const NAME = "nlnetlabs.nl";

async function verifyQuery(context: SetupContext, protocol: "udp" | "tcp"): Promise<void> {
  const argv = ["drill"];
  if (protocol === "tcp") argv.push("-t");
  argv.push("-p", "5335", "@127.0.0.1", NAME, "A");
  const result = await context.container.exec({
    effect: "read",
    argv,
    approval: {
      action: `unbound-local-${protocol}-query`,
      progress: `Verify a fixed ${protocol.toUpperCase()} DNS query inside the exact owned Unbound container`,
    },
  });
  const answer = result.stdout.match(/^nlnetlabs\.nl\.\s+\d+\s+IN\s+A\s+\d{1,3}(?:\.\d{1,3}){3}\s*$/m);
  if (result.exitCode !== 0 || !/rcode:\s*NOERROR\b/.test(result.stdout) || !answer) {
    throw new Error(`Unbound did not answer the fixed local ${protocol.toUpperCase()} DNS query`);
  }
}

const setup: SetupAdapter = {
  appId: APP_ID,
  sharedOwner: true,
  credentialCommand: "app handoff",
  apiKey: "not-created",
  healthSource: "drill UDP and TCP queries to 127.0.0.1:5335 inside the exact owned container",
  homarrIntegration: null,
  ready(record: SetupRecord) {
    return record.appId === APP_ID && record.stage === "local-dns-ready"
      && record.hostReachabilityVerified === false && record.peerReachabilityVerified === false;
  },
  async firstRun(context) {
    if (context.appId !== APP_ID) throw new Error("Unbound setup received a different app ID");
    appliedStatus(context, await context.status());
    await verifyQuery(context, "udp");
    await verifyQuery(context, "tcp");
    return { appId: APP_ID, projectRoot: context.projectRoot, stage: "local-dns-ready",
      hostReachabilityVerified: false, peerReachabilityVerified: false };
  },
};

export default setup;
