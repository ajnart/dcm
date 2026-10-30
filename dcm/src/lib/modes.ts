import { routes } from "@/lib/routes"

export type CatalogMode = "self-host" | "compose"

export const CATALOG_MODES: CatalogMode[] = ["self-host", "compose"]

export const MODE_LABELS: Record<CatalogMode, string> = {
  "self-host": "self-host",
  compose: "docker compose",
}

export const MODE_PATHS: Record<CatalogMode, string> = {
  "self-host": routes.apps,
  compose: routes.compose,
}

const LEGACY_MODES = new Map<string, CatalogMode>([
  ["self-host", "self-host"],
  ["all", "compose"],
])

export function modeHref(mode: CatalogMode, current: URL): string {
  return `${MODE_PATHS[mode]}${current.search}${current.hash}`
}

export function legacyModeTarget(url: URL): string | null {
  const mode = LEGACY_MODES.get(url.searchParams.get("mode") ?? "")
  const onCatalogPage = Object.values(MODE_PATHS).includes(url.pathname)
  if (!mode || !onCatalogPage) return null
  const clean = new URL(url)
  clean.searchParams.delete("mode")
  return modeHref(mode, clean)
}
