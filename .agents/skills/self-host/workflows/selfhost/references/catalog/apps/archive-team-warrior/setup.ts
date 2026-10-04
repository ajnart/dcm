import type { SetupAdapter } from "../../types/setup.ts";
import { readWarriorIdle } from "./idle-readback.ts";

const adapter: SetupAdapter = {
  appId: "archive-team-warrior", credentialCommand: "app handoff", apiKey: "not-created",
  healthSource: null, homarrIntegration: "ArchiveTeam Warrior",
  ready(record) {
    return record.appId === "archive-team-warrior"
      && record.stage === "basic-login-and-effective-idle-verified"
      && record.httpUsername === "warrior-admin" && record.anonymousDenied === true
      && record.selectedProject === "none" && record.effectiveState === "NO_PROJECT"
      && record.hqTrafficDisabled === false && record.archivalAcceptanceVerified === false
      && record.apiKeyCreated === false;
  },
  firstRun: readWarriorIdle,
  inspect: readWarriorIdle,
};
export default adapter;
