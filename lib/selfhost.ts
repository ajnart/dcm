import data from "./selfhost-catalog.json"

export const SELFHOST_URL = "https://selfhost.ajnart.dev"
export const SELFHOST_SITE = "https://self-host.fyi"
export const SELFHOST_ICON_BASE =
  "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/"

export interface SelfHostApp {
  id: string
  name: string
  d: string
  c: string
  i?: string
}

export const selfHostApps: SelfHostApp[] = data.apps

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

export function buildSelfHostLink(ids: string[] = []): string {
  if (ids.length === 0) return `${SELFHOST_URL}/?ref=dcm`
  return `${SELFHOST_URL}/?apps=${ids.join(",")}&ref=dcm`
}

export function buildSelfHostCommand(ids: string[]): string {
  return `self-host install ${ids.join(" ")}`
}
