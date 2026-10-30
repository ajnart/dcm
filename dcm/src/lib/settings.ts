import { selfHostGlobals } from "./selfhost"

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

function globalDefault(key: string): string {
  const entry = selfHostGlobals.find((variable) => variable.key === key)
  if (!entry) throw new Error(`selfhost.json has no global ${key}`)
  return entry.default
}

export const DEFAULT_SETTINGS: DockerSettings = {
  configPath: globalDefault("CONFIG_PATH"),
  dataPath: globalDefault("DATA_PATH"),
  timezone: globalDefault("TZ"),
  puid: globalDefault("PUID"),
  pgid: globalDefault("PGID"),
  umask: globalDefault("UMASK"),
  restartPolicy: globalDefault("RESTART_POLICY"),
  networkMode: "bridge",
  containerNamePrefix: globalDefault("CONTAINER_PREFIX"),
}
