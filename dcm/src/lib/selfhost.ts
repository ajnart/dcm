import data from "../data/selfhost.json"

export const SELFHOST_URL = "https://self-host.fyi"
export const SELFHOST_INSTALL =
  "curl -fsSL https://self-host.fyi/install | bash"
export const SELFHOST_ICON_BASE =
  "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/"

export interface SelfHostEnvVar {
  key: string
  default: string
  description: string
  secret: boolean
}

export interface SelfHostApp {
  id: string
  name: string
  description: string
  category: string
  icon: string
  image: string
  port: number
  docs: string
  links: { target: string; title: string }[]
  compose: string
  env: SelfHostEnvVar[]
  standalone: boolean
  notes?: string
}

export interface SelfHostRecipe {
  id: string
  name: string
  description: string
  apps: string[]
}

export const selfHostApps: SelfHostApp[] = data.apps
export const selfHostRecipes: SelfHostRecipe[] = data.recipes

const appIds = new Set(selfHostApps.map((app) => app.id))

const ALIASES: Record<string, string> = {
  actualbudget: "actual-budget",
  adguardhome: "adguard-home",
  firefly: "firefly-iii",
  homeassistant: "home-assistant",
  jellyseerr: "seerr",
  overseerr: "seerr",
  postgres: "postgresql",
}

export function getSelfHostId(toolId: string): string | undefined {
  const id = ALIASES[toolId] ?? toolId
  return appIds.has(id) ? id : undefined
}

export function selfHostIcon(path?: string): string | undefined {
  return path ? `${SELFHOST_ICON_BASE}${path}` : undefined
}

export function buildSelfHostLink(ids: string[] = []): string {
  if (ids.length === 0) return `${SELFHOST_URL}/?ref=dcm`
  return `${SELFHOST_URL}/?apps=${ids.join(",")}&ref=dcm`
}

export function buildSelfHostCommand(ids: string[]): string {
  return `self-host install ${ids.join(" ")}`
}
