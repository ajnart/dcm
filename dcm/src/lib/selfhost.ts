import data from "../data/selfhost.json"

export const SELFHOST_URL = "https://self-host.fyi"
export const SELFHOST_INSTALL =
  "curl -fsSL https://self-host.fyi/install | bash"
export const SELFHOST_ICON_BASE =
  "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@83f32e08257b66fbd971ac8d7645f5b38d52e85d/"

export interface SelfHostEnvVar {
  key: string
  default: string
  description: string
  secret: boolean
  external?: boolean
  bytes?: number
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
export const selfHostGlobals: SelfHostEnvVar[] = data.globals

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
  const params = new URLSearchParams({ ref: "dcm" })
  if (ids.length) params.set("apps", ids.join(","))
  return `/?${params}#play`
}

export function buildSelfHostCommand(ids: string[]): string {
  return `self-host install ${ids.join(" ")}`
}
