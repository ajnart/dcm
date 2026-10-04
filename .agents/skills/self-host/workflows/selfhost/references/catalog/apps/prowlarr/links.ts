export const links = [
  { source: "prowlarr", target: "sonarr", kind: "application", name: "Sonarr", targetPort: 8989 },
  { source: "prowlarr", target: "radarr", kind: "application", name: "Radarr", targetPort: 7878 },
] as const;
