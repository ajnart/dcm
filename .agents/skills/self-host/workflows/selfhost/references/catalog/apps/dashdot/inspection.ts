import { appliedStatus, setupRecord, type SetupInspectionContext } from "../../types/setup";

type InspectionContext = Pick<SetupInspectionContext, "appId" | "projectRoot" | "status" | "http">;

/** API observation only. Never use this as first-run or host-metric acceptance. */
export async function inspectDashdotApi(context: InspectionContext,
  options: { boundedProfile?: boolean } = {}) {
  if (context.appId !== "dashdot") throw new Error("Dashdot inspection received another app");
  appliedStatus(context, await context.status());

  async function read(path: string): Promise<unknown> {
    const response = await context.http.request({ method: "GET", path });
    if (response.status !== 200 || !response.ok) {
      throw new Error("Dashdot documented API is unavailable");
    }
    return response.json();
  }

  // Pinned server index.ts returns version.json alongside CONFIG here.
  const configuration = setupRecord(await read("/config"), "Dashdot configuration");
  const config = setupRecord(configuration.config, "Dashdot configuration values");
  if (configuration.version !== "6.3.4" || config.disable_integrations !== false
    || !Array.isArray(config.widget_list)
    || !config.widget_list.includes("cpu") || !config.widget_list.includes("ram")) {
    throw new Error("Dashdot API does not match its pinned CPU/RAM observation contract");
  }
  if (options.boundedProfile && (config.running_in_docker !== false
    || config.disable_background_stats_collection !== true
    || config.enable_cpu_temps !== false
    || config.widget_list.length !== 2
    || !config.widget_list.includes("ram"))) {
    throw new Error("Dashdot does not match its bounded CPU/RAM runtime profile");
  }
  const info = setupRecord(await read("/info"), "Dashdot information");
  const cpu = setupRecord(info.cpu, "Dashdot CPU information");
  const ram = setupRecord(info.ram, "Dashdot RAM information");
  if (typeof cpu.model !== "string" || !cpu.model.trim()
    || !Number.isSafeInteger(cpu.threads) || (cpu.threads as number) < 1
    || typeof ram.size !== "number" || !Number.isFinite(ram.size) || ram.size <= 0) {
    throw new Error("Dashdot static CPU/RAM information is incomplete");
  }
  const cpuLoad = await read("/load/cpu");
  if (!Array.isArray(cpuLoad) || cpuLoad.length === 0) {
    throw new Error("Dashdot CPU load is unavailable");
  }
  const cores = new Set<number>();
  for (const value of cpuLoad) {
    const sample = setupRecord(value, "Dashdot CPU load sample");
    if (!Number.isSafeInteger(sample.core) || (sample.core as number) < 0
      || cores.has(sample.core as number)
      || typeof sample.load !== "number" || !Number.isFinite(sample.load)
      || sample.load < 0 || sample.load > 100) {
      throw new Error("Dashdot CPU load is invalid");
    }
    cores.add(sample.core as number);
  }
  if (options.boundedProfile && (cores.size !== cpu.threads
    || [...cores].some((core) => core >= (cpu.threads as number)))) {
    throw new Error("Dashdot CPU samples do not cover its reported threads");
  }
  const ramLoad = setupRecord(await read("/load/ram"), "Dashdot RAM load");
  if (typeof ramLoad.load !== "number" || !Number.isFinite(ramLoad.load) || ramLoad.load < 0) {
    throw new Error("Dashdot RAM load is invalid");
  }
  if (options.boundedProfile && ramLoad.load > ram.size) {
    throw new Error("Dashdot RAM load exceeds its reported total");
  }
  // Do not return raw host inventory, create credentials, or mark setup ready.
  return {
    appId: "dashdot" as const,
    stage: "api-contract-observed" as const,
    version: "6.3.4" as const,
    hostMetricsVerified: false as const,
    homarrVerified: false as const,
  };
}
