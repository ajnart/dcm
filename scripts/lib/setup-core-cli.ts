import { setupCoreService } from "../bootstrap-core.ts";

export async function runCoreService(service) {
  if (Bun.argv.length !== 3) {
    console.error(`usage: setup-${service}.ts RUN_ID`);
    process.exitCode = 2;
    return;
  }
  try {
    const result = await setupCoreService(Bun.argv[2], service);
    console.log(`PASS ${result}`);
  } catch {
    console.error(`FAIL ${service} API setup; run session doctor RUN_ID for diagnostics`);
    process.exitCode = 1;
  }
}
