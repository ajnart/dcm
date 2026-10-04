/** Fixed probes are binary/version inspection only, never a data or remote write. */
export function manualJobProbeAllowed(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const probe = value as Record<string, unknown>;
  if (Object.keys(probe).sort().join(",") !== "argv,officialUrl"
    || !Array.isArray(probe.argv) || probe.argv.length !== 2) return false;
  const commands: Record<string, { argument: string; officialUrl: string }> = {
    restic: { argument: "version", officialUrl: "https://github.com/restic/restic/releases/tag/v0.19.1" },
    borgmatic: { argument: "--version", officialUrl: "https://github.com/borgmatic-collective/docker-borgmatic" },
    renovate: { argument: "--version", officialUrl: "https://github.com/renovatebot/renovate/releases/tag/44.132.2" },
  };
  const [binary, argument] = probe.argv;
  if (typeof binary !== "string" || !Object.hasOwn(commands, binary)) return false;
  return argument === commands[binary].argument && probe.officialUrl === commands[binary].officialUrl;
}

export function checkedManualProbe(image: string, value: unknown): { argv: string[]; officialUrl: string } {
  if (!manualJobProbeAllowed(value)) throw new Error("Manual probe must use one fixed official version command");
  const probe = value as { argv: string[]; officialUrl: string };
  const tags: Record<string, string> = {
    restic: "ghcr.io/restic/restic:0.19.1",
    borgmatic: "ghcr.io/borgmatic-collective/borgmatic:2.1.8",
    renovate: "ghcr.io/renovatebot/renovate:44.132.2",
  };
  const tag = tags[probe.argv[0]];
  if (typeof image !== "string" || !image.startsWith(`${tag}@sha256:`)
    || !/^sha256:[0-9a-f]{64}$/.test(image.slice(tag.length + 1))) {
    throw new Error("Manual probe must match its exact pinned publisher image");
  }
  return { argv: [...probe.argv], officialUrl: probe.officialUrl };
}
