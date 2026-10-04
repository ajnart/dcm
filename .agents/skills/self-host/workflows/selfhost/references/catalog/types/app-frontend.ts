export type AppFrontend =
  | { kind: "web"; protocol: "http" | "https" }
  | { kind: "tcp"; protocol: "postgresql" | "redis" }
  | { kind: "none" };

/** Omission preserves the legacy HTTP presentation contract, not reachability. */
export function checkedAppFrontend(value: unknown): AppFrontend | null {
  if (value === undefined) return { kind: "web", protocol: "http" };
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(",");
  if (record.kind === "none" && keys === "kind") return { kind: "none" };
  if (keys !== "kind,protocol") return null;
  if (record.kind === "web" && (record.protocol === "http" || record.protocol === "https")) {
    return { kind: "web", protocol: record.protocol };
  }
  if (record.kind === "tcp" && (record.protocol === "postgresql" || record.protocol === "redis")) {
    return { kind: "tcp", protocol: record.protocol };
  }
  return null;
}
