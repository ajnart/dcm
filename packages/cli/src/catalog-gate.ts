import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { householdCatalogSupported } from "./interactive-household.ts";
import { mediaCatalogSupported } from "./interactive-catalog.ts";

const routerCandidates = [
  new URL("./workflows/selfhost/scripts/selfhost.js", import.meta.url),
  new URL("../dist/workflows/selfhost/scripts/selfhost.js", import.meta.url),
];

function routerData(args: string[], feature: string): Record<string, unknown> {
  const router = routerCandidates.find((candidate) => existsSync(fileURLToPath(candidate)));
  if (!router) throw new Error("The packaged catalog router is missing. Rebuild or reinstall the CLI before preparing a new setup.");
  const result = spawnSync(process.execPath, [fileURLToPath(router), ...args, "--json"], {
    encoding: "utf8", timeout: 10000, maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? result.stderr.trim().slice(0, 300);
    throw new Error(`The ${feature} install feature is unavailable or its catalog is invalid. Run self-host catalog validate before preparing a new setup. ${detail}`);
  }
  let output: unknown;
  try { output = JSON.parse(result.stdout); }
  catch { throw new Error("The packaged catalog did not return a valid review result."); }
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw new Error("The packaged catalog did not return a valid review result.");
  }
  const envelope = output as { status?: unknown; data?: unknown };
  if (envelope.status !== "pass" || !envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) {
    throw new Error("The packaged catalog did not pass validation.");
  }
  return envelope.data as Record<string, unknown>;
}

export type FixedInstaller = "media" | "household";

export async function installPlanSupported(installer: FixedInstaller): Promise<boolean> {
  const created = await mkdtemp(join(tmpdir(), "selfhost-catalog-gate-"));
  try {
    const root = await realpath(created);
    const goals = installer === "media"
      ? ["personal-media"]
      : ["personal-media", "photos", "private-notes", "passwords"];
    const args = ["plan", ...goals, "--project-root", root];
    if (installer === "household") args.push("--compose");
    const data = routerData(args, installer);
    if (installer === "media") return mediaCatalogSupported(data);
    return householdCatalogSupported(data);
  } finally {
    await rm(created, { recursive: true, force: true });
  }
}

export async function requireInstallPlan(installer: FixedInstaller): Promise<void> {
  if (!(await installPlanSupported(installer))) {
    throw new Error(`The ${installer} installer no longer matches this catalog's default apps and adapters. Review the plan or restore its supported app folders before preparing a new setup.`);
  }
}

export function requireAppCliSetup(appId: string): void {
  const data = routerData(["catalog", "show", appId], appId);
  const app = data.app;
  if (!app || typeof app !== "object" || Array.isArray(app)) {
    throw new Error(`The ${appId} CLI setup feature is unavailable in this catalog.`);
  }
  const record = app as Record<string, unknown>;
  const setup = record.cliSetup;
  if (!setup || typeof setup !== "object" || Array.isArray(setup)
    || (setup as Record<string, unknown>).command !== appId) {
    throw new Error(`The ${appId} CLI setup feature is unavailable in this catalog.`);
  }
}
