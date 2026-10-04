// The Compose owner is canonical; CLI and portable skill share one permission policy.
export { assertPrivatePath, protectPrivatePath, privateMode, ownedByCurrentUser }
  from "../../../../.agents/skills/self-host/workflows/selfhost-compose/scripts/platform-private.ts";
