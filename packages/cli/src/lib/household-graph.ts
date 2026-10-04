type GraphJob = {
  id: string;
  needs: string[];
  gates: string[];
  owner: string;
  apps: string[];
};

const mediaApps = ["homarr", "jellyfin", "seerr", "sonarr", "radarr", "prowlarr", "qbittorrent"];
const expected: GraphJob[] = [
  { id: "media", needs: [], gates: ["fresh-host-inspection", "exact-apply-approval"],
    owner: "selfhost-media", apps: mediaApps },
  { id: "app-immich", needs: ["media"],
    gates: ["fresh-host-inspection", "exact-apply-approval", "media-web-network-bound"],
    owner: "selfhost-compose", apps: ["immich"] },
  { id: "app-docmost", needs: ["media"],
    gates: ["fresh-host-inspection", "exact-apply-approval", "media-web-network-bound"],
    owner: "selfhost-compose", apps: ["docmost"] },
  { id: "app-vaultwarden", needs: ["media"],
    gates: ["fresh-host-inspection", "exact-apply-approval", "private-https-before-signup",
      "first-account-before-registration-closure"],
    owner: "selfhost-compose", apps: ["vaultwarden"] },
  { id: "homarr-attachments",
    needs: ["media", "app-immich", "app-docmost", "app-vaultwarden"],
    gates: ["fresh-host-inspection", "exact-apply-approval", "direct-app-acceptance"],
    owner: "selfhost-homarr", apps: ["immich", "docmost", "vaultwarden"] },
];

export function exactHouseholdParallelGraph(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  if (!plan.workflow || typeof plan.workflow !== "object" || Array.isArray(plan.workflow)) return false;
  const graph = plan.workflow as Record<string, unknown>;
  if (graph.mode !== "planning-only" || !Array.isArray(graph.jobs)
    || JSON.stringify(graph.jobs) !== JSON.stringify(expected)) return false;
  if (JSON.stringify(graph.parallelGroups) !== JSON.stringify([
    { needs: ["media"], jobs: ["app-immich", "app-docmost"] },
  ])) return false;
  return JSON.stringify(graph.parallelCandidates) === JSON.stringify(["app-immich", "app-docmost"]);
}

export function approvedHouseholdParallelJobs(value: unknown): Array<{ id: string; needs: string[]; service: "immich" | "docmost" }> | null {
  if (!exactHouseholdParallelGraph(value)) return null;
  const graph = (value as { workflow: { jobs: GraphJob[]; parallelGroups: Array<{ jobs: string[] }> } }).workflow;
  const services = new Map([["app-immich", "immich"], ["app-docmost", "docmost"]] as const);
  return graph.parallelGroups[0].jobs.map((id) => ({
    id, needs: graph.jobs.find((job) => job.id === id)!.needs,
    service: services.get(id as "app-immich" | "app-docmost")!,
  }));
}
