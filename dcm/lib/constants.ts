import type { DockerSettings } from "@/components/settings-panel"

export const DEFAULT_SETTINGS: DockerSettings = {
  configPath: "/opt/appdata/config",
  dataPath: "/opt/appdata/data",
  timezone: "UTC",
  puid: "1000",
  pgid: "1000",
  umask: "022",
  restartPolicy: "unless-stopped",
  networkMode: "bridge",
  containerNamePrefix: "",
}

// LocalStorage keys
export const STORAGE_KEYS = {
  SELECTED_TOOLS: "dockerComposeSelectedTools",
  SETTINGS: "dockerComposeSettings",
}
