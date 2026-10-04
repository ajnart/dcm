export const links = [
  { source: "seerr", target: "sonarr", kind: "request-manager", name: "Sonarr", targetPort: 8989, root: "/data/media/tv" },
  { source: "seerr", target: "radarr", kind: "request-manager", name: "Radarr", targetPort: 7878, root: "/data/media/movies" },
] as const;
