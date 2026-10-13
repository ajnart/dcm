import type { DockerTool } from "@/lib/docker-tools"
import { SELFHOST_ICON_BASE, getSelfHostId, selfHostApps } from "@/lib/selfhost"

export interface CatalogEntry extends DockerTool {
  selfhostId?: string
  selfhostOnly?: boolean
}

export interface Catalog {
  entries: CatalogEntry[]
}

export function selfHostIcon(path?: string): string | undefined {
  return path ? `${SELFHOST_ICON_BASE}${path}` : undefined
}

export function buildCatalog(tools: DockerTool[]): Catalog {
  const appsById = new Map(selfHostApps.map((app) => [app.id, app]))
  const covered = new Set<string>()
  const entries: CatalogEntry[] = tools.map((tool) => {
    const selfhostId = getSelfHostId(tool.id)
    if (!selfhostId) return tool
    covered.add(selfhostId)
    return {
      ...tool,
      icon: tool.icon ?? selfHostIcon(appsById.get(selfhostId)?.i),
      selfhostId,
    }
  })

  for (const app of selfHostApps) {
    if (covered.has(app.id)) continue
    entries.push({
      id: app.id,
      name: app.name,
      description: app.d,
      category: app.c,
      tags: [],
      icon: selfHostIcon(app.i),
      selfhostId: app.id,
      selfhostOnly: true,
    })
  }

  return { entries }
}

export function canGenerateYaml(entry: CatalogEntry): boolean {
  return Boolean(entry.composeContent) && !entry.isUnsupported
}

export interface ResolvedSelection {
  entries: CatalogEntry[]
  yamlTools: CatalogEntry[]
  yamlMissing: CatalogEntry[]
}

export function resolveSelection(
  ids: string[],
  catalog: Catalog,
): ResolvedSelection {
  const entryById = new Map(catalog.entries.map((entry) => [entry.id, entry]))
  const entries = ids.flatMap((id) => entryById.get(id) ?? [])
  return {
    entries,
    yamlTools: entries.filter(canGenerateYaml),
    yamlMissing: entries.filter((entry) => !canGenerateYaml(entry)),
  }
}

export function toSelfHostIds(ids: string[], catalog: Catalog): string[] {
  const entryById = new Map(catalog.entries.map((entry) => [entry.id, entry]))
  const result = new Set<string>()
  for (const id of ids) {
    const selfhostId = entryById.get(id)?.selfhostId
    if (selfhostId) result.add(selfhostId)
  }
  return [...result]
}
