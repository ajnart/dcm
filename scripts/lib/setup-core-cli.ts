import { setupCoreService } from "../bootstrap-core.ts";
import { runManagedSetup } from "./setup-handoff.ts";

export async function runCoreService(service) {
  if (Bun.argv.length !== 3) {
    console.error(`usage: setup-${service}.ts RUN_ID`);
    process.exitCode = 2;
    return;
  }
  await runManagedSetup(
    Bun.argv[2], service, `${service} authentication and connections`,
    async () => setupCoreService(Bun.argv[2], service),
  );
}
