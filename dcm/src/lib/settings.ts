export interface DockerSettings {
  configPath: string
  dataPath: string
  timezone: string
  puid: string
  pgid: string
  umask: string
  restartPolicy: string
  networkMode: string
  containerNamePrefix: string
}

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
