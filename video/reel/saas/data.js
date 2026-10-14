// The five swaps. Name, category and port come from the Catalog (self-host apps list --json: Immich 2283, Syncthing 8384,
// Nextcloud 8080, Home Assistant 8123, Uptime Kuma 3001); the Address is the Home network one at the reel's LAN address.
// Setup follows internal/apps:
//   immich          firstadmin Create: admin-sign-up through the API, so Status is ok
//   syncthing       firstadmin Create: PATCH /rest/config/gui sets the web login, so Status is ok
//   nextcloud       the administrator's sign-in is verified and its Addresses trusted, so Status is ok
//   home-assistant  firstadmin Create: /api/onboarding/users makes the owner, but the core_config, analytics and
//                   integration choices stay a Manual step, so Status is attention until a person finishes them
//   uptime-kuma     no HTTP setup API: the first administrator is a Manual step, so Status is attention
// service.Level: a Manual step makes Status attention (yellow), never ok.
export const LAN = "192.168.1.20";
export const SWAPS = [
  { id: "immich", name: "Immich", category: "Photos", port: 2283, tile: "Photos", was: "Google Photos", wasIcon: "google-photos", pills: [["ok", "Admin created"]], level: "ok" },
  { id: "syncthing", name: "Syncthing", category: "Files", port: 8384, tile: "Dropbox", was: "Dropbox", wasIcon: "dropbox", pills: [["ok", "Web login set"]], level: "ok" },
  { id: "nextcloud", name: "Nextcloud", category: "Files", port: 8080, tile: "Drive", was: "Google Drive", wasIcon: "google-drive", pills: [["ok", "Admin login ready"]], level: "ok" },
  { id: "home-assistant", name: "Home Assistant", category: "Home automation", port: 8123, tile: "Smart home", was: "cloud smart-home apps", wasIcon: null, pills: [["ok", "Owner created"], ["warn", "Finish in browser"]], level: "attention" },
  { id: "uptime-kuma", name: "Uptime Kuma", category: "Monitoring", port: 3001, tile: "UptimeRobot", was: "UptimeRobot", wasIcon: "uptimerobot", pills: [["warn", "Finish in browser"]], level: "attention" },
];
export const address = (s) => `${LAN}:${s.port}`;

export const HOME = `<svg class="gl" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/></svg>`;
export const wasFace = (s) => (s.wasIcon ? `<img src="assets/icons/${s.wasIcon}.svg">` : `<div class="gi">${HOME}</div>`);
