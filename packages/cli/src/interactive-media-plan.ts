export type MediaPlan = { approvalDigest: string; bind: string; ports: Record<string, string>; publishedPorts: string };

export function reviewedMediaPlan(value: unknown, exposure: "host-only" | "all-interfaces"): MediaPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Media preparation returned an invalid plan.");
  const plan = value as Record<string, unknown>;
  const expectedBind = exposure === "host-only" ? "127.0.0.1" : "0.0.0.0";
  if (typeof plan.approvalDigest !== "string" || !/^[0-9a-f]{64}$/.test(plan.approvalDigest)
    || plan.bind !== expectedBind || typeof plan.publishedPorts !== "string"
    || !plan.ports || typeof plan.ports !== "object" || Array.isArray(plan.ports)) {
    throw new Error("The prepared approval or exposure differs from the reviewed choices. Do not apply this run.");
  }
  const ports = plan.ports as Record<string, unknown>;
  const names = ["PROWLARR_PORT", "RADARR_PORT", "SONARR_PORT", "QBITTORRENT_PORT", "JELLYFIN_PORT", "SEERR_PORT", "HOMARR_PORT"];
  if (Object.keys(ports).length !== names.length || names.some((name) => !/^[1-9][0-9]{1,4}$/.test(String(ports[name]))
    || Number(ports[name]) > 65535) || new Set(Object.values(ports)).size !== names.length) {
    throw new Error("Media preparation returned an invalid seven-port allocation.");
  }
  return plan as MediaPlan;
}
